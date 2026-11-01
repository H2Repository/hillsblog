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
  if (a.id && b.id && a.id === b.id) return true;
  if (a.date && b.date && a.date === b.date) {
    const normA = normalizeTitle(a.title);
    const normB = normalizeTitle(b.title);
    if (normA.length > 0 && normA === normB) {
      return true;
    }
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
 * Checks if a diary has been modified after creation
 */
export function isDiaryModified(d: DiaryEntry): boolean {
  return Boolean(d.updatedAt && d.createdAt && d.updatedAt - d.createdAt > 1000);
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
  const nowStr = new Date().toISOString().slice(0, 10);

  let fileName = `hills_diaries_전체_${nowStr}.json`;
  if (options.mode === 'modified') {
    fileName = `hills_diaries_수정된일기_${nowStr}.json`;
  } else if (options.mode === 'range') {
    const start = options.startDate || nowStr;
    const end = options.endDate || nowStr;
    fileName = `hills_diaries_${start}_${end}.json`;
  }

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


