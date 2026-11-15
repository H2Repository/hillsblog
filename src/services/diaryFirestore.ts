import {
  collection,
  doc,
  getCountFromServer,
  getDocFromServer,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  isFirestoreOfflineError,
  isFirestoreQuotaExceededError,
  OperationType,
} from '../lib/firebase';
import { DiaryEntry, TravelPhoto } from '../types';
import { createThumbnail, getDiaryPayloadSizeBytes } from '../utils/imageCompressor';
import { saveMultipleLocalDiaries } from '../utils/localDb';

export type ServerDiarySyncStatus = 'synced' | 'needs_update' | 'not_on_server';

export interface ServerDiaryMeta {
  id: string;
  updatedAt: number;
  createdAt?: number;
  hasSubcollectionPhotos?: boolean;
}

interface ServerSyncState {
  lastWatermark: number;
  lastCheckAt: number;
  lastFullSyncAt: number;
}

const SERVER_META_CACHE_KEY = 'hills_server_meta_cache_v1';
const SERVER_SYNC_STATE_KEY = 'hills_server_sync_state_v1';
const AUTO_SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between automatic boot scans

export function getCachedServerMetaMap(): {
  metaMap: Record<string, ServerDiaryMeta>;
  hasLoaded: boolean;
} {
  try {
    const raw = localStorage.getItem(SERVER_META_CACHE_KEY);
    if (!raw) return { metaMap: {}, hasLoaded: false };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        metaMap: parsed as Record<string, ServerDiaryMeta>,
        hasLoaded: Object.keys(parsed).length > 0,
      };
    }
  } catch {}
  return { metaMap: {}, hasLoaded: false };
}

export function saveCachedServerMetaMap(metaMap: Record<string, ServerDiaryMeta>): void {
  try {
    localStorage.setItem(SERVER_META_CACHE_KEY, JSON.stringify(metaMap));
  } catch {}
}

function getServerSyncState(): ServerSyncState {
  try {
    const raw = localStorage.getItem(SERVER_SYNC_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        lastWatermark: Number(parsed?.lastWatermark) || 0,
        lastCheckAt: Number(parsed?.lastCheckAt) || 0,
        lastFullSyncAt: Number(parsed?.lastFullSyncAt) || 0,
      };
    }
  } catch {}
  return { lastWatermark: 0, lastCheckAt: 0, lastFullSyncAt: 0 };
}

function saveServerSyncState(patch: Partial<ServerSyncState>): void {
  try {
    const current = getServerSyncState();
    localStorage.setItem(SERVER_SYNC_STATE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

const VALID_DOC_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_PARENT_DOC_BYTES = 100_000;
const MAX_PHOTO_DOC_BYTES = 600_000;
const PHOTO_CHUNK_CHAR_SIZE = 500_000;
const FIRESTORE_OP_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), ms)
    ),
  ]);
}

/**
 * Checks whether a diary ID satisfies Firestore rules (`^[a-zA-Z0-9_-]+$`, <= 128 chars).
 */
export function isValidFirestoreDiaryId(id?: string): boolean {
  return typeof id === 'string' && VALID_DOC_ID_REGEX.test(id);
}

/**
 * Generates a Firestore-rules-compliant ID if an existing local ID contains invalid characters.
 */
export function ensureValidFirestoreDiaryId(id?: string): string {
  if (isValidFirestoreDiaryId(id)) {
    return id as string;
  }
  const cleaned = (id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return cleaned ? `${cleaned}_${suffix}`.slice(0, 128) : `diary_${suffix}`;
}

/**
 * Recursively strips `undefined` values because Firestore rejects `undefined`.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Determines the sync status of an individual local diary relative to Firestore.
 */
export function getDiaryServerStatus(
  diary: DiaryEntry,
  serverMetaMap: Record<string, ServerDiaryMeta>
): ServerDiarySyncStatus {
  const serverMeta = serverMetaMap[diary.id];
  if (!serverMeta) {
    return 'not_on_server';
  }
  const localUpdatedAt = Number(diary.updatedAt) || 0;
  const serverUpdatedAt = Number(serverMeta.updatedAt) || 0;
  if (localUpdatedAt > serverUpdatedAt) {
    return 'needs_update';
  }
  return 'synced';
}



/**
 * Hydrates subcollection HD photos (including chunked photos) for a diary fetched from Firestore.
 */
async function hydrateSubcollectionPhotos(diaryId: string, fallbackPhotos: TravelPhoto[]): Promise<TravelPhoto[]> {
  try {
    const photosSnap = await withTimeout(
      getDocs(collection(db, 'diaries', diaryId, 'photos')),
      15_000,
      '사진 목록 불러오기 시간 초과'
    );
    if (photosSnap.empty) {
      return fallbackPhotos;
    }

    const sortedDocs = [...photosSnap.docs].sort((a, b) => {
      const orderA = typeof a.data().order === 'number' ? a.data().order : 9999;
      const orderB = typeof b.data().order === 'number' ? b.data().order : 9999;
      return orderA - orderB;
    });

    const hydrated = await Promise.all(
      sortedDocs.map(async (photoDoc) => {
        const pData = photoDoc.data();
        let url = String(pData.url || '');

        if (pData.isChunked) {
          const chunksSnap = await withTimeout(
            getDocs(collection(db, 'diaries', diaryId, 'photos', photoDoc.id, 'chunks')),
            15_000,
            '고화질 사진 조각 불러오기 시간 초과'
          );
          const sortedChunks = [...chunksSnap.docs].sort((a, b) => {
            const idxA = typeof a.data().index === 'number' ? a.data().index : 0;
            const idxB = typeof b.data().index === 'number' ? b.data().index : 0;
            return idxA - idxB;
          });
          url = sortedChunks.map((c) => String(c.data().data || '')).join('');
        }

        const photo: TravelPhoto = {
          id: String(pData.id || photoDoc.id),
          url,
          timestamp: String(pData.timestamp || new Date().toISOString()),
          isCover: Boolean(pData.isCover),
          ...(pData.caption ? { caption: String(pData.caption) } : {}),
        };
        return photo;
      })
    );

    return hydrated.filter((p) => Boolean(p.url));
  } catch (err) {
    console.warn(`[Firestore] Failed to hydrate photos for ${diaryId}:`, err);
    return fallbackPhotos;
  }
}

/**
 * Converts a Firestore document payload into a normalized DiaryEntry.
 */
function mapDocDataToDiaryEntry(docId: string, data: Record<string, unknown>, photos: TravelPhoto[]): DiaryEntry {
  const loc = (data.location as Record<string, unknown>) || {};
  const insights = (data.localInsights as Record<string, unknown>) || {};

  return {
    id: String(data.id || docId),
    title: String(data.title || '제목 없음'),
    content: String(data.content || ''),
    date: String(data.date || ''),
    time: String(data.time || '00:00'),
    location: {
      lat: typeof loc.lat === 'number' ? loc.lat : Number(loc.lat) || 0,
      lng: typeof loc.lng === 'number' ? loc.lng : Number(loc.lng) || 0,
      address: String(loc.address || ''),
      region: String(loc.region || '알 수 없음'),
      ...(loc.accuracy !== undefined ? { accuracy: Number(loc.accuracy) } : {}),
      ...(loc.landmark ? { landmark: String(loc.landmark) } : {}),
      ...(loc.isRealtimeGps !== undefined ? { isRealtimeGps: Boolean(loc.isRealtimeGps) } : {}),
      ...(loc.includeInDistance !== undefined ? { includeInDistance: Boolean(loc.includeInDistance) } : {}),
    },
    photos,
    weather: (data.weather as DiaryEntry['weather']) || 'sunny',
    moodTags: Array.isArray(data.moodTags) ? data.moodTags.map(String) : [],
    localInsights: {
      recommendedForSolo: String(insights.recommendedForSolo || ''),
      ...(insights.localFood ? { localFood: String(insights.localFood) } : {}),
      ...(insights.transportTip ? { transportTip: String(insights.transportTip) } : {}),
      ...(insights.soloTravelTip ? { soloTravelTip: String(insights.soloTravelTip) } : {}),
    },
    rating: typeof data.rating === 'number' ? data.rating : Number(data.rating) || 5,
    views: typeof data.views === 'number' ? data.views : Number(data.views) || 0,
    hasSubcollectionPhotos: Boolean(data.hasSubcollectionPhotos),
    totalPhotosCount: typeof data.totalPhotosCount === 'number' ? data.totalPhotosCount : photos.length,
    includeInDistance: data.includeInDistance !== undefined ? Boolean(data.includeInDistance) : true,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Number(data.createdAt) || Date.now(),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Number(data.updatedAt) || Date.now(),
    isModified: false,
  };
}

export interface ServerSyncResult {
  online: boolean;
  quotaExceeded?: boolean;
  skipped?: boolean;
  errorMessage?: string;
  serverMetaMap: Record<string, ServerDiaryMeta>;
  addedCount: number;
  updatedCount: number;
  syncedEntries: DiaryEntry[];
}

/**
 * Reads diaries from Firestore on app boot (or manual refresh) with minimal read units:
 * - On automatic boot (`force: false`), skips hitting Firestore if checked within 5 minutes and local cache exists.
 * - When a watermark exists (`lastWatermark > 0` + cached meta), queries ONLY documents with `updatedAt > lastWatermark`!
 * - Only performs a full collection scan on initial bootstrap (empty cache/IndexedDB) or when count mismatch indicates server deletion.
 * - Deduplicates concurrent calls (including React StrictMode double-mounts) via `inFlightSyncPromise` and short memory guard.
 */
let inFlightSyncPromise: Promise<ServerSyncResult> | null = null;
let lastAutoSyncAttemptTs = 0;

export async function syncMissingAndUpdatedFromServer(
  localDiaries: DiaryEntry[],
  options?: { force?: boolean }
): Promise<ServerSyncResult> {
  const force = Boolean(options?.force);

  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  const cachedMeta = getCachedServerMetaMap().metaMap;
  const cachedCount = Object.keys(cachedMeta).length;
  const syncState = getServerSyncState();
  const now = Date.now();

  // Prevent React StrictMode double-mount or rapid reloads from issuing duplicate reads
  if (!force && now - lastAutoSyncAttemptTs < 4000) {
    return {
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      quotaExceeded: false,
      skipped: true,
      serverMetaMap: cachedMeta,
      addedCount: 0,
      updatedCount: 0,
      syncedEntries: [],
    };
  }

  if (
    !force &&
    localDiaries.length > 0 &&
    cachedCount > 0 &&
    syncState.lastCheckAt > 0 &&
    now - syncState.lastCheckAt < AUTO_SYNC_COOLDOWN_MS
  ) {
    return {
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      quotaExceeded: false,
      skipped: true,
      serverMetaMap: cachedMeta,
      addedCount: 0,
      updatedCount: 0,
      syncedEntries: [],
    };
  }

  if (!force) {
    lastAutoSyncAttemptTs = now;
  }

  inFlightSyncPromise = (async () => {
    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!browserOnline) {
      return {
        online: false,
        quotaExceeded: false,
        serverMetaMap: cachedMeta,
        addedCount: 0,
        updatedCount: 0,
        syncedEntries: [],
      };
    }

    const diariesCol = collection(db, 'diaries');
    const derivedWatermark =
      syncState.lastWatermark > 0
        ? syncState.lastWatermark
        : cachedCount > 0
          ? Math.max(...Object.values(cachedMeta).map((m) => Number(m.updatedAt) || 0), 0)
          : 0;

    // Use incremental query whenever we already have a synced baseline
    let useIncremental = derivedWatermark > 0 && cachedCount > 0 && localDiaries.length > 0;

    // On manual refresh, verify total server count via lightweight aggregation (1 read unit)
    // to detect whether a diary was deleted from another device.
    if (force && useIncremental) {
      try {
        const countSnap = await withTimeout(
          getCountFromServer(diariesCol),
          10_000,
          '서버 일기 개수 확인 시간 초과'
        );
        const serverCount = countSnap.data().count;
        if (serverCount < cachedCount) {
          useIncremental = false;
        }
      } catch (countErr) {
        if (isFirestoreQuotaExceededError(countErr)) {
          saveServerSyncState({ lastCheckAt: Date.now() });
          return {
            online: browserOnline,
            quotaExceeded: true,
            errorMessage: countErr instanceof Error ? countErr.message : String(countErr),
            serverMetaMap: cachedMeta,
            addedCount: 0,
            updatedCount: 0,
            syncedEntries: [],
          };
        }
      }
    }

    let snap;
    try {
      const targetQuery = useIncremental
        ? query(diariesCol, where('updatedAt', '>', derivedWatermark))
        : diariesCol;

      snap = await withTimeout(
        getDocs(targetQuery),
        25_000,
        '서버 일기 목록 조회 시간 초과'
      );
    } catch (error) {
      console.warn('[Firestore] syncMissingAndUpdatedFromServer failed:', error);
      const quotaExceeded = isFirestoreQuotaExceededError(error);
      const offline = !browserOnline || (!quotaExceeded && isFirestoreOfflineError(error));
      if (quotaExceeded) {
        saveServerSyncState({ lastCheckAt: Date.now() });
      }
      return {
        online: !offline,
        quotaExceeded,
        errorMessage: error instanceof Error ? error.message : String(error),
        serverMetaMap: cachedMeta,
        addedCount: 0,
        updatedCount: 0,
        syncedEntries: [],
      };
    }

    const localMap = new Map<string, DiaryEntry>();
    for (const item of localDiaries) {
      if (item?.id) localMap.set(item.id, item);
    }

    const serverMetaMap: Record<string, ServerDiaryMeta> = useIncremental ? { ...cachedMeta } : {};
    const entriesToSave: DiaryEntry[] = [];
    let addedCount = 0;
    let updatedCount = 0;
    let maxSeenUpdatedAt = derivedWatermark;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const serverUpdatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : Number(data.updatedAt) || 0;
      const serverCreatedAt = typeof data.createdAt === 'number' ? data.createdAt : Number(data.createdAt) || undefined;
      if (serverUpdatedAt > maxSeenUpdatedAt) {
        maxSeenUpdatedAt = serverUpdatedAt;
      }

      serverMetaMap[docSnap.id] = {
        id: docSnap.id,
        updatedAt: serverUpdatedAt,
        createdAt: serverCreatedAt,
        hasSubcollectionPhotos: Boolean(data.hasSubcollectionPhotos),
      };

      const localEntry = localMap.get(docSnap.id);
      const localUpdatedAt = localEntry ? Number(localEntry.updatedAt) || 0 : -1;

      const needsAdd = !localEntry;
      const needsUpdate = Boolean(localEntry && serverUpdatedAt > localUpdatedAt);

      if (needsAdd || needsUpdate) {
        const parentPhotos = Array.isArray(data.photos) ? (data.photos as TravelPhoto[]) : [];
        const fullPhotos = data.hasSubcollectionPhotos
          ? await hydrateSubcollectionPhotos(docSnap.id, parentPhotos)
          : parentPhotos;

        const mapped = mapDocDataToDiaryEntry(docSnap.id, data, fullPhotos);
        if (localEntry) {
          mapped.views = Math.max(localEntry.views || 0, mapped.views || 0);
          updatedCount++;
        } else {
          addedCount++;
        }
        entriesToSave.push(mapped);
      }
    }

    if (entriesToSave.length > 0) {
      await saveMultipleLocalDiaries(entriesToSave, true);
    }

    saveCachedServerMetaMap(serverMetaMap);
    saveServerSyncState({
      lastWatermark: maxSeenUpdatedAt > 0 ? maxSeenUpdatedAt : Date.now(),
      lastCheckAt: Date.now(),
      ...(useIncremental ? {} : { lastFullSyncAt: Date.now() }),
    });

    return {
      online: true,
      quotaExceeded: false,
      serverMetaMap,
      addedCount,
      updatedCount,
      syncedEntries: entriesToSave,
    };
  })().finally(() => {
    inFlightSyncPromise = null;
  });

  return inFlightSyncPromise;
}

/**
 * Checks server diary count via lightweight aggregation query (1 read unit).
 */
export async function fetchServerDiaryCountAndStatus(): Promise<{
  metaMap: Record<string, ServerDiaryMeta>;
  count: number;
  online: boolean;
  quotaExceeded?: boolean;
}> {
  const cachedMeta = getCachedServerMetaMap().metaMap;
  const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!browserOnline) {
    return { metaMap: cachedMeta, count: Object.keys(cachedMeta).length, online: false, quotaExceeded: false };
  }

  try {
    const countSnap = await withTimeout(
      getCountFromServer(collection(db, 'diaries')),
      15_000,
      '서버 일기 수량 조회 시간 초과'
    );
    return { metaMap: cachedMeta, count: countSnap.data().count, online: true, quotaExceeded: false };
  } catch (err) {
    console.warn('[Firestore] fetchServerDiaryCountAndStatus fallback:', err);
    const quotaExceeded = isFirestoreQuotaExceededError(err);
    const offline = !browserOnline || (!quotaExceeded && isFirestoreOfflineError(err));
    return {
      metaMap: cachedMeta,
      count: Object.keys(cachedMeta).length,
      online: !offline,
      quotaExceeded,
    };
  }
}

/**
 * Deletes any existing subcollection photos and chunks under `diaries/{diaryId}/photos`.
 */
async function clearSubcollectionPhotos(diaryId: string): Promise<void> {
  const photosCol = collection(db, 'diaries', diaryId, 'photos');
  const photoSnaps = await withTimeout(getDocs(photosCol), 10_000, '기존 사진 정리 시간 초과');
  if (photoSnaps.empty) return;

  await Promise.all(
    photoSnaps.docs.map(async (photoDoc) => {
      const chunksCol = collection(db, 'diaries', diaryId, 'photos', photoDoc.id, 'chunks');
      const chunkSnaps = await withTimeout(getDocs(chunksCol), 10_000, '기존 사진 조각 정리 시간 초과');
      if (!chunkSnaps.empty) {
        const batch = writeBatch(db);
        chunkSnaps.docs.forEach((c) => batch.delete(c.ref));
        await withTimeout(batch.commit(), 15_000, '기존 사진 조각 삭제 시간 초과');
      }
      await withTimeout(deleteDoc(photoDoc.ref), 10_000, '기존 사진 삭제 시간 초과');
    })
  );
}

/**
 * Prepares a Firestore-valid diary document body (satisfying `isValidDiary` rules).
 */
function buildValidatedDiaryPayload(
  entry: DiaryEntry,
  validId: string,
  photosForParent: TravelPhoto[],
  hasSubcollectionPhotos: boolean,
  totalPhotosCount: number,
  syncTimestamp: number
): Record<string, unknown> {
  const parsedLat = Number(entry.location?.lat);
  const parsedLng = Number(entry.location?.lng);
  const safeLocation = {
    lat: Number.isFinite(parsedLat) ? parsedLat : 0,
    lng: Number.isFinite(parsedLng) ? parsedLng : 0,
    address: String(entry.location?.address || '').slice(0, 500),
    region: String(entry.location?.region || '알 수 없음').slice(0, 200),
    ...(entry.location?.accuracy !== undefined && Number.isFinite(Number(entry.location.accuracy))
      ? { accuracy: Number(entry.location.accuracy) }
      : {}),
    ...(entry.location?.landmark ? { landmark: String(entry.location.landmark).slice(0, 200) } : {}),
    ...(entry.location?.isRealtimeGps !== undefined ? { isRealtimeGps: Boolean(entry.location.isRealtimeGps) } : {}),
    ...(entry.location?.includeInDistance !== undefined
      ? { includeInDistance: Boolean(entry.location.includeInDistance) }
      : {}),
  };

  const payload: Record<string, unknown> = {
    id: validId,
    title: String(entry.title || '제목 없음').slice(0, 1000),
    content: String(entry.content || '').slice(0, 100000),
    date: String(entry.date || new Date().toISOString().slice(0, 10)).slice(0, 50),
    time: String(entry.time || '00:00').slice(0, 50),
    location: safeLocation,
    photos: photosForParent,
    weather: entry.weather || 'sunny',
    moodTags: Array.isArray(entry.moodTags) ? entry.moodTags.map(String) : [],
    localInsights: {
      recommendedForSolo: String(entry.localInsights?.recommendedForSolo || ''),
      ...(entry.localInsights?.localFood ? { localFood: String(entry.localInsights.localFood) } : {}),
      ...(entry.localInsights?.transportTip ? { transportTip: String(entry.localInsights.transportTip) } : {}),
      ...(entry.localInsights?.soloTravelTip ? { soloTravelTip: String(entry.localInsights.soloTravelTip) } : {}),
    },
    rating: Math.min(5, Math.max(0, Number(entry.rating ?? 5) || 0)),
    views: Math.max(0, Number(entry.views || 0) || 0),
    hasSubcollectionPhotos,
    totalPhotosCount,
    includeInDistance: entry.includeInDistance !== undefined ? Boolean(entry.includeInDistance) : true,
    createdAt: Number(entry.createdAt) || syncTimestamp,
    updatedAt: syncTimestamp,
  };

  return stripUndefined(payload);
}

/**
 * Adds or updates a SINGLE local diary entry on Firestore (`diaries/{diaryId}`),
 * automatically spilling large base64 photos to `photos/{photoId}` + `chunks/{chunkId}`
 * so the parent document never exceeds Firestore's 1MB limit.
 * Writes subcollection photos FIRST and the parent document LAST to avoid premature snapshot updates,
 * with strict timeouts on every step so uploads never hang indefinitely.
 */
export async function upsertDiaryToFirestore(
  entry: DiaryEntry,
  options?: { isExistingOnServer?: boolean; existingHasSubcollectionPhotos?: boolean }
): Promise<{ updatedDiary: DiaryEntry; meta: ServerDiaryMeta }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('오프라인 상태에서는 서버에 반영할 수 없습니다. 인터넷 연결을 확인해주세요.');
  }

  const validId = ensureValidFirestoreDiaryId(entry.id);
  const syncTimestamp = Number(entry.updatedAt) || Date.now();
  const photos = Array.isArray(entry.photos) ? entry.photos : [];
  const totalPhotosCount = Math.max(photos.length, entry.totalPhotosCount || 0);

  const seenPhotoIds = new Set<string>();
  const sanitizedPhotos: TravelPhoto[] = photos.map((p, idx) => {
    let safePhotoId = ensureValidFirestoreDiaryId(p.id || `photo_${idx}`);
    if (seenPhotoIds.has(safePhotoId)) {
      safePhotoId = `${safePhotoId.slice(0, 110)}_${idx}`;
    }
    seenPhotoIds.add(safePhotoId);
    return stripUndefined({
      id: safePhotoId,
      url: String(p.url || ''),
      caption: p.caption !== undefined ? String(p.caption) : undefined,
      timestamp: String(p.timestamp || new Date().toISOString()),
      isCover: Boolean(p.isCover),
    });
  });

  // Measure size if stored inline inside the parent diary document
  const inlineCandidate = buildValidatedDiaryPayload(
    entry,
    validId,
    sanitizedPhotos,
    false,
    totalPhotosCount,
    syncTimestamp
  );
  const inlineBytes = getDiaryPayloadSizeBytes(inlineCandidate);

  const diaryDocRef = doc(db, 'diaries', validId);
  const shouldClearExistingSubPhotos = Boolean(
    options?.isExistingOnServer && (options?.existingHasSubcollectionPhotos || entry.hasSubcollectionPhotos)
  );
  let storedInSubcollection = false;

  if (inlineBytes <= MAX_PARENT_DOC_BYTES) {
    try {
      await withTimeout(
        setDoc(diaryDocRef, inlineCandidate),
        FIRESTORE_OP_TIMEOUT_MS,
        '일기 서버 저장 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
      );
      if (shouldClearExistingSubPhotos) {
        await clearSubcollectionPhotos(validId).catch(() => {});
      }
    } catch (error) {
      // Only perform a read verification if setDoc timed out waiting for ACK
      let confirmedOnServer = false;
      const isTimeout = error instanceof Error && error.message.includes('시간 초과');
      if (isTimeout) {
        try {
          const serverSnap = await withTimeout(getDocFromServer(diaryDocRef), 6000, '확인 시간 초과');
          if (serverSnap.exists() && (Number(serverSnap.data()?.updatedAt) || 0) >= syncTimestamp) {
            confirmedOnServer = true;
          }
        } catch {}
      }

      if (!confirmedOnServer) {
        handleFirestoreError(error, OperationType.WRITE, `diaries/${validId}`);
      }
    }
  } else {
    // Prepare lightweight thumbnails for parent preview (bounded with 5s timeout per photo)
    const parentPreviewPhotos: TravelPhoto[] = [];
    for (let i = 0; i < sanitizedPhotos.length; i++) {
      const p = sanitizedPhotos[i];
      let thumbUrl = '';
      if (p.url && (i === 0 || p.isCover || i < 4)) {
        try {
          thumbUrl = p.url.startsWith('data:image/')
            ? await withTimeout(createThumbnail(p.url, 420, 0.7), 5_000, '썸네일 생성 시간 초과')
            : p.url;
        } catch {
          thumbUrl = '';
        }
      }
      const candidatePreview: TravelPhoto = stripUndefined({
        id: p.id,
        url: thumbUrl,
        caption: p.caption,
        timestamp: p.timestamp,
        isCover: p.isCover,
      });

      const testParent = buildValidatedDiaryPayload(
        entry,
        validId,
        [...parentPreviewPhotos, candidatePreview],
        true,
        totalPhotosCount,
        syncTimestamp
      );
      if (getDiaryPayloadSizeBytes(testParent) <= MAX_PARENT_DOC_BYTES) {
        parentPreviewPhotos.push(candidatePreview);
      } else {
        parentPreviewPhotos.push(
          stripUndefined({
            id: p.id,
            url: '',
            caption: p.caption,
            timestamp: p.timestamp,
            isCover: p.isCover,
          })
        );
      }
    }

    const parentPayload = buildValidatedDiaryPayload(
      entry,
      validId,
      parentPreviewPhotos,
      true,
      totalPhotosCount,
      syncTimestamp
    );

    storedInSubcollection = true;
    try {
      if (shouldClearExistingSubPhotos) {
        await clearSubcollectionPhotos(validId).catch(() => {});
      }

      // Upload subcollection photos & chunks sequentially in compact <= 600KB batches
      for (let i = 0; i < sanitizedPhotos.length; i++) {
        const photo = sanitizedPhotos[i];
        const photoRef = doc(db, 'diaries', validId, 'photos', photo.id);
        const photoPayload = stripUndefined({
          id: photo.id,
          url: photo.url,
          caption: photo.caption,
          timestamp: photo.timestamp,
          isCover: Boolean(photo.isCover),
          order: i,
        });

        if (getDiaryPayloadSizeBytes(photoPayload) <= MAX_PHOTO_DOC_BYTES) {
          await withTimeout(
            setDoc(photoRef, { ...photoPayload, isChunked: false, chunkCount: 0 }),
            FIRESTORE_OP_TIMEOUT_MS,
            `사진(${i + 1}) 저장 시간이 초과되었습니다.`
          );
        } else {
          const chunks: string[] = [];
          for (let offset = 0; offset < photo.url.length; offset += PHOTO_CHUNK_CHAR_SIZE) {
            chunks.push(photo.url.slice(offset, offset + PHOTO_CHUNK_CHAR_SIZE));
          }

          await withTimeout(
            setDoc(
              photoRef,
              stripUndefined({
                id: photo.id,
                url: '',
                caption: photo.caption,
                timestamp: photo.timestamp,
                isCover: Boolean(photo.isCover),
                order: i,
                isChunked: true,
                chunkCount: chunks.length,
              })
            ),
            FIRESTORE_OP_TIMEOUT_MS,
            `사진(${i + 1}) 메타 저장 시간이 초과되었습니다.`
          );

          // Commit chunks in compact batches of 2 (2 * 500KB = 1MB max) for mobile reliability
          for (let start = 0; start < chunks.length; start += 2) {
            const batch = writeBatch(db);
            const slice = chunks.slice(start, start + 2);
            slice.forEach((chunkData, offsetIdx) => {
              const cIdx = start + offsetIdx;
              const chunkRef = doc(db, 'diaries', validId, 'photos', photo.id, 'chunks', `chunk_${cIdx}`);
              batch.set(chunkRef, { index: cIdx, data: chunkData });
            });
            await withTimeout(
              batch.commit(),
              FIRESTORE_OP_TIMEOUT_MS,
              `고화질 사진(${i + 1}) 업로드 시간이 초과되었습니다.`
            );
          }
        }
      }

      // Write parent diary document LAST once all photos are safely stored
      await withTimeout(
        setDoc(diaryDocRef, parentPayload),
        FIRESTORE_OP_TIMEOUT_MS,
        '일기 본문 서버 저장 시간이 초과되었습니다.'
      );
    } catch (error) {
      let confirmedOnServer = false;
      const isTimeout = error instanceof Error && error.message.includes('시간 초과');
      if (isTimeout) {
        try {
          const serverSnap = await withTimeout(getDocFromServer(diaryDocRef), 6000, '확인 시간 초과');
          if (serverSnap.exists() && (Number(serverSnap.data()?.updatedAt) || 0) >= syncTimestamp) {
            confirmedOnServer = true;
          }
        } catch {}
      }

      if (!confirmedOnServer) {
        handleFirestoreError(error, OperationType.WRITE, `diaries/${validId}`);
      }
    }
  }

  const updatedDiary: DiaryEntry = {
    ...entry,
    id: validId,
    hasSubcollectionPhotos: storedInSubcollection,
    updatedAt: syncTimestamp,
    createdAt: Number(entry.createdAt) || syncTimestamp,
  };

  return {
    updatedDiary,
    meta: {
      id: validId,
      updatedAt: syncTimestamp,
      createdAt: updatedDiary.createdAt,
      hasSubcollectionPhotos: storedInSubcollection,
    },
  };
}
