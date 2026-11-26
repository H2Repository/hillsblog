import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { diaries, diaryPhotos, diaryVisits, type LocalInsightsRow, users } from './schema.ts';

export interface ServerDiaryMetaDto {
  id: string;
  updatedAt: number;
  createdAt?: number;
  title?: string;
  date?: string;
  time?: string;
  hasSubcollectionPhotos?: boolean;
  includeInDistance?: boolean;
  photoSigs?: Record<string, string>;
  visitCount?: number;
}

export interface DiaryVisitDto {
  id: string;
  diaryId: string;
  visitorName: string;
  message: string;
  reaction: string;
  visitedAt: number;
}

export interface UpsertPhotoMetaInput {
  photoId: string;
  orderIndex: number;
  caption?: string;
  timestamp?: string;
  isCover?: boolean;
  mimeType?: string;
  contentSig: string;
  thumbnailUrl?: string;
  externalUrl?: string;
}

export interface UpsertDiaryInput {
  id: string;
  title: string;
  content: string;
  date: string;
  time: string;
  location: {
    lat: number;
    lng: number;
    accuracy?: number;
    address: string;
    region: string;
    landmark?: string;
    isRealtimeGps?: boolean;
    includeInDistance?: boolean;
  };
  weather: string;
  moodTags: string[];
  localInsights: LocalInsightsRow;
  rating: number;
  includeInDistance?: boolean;
  createdAt: number;
  updatedAt: number;
  isModified?: boolean;
  photos: UpsertPhotoMetaInput[];
}

export interface SyncedPhotoDto {
  id: string;
  url: string;
  caption?: string;
  timestamp: string;
  isCover?: boolean;
  thumbnailUrl?: string;
  isThumbnailOnly?: boolean;
  contentSig?: string;
}

export interface SyncedDiaryDto {
  id: string;
  title: string;
  content: string;
  date: string;
  time: string;
  location: {
    lat: number;
    lng: number;
    accuracy?: number;
    address: string;
    region: string;
    landmark?: string;
    isRealtimeGps?: boolean;
    includeInDistance?: boolean;
  };
  photos: SyncedPhotoDto[];
  weather: string;
  moodTags: string[];
  localInsights: LocalInsightsRow;
  rating: number;
  hasSubcollectionPhotos: boolean;
  totalPhotosCount: number;
  includeInDistance?: boolean;
  createdAt: number;
  updatedAt: number;
  isModified?: boolean;
}

function formatPhotoFullSig(
  contentSig: string,
  isCover: boolean,
  orderIndex: number,
  caption: string
): string {
  return `${contentSig}|${isCover ? 1 : 0}|${orderIndex}|${String(caption || '').slice(0, 120)}`;
}

export async function getPublicBlogOwnerUserId(): Promise<number | null> {
  try {
    const ownerEmail = process.env.BLOG_OWNER_EMAIL?.trim();
    if (ownerEmail) {
      const ownerRows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, ownerEmail))
        .limit(1);

      if (ownerRows.length > 0) {
        return ownerRows[0].id;
      }
    }

    const fallbackRows = await db
      .select({ id: users.id })
      .from(users)
      .orderBy(asc(users.id))
      .limit(1);

    return fallbackRows.length > 0 ? fallbackRows[0].id : null;
  } catch (error) {
    console.error('Failed to resolve public blog owner:', error);
    throw new Error('블로그 소유자 정보를 조회하지 못했습니다.', { cause: error });
  }
}

export async function getServerDiaryMetaMapForUser(
  userId: number
): Promise<Record<string, ServerDiaryMetaDto>> {
  try {
    const diaryRows = await db
      .select({
        id: diaries.id,
        title: diaries.title,
        date: diaries.date,
        time: diaries.time,
        updatedAtMs: diaries.updatedAtMs,
        createdAtMs: diaries.createdAtMs,
        totalPhotosCount: diaries.totalPhotosCount,
        includeInDistance: diaries.includeInDistance,
      })
      .from(diaries)
      .where(eq(diaries.userId, userId));

    const photoRows = await db
      .select({
        diaryId: diaryPhotos.diaryId,
        photoId: diaryPhotos.photoId,
        orderIndex: diaryPhotos.orderIndex,
        isCover: diaryPhotos.isCover,
        caption: diaryPhotos.caption,
        contentSig: diaryPhotos.contentSig,
        byteSize: diaryPhotos.byteSize,
        externalUrl: diaryPhotos.externalUrl,
      })
      .from(diaryPhotos)
      .where(eq(diaryPhotos.userId, userId))
      .orderBy(asc(diaryPhotos.orderIndex));

    const sigsByDiary = new Map<string, Record<string, string>>();
    for (const p of photoRows) {
      // Only advertise photo signature as stored if binary or external URL actually exists
      if (!p.externalUrl && p.byteSize <= 0) continue;
      let map = sigsByDiary.get(p.diaryId);
      if (!map) {
        map = {};
        sigsByDiary.set(p.diaryId, map);
      }
      map[p.photoId] = formatPhotoFullSig(p.contentSig, p.isCover, p.orderIndex, p.caption);
    }

    const visitCountRows = await db
      .select({
        diaryId: diaryVisits.diaryId,
        visitCount: sql<number>`count(*)::int`,
      })
      .from(diaryVisits)
      .innerJoin(diaries, eq(diaryVisits.diaryId, diaries.id))
      .where(eq(diaries.userId, userId))
      .groupBy(diaryVisits.diaryId);

    const visitCountMap = new Map<string, number>();
    for (const v of visitCountRows) {
      visitCountMap.set(v.diaryId, Number(v.visitCount) || 0);
    }

    const metaMap: Record<string, ServerDiaryMetaDto> = {};
    for (const d of diaryRows) {
      metaMap[d.id] = {
        id: d.id,
        updatedAt: Number(d.updatedAtMs) || 0,
        createdAt: Number(d.createdAtMs) || 0,
        title: d.title,
        date: d.date,
        time: d.time,
        hasSubcollectionPhotos: d.totalPhotosCount > 0,
        includeInDistance: d.includeInDistance ?? true,
        photoSigs: sigsByDiary.get(d.id) || {},
        visitCount: visitCountMap.get(d.id) || 0,
      };
    }

    return metaMap;
  } catch (error) {
    console.error('Failed to fetch server diary meta map:', error);
    throw new Error('서버 일기 메타데이터를 조회하지 못했습니다.', { cause: error });
  }
}

export async function getSyncedDiariesForUser(
  userId: number,
  options?: { sinceMs?: number; targetIds?: string[] }
): Promise<SyncedDiaryDto[]> {
  try {
    const conditions = [eq(diaries.userId, userId)];
    if (options?.targetIds && options.targetIds.length > 0) {
      conditions.push(inArray(diaries.id, options.targetIds));
    } else if (typeof options?.sinceMs === 'number' && options.sinceMs > 0) {
      conditions.push(gt(diaries.updatedAtMs, options.sinceMs));
    }

    const diaryRows = await db
      .select()
      .from(diaries)
      .where(and(...conditions))
      .orderBy(desc(diaries.date), desc(diaries.time), desc(diaries.createdAtMs));

    if (diaryRows.length === 0) {
      return [];
    }

    const diaryIds = diaryRows.map((d) => d.id);
    const photoMetaRows = await db
      .select({
        diaryId: diaryPhotos.diaryId,
        photoId: diaryPhotos.photoId,
        orderIndex: diaryPhotos.orderIndex,
        caption: diaryPhotos.caption,
        timestamp: diaryPhotos.timestamp,
        isCover: diaryPhotos.isCover,
        byteSize: diaryPhotos.byteSize,
        contentSig: diaryPhotos.contentSig,
        thumbnailUrl: diaryPhotos.thumbnailUrl,
        externalUrl: diaryPhotos.externalUrl,
      })
      .from(diaryPhotos)
      .where(and(eq(diaryPhotos.userId, userId), inArray(diaryPhotos.diaryId, diaryIds)))
      .orderBy(asc(diaryPhotos.orderIndex));

    const photosByDiary = new Map<string, typeof photoMetaRows>();
    for (const p of photoMetaRows) {
      const list = photosByDiary.get(p.diaryId) || [];
      list.push(p);
      photosByDiary.set(p.diaryId, list);
    }

    return diaryRows.map((d) => {
      const rows = photosByDiary.get(d.id) || [];
      const hasBinaryPhotos = rows.some((r) => r.byteSize > 0 && !r.externalUrl);

      // For fast feed sync without bloating mobile memory, send cover thumbnail (plus external URLs)
      // when binary photos exist; client hydrates full HD binaries lazily when opening the diary.
      let previewPhotos: SyncedPhotoDto[];
      if (hasBinaryPhotos) {
        const cover = rows.find((r) => r.isCover) || rows[0];
        const fallbackThumbUrl =
          cover && cover.byteSize > 0
            ? `/api/diaries/${encodeURIComponent(d.id)}/photos/${encodeURIComponent(cover.photoId)}/binary?thumb=1`
            : '';
        const resolvedUrl = cover
          ? cover.externalUrl || cover.thumbnailUrl || fallbackThumbUrl
          : '';
        previewPhotos = cover
          ? [
              {
                id: cover.photoId,
                url: resolvedUrl,
                caption: cover.caption || undefined,
                timestamp: cover.timestamp || '',
                isCover: cover.isCover,
                thumbnailUrl:
                  cover.thumbnailUrl || (!cover.externalUrl && fallbackThumbUrl ? fallbackThumbUrl : undefined),
                isThumbnailOnly: !cover.externalUrl,
                contentSig: cover.contentSig,
              },
            ]
          : [];
      } else {
        previewPhotos = rows.map((r) => ({
          id: r.photoId,
          url: r.externalUrl || r.thumbnailUrl || '',
          caption: r.caption || undefined,
          timestamp: r.timestamp || '',
          isCover: r.isCover,
          thumbnailUrl: r.thumbnailUrl || undefined,
          isThumbnailOnly: false,
          contentSig: r.contentSig,
        }));
      }

      return {
        id: d.id,
        title: d.title,
        content: d.content,
        date: d.date,
        time: d.time,
        location: {
          lat: d.lat,
          lng: d.lng,
          ...(d.accuracy !== null && d.accuracy !== undefined ? { accuracy: d.accuracy } : {}),
          address: d.address,
          region: d.region,
          ...(d.landmark ? { landmark: d.landmark } : {}),
          ...(d.isRealtimeGps !== null && d.isRealtimeGps !== undefined ? { isRealtimeGps: d.isRealtimeGps } : {}),
          ...(d.includeInDistance !== null && d.includeInDistance !== undefined
            ? { includeInDistance: d.includeInDistance }
            : {}),
        },
        photos: previewPhotos.filter((p) => Boolean(p.url)),
        weather: d.weather,
        moodTags: Array.isArray(d.moodTags) ? d.moodTags : [],
        localInsights: d.localInsights || { recommendedForSolo: '' },
        rating: d.rating,
        hasSubcollectionPhotos: hasBinaryPhotos,
        totalPhotosCount: rows.length,
        includeInDistance: d.includeInDistance ?? true,
        createdAt: Number(d.createdAtMs) || 0,
        updatedAt: Number(d.updatedAtMs) || 0,
        isModified: d.isModified ?? false,
      };
    });
  } catch (error) {
    console.error('Failed to sync diaries from Cloud SQL:', error);
    throw new Error('서버에서 일기를 불러오지 못했습니다.', { cause: error });
  }
}

export async function upsertDiaryMetadataForUser(
  userId: number,
  input: UpsertDiaryInput
): Promise<{ diaryId: string; missingPhotoIds: string[]; photoSigs: Record<string, string> }> {
  try {
    const existing = await db
      .select({ id: diaries.id, userId: diaries.userId })
      .from(diaries)
      .where(eq(diaries.id, input.id));

    if (existing.length > 0 && existing[0].userId !== userId) {
      throw new Error('다른 사용자의 일기를 수정할 수 없습니다.');
    }

    const totalCount = input.photos.length;

    await db
      .insert(diaries)
      .values({
        id: input.id,
        userId,
        title: input.title || '제목 없음',
        content: input.content || '',
        date: input.date || '',
        time: input.time || '',
        lat: Number(input.location?.lat) || 0,
        lng: Number(input.location?.lng) || 0,
        accuracy: input.location?.accuracy ?? null,
        address: input.location?.address || '',
        region: input.location?.region || '',
        landmark: input.location?.landmark ?? null,
        isRealtimeGps: Boolean(input.location?.isRealtimeGps),
        includeInDistance: input.includeInDistance ?? input.location?.includeInDistance ?? true,
        weather: input.weather || 'sunny',
        moodTags: Array.isArray(input.moodTags) ? input.moodTags : [],
        localInsights: input.localInsights || { recommendedForSolo: '' },
        rating: Math.max(0, Math.min(5, Number(input.rating) || 0)),
        totalPhotosCount: totalCount,
        isModified: Boolean(input.isModified),
        createdAtMs: Number(input.createdAt) || Date.now(),
        updatedAtMs: Number(input.updatedAt) || Date.now(),
      })
      .onConflictDoUpdate({
        target: diaries.id,
        set: {
          title: input.title || '제목 없음',
          content: input.content || '',
          date: input.date || '',
          time: input.time || '',
          lat: Number(input.location?.lat) || 0,
          lng: Number(input.location?.lng) || 0,
          accuracy: input.location?.accuracy ?? null,
          address: input.location?.address || '',
          region: input.location?.region || '',
          landmark: input.location?.landmark ?? null,
          isRealtimeGps: Boolean(input.location?.isRealtimeGps),
          includeInDistance: input.includeInDistance ?? input.location?.includeInDistance ?? true,
          weather: input.weather || 'sunny',
          moodTags: Array.isArray(input.moodTags) ? input.moodTags : [],
          localInsights: input.localInsights || { recommendedForSolo: '' },
          rating: Math.max(0, Math.min(5, Number(input.rating) || 0)),
          totalPhotosCount: totalCount,
          isModified: Boolean(input.isModified),
          createdAtMs: Number(input.createdAt) || Date.now(),
          updatedAtMs: Number(input.updatedAt) || Date.now(),
          updatedAt: new Date(),
        },
      });

    const keepPhotoIds = input.photos.map((p) => p.photoId);
    if (keepPhotoIds.length === 0) {
      await db
        .delete(diaryPhotos)
        .where(and(eq(diaryPhotos.diaryId, input.id), eq(diaryPhotos.userId, userId)));
      return { diaryId: input.id, missingPhotoIds: [], photoSigs: {} };
    }

    await db
      .delete(diaryPhotos)
      .where(
        and(
          eq(diaryPhotos.diaryId, input.id),
          eq(diaryPhotos.userId, userId),
          notInArray(diaryPhotos.photoId, keepPhotoIds)
        )
      );

    const existingPhotos = await db
      .select({
        id: diaryPhotos.id,
        photoId: diaryPhotos.photoId,
        contentSig: diaryPhotos.contentSig,
        byteSize: diaryPhotos.byteSize,
        externalUrl: diaryPhotos.externalUrl,
      })
      .from(diaryPhotos)
      .where(and(eq(diaryPhotos.diaryId, input.id), eq(diaryPhotos.userId, userId)));

    const existingMap = new Map(existingPhotos.map((row) => [row.photoId, row]));
    const missingPhotoIds: string[] = [];
    const photoSigs: Record<string, string> = {};

    for (const p of input.photos) {
      const rowId = `${input.id}__${p.photoId}`;
      const prev = existingMap.get(p.photoId);
      const caption = p.caption || '';
      const isCover = Boolean(p.isCover);

      if (p.externalUrl) {
        await db
          .insert(diaryPhotos)
          .values({
            id: rowId,
            diaryId: input.id,
            userId,
            photoId: p.photoId,
            orderIndex: p.orderIndex,
            caption,
            timestamp: p.timestamp || '',
            isCover,
            mimeType: p.mimeType || 'image/jpeg',
            byteSize: 0,
            contentSig: p.contentSig,
            thumbnailUrl: p.thumbnailUrl || null,
            externalUrl: p.externalUrl,
          })
          .onConflictDoUpdate({
            target: diaryPhotos.id,
            set: {
              orderIndex: p.orderIndex,
              caption,
              timestamp: p.timestamp || '',
              isCover,
              contentSig: p.contentSig,
              thumbnailUrl: p.thumbnailUrl || null,
              externalUrl: p.externalUrl,
              imageData: null,
              byteSize: 0,
            },
          });
        photoSigs[p.photoId] = formatPhotoFullSig(p.contentSig, isCover, p.orderIndex, caption);
        continue;
      }

      if (prev && prev.contentSig === p.contentSig && prev.byteSize > 0) {
        // Binary photo is already stored identically; update only lightweight metadata
        await db
          .update(diaryPhotos)
          .set({
            orderIndex: p.orderIndex,
            caption,
            timestamp: p.timestamp || '',
            isCover,
            ...(p.thumbnailUrl ? { thumbnailUrl: p.thumbnailUrl } : {}),
          })
          .where(and(eq(diaryPhotos.id, rowId), eq(diaryPhotos.userId, userId)));
        photoSigs[p.photoId] = formatPhotoFullSig(p.contentSig, isCover, p.orderIndex, caption);
      } else {
        missingPhotoIds.push(p.photoId);
      }
    }

    return { diaryId: input.id, missingPhotoIds, photoSigs };
  } catch (error) {
    if (error instanceof Error && error.message === '다른 사용자의 일기를 수정할 수 없습니다.') {
      throw error;
    }
    console.error('Failed to upsert diary metadata:', error);
    throw new Error('서버에 일기 메타데이터를 저장하지 못했습니다.', { cause: error });
  }
}

export async function upsertDiaryPhotoBinaryForUser(
  userId: number,
  diaryId: string,
  photoId: string,
  meta: {
    orderIndex: number;
    caption: string;
    timestamp: string;
    isCover: boolean;
    mimeType: string;
    contentSig: string;
    thumbnailUrl?: string;
  },
  imageBuffer: Buffer
): Promise<string> {
  try {
    const owned = await db
      .select({ id: diaries.id })
      .from(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, userId)));

    if (owned.length === 0) {
      throw new Error('일기를 찾을 수 없거나 권한이 없습니다.');
    }

    const rowId = `${diaryId}__${photoId}`;
    await db
      .insert(diaryPhotos)
      .values({
        id: rowId,
        diaryId,
        userId,
        photoId,
        orderIndex: meta.orderIndex,
        caption: meta.caption,
        timestamp: meta.timestamp,
        isCover: meta.isCover,
        mimeType: meta.mimeType,
        byteSize: imageBuffer.length,
        contentSig: meta.contentSig,
        thumbnailUrl: meta.thumbnailUrl || null,
        imageData: imageBuffer,
        externalUrl: null,
      })
      .onConflictDoUpdate({
        target: diaryPhotos.id,
        set: {
          orderIndex: meta.orderIndex,
          caption: meta.caption,
          timestamp: meta.timestamp,
          isCover: meta.isCover,
          mimeType: meta.mimeType,
          byteSize: imageBuffer.length,
          contentSig: meta.contentSig,
          ...(meta.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}),
          imageData: imageBuffer,
          externalUrl: null,
        },
      });

    return formatPhotoFullSig(meta.contentSig, meta.isCover, meta.orderIndex, meta.caption);
  } catch (error) {
    if (error instanceof Error && error.message === '일기를 찾을 수 없거나 권한이 없습니다.') {
      throw error;
    }
    console.error('Failed to store diary photo binary:', error);
    throw new Error('서버에 사진을 저장하지 못했습니다.', { cause: error });
  }
}

export async function getDiaryPhotosListForUser(userId: number, diaryId: string) {
  try {
    const rows = await db
      .select({
        photoId: diaryPhotos.photoId,
        orderIndex: diaryPhotos.orderIndex,
        caption: diaryPhotos.caption,
        timestamp: diaryPhotos.timestamp,
        isCover: diaryPhotos.isCover,
        mimeType: diaryPhotos.mimeType,
        byteSize: diaryPhotos.byteSize,
        contentSig: diaryPhotos.contentSig,
        thumbnailUrl: diaryPhotos.thumbnailUrl,
        externalUrl: diaryPhotos.externalUrl,
      })
      .from(diaryPhotos)
      .where(and(eq(diaryPhotos.diaryId, diaryId), eq(diaryPhotos.userId, userId)))
      .orderBy(asc(diaryPhotos.orderIndex));

    return rows;
  } catch (error) {
    console.error('Failed to list diary photos:', error);
    throw new Error('일기 사진 목록을 조회하지 못했습니다.', { cause: error });
  }
}

export async function getDiaryPhotoBinaryForUser(
  userId: number,
  diaryId: string,
  photoId: string
) {
  try {
    const rows = await db
      .select({
        mimeType: diaryPhotos.mimeType,
        imageData: diaryPhotos.imageData,
        externalUrl: diaryPhotos.externalUrl,
      })
      .from(diaryPhotos)
      .where(
        and(
          eq(diaryPhotos.diaryId, diaryId),
          eq(diaryPhotos.photoId, photoId),
          eq(diaryPhotos.userId, userId)
        )
      );

    return rows[0] || null;
  } catch (error) {
    console.error('Failed to read diary photo binary:', error);
    throw new Error('사진 데이터를 불러오지 못했습니다.', { cause: error });
  }
}

export async function deleteDiaryForUser(userId: number, diaryId: string): Promise<boolean> {
  try {
    const deleted = await db
      .delete(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, userId)))
      .returning({ id: diaries.id });

    return deleted.length > 0;
  } catch (error) {
    console.error('Failed to delete diary from Cloud SQL:', error);
    throw new Error('서버에서 일기를 삭제하지 못했습니다.', { cause: error });
  }
}

export async function includeAllDiariesInDistanceForUser(
  userId: number
): Promise<{ updatedCount: number; updatedAtMs: number }> {
  try {
    const nowMs = Date.now();
    const updated = await db
      .update(diaries)
      .set({
        includeInDistance: true,
        updatedAtMs: nowMs,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(diaries.userId, userId),
          or(eq(diaries.includeInDistance, false), isNull(diaries.includeInDistance))
        )
      )
      .returning({ id: diaries.id });

    return { updatedCount: updated.length, updatedAtMs: nowMs };
  } catch (error) {
    console.error('Failed to include all diaries in distance:', error);
    throw new Error('서버 일기의 누적거리 포함 설정을 일괄 업데이트하지 못했습니다.', { cause: error });
  }
}

export async function getDiaryVisitsForDiary(
  ownerUserId: number,
  diaryId: string
): Promise<DiaryVisitDto[]> {
  try {
    const owned = await db
      .select({ id: diaries.id })
      .from(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, ownerUserId)))
      .limit(1);

    if (owned.length === 0) {
      return [];
    }

    const rows = await db
      .select({
        id: diaryVisits.id,
        diaryId: diaryVisits.diaryId,
        visitorName: diaryVisits.visitorName,
        message: diaryVisits.message,
        reaction: diaryVisits.reaction,
        visitedAtMs: diaryVisits.visitedAtMs,
      })
      .from(diaryVisits)
      .where(eq(diaryVisits.diaryId, diaryId))
      .orderBy(desc(diaryVisits.visitedAtMs))
      .limit(200);

    return rows.map((r) => ({
      id: r.id,
      diaryId: r.diaryId,
      visitorName: r.visitorName,
      message: r.message,
      reaction: r.reaction,
      visitedAt: Number(r.visitedAtMs) || Date.now(),
    }));
  } catch (error) {
    console.error('Failed to get diary visits:', error);
    throw new Error('방문자 기록을 불러오지 못했습니다.', { cause: error });
  }
}

export async function createDiaryVisitForDiary(
  ownerUserId: number,
  diaryId: string,
  input: { visitorName: string; message: string; reaction: string }
): Promise<DiaryVisitDto | null> {
  try {
    const owned = await db
      .select({ id: diaries.id })
      .from(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, ownerUserId)))
      .limit(1);

    if (owned.length === 0) {
      return null;
    }

    const nowMs = Date.now();
    const visitId = `visit_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;

    await db.insert(diaryVisits).values({
      id: visitId,
      diaryId,
      visitorName: input.visitorName,
      message: input.message,
      reaction: input.reaction,
      visitedAtMs: nowMs,
      createdAt: new Date(),
    });

    return {
      id: visitId,
      diaryId,
      visitorName: input.visitorName,
      message: input.message,
      reaction: input.reaction,
      visitedAt: nowMs,
    };
  } catch (error) {
    console.error('Failed to create diary visit:', error);
    throw new Error('방문자 기록을 저장하지 못했습니다.', { cause: error });
  }
}

export async function deleteDiaryVisitForUser(
  ownerUserId: number,
  diaryId: string,
  visitId: string
): Promise<boolean> {
  try {
    const owned = await db
      .select({ id: diaries.id })
      .from(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, ownerUserId)))
      .limit(1);

    if (owned.length === 0) {
      return false;
    }

    const deleted = await db
      .delete(diaryVisits)
      .where(and(eq(diaryVisits.id, visitId), eq(diaryVisits.diaryId, diaryId)))
      .returning({ id: diaryVisits.id });

    return deleted.length > 0;
  } catch (error) {
    console.error('Failed to delete diary visit:', error);
    throw new Error('방문자 기록을 삭제하지 못했습니다.', { cause: error });
  }
}

export async function getDiaryVisitsMapForUser(
  ownerUserId: number,
  targetDiaryIds?: string[]
): Promise<Record<string, DiaryVisitDto[]>> {
  try {
    const ownedRows = await db
      .select({ id: diaries.id })
      .from(diaries)
      .where(
        targetDiaryIds && targetDiaryIds.length > 0
          ? and(eq(diaries.userId, ownerUserId), inArray(diaries.id, targetDiaryIds))
          : eq(diaries.userId, ownerUserId)
      );

    if (ownedRows.length === 0) {
      return {};
    }

    const validIds = ownedRows.map((r) => r.id);
    const visitRows = await db
      .select({
        id: diaryVisits.id,
        diaryId: diaryVisits.diaryId,
        visitorName: diaryVisits.visitorName,
        message: diaryVisits.message,
        reaction: diaryVisits.reaction,
        visitedAtMs: diaryVisits.visitedAtMs,
      })
      .from(diaryVisits)
      .where(inArray(diaryVisits.diaryId, validIds))
      .orderBy(desc(diaryVisits.visitedAtMs));

    const result: Record<string, DiaryVisitDto[]> = {};
    for (const r of visitRows) {
      if (!result[r.diaryId]) {
        result[r.diaryId] = [];
      }
      result[r.diaryId].push({
        id: r.id,
        diaryId: r.diaryId,
        visitorName: r.visitorName,
        message: r.message,
        reaction: r.reaction,
        visitedAt: Number(r.visitedAtMs) || Date.now(),
      });
    }
    return result;
  } catch (error) {
    console.error('Failed to export diary visits map:', error);
    throw new Error('방문자 기록 일괄 조회에 실패했습니다.', { cause: error });
  }
}

export async function importDiaryVisitsForUser(
  ownerUserId: number,
  diaryId: string,
  visits: Array<{
    id?: string;
    visitorName?: string;
    message: string;
    reaction: string;
    visitedAt: number;
  }>
): Promise<{ importedCount: number; totalCount: number }> {
  try {
    const owned = await db
      .select({ id: diaries.id })
      .from(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, ownerUserId)))
      .limit(1);

    if (owned.length === 0) {
      throw new Error('일기를 찾을 수 없거나 권한이 없습니다.');
    }

    if (visits.length === 0) {
      const countRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(diaryVisits)
        .where(eq(diaryVisits.diaryId, diaryId));
      return { importedCount: 0, totalCount: Number(countRows[0]?.count) || 0 };
    }

    const existingRows = await db
      .select({
        id: diaryVisits.id,
        message: diaryVisits.message,
        visitedAtMs: diaryVisits.visitedAtMs,
      })
      .from(diaryVisits)
      .where(eq(diaryVisits.diaryId, diaryId));

    const existingIds = new Set(existingRows.map((r) => r.id));
    const existingKeys = new Set(
      existingRows.map((r) => `${r.message.trim()}__${Number(r.visitedAtMs) || 0}`)
    );

    const rowsToInsert: Array<{
      id: string;
      diaryId: string;
      visitorName: string;
      message: string;
      reaction: string;
      visitedAtMs: number;
      createdAt: Date;
    }> = [];

    for (const item of visits) {
      const visitedAtMs = Number.isFinite(item.visitedAt) && item.visitedAt > 0
        ? Math.round(item.visitedAt)
        : Date.now();
      const dedupeKey = `${item.message.trim()}__${visitedAtMs}`;
      if (existingKeys.has(dedupeKey)) {
        continue;
      }

      const rawId = typeof item.id === 'string' ? item.id.trim().slice(0, 128) : '';
      const candidateId =
        rawId && !rawId.startsWith('local_visit_') && !existingIds.has(rawId)
          ? rawId
          : `visit_${visitedAtMs}_${Math.random().toString(36).slice(2, 8)}`;

      if (existingIds.has(candidateId)) {
        continue;
      }

      existingIds.add(candidateId);
      existingKeys.add(dedupeKey);
      rowsToInsert.push({
        id: candidateId,
        diaryId,
        visitorName: item.visitorName || '',
        message: item.message,
        reaction: item.reaction,
        visitedAtMs,
        createdAt: new Date(visitedAtMs),
      });
    }

    if (rowsToInsert.length > 0) {
      await db.insert(diaryVisits).values(rowsToInsert).onConflictDoNothing({
        target: diaryVisits.id,
      });
    }

    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(diaryVisits)
      .where(eq(diaryVisits.diaryId, diaryId));

    return {
      importedCount: rowsToInsert.length,
      totalCount: Number(countRows[0]?.count) || 0,
    };
  } catch (error) {
    if (error instanceof Error && error.message === '일기를 찾을 수 없거나 권한이 없습니다.') {
      throw error;
    }
    console.error('Failed to import diary visits:', error);
    throw new Error('방문자 기록을 가져오지 못했습니다.', { cause: error });
  }
}
