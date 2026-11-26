import { DiaryEntry, DiaryVisitRecord, ExportedDiaryEntry, TravelPhoto } from '../types';

/**
 * Checks if a photo URL is non-empty and valid for rendering.
 */
export function isValidPhotoUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return false;
  if (trimmed.startsWith('blob:')) return false;
  if (trimmed.startsWith('data:')) {
    const commaIdx = trimmed.indexOf(',');
    return trimmed.startsWith('data:image/') && commaIdx > 0 && trimmed.length > commaIdx + 10;
  }
  return true;
}

/**
 * Returns only photos with valid, renderable URLs.
 */
export function filterValidPhotos(photos?: TravelPhoto[]): TravelPhoto[] {
  if (!Array.isArray(photos)) return [];
  return photos.filter((p) => Boolean(p && isValidPhotoUrl(p.url)));
}

/**
 * Strips broken/empty photo entries from a diary while keeping accurate totalPhotosCount
 * and hasSubcollectionPhotos flags so missing photos can be repaired from Firestore.
 */
export function sanitizeDiaryEntry(diary: DiaryEntry): { entry: DiaryEntry; strippedCount: number } {
  const rawPhotos = Array.isArray(diary.photos) ? diary.photos : [];
  const validPhotos = filterValidPhotos(rawPhotos);
  const strippedCount = rawPhotos.length - validPhotos.length;

  if (strippedCount === 0) {
    return { entry: diary, strippedCount: 0 };
  }

  const totalPhotosCount = Math.max(diary.totalPhotosCount || 0, rawPhotos.length);
  return {
    entry: {
      ...diary,
      photos: validPhotos,
      totalPhotosCount,
      hasSubcollectionPhotos: Boolean(diary.hasSubcollectionPhotos || totalPhotosCount > validPhotos.length),
    },
    strippedCount,
  };
}

/**
 * Returns true if a diary has missing/empty photo URLs or fewer valid local photos
 * than expected from Firestore subcollections.
 */
export function diaryNeedsPhotoHydration(diary: DiaryEntry): boolean {
  if (!diary) return false;
  const rawPhotos = Array.isArray(diary.photos) ? diary.photos : [];
  if (rawPhotos.some((p) => !isValidPhotoUrl(p?.url) || Boolean(p?.isThumbnailOnly))) {
    return true;
  }
  const expectedCount = typeof diary.totalPhotosCount === 'number' ? diary.totalPhotosCount : 0;
  if (diary.hasSubcollectionPhotos && expectedCount > rawPhotos.length) {
    return true;
  }
  return false;
}

const STORAGE_KEY = 'hills_blog_diaries_v2';

/**
 * Strictly sorts diaries so the newest travel date & time appears first.
 * If dates are identical, falls back to newest creation timestamp (createdAt).
 */
export function sortDiariesDescending(diaries: DiaryEntry[]): DiaryEntry[] {
  return [...diaries].sort((a, b) => {
    // 1. Primary: Compare travel date and time (YYYY-MM-DD HH:mm) descending
    const dateTimeA = `${a.date || ''} ${a.time || ''}`.trim();
    const dateTimeB = `${b.date || ''} ${b.time || ''}`.trim();

    if (dateTimeA && dateTimeB && dateTimeA !== dateTimeB) {
      return dateTimeB.localeCompare(dateTimeA);
    }

    // 2. Secondary: Compare createdAt timestamp descending
    const createdA = a.createdAt || 0;
    const createdB = b.createdAt || 0;
    if (createdA !== createdB) {
      return createdB - createdA;
    }

    // 3. Fallback: Compare updatedAt timestamp descending
    const updatedA = a.updatedAt || 0;
    const updatedB = b.updatedAt || 0;
    return updatedB - updatedA;
  });
}

/**
 * Normalizes title for duplicate detection:
 * - Strips leading index tags like '#40 ', '#41 ', '#12 '
 * - Strips all whitespace so '돌아가는길' and '돌아가는 길' match
 * - Converts to lower-case
 */
export function normalizeTitle(title?: string): string {
  if (!title) return '';
  return title
    .replace(/^#\d+\s*/, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Checks whether two diaries represent the exact same entry:
 * - Identical ID
 * - OR exact same creation timestamp (within 2s) on the same date with the same normalized title
 */
export function isDiaryDuplicate(a: DiaryEntry, b: DiaryEntry): boolean {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) {
    return true;
  }
  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);
  if (
    titleA &&
    titleA === titleB &&
    a.date &&
    a.date === b.date &&
    a.createdAt &&
    b.createdAt &&
    Math.abs(a.createdAt - b.createdAt) <= 2000
  ) {
    return true;
  }
  return false;
}

/**
 * Picks the higher quality/updated diary when two duplicates are found,
 * merging best traits (earliest createdAt, latest updatedAt, photos).
 */
export function pickBetterDiary(a: DiaryEntry, b: DiaryEntry): { winner: DiaryEntry; loser: DiaryEntry } {
  let scoreA = 0;
  let scoreB = 0;

  // 1. Valid Photos count (highest weight: 3) - never let empty/broken photo stubs outrank real photos
  const validA = filterValidPhotos(a.photos);
  const validB = filterValidPhotos(b.photos);
  if (validA.length > validB.length) scoreA += 3;
  else if (validB.length > validA.length) scoreB += 3;

  // 2. Text content length (weight: 2) - revisions usually contain corrected typos or richer text
  const lenA = a.content?.trim().length || 0;
  const lenB = b.content?.trim().length || 0;
  if (lenA > lenB) scoreA += 2;
  else if (lenB > lenA) scoreB += 2;

  // 3. UpdatedAt timestamp (weight: 2)
  const updatedA = a.updatedAt || 0;
  const updatedB = b.updatedAt || 0;
  if (updatedA > updatedB) scoreA += 2;
  else if (updatedB > updatedA) scoreB += 2;

  // 4. CreatedAt timestamp (weight: 1)
  const createdA = a.createdAt || 0;
  const createdB = b.createdAt || 0;
  if (createdA > createdB) scoreA += 1;
  else if (createdB > createdA) scoreB += 1;

  const aWins = scoreA >= scoreB;
  const winnerBase = aWins ? a : b;
  const loser = aWins ? b : a;

  const winnerValid = filterValidPhotos(winnerBase.photos);
  const loserValid = filterValidPhotos(loser.photos);
  const winnerPhotos = winnerValid.length >= loserValid.length ? winnerValid : loserValid;
  const expectedCount = Math.max(
    winnerBase.totalPhotosCount || 0,
    loser.totalPhotosCount || 0,
    winnerBase.photos?.length || 0,
    loser.photos?.length || 0,
    winnerPhotos.length
  );

  const winner: DiaryEntry = {
    ...winnerBase,
    createdAt: Math.min(a.createdAt || Date.now(), b.createdAt || Date.now()),
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0, Date.now()),
    photos: winnerPhotos,
    totalPhotosCount: expectedCount,
    hasSubcollectionPhotos: Boolean(
      winnerBase.hasSubcollectionPhotos ||
      loser.hasSubcollectionPhotos ||
      expectedCount > winnerPhotos.length
    ),
  };

  return { winner, loser };
}

/**
 * Deduplicates a list of diaries, merging duplicate entries on the same date with the same title.
 * Returns the deduplicated list sorted descending and the list of removed loser IDs.
 */
export function deduplicateDiaries(diaries: DiaryEntry[]): { deduplicated: DiaryEntry[]; removedIds: string[] } {
  if (!Array.isArray(diaries) || diaries.length === 0) {
    return { deduplicated: [], removedIds: [] };
  }

  const result: DiaryEntry[] = [];
  const removedIds: string[] = [];

  for (const entry of diaries) {
    if (!entry || !entry.id) continue;

    const existingIdx = result.findIndex((existing) => isDiaryDuplicate(existing, entry));
    if (existingIdx >= 0) {
      const existing = result[existingIdx];
      const { winner, loser } = pickBetterDiary(existing, entry);
      result[existingIdx] = winner;
      removedIds.push(loser.id);
    } else {
      result.push(entry);
    }
  }

  return {
    deduplicated: sortDiariesDescending(result),
    removedIds: Array.from(new Set(removedIds)),
  };
}

export function getStoredDiaries(): DiaryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const sanitized = parsed.map((d) => sanitizeDiaryEntry(d).entry);
      const { deduplicated } = deduplicateDiaries(sanitized);
      return deduplicated;
    }
    return [];
  } catch (e) {
    console.error('Failed to parse diaries from localStorage:', e);
    return [];
  }
}

export function saveDiaries(diaries: DiaryEntry[]): void {
  const hasIdb = typeof indexedDB !== 'undefined';
  if (hasIdb) {
    // Full diaries & photos live in IndexedDB. Keep localStorage fallback strictly lightweight text-only
    // so main thread never stalls serializing images and iPhone's 5MB limit stays clear.
    try {
      const lightweight = diaries.slice(0, 15).map((d) => {
        const allPhotos = Array.isArray(d.photos) ? d.photos : [];
        const totalCount = Math.max(d.totalPhotosCount || 0, allPhotos.length);
        return {
          ...d,
          photos: [],
          totalPhotosCount: totalCount,
          hasSubcollectionPhotos: Boolean(d.hasSubcollectionPhotos || totalCount > 0),
        };
      });
      const json = JSON.stringify(lightweight);
      if (json.length <= 150_000) {
        localStorage.setItem(STORAGE_KEY, json);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    return;
  }

  const { deduplicated } = deduplicateDiaries(diaries);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deduplicated));
  } catch (e) {
    console.warn('localStorage quota reached. Full photos and diaries are safely preserved in IndexedDB.', e);
  }
}

/**
 * Exports all travel diaries as a formatted JSON file.
 * Compatible with mobile phones (Android, iOS) and desktop browsers:
 * - Uses Blob + Object URL with application/json
 * - Triggers native browser download directly into the device's Download (다운로드) folder
 */
export type ExportMode = 'all' | 'modified' | 'range';

export interface ExportOptions {
  mode: ExportMode;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

/**
 * Safely parses a timestamp from a number, string, or date into epoch milliseconds
 */
export function parseTimestamp(val: unknown): number | null {
  if (typeof val === 'number' && !isNaN(val) && val > 0) {
    return val < 10000000000 ? val * 1000 : val;
  }
  if (typeof val === 'string' && val.trim()) {
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      return num < 10000000000 ? num * 1000 : num;
    }
    const parsed = Date.parse(val);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Checks if a diary has been modified AFTER being added to the server (not a newly added diary).
 * - Addition (새로 추가된 일기): createdAt === updatedAt (diff <= 1000ms) or isModified === false. This is NOT a modification.
 * - Modification (서버에 추가된 후 수정이 있었던 일기):
 *   1) Explicitly marked with isModified === true
 *   2) OR updatedAt is newer than createdAt by more than 1000ms (1 second)
 *   3) AND the modification occurred within the specified days (default 14 days / 2 weeks)
 */
export function isDiaryModified(d: DiaryEntry, withinDays = 14): boolean {
  if (!d) return false;

  // If explicitly declared as not modified (e.g. brand new addition)
  if (d.isModified === false) return false;

  const updated = parseTimestamp(d.updatedAt);
  const created = parseTimestamp(d.createdAt);

  // Must have an update timestamp
  if (!updated) return false;

  // Must be modified within the last 2 weeks (14 days)
  const now = Date.now();
  const cutoffTime = now - withinDays * 24 * 60 * 60 * 1000;
  if (updated < cutoffTime) return false;

  // Definition: Modification is NOT an addition; it must be a modification AFTER being added to the server.
  if (d.isModified === true) {
    return true;
  }

  // If created timestamp exists, check that it was modified after initial addition
  if (created) {
    return (updated - created) > 1000;
  }

  return false;
}

/**
 * Filters diaries according to selected export options
 */
export function filterDiariesForExport(diaries: DiaryEntry[], options: ExportOptions): DiaryEntry[] {
  const sorted = sortDiariesDescending(diaries);

  if (options.mode === 'all') {
    return sorted;
  }

  if (options.mode === 'modified') {
    return sorted.filter(isDiaryModified);
  }

  if (options.mode === 'range') {
    const start = options.startDate || '1970-01-01';
    const end = options.endDate || '2099-12-31';
    const minDate = start <= end ? start : end;
    const maxDate = start <= end ? end : start;

    return sorted.filter((d) => {
      if (!d.date) return false;
      return d.date >= minDate && d.date <= maxDate;
    });
  }

  return sorted;
}

/**
 * Exports diaries as a formatted JSON file with specific options
 */
export async function exportDiariesWithOptions(
  diaries: DiaryEntry[],
  options: ExportOptions,
  visitsByDiary?: Record<string, DiaryVisitRecord[]>
): Promise<{ count: number; visitCount: number; success: boolean; fileName: string }> {
  const filtered = filterDiariesForExport(diaries, options);
  const count = filtered.length;

  const formatYymmdd = (dateStr: string): string => {
    const digits = dateStr.replace(/[^0-9]/g, '');
    if (digits.length >= 8) return digits.slice(2, 8);
    if (digits.length === 6) return digits;
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  };

  const formatMmdd = (dateStr: string): string => {
    const digits = dateStr.replace(/[^0-9]/g, '');
    if (digits.length >= 8) return digits.slice(4, 8);
    if (digits.length === 6) return digits.slice(2, 6);
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${mm}${dd}`;
  };

  let startYmd = '';
  let endYmd = '';

  if (options.mode === 'range' && options.startDate && options.endDate) {
    startYmd = options.startDate <= options.endDate ? options.startDate : options.endDate;
    endYmd = options.startDate <= options.endDate ? options.endDate : options.startDate;
  } else {
    const validDates = filtered
      .map((d) => (d.date || '').trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    if (validDates.length > 0) {
      startYmd = validDates[0];
      endYmd = validDates[validDates.length - 1];
    } else {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      startYmd = today;
      endYmd = today;
    }
  }

  const fileName = `viajes_${formatYymmdd(startYmd)}~${formatMmdd(endYmd)}(${count}).json`;

  if (filtered.length === 0) {
    return { count: 0, visitCount: 0, success: false, fileName };
  }

  let totalVisitCount = 0;
  const blobParts: BlobPart[] = ['[\n'];
  for (let i = 0; i < filtered.length; i++) {
    if (i > 0) blobParts.push(',\n');
    const itemVisits = visitsByDiary?.[filtered[i].id];
    const exportItem: ExportedDiaryEntry =
      Array.isArray(itemVisits) && itemVisits.length > 0
        ? { ...filtered[i], visits: itemVisits }
        : filtered[i];
    if (Array.isArray(itemVisits)) {
      totalVisitCount += itemVisits.length;
    }
    blobParts.push(JSON.stringify(exportItem, null, 2));
  }
  blobParts.push('\n]');
  const blob = new Blob(blobParts, { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = fileName;
  downloadAnchor.setAttribute('download', fileName);
  downloadAnchor.style.display = 'none';
  document.body.appendChild(downloadAnchor);

  downloadAnchor.click();

  setTimeout(() => {
    try {
      if (document.body.contains(downloadAnchor)) {
        document.body.removeChild(downloadAnchor);
      }
      URL.revokeObjectURL(url);
    } catch {}
  }, 4000);

  return { count: filtered.length, visitCount: totalVisitCount, success: true, fileName };
}

/**
 * Backward-compatible helper for export
 */
export async function exportDiariesToJson(
  diaries: DiaryEntry[],
  options?: ExportOptions
): Promise<{ count: number; success: boolean }> {
  const result = await exportDiariesWithOptions(diaries, options || { mode: 'all' });
  return { count: result.count, success: result.success };
}


