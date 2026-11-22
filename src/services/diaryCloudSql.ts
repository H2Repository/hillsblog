import { DiaryEntry, TravelPhoto } from '../types';
import { createThumbnail } from '../utils/imageCompressor';
import {
  deleteLocalDiary,
  getLocalMeta,
  saveLocalDiary,
  saveMultipleLocalDiaries,
  setLocalMeta,
} from '../utils/localDb';
import {
  diaryNeedsPhotoHydration,
  filterValidPhotos,
  isValidPhotoUrl,
  normalizeTitle,
} from '../utils/storage';

export type ServerDiarySyncStatus = 'synced' | 'needs_update' | 'not_on_server';

export interface ServerDiaryMeta {
  id: string;
  updatedAt: number;
  createdAt?: number;
  title?: string;
  date?: string;
  time?: string;
  hasSubcollectionPhotos?: boolean;
  includeInDistance?: boolean;
  photoSigs?: Record<string, string>;
}

interface ServerSyncState {
  lastWatermark: number;
  lastCheckAt: number;
  lastFullSyncAt: number;
}

const SERVER_META_CACHE_KEY = 'hills_cloudsql_meta_cache_v1';
const SERVER_SYNC_STATE_KEY = 'hills_cloudsql_sync_state_v1';
const PENDING_DELETES_CACHE_KEY = 'hills_cloudsql_pending_deletes_v1';
const MIGRATION_LOCAL_INCLUDE_ALL_KEY = 'hills_migration_include_all_distance_v1';
const MIGRATION_SERVER_INCLUDE_ALL_KEY = 'hills_migration_server_include_all_v1';
const HYDRATION_ATTEMPT_COOLDOWN_MS = 30 * 1000;

export type IdTokenGetter = (forceRefresh?: boolean) => Promise<string | null>;

function computePhotoContentSig(url: string): string {
  const len = url.length;
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(len / 64));
  for (let i = 0; i < len; i += step) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const tailStart = Math.max(0, len - 32);
  for (let i = tailStart; i < len; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${len}:${(hash >>> 0).toString(36)}`;
}

function computePhotoFullSig(photo: TravelPhoto, order: number): string {
  const contentSig = computePhotoContentSig(String(photo.url || ''));
  return `${contentSig}|${photo.isCover ? 1 : 0}|${order}|${String(photo.caption || '').slice(0, 120)}`;
}

function buildDiaryPhotoSigs(photos: TravelPhoto[]): Record<string, string> {
  const sigs: Record<string, string> = {};
  photos.forEach((p, idx) => {
    if (p?.id && p?.url && !p.isThumbnailOnly) {
      sigs[p.id] = computePhotoFullSig(p, idx);
    }
  });
  return sigs;
}

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
  setLocalMeta(SERVER_META_CACHE_KEY, metaMap).catch(() => {});
  try {
    const json = JSON.stringify(metaMap);
    if (json.length <= 350_000) {
      localStorage.setItem(SERVER_META_CACHE_KEY, json);
    } else {
      const stripped: Record<string, ServerDiaryMeta> = {};
      for (const [k, v] of Object.entries(metaMap)) {
        stripped[k] = {
          id: v.id,
          updatedAt: v.updatedAt,
          ...(v.createdAt !== undefined ? { createdAt: v.createdAt } : {}),
          ...(v.hasSubcollectionPhotos !== undefined
            ? { hasSubcollectionPhotos: v.hasSubcollectionPhotos }
            : {}),
          ...(v.includeInDistance !== undefined
            ? { includeInDistance: v.includeInDistance }
            : {}),
        };
      }
      localStorage.setItem(SERVER_META_CACHE_KEY, JSON.stringify(stripped));
    }
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
  const next = { ...getServerSyncState(), ...patch };
  setLocalMeta(SERVER_SYNC_STATE_KEY, next).catch(() => {});
  try {
    localStorage.setItem(SERVER_SYNC_STATE_KEY, JSON.stringify(next));
  } catch {}
}

export function getPendingServerDeleteIds(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_DELETES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return Array.from(new Set(parsed.map((v) => String(v || '').trim()).filter(Boolean)));
    }
  } catch {}
  return [];
}

export function savePendingServerDeleteIds(ids: string[]): void {
  const normalized = Array.from(new Set(ids.map((v) => String(v || '').trim()).filter(Boolean)));
  setLocalMeta(PENDING_DELETES_CACHE_KEY, normalized).catch(() => {});
  try {
    localStorage.setItem(PENDING_DELETES_CACHE_KEY, JSON.stringify(normalized));
  } catch {}
}

export function clearServerSyncCaches(): void {
  try {
    localStorage.removeItem(SERVER_META_CACHE_KEY);
    localStorage.removeItem(SERVER_SYNC_STATE_KEY);
    localStorage.removeItem(PENDING_DELETES_CACHE_KEY);
  } catch {}
}

export async function loadDurablePendingServerDeleteIds(): Promise<string[]> {
  const lsList = getPendingServerDeleteIds();
  const idbList = await getLocalMeta<string[]>(PENDING_DELETES_CACHE_KEY);
  const merged = Array.from(
    new Set([
      ...lsList,
      ...(Array.isArray(idbList) ? idbList.map((v) => String(v || '').trim()).filter(Boolean) : []),
    ])
  );
  if (merged.length > lsList.length) {
    try {
      localStorage.setItem(PENDING_DELETES_CACHE_KEY, JSON.stringify(merged));
    } catch {}
  }
  return merged;
}

export async function addPendingServerDeleteId(id: string): Promise<string[]> {
  const trimmed = String(id || '').trim();
  if (!trimmed) return loadDurablePendingServerDeleteIds();
  const current = await loadDurablePendingServerDeleteIds();
  if (current.includes(trimmed)) return current;
  const next = [...current, trimmed];
  savePendingServerDeleteIds(next);
  return next;
}

export async function removePendingServerDeleteIds(idsToRemove: string[]): Promise<string[]> {
  const removeSet = new Set(idsToRemove.map((v) => String(v || '').trim()).filter(Boolean));
  if (removeSet.size === 0) return loadDurablePendingServerDeleteIds();
  const current = await loadDurablePendingServerDeleteIds();
  const next = current.filter((id) => !removeSet.has(id));
  savePendingServerDeleteIds(next);
  return next;
}

export async function restoreDurableSyncCachesFromIdb(): Promise<{
  metaMap: Record<string, ServerDiaryMeta>;
  hasLoaded: boolean;
  pendingDeleteIds: string[];
}> {
  const lsMeta = getCachedServerMetaMap();
  const idbMeta = await getLocalMeta<Record<string, ServerDiaryMeta>>(SERVER_META_CACHE_KEY);
  const idbState = await getLocalMeta<ServerSyncState>(SERVER_SYNC_STATE_KEY);
  const pendingDeleteIds = await loadDurablePendingServerDeleteIds();

  let effectiveMeta = lsMeta.metaMap;
  let hasLoaded = lsMeta.hasLoaded;
  if (idbMeta && Object.keys(idbMeta).length >= Object.keys(lsMeta.metaMap).length) {
    effectiveMeta = idbMeta;
    hasLoaded = Object.keys(idbMeta).length > 0;
    try {
      const json = JSON.stringify(idbMeta);
      if (json.length <= 350_000) {
        localStorage.setItem(SERVER_META_CACHE_KEY, json);
      }
    } catch {}
  }

  const lsState = getServerSyncState();
  if (idbState && (idbState.lastWatermark > lsState.lastWatermark || idbState.lastCheckAt > lsState.lastCheckAt)) {
    try {
      localStorage.setItem(SERVER_SYNC_STATE_KEY, JSON.stringify(idbState));
    } catch {}
  }

  return {
    metaMap: effectiveMeta,
    hasLoaded,
    pendingDeleteIds,
  };
}

export function areDiaryPhotosSyncedWithMeta(
  diary: DiaryEntry,
  serverMeta?: ServerDiaryMeta
): boolean {
  if (!serverMeta) return false;
  if (!serverMeta.photoSigs) return true;
  if (diaryNeedsPhotoHydration(diary)) return true;
  const localSigs = buildDiaryPhotoSigs(filterValidPhotos(diary.photos));
  const localKeys = Object.keys(localSigs);
  const serverKeys = Object.keys(serverMeta.photoSigs);
  if (localKeys.length !== serverKeys.length) return false;
  for (const key of localKeys) {
    if (localSigs[key] !== serverMeta.photoSigs[key]) {
      return false;
    }
  }
  return true;
}

export function findMatchingServerMeta(
  diary: DiaryEntry,
  serverMetaMap: Record<string, ServerDiaryMeta>
): ServerDiaryMeta | undefined {
  if (!diary) return undefined;
  const direct = serverMetaMap[diary.id];
  if (direct) return direct;

  const localTitle = normalizeTitle(diary.title);
  const localDate = (diary.date || '').trim();
  if (!localTitle || !localDate) return undefined;

  for (const meta of Object.values(serverMetaMap)) {
    if ((meta.date || '').trim() !== localDate) continue;
    if (normalizeTitle(meta.title) !== localTitle) continue;

    const sameCreated =
      Boolean(diary.createdAt && meta.createdAt) &&
      Math.abs((diary.createdAt || 0) - (meta.createdAt || 0)) <= 2000;
    const sameTime = Boolean(diary.time && meta.time) && diary.time === meta.time;

    if (sameCreated || sameTime) {
      return meta;
    }
  }
  return undefined;
}

export function getDiaryServerStatus(
  diary: DiaryEntry,
  serverMetaMap: Record<string, ServerDiaryMeta>,
  hasLoadedServerMeta = Object.keys(serverMetaMap).length > 0
): ServerDiarySyncStatus {
  const serverMeta = findMatchingServerMeta(diary, serverMetaMap);
  if (serverMeta) {
    const localUpdatedAt = diary.updatedAt || diary.createdAt || 0;
    if (localUpdatedAt > serverMeta.updatedAt) {
      return 'needs_update';
    }
    if (!areDiaryPhotosSyncedWithMeta(diary, serverMeta)) {
      return 'needs_update';
    }
    return 'synced';
  }
  if (diary.localSyncStatus === 'not_on_server') {
    return 'not_on_server';
  }
  if (diary.localSyncStatus === 'needs_update') {
    return 'needs_update';
  }
  if (hasLoadedServerMeta) {
    return 'not_on_server';
  }
  return 'synced';
}

async function fetchPublicOrAuth(
  url: string,
  getIdToken?: IdTokenGetter,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (getIdToken) {
    const token = await getIdToken().catch(() => null);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return fetch(url, { cache: init.cache ?? 'no-store', ...init, headers });
}

async function fetchWithAuth(
  url: string,
  getIdToken: IdTokenGetter,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();
  if (!token) {
    throw new Error('Google 계정 로그인이 필요합니다.');
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    const refreshed = await getIdToken(true);
    if (refreshed) {
      headers.set('Authorization', `Bearer ${refreshed}`);
      res = await fetch(url, { ...init, headers });
    }
  }
  return res;
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx <= 0) {
    throw new Error('유효하지 않은 이미지 데이터입니다.');
  }
  const header = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  if (header.includes(';base64')) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return { blob: new Blob([bytes], { type: mimeType }), mimeType };
  }
  return { blob: new Blob([decodeURIComponent(body)], { type: mimeType }), mimeType };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('이미지 변환 실패'));
    reader.readAsDataURL(blob);
  });
}

async function parseErrorResponse(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {}
  return `${fallback} (HTTP ${res.status})`;
}

export async function upsertDiaryToServer(
  diary: DiaryEntry,
  getIdToken: IdTokenGetter
): Promise<{
  updatedDiary: DiaryEntry;
  meta: ServerDiaryMeta;
}> {
  const validPhotos = filterValidPhotos(diary.photos);
  const photosMeta = await Promise.all(
    validPhotos.map(async (photo, idx) => {
      const isDataUrl = photo.url.startsWith('data:image/');
      let thumb = photo.thumbnailUrl;
      if (isDataUrl && !thumb) {
        try {
          thumb = await createThumbnail(photo.url, 240, 0.62);
          if (thumb.length > 24_000) {
            thumb = await createThumbnail(photo.url, 180, 0.5);
          }
        } catch {
          thumb = undefined;
        }
      }
      return {
        photoId: photo.id || `photo_${idx}`,
        orderIndex: idx,
        caption: photo.caption || '',
        timestamp: photo.timestamp || new Date().toISOString(),
        isCover: Boolean(photo.isCover),
        mimeType: 'image/jpeg',
        contentSig: computePhotoContentSig(photo.url),
        thumbnailUrl: thumb,
        externalUrl: isDataUrl ? undefined : photo.url,
        _originalPhoto: photo,
      };
    })
  );

  const nowTs = Math.max(diary.updatedAt || 0, diary.createdAt || 0, Date.now());
  const payload = {
    title: diary.title || '제목 없음',
    content: diary.content || '',
    date: diary.date || '',
    time: diary.time || '',
    location: diary.location,
    weather: diary.weather || 'sunny',
    moodTags: Array.isArray(diary.moodTags) ? diary.moodTags : [],
    localInsights: diary.localInsights || { recommendedForSolo: '' },
    rating: diary.rating ?? 5,
    includeInDistance: diary.includeInDistance ?? diary.location?.includeInDistance ?? true,
    createdAt: diary.createdAt || nowTs,
    updatedAt: nowTs,
    isModified: Boolean(diary.isModified),
    photos: photosMeta.map(({ _originalPhoto, ...rest }) => rest),
  };

  const metaRes = await fetchWithAuth(`/api/diaries/${encodeURIComponent(diary.id)}`, getIdToken, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!metaRes.ok) {
    throw new Error(await parseErrorResponse(metaRes, '일기 메타데이터 저장 실패'));
  }

  const metaJson = (await metaRes.json()) as {
    diaryId: string;
    missingPhotoIds: string[];
    photoSigs: Record<string, string>;
  };

  const missingSet = new Set(metaJson.missingPhotoIds || []);
  const finalSigs: Record<string, string> = { ...(metaJson.photoSigs || {}) };

  // Upload ONLY new/changed binary photos individually (raw binary, zero Base64 overhead)
  for (const item of photosMeta) {
    if (!missingSet.has(item.photoId)) continue;
    const rawUrl = item._originalPhoto.url;
    if (!rawUrl.startsWith('data:image/')) continue;

    const { blob, mimeType } = dataUrlToBlob(rawUrl);
    const uploadRes = await fetchWithAuth(
      `/api/diaries/${encodeURIComponent(diary.id)}/photos/${encodeURIComponent(item.photoId)}`,
      getIdToken,
      {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'x-photo-order': String(item.orderIndex),
          'x-photo-cover': item.isCover ? 'true' : 'false',
          'x-photo-sig': encodeURIComponent(item.contentSig),
          'x-photo-caption': encodeURIComponent(item.caption.slice(0, 120)),
          'x-photo-timestamp': encodeURIComponent(item.timestamp),
        },
        body: blob,
      }
    );

    if (!uploadRes.ok) {
      throw new Error(await parseErrorResponse(uploadRes, `사진(${item.photoId}) 업로드 실패`));
    }

    const uploadData = (await uploadRes.json()) as { fullSig?: string };
    if (uploadData.fullSig) {
      finalSigs[item.photoId] = uploadData.fullSig;
    }
  }

  const updatedDiary: DiaryEntry = {
    ...diary,
    updatedAt: nowTs,
    isModified: false,
    localSyncStatus: 'synced',
    totalPhotosCount: validPhotos.length,
    hasSubcollectionPhotos: validPhotos.some((p) => p.url.startsWith('data:image/')),
  };

  const serverMeta: ServerDiaryMeta = {
    id: diary.id,
    updatedAt: nowTs,
    createdAt: updatedDiary.createdAt,
    title: updatedDiary.title,
    date: updatedDiary.date,
    time: updatedDiary.time,
    hasSubcollectionPhotos: updatedDiary.hasSubcollectionPhotos,
    includeInDistance: updatedDiary.includeInDistance ?? updatedDiary.location?.includeInDistance ?? true,
    photoSigs: finalSigs,
  };

  return { updatedDiary, meta: serverMeta };
}

async function hasMigrationFlag(key: string): Promise<boolean> {
  try {
    if (localStorage.getItem(key) === 'done') return true;
  } catch {}
  const idbVal = await getLocalMeta<string>(key).catch(() => null);
  if (idbVal === 'done') {
    try {
      localStorage.setItem(key, 'done');
    } catch {}
    return true;
  }
  return false;
}

async function markMigrationFlag(key: string): Promise<void> {
  try {
    localStorage.setItem(key, 'done');
  } catch {}
  await setLocalMeta(key, 'done').catch(() => {});
}

export async function migrateLocalDiariesIncludeAllDistance(
  entries: DiaryEntry[],
  options?: { force?: boolean }
): Promise<{ entries: DiaryEntry[]; changedCount: number }> {
  if (!options?.force && (await hasMigrationFlag(MIGRATION_LOCAL_INCLUDE_ALL_KEY))) {
    return { entries, changedCount: 0 };
  }

  const changed: DiaryEntry[] = [];
  const nextEntries = entries.map((d) => {
    if (d.location?.includeInDistance === false || d.includeInDistance === false) {
      const updated: DiaryEntry = {
        ...d,
        includeInDistance: true,
        location: {
          ...d.location,
          includeInDistance: true,
        },
      };
      changed.push(updated);
      return updated;
    }
    return d;
  });

  if (changed.length > 0) {
    await saveMultipleLocalDiaries(changed, true);
  }
  await markMigrationFlag(MIGRATION_LOCAL_INCLUDE_ALL_KEY);
  return { entries: nextEntries, changedCount: changed.length };
}

export async function hasCompletedServerIncludeAllMigration(): Promise<boolean> {
  return hasMigrationFlag(MIGRATION_SERVER_INCLUDE_ALL_KEY);
}

export async function markServerIncludeAllMigrationDone(): Promise<void> {
  await markMigrationFlag(MIGRATION_SERVER_INCLUDE_ALL_KEY);
}

export async function includeAllServerDiariesInDistance(
  getIdToken: IdTokenGetter
): Promise<{ updatedCount: number; updatedAtMs: number }> {
  const res = await fetchWithAuth('/api/diaries/include-all-distance', getIdToken, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res, '서버 누적거리 일괄 포함 업데이트 실패'));
  }
  const data = (await res.json()) as { updatedCount?: number; updatedAtMs?: number };
  await markServerIncludeAllMigrationDone();
  return {
    updatedCount: Number(data.updatedCount) || 0,
    updatedAtMs: Number(data.updatedAtMs) || Date.now(),
  };
}

const hydrationInFlight = new Map<string, Promise<DiaryEntry | null>>();
const lastHydrationAttemptAt = new Map<string, number>();

export async function hydrateDiaryPhotosFromServer(
  diary: DiaryEntry,
  getIdToken?: IdTokenGetter,
  options?: { force?: boolean }
): Promise<DiaryEntry | null> {
  if (!diary?.id) return null;
  if (!diaryNeedsPhotoHydration(diary) && !options?.force) {
    return null;
  }

  const existingPromise = hydrationInFlight.get(diary.id);
  if (existingPromise) {
    return existingPromise;
  }

  const lastTry = lastHydrationAttemptAt.get(diary.id) || 0;
  if (!options?.force && Date.now() - lastTry < HYDRATION_ATTEMPT_COOLDOWN_MS) {
    return null;
  }
  lastHydrationAttemptAt.set(diary.id, Date.now());

  const task = (async (): Promise<DiaryEntry | null> => {
    try {
      const listRes = await fetchPublicOrAuth(
        `/api/diaries/${encodeURIComponent(diary.id)}/photos`,
        getIdToken
      );
      if (!listRes.ok) return null;

      const listData = (await listRes.json()) as {
        photos?: Array<{
          photoId: string;
          orderIndex: number;
          caption: string;
          timestamp: string;
          isCover: boolean;
          mimeType: string;
          byteSize: number;
          thumbnailUrl?: string | null;
          externalUrl?: string | null;
        }>;
      };

      const rows = listData.photos || [];
      if (rows.length === 0) {
        if (diary.photos.length === 0 && !diary.hasSubcollectionPhotos) return null;
        return null;
      }

      const existingById = new Map(
        filterValidPhotos(diary.photos)
          .filter((p) => !p.isThumbnailOnly)
          .map((p) => [p.id, p])
      );

      const hydratedPhotos: TravelPhoto[] = [];
      for (const row of rows) {
        const localFull = existingById.get(row.photoId);
        if (localFull && isValidPhotoUrl(localFull.url)) {
          hydratedPhotos.push({
            ...localFull,
            caption: row.caption || localFull.caption,
            isCover: row.isCover,
            isThumbnailOnly: false,
          });
          continue;
        }

        if (row.externalUrl) {
          hydratedPhotos.push({
            id: row.photoId,
            url: row.externalUrl,
            caption: row.caption || undefined,
            timestamp: row.timestamp || '',
            isCover: row.isCover,
            thumbnailUrl: row.thumbnailUrl || undefined,
            isThumbnailOnly: false,
          });
          continue;
        }

        if (row.byteSize > 0) {
          const binRes = await fetchPublicOrAuth(
            `/api/diaries/${encodeURIComponent(diary.id)}/photos/${encodeURIComponent(row.photoId)}/binary`,
            getIdToken
          );
          if (binRes.ok) {
            const blob = await binRes.blob();
            const dataUrl = await blobToDataUrl(blob);
            hydratedPhotos.push({
              id: row.photoId,
              url: dataUrl,
              caption: row.caption || undefined,
              timestamp: row.timestamp || '',
              isCover: row.isCover,
              thumbnailUrl: row.thumbnailUrl || undefined,
              isThumbnailOnly: false,
            });
            continue;
          }
        }

        if (row.thumbnailUrl) {
          hydratedPhotos.push({
            id: row.photoId,
            url: row.thumbnailUrl,
            caption: row.caption || undefined,
            timestamp: row.timestamp || '',
            isCover: row.isCover,
            thumbnailUrl: row.thumbnailUrl,
            isThumbnailOnly: true,
          });
        }
      }

      if (hydratedPhotos.length === 0) return null;

      const updated: DiaryEntry = {
        ...diary,
        photos: hydratedPhotos,
        totalPhotosCount: hydratedPhotos.length,
        hasSubcollectionPhotos: hydratedPhotos.some((p) => p.url.startsWith('data:image/')),
      };

      await saveLocalDiary(updated).catch(() => {});
      return updated;
    } catch (err) {
      console.warn('Cloud SQL photo hydration error:', err);
      return null;
    }
  })().finally(() => {
    hydrationInFlight.delete(diary.id);
  });

  hydrationInFlight.set(diary.id, task);
  return task;
}

export async function syncMissingAndUpdatedFromServer(
  localDiaries: DiaryEntry[],
  getIdToken?: IdTokenGetter,
  options?: { force?: boolean }
): Promise<{
  online: boolean;
  serverMetaMap: Record<string, ServerDiaryMeta>;
  addedCount: number;
  updatedCount: number;
  errorMessage?: string;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      online: false,
      serverMetaMap: getCachedServerMetaMap().metaMap,
      addedCount: 0,
      updatedCount: 0,
    };
  }

  try {
    const metaRes = await fetchPublicOrAuth('/api/diaries/meta', getIdToken);
    if (!metaRes.ok) {
      const msg = await parseErrorResponse(metaRes, '서버 상태 확인 실패');
      return {
        online: metaRes.status !== 503 && metaRes.status !== 502,
        serverMetaMap: getCachedServerMetaMap().metaMap,
        addedCount: 0,
        updatedCount: 0,
        errorMessage: msg,
      };
    }

    const metaData = (await metaRes.json()) as {
      metaMap: Record<string, ServerDiaryMeta>;
    };
    const serverMetaMap = metaData.metaMap || {};
    saveCachedServerMetaMap(serverMetaMap);

    // Protect locally deleted diaries from being re-downloaded until server deletion completes
    const rawPendingDeletes = await loadDurablePendingServerDeleteIds();
    const stillOnServerDeletes = rawPendingDeletes.filter((id) => Boolean(serverMetaMap[id]));
    if (stillOnServerDeletes.length !== rawPendingDeletes.length) {
      savePendingServerDeleteIds(stillOnServerDeletes);
    }
    const pendingDeleteSet = new Set(stillOnServerDeletes);

    const localMap = new Map(localDiaries.map((d) => [d.id, d]));
    let reconciledCount = 0;

    // Reconcile local entries whose IDs diverged from an identical Cloud SQL entry (same date + title + time/createdAt)
    for (const local of localDiaries) {
      if (pendingDeleteSet.has(local.id)) continue;
      if (serverMetaMap[local.id]) {
        if (local.localSyncStatus !== 'synced' && (local.updatedAt || local.createdAt || 0) <= serverMetaMap[local.id].updatedAt) {
          const stamped: DiaryEntry = { ...local, localSyncStatus: 'synced' };
          await saveLocalDiary(stamped).catch(() => {});
          localMap.set(local.id, stamped);
          reconciledCount++;
        }
        continue;
      }
      const matched = findMatchingServerMeta(local, serverMetaMap);
      if (matched && !pendingDeleteSet.has(matched.id) && !localMap.has(matched.id)) {
        const localUpdatedAt = local.updatedAt || local.createdAt || 0;
        const reconciled: DiaryEntry = {
          ...local,
          id: matched.id,
          createdAt: Math.min(local.createdAt || matched.createdAt || Date.now(), matched.createdAt || local.createdAt || Date.now()),
          updatedAt: Math.max(local.updatedAt || 0, matched.updatedAt || 0),
          localSyncStatus: localUpdatedAt > (matched.updatedAt || 0) ? 'needs_update' : 'synced',
        };
        await saveLocalDiary(reconciled).catch(() => {});
        await deleteLocalDiary(local.id).catch(() => {});
        localMap.delete(local.id);
        localMap.set(matched.id, reconciled);
        reconciledCount++;
      } else if (!matched && local.localSyncStatus !== 'not_on_server' && local.localSyncStatus !== 'needs_update') {
        const marked: DiaryEntry = { ...local, localSyncStatus: 'not_on_server' };
        await saveLocalDiary(marked).catch(() => {});
        localMap.set(local.id, marked);
        reconciledCount++;
      }
    }

    const idsToPull: string[] = [];

    for (const [id, meta] of Object.entries(serverMetaMap)) {
      if (pendingDeleteSet.has(id)) {
        continue;
      }
      const local = localMap.get(id);
      if (!local) {
        idsToPull.push(id);
      } else {
        const localUpdatedAt = local.updatedAt || local.createdAt || 0;
        const missingCoverPreview =
          (local.photos?.length || 0) === 0 && Boolean(meta.hasSubcollectionPhotos);
        if (meta.updatedAt > localUpdatedAt || missingCoverPreview) {
          idsToPull.push(id);
        }
      }
    }

    if (idsToPull.length === 0) {
      saveServerSyncState({ lastCheckAt: Date.now(), lastFullSyncAt: Date.now() });
      return {
        online: true,
        serverMetaMap,
        addedCount: 0,
        updatedCount: reconciledCount,
      };
    }

    const pulledDiaries: DiaryEntry[] = [];
    // Pull in manageable batches to keep query string short and mobile memory light
    const BATCH_SIZE = 25;
    for (let i = 0; i < idsToPull.length; i += BATCH_SIZE) {
      const batchIds = idsToPull.slice(i, i + BATCH_SIZE);
      const syncRes = await fetchPublicOrAuth(
        `/api/diaries/sync?ids=${encodeURIComponent(batchIds.join(','))}`,
        getIdToken
      );
      if (!syncRes.ok) {
        throw new Error(await parseErrorResponse(syncRes, '일기 동기화 실패'));
      }
      const syncJson = (await syncRes.json()) as { diaries?: DiaryEntry[] };
      if (Array.isArray(syncJson.diaries)) {
        pulledDiaries.push(...syncJson.diaries);
      }
    }

    let addedCount = 0;
    let updatedCount = 0;
    const toSave: DiaryEntry[] = [];

    for (const remote of pulledDiaries) {
      const local = localMap.get(remote.id);
      if (!local) {
        addedCount++;
        toSave.push({
          ...remote,
          localSyncStatus: 'synced',
        });
      } else {
        const localUpdatedAt = local.updatedAt || local.createdAt || 0;
        const hasPendingLocalEdit =
          local.localSyncStatus === 'needs_update' && localUpdatedAt > remote.updatedAt;
        if (hasPendingLocalEdit) {
          continue;
        }
        const missingCoverPreview =
          (local.photos?.length || 0) === 0 && Boolean(remote.photos?.length);
        if (remote.updatedAt > localUpdatedAt || options?.force || missingCoverPreview) {
          // Preserve locally cached HD photos if photo signatures didn't change
          const remoteMeta = serverMetaMap[remote.id];
          const canKeepLocalPhotos =
            !diaryNeedsPhotoHydration(local) &&
            areDiaryPhotosSyncedWithMeta(local, remoteMeta);

          toSave.push({
            ...remote,
            localSyncStatus: 'synced',
            photos: canKeepLocalPhotos ? local.photos : remote.photos,
          });
          updatedCount++;
        }
      }
    }

    if (toSave.length > 0) {
      await saveMultipleLocalDiaries(toSave, true);
    }

    const maxWatermark = Object.values(serverMetaMap).reduce(
      (max, m) => Math.max(max, m.updatedAt || 0),
      0
    );
    saveServerSyncState({
      lastWatermark: maxWatermark,
      lastCheckAt: Date.now(),
      lastFullSyncAt: Date.now(),
    });

    return {
      online: true,
      serverMetaMap,
      addedCount,
      updatedCount: updatedCount + reconciledCount,
    };
  } catch (err: any) {
    return {
      online: typeof navigator !== 'undefined' ? navigator.onLine : false,
      serverMetaMap: getCachedServerMetaMap().metaMap,
      addedCount: 0,
      updatedCount: 0,
      errorMessage: err?.message || 'Cloud SQL 서버와 동기화하지 못했습니다.',
    };
  }
}

export async function deleteDiaryFromServer(
  diaryId: string,
  getIdToken: IdTokenGetter
): Promise<boolean> {
  const res = await fetchWithAuth(`/api/diaries/${encodeURIComponent(diaryId)}`, getIdToken, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res, '서버 일기 삭제 실패'));
  }
  return true;
}

export async function flushPendingDeletesToServer(
  getIdToken: IdTokenGetter
): Promise<{
  deletedIds: string[];
  failedIds: string[];
  authRequired: boolean;
}> {
  const pendingIds = await loadDurablePendingServerDeleteIds();
  if (pendingIds.length === 0) {
    return { deletedIds: [], failedIds: [], authRequired: false };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { deletedIds: [], failedIds: pendingIds, authRequired: false };
  }

  const token = await getIdToken().catch(() => null);
  if (!token) {
    return { deletedIds: [], failedIds: pendingIds, authRequired: true };
  }

  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  let authRequired = false;

  for (const id of pendingIds) {
    try {
      const res = await fetchWithAuth(`/api/diaries/${encodeURIComponent(id)}`, getIdToken, {
        method: 'DELETE',
      });
      if (res.ok || res.status === 404) {
        deletedIds.push(id);
      } else if (res.status === 401 || res.status === 403) {
        authRequired = true;
        failedIds.push(id);
      } else {
        failedIds.push(id);
      }
    } catch {
      failedIds.push(id);
    }
  }

  if (deletedIds.length > 0) {
    await removePendingServerDeleteIds(deletedIds);
    const cached = getCachedServerMetaMap();
    if (cached.hasLoaded) {
      const nextMap = { ...cached.metaMap };
      let changed = false;
      for (const delId of deletedIds) {
        if (nextMap[delId]) {
          delete nextMap[delId];
          changed = true;
        }
      }
      if (changed) {
        saveCachedServerMetaMap(nextMap);
      }
    }
  }

  return { deletedIds, failedIds, authRequired };
}
