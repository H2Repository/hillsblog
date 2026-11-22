import { useEffect, useMemo, useState } from 'react';
import { DiaryEntry } from '../types';
import { calculateDistanceKm } from '../utils/geo';
import { getLocalMeta, setLocalMeta } from '../utils/localDb';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface RoadSegmentResult {
  distanceKm: number;
  isRoad: boolean;
  updatedAt: number;
}

const ROAD_CACHE_META_KEY = 'hills_road_distance_cache_v1';
const ROAD_CACHE_LS_KEY = 'hills_road_distance_cache_v1';
const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const MAX_BATCH_WAYPOINTS = 12;
const MAX_ROAD_CANDIDATE_STRAIGHT_KM = 600;
const RETRY_COOLDOWN_MS = 60 * 1000;
const NO_ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const segmentCache = new Map<string, RoadSegmentResult>();
const listeners = new Set<() => void>();
const retryCooldownMap = new Map<string, number>();

let idbLoaded = false;
let idbLoadPromise: Promise<void> | null = null;
let lsLoaded = false;
let cacheVersion = 0;
let queueProcessing = false;
let activeInFlightCount = 0;
let onlineListenerAttached = false;

interface PendingPair {
  key: string;
  from: LatLngPoint;
  to: LatLngPoint;
}

const pendingQueue = new Map<string, PendingPair>();

function roundCoord(val: number): string {
  return Number(val).toFixed(5);
}

export function makeSegmentKey(from: LatLngPoint, to: LatLngPoint): string {
  return `${roundCoord(from.lat)},${roundCoord(from.lng)}->${roundCoord(to.lat)},${roundCoord(to.lng)}`;
}

function isValidLatLng(p?: LatLngPoint | null): p is LatLngPoint {
  return Boolean(
    p &&
      typeof p.lat === 'number' &&
      typeof p.lng === 'number' &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lng) <= 180 &&
      !(p.lat === 0 && p.lng === 0)
  );
}

function notifyListeners(): void {
  cacheVersion++;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

function loadLocalStorageCacheSync(): void {
  if (lsLoaded) return;
  lsLoaded = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(ROAD_CACHE_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, RoadSegmentResult>;
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.distanceKm === 'number' && !segmentCache.has(k)) {
          segmentCache.set(k, v);
        }
      }
    }
  } catch {}
}

let persistTimer: number | null = null;
function schedulePersistCache(): void {
  if (typeof window === 'undefined') return;
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const obj: Record<string, RoadSegmentResult> = {};
    for (const [k, v] of segmentCache.entries()) {
      obj[k] = v;
    }
    setLocalMeta(ROAD_CACHE_META_KEY, obj).catch(() => {});
    try {
      const entries = Object.entries(obj).slice(-250);
      localStorage.setItem(ROAD_CACHE_LS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }, 400);
}

async function ensureIdbCacheLoaded(): Promise<void> {
  loadLocalStorageCacheSync();
  if (idbLoaded) return;
  if (idbLoadPromise) return idbLoadPromise;

  idbLoadPromise = (async () => {
    try {
      const stored = await getLocalMeta<Record<string, RoadSegmentResult>>(ROAD_CACHE_META_KEY);
      if (stored && typeof stored === 'object') {
        let added = 0;
        for (const [k, v] of Object.entries(stored)) {
          if (v && typeof v.distanceKm === 'number' && !segmentCache.has(k)) {
            segmentCache.set(k, v);
            added++;
          }
        }
        if (added > 0) {
          notifyListeners();
        }
      }
    } catch {}
    idbLoaded = true;
  })();

  return idbLoadPromise;
}

function getCachedEntry(key: string): RoadSegmentResult | undefined {
  loadLocalStorageCacheSync();
  const cached = segmentCache.get(key);
  if (!cached) return undefined;
  if (!cached.isRoad && Date.now() - (cached.updatedAt || 0) > NO_ROUTE_TTL_MS) {
    return undefined;
  }
  return cached;
}

export function getSegmentDistanceSync(
  from?: LatLngPoint | null,
  to?: LatLngPoint | null
): { km: number; isRoad: boolean } {
  if (!isValidLatLng(from) || !isValidLatLng(to)) {
    return { km: 0, isRoad: false };
  }
  const straightKm = calculateDistanceKm(from.lat, from.lng, to.lat, to.lng);
  if (straightKm < 0.05) {
    return { km: 0, isRoad: true };
  }
  if (straightKm > MAX_ROAD_CANDIDATE_STRAIGHT_KM) {
    return { km: straightKm, isRoad: false };
  }

  const key = makeSegmentKey(from, to);
  const cached = getCachedEntry(key);
  if (cached) {
    return { km: cached.distanceKm, isRoad: cached.isRoad };
  }
  return { km: straightKm, isRoad: false };
}

async function fetchOsrmRouteLegs(
  waypoints: LatLngPoint[]
): Promise<{ status: 'ok'; distancesMeters: number[] } | { status: 'no_route' } | { status: 'network_error' }> {
  if (waypoints.length < 2) {
    return { status: 'ok', distancesMeters: [] };
  }
  const coordStr = waypoints.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const url = `${OSRM_BASE_URL}/${coordStr}?overview=false&steps=false&alternatives=false`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = typeof window !== 'undefined' && controller
    ? window.setTimeout(() => controller.abort(), 7000)
    : null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller?.signal,
    });
    if (res.status === 400) {
      return { status: 'no_route' };
    }
    if (!res.ok) {
      return { status: 'network_error' };
    }
    const json = (await res.json()) as {
      code?: string;
      routes?: Array<{ legs?: Array<{ distance?: number }> }>;
    };
    if (json.code === 'NoRoute' || json.code === 'NoSegment') {
      return { status: 'no_route' };
    }
    if (json.code !== 'Ok' || !Array.isArray(json.routes) || json.routes.length === 0) {
      return { status: 'network_error' };
    }
    const legs = json.routes[0]?.legs;
    if (!Array.isArray(legs) || legs.length !== waypoints.length - 1) {
      return { status: 'no_route' };
    }
    return {
      status: 'ok',
      distancesMeters: legs.map((leg) => Number(leg?.distance) || 0),
    };
  } catch {
    return { status: 'network_error' };
  } finally {
    if (timeout !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeout);
    }
  }
}

async function processQueue(): Promise<void> {
  if (queueProcessing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  queueProcessing = true;
  activeInFlightCount++;
  notifyListeners();

  try {
    await ensureIdbCacheLoaded();

    while (pendingQueue.size > 0) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;

      const allPending = Array.from(pendingQueue.values());
      const now = Date.now();
      const batch: PendingPair[] = [];

      // Build a contiguous chain of waypoints when possible so one OSRM call resolves up to 11 segments
      for (const item of allPending) {
        pendingQueue.delete(item.key);
        if (getCachedEntry(item.key)) continue;
        const cooldownUntil = retryCooldownMap.get(item.key) || 0;
        if (cooldownUntil > now) continue;

        if (batch.length === 0) {
          batch.push(item);
        } else {
          const prev = batch[batch.length - 1];
          const isContiguous =
            roundCoord(prev.to.lat) === roundCoord(item.from.lat) &&
            roundCoord(prev.to.lng) === roundCoord(item.from.lng);
          if (isContiguous && batch.length + 1 < MAX_BATCH_WAYPOINTS) {
            batch.push(item);
          } else {
            // Put back for next iteration
            pendingQueue.set(item.key, item);
            break;
          }
        }
      }

      if (batch.length === 0) continue;

      const waypoints: LatLngPoint[] = [batch[0].from, ...batch.map((b) => b.to)];
      const batchRes = await fetchOsrmRouteLegs(waypoints);
      let updatedAny = false;

      if (batchRes.status === 'ok') {
        batch.forEach((pair, idx) => {
          const straightKm = calculateDistanceKm(pair.from.lat, pair.from.lng, pair.to.lat, pair.to.lng);
          const rawMeters = batchRes.distancesMeters[idx] || 0;
          const roadKm = Math.round((rawMeters / 1000) * 10) / 10;
          const finalKm = roadKm > 0 ? roadKm : straightKm;
          segmentCache.set(pair.key, {
            distanceKm: finalKm,
            isRoad: roadKm > 0,
            updatedAt: Date.now(),
          });
          retryCooldownMap.delete(pair.key);
          updatedAny = true;
        });
      } else if (batchRes.status === 'no_route') {
        // Resolve each pair individually so one ferry/unroutable jump doesn't block neighbors
        for (const pair of batch) {
          if (typeof navigator !== 'undefined' && !navigator.onLine) break;
          const singleRes = await fetchOsrmRouteLegs([pair.from, pair.to]);
          const straightKm = calculateDistanceKm(pair.from.lat, pair.from.lng, pair.to.lat, pair.to.lng);
          if (singleRes.status === 'ok') {
            const rawMeters = singleRes.distancesMeters[0] || 0;
            const roadKm = Math.round((rawMeters / 1000) * 10) / 10;
            segmentCache.set(pair.key, {
              distanceKm: roadKm > 0 ? roadKm : straightKm,
              isRoad: roadKm > 0,
              updatedAt: Date.now(),
            });
            retryCooldownMap.delete(pair.key);
            updatedAny = true;
          } else if (singleRes.status === 'no_route') {
            segmentCache.set(pair.key, {
              distanceKm: straightKm,
              isRoad: false,
              updatedAt: Date.now(),
            });
            updatedAny = true;
          } else {
            retryCooldownMap.set(pair.key, Date.now() + RETRY_COOLDOWN_MS);
          }
          await new Promise((r) => setTimeout(r, 120));
        }
      } else {
        batch.forEach((pair) => {
          retryCooldownMap.set(pair.key, Date.now() + RETRY_COOLDOWN_MS);
        });
        break;
      }

      if (updatedAny) {
        schedulePersistCache();
        notifyListeners();
      }

      if (pendingQueue.size > 0) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  } finally {
    queueProcessing = false;
    activeInFlightCount = Math.max(0, activeInFlightCount - 1);
    notifyListeners();
  }
}

export function enqueueRoadDistancePairs(pairs: Array<{ from: LatLngPoint; to: LatLngPoint }>): void {
  if (pairs.length === 0) return;
  if (typeof window !== 'undefined' && !onlineListenerAttached) {
    onlineListenerAttached = true;
    window.addEventListener('online', () => {
      retryCooldownMap.clear();
      if (pendingQueue.size > 0) {
        processQueue().catch(() => {});
      }
    });
  }

  ensureIdbCacheLoaded().then(() => {
    const now = Date.now();
    let enqueued = 0;

    for (const { from, to } of pairs) {
      if (!isValidLatLng(from) || !isValidLatLng(to)) continue;
      const straightKm = calculateDistanceKm(from.lat, from.lng, to.lat, to.lng);
      if (straightKm < 0.05 || straightKm > MAX_ROAD_CANDIDATE_STRAIGHT_KM) continue;

      const key = makeSegmentKey(from, to);
      if (getCachedEntry(key)) continue;
      const cooldownUntil = retryCooldownMap.get(key) || 0;
      if (cooldownUntil > now) continue;
      if (!pendingQueue.has(key)) {
        pendingQueue.set(key, { key, from, to });
        enqueued++;
      }
    }

    if (enqueued > 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
      processQueue().catch(() => {});
    }
  });
}

function normalizeTimeForSort(timeStr?: string): string {
  if (!timeStr) return '00:00';
  const parts = String(timeStr).trim().split(':');
  if (parts.length < 2) return '00:00';
  const hh = parts[0].padStart(2, '0');
  const mm = parts[1].slice(0, 2).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function sortDiariesChronological<T extends DiaryEntry>(diaries: T[]): T[] {
  return [...diaries].sort((a, b) => {
    const dtA = `${a.date || ''} ${normalizeTimeForSort(a.time)}`.trim();
    const dtB = `${b.date || ''} ${normalizeTimeForSort(b.time)}`.trim();
    if (dtA !== dtB) return dtA.localeCompare(dtB);
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

export function getDistanceDiariesChain(diaries: DiaryEntry[]): DiaryEntry[] {
  const sorted = sortDiariesChronological(diaries);
  if (sorted.length === 0) return [];
  const startIndex = sorted.findIndex(
    (d) =>
      (d.date && d.date.includes('10-23')) ||
      (d.title &&
        (d.title.includes('자전거') ||
          d.title.includes('가게') ||
          d.title.includes('가계') ||
          d.title.includes('샵'))) ||
      (d.content &&
        (d.content.includes('자전거') ||
          d.content.includes('가게') ||
          d.content.includes('가계')))
  );
  const relevant = sorted.slice(startIndex !== -1 ? startIndex : 0);
  return relevant.filter(
    (d) => (d.location?.includeInDistance ?? d.includeInDistance ?? true) !== false
  );
}

export function useRoadDistances(diaries: DiaryEntry[]): {
  version: number;
  isCalculatingRoadDistances: boolean;
  cumulativeDistanceKm: number;
  cumulativeHasRoadData: boolean;
  getSegmentDistance: (from?: LatLngPoint | null, to?: LatLngPoint | null) => { km: number; isRoad: boolean };
} {
  const [version, setVersion] = useState(cacheVersion);

  useEffect(() => {
    const onUpdate = () => setVersion(cacheVersion);
    listeners.add(onUpdate);
    ensureIdbCacheLoaded();
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  const { allPairs, cumulativeChain } = useMemo(() => {
    const sorted = sortDiariesChronological(diaries);
    const chain = getDistanceDiariesChain(sorted);
    const pairs: Array<{ from: LatLngPoint; to: LatLngPoint }> = [];

    for (let i = 1; i < sorted.length; i++) {
      const from = sorted[i - 1]?.location;
      const to = sorted[i]?.location;
      if (isValidLatLng(from) && isValidLatLng(to)) {
        pairs.push({ from, to });
      }
    }

    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1]?.location;
      const to = chain[i]?.location;
      if (isValidLatLng(from) && isValidLatLng(to)) {
        pairs.push({ from, to });
      }
    }

    return { allPairs: pairs, cumulativeChain: chain };
  }, [diaries]);

  useEffect(() => {
    if (allPairs.length > 0) {
      enqueueRoadDistancePairs(allPairs);
    }
  }, [allPairs]);

  const { cumulativeDistanceKm, cumulativeHasRoadData } = useMemo(() => {
    let total = 0;
    let hasRoad = false;
    for (let i = 1; i < cumulativeChain.length; i++) {
      const res = getSegmentDistanceSync(
        cumulativeChain[i - 1]?.location,
        cumulativeChain[i]?.location
      );
      total += res.km;
      if (res.isRoad && res.km > 0) hasRoad = true;
    }
    return {
      cumulativeDistanceKm: Math.round(total * 10) / 10,
      cumulativeHasRoadData: hasRoad,
    };
  }, [cumulativeChain, version]);

  return {
    version,
    isCalculatingRoadDistances: activeInFlightCount > 0,
    cumulativeDistanceKm,
    cumulativeHasRoadData,
    getSegmentDistance: getSegmentDistanceSync,
  };
}
