import { DiaryEntry } from '../types';

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
 * - OR same travel date (YYYY-MM-DD) and matching normalized title
 */
export function isDiaryDuplicate(a: DiaryEntry, b: DiaryEntry): boolean {
  if (!a || !b) return false;
  // Primarily rely on unique IDs. 
  // Title/Date matching is too aggressive and causes data loss if multiple entries share generic titles.
  if (a.id && b.id) {
    return a.id === b.id;
  }
  return false;
}

/**
 * Picks the higher quality/updated diary when two duplicates are found,
 * merging best traits (max views, earliest createdAt, latest updatedAt, photos).
 */
export function pickBetterDiary(a: DiaryEntry, b: DiaryEntry): { winner: DiaryEntry; loser: DiaryEntry } {
  let scoreA = 0;
  let scoreB = 0;

  // 1. Photos count (highest weight: 3) - updated versions typically carry more or equal photos
  const photosA = a.photos?.length || 0;
  const photosB = b.photos?.length || 0;
  if (photosA > photosB) scoreA += 3;
  else if (photosB > photosA) scoreB += 3;

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

  // Prefer keeping the winner's photos, or fallback to whichever has more photos
  const winnerPhotos = (winnerBase.photos && winnerBase.photos.length > 0)
    ? winnerBase.photos
    : (loser.photos || []);

  const winner: DiaryEntry = {
    ...winnerBase,
    views: Math.max(a.views || 0, b.views || 0),
    createdAt: Math.min(a.createdAt || Date.now(), b.createdAt || Date.now()),
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0, Date.now()),
    photos: winnerPhotos,
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
      const { deduplicated } = deduplicateDiaries(parsed);
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
    // Full diaries & photos live in IndexedDB. Never let localStorage fill up iPhone's 5MB origin limit
    // and starve auth session or Firestore sync metadata keys.
    try {
      const lightweight = diaries.slice(0, 15).map((d) => ({
        ...d,
        photos: (d.photos || []).map((p) => ({
          ...p,
          url: p.url && p.url.startsWith('data:image/') && p.url.length > 60_000 ? '' : p.url,
        })),
      }));
      const json = JSON.stringify(lightweight);
      if (json.length <= 400_000) {
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
  options: ExportOptions
): Promise<{ count: number; success: boolean; fileName: string }> {
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
    return { count: 0, success: false, fileName };
  }

  const jsonString = JSON.stringify(filtered, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
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

  return { count: filtered.length, success: true, fileName };
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


