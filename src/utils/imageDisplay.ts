import { useEffect, useState } from 'react';

const MAX_THUMB_CACHE_ENTRIES = 80;
const MAX_FULL_BLOB_CACHE_ENTRIES = 8;

interface CachedObjectUrl {
  url: string;
  sizeHint: number;
}

const thumbCache = new Map<string, CachedObjectUrl>();
const fullBlobCache = new Map<string, CachedObjectUrl>();
const inFlightTasks = new Map<string, Promise<string>>();

// Bounded queue (max 2 concurrent Canvas thumbnail renders) to prevent iOS WebKit OOM spikes
let activeWorkers = 0;
const MAX_CONCURRENT_WORKERS = 2;
const taskQueue: Array<() => void> = [];

function runInWorkerQueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      activeWorkers++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeWorkers--;
          const next = taskQueue.shift();
          if (next) next();
        });
    };

    if (activeWorkers < MAX_CONCURRENT_WORKERS) {
      start();
    } else {
      taskQueue.push(start);
    }
  });
}

function hashSourceKey(src: string): string {
  const len = src.length;
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(len / 48));
  for (let i = 0; i < len; i += step) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const tailStart = Math.max(0, len - 24);
  for (let i = tailStart; i < len; i++) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${len}_${(hash >>> 0).toString(36)}`;
}

function setLruEntry(cache: Map<string, CachedObjectUrl>, key: string, value: CachedObjectUrl, maxEntries: number) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    const evicted = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (evicted?.url && evicted.url.startsWith('blob:')) {
      const toRevoke = evicted.url;
      setTimeout(() => {
        try {
          URL.revokeObjectURL(toRevoke);
        } catch {}
      }, 6000);
    }
  }
}

function touchLruEntry(cache: Map<string, CachedObjectUrl>, key: string): string | null {
  const found = cache.get(key);
  if (!found) return null;
  cache.delete(key);
  cache.set(key, found);
  return found.url;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx <= 0) return null;
    const header = dataUrl.slice(0, commaIdx);
    const body = dataUrl.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    if (header.includes(';base64')) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Converts a large data URL into a lightweight downscaled Blob ObjectURL,
 * freeing Canvas backing memory immediately and keeping an LRU cap to prevent iOS Jetsam OOM crashes.
 */
export function getCompactDisplayUrl(
  sourceUrl: string,
  maxDimension: number = 480,
  quality: number = 0.74
): Promise<string> {
  if (!sourceUrl) return Promise.resolve('');
  if (!sourceUrl.startsWith('data:image/')) {
    return Promise.resolve(sourceUrl);
  }

  // For full-screen lightbox display (>= 1800px), promote directly to a bounded Blob ObjectURL
  // without async canvas re-encoding so photos appear immediately with zero memory duplication.
  if (maxDimension >= 1800) {
    const fullKey = `full:${hashSourceKey(sourceUrl)}`;
    const fullCached = touchLruEntry(fullBlobCache, fullKey);
    if (fullCached) return Promise.resolve(fullCached);

    const blob = dataUrlToBlob(sourceUrl);
    if (blob) {
      const objUrl = URL.createObjectURL(blob);
      setLruEntry(fullBlobCache, fullKey, { url: objUrl, sizeHint: blob.size }, MAX_FULL_BLOB_CACHE_ENTRIES);
      return Promise.resolve(objUrl);
    }
    return Promise.resolve(sourceUrl);
  }

  // If image is already very small (< 32KB), convert directly to a Blob URL without re-encoding
  if (sourceUrl.length <= 42_000 && maxDimension >= 320) {
    const cacheKey = `raw:${hashSourceKey(sourceUrl)}`;
    const existing = touchLruEntry(thumbCache, cacheKey);
    if (existing) return Promise.resolve(existing);

    const blob = dataUrlToBlob(sourceUrl);
    if (blob) {
      const objUrl = URL.createObjectURL(blob);
      setLruEntry(thumbCache, cacheKey, { url: objUrl, sizeHint: blob.size }, MAX_THUMB_CACHE_ENTRIES);
      return Promise.resolve(objUrl);
    }
    return Promise.resolve(sourceUrl);
  }

  const cacheKey = `${maxDimension}:${hashSourceKey(sourceUrl)}`;
  const cached = touchLruEntry(thumbCache, cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = inFlightTasks.get(cacheKey);
  if (pending) return pending;

  const taskPromise = runInWorkerQueue(async () => {
    // Re-check cache after waiting in queue
    const cachedAgain = touchLruEntry(thumbCache, cacheKey);
    if (cachedAgain) return cachedAgain;

    const blob = dataUrlToBlob(sourceUrl);
    const inputUrl = blob ? URL.createObjectURL(blob) : sourceUrl;

    let img: HTMLImageElement | null = new Image();
    let canvas: HTMLCanvasElement | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        if (!img) return reject(new Error('Image disposed'));
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = inputUrl;
      });

      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      // If original dimensions are already <= maxDimension and we have a Blob, reuse Blob directly
      if (blob && origW > 0 && origH > 0 && origW <= maxDimension && origH <= maxDimension) {
        const objUrl = URL.createObjectURL(blob);
        const targetCache = maxDimension >= 1800 ? fullBlobCache : thumbCache;
        const maxCap = maxDimension >= 1800 ? MAX_FULL_BLOB_CACHE_ENTRIES : MAX_THUMB_CACHE_ENTRIES;
        const keyToStore = maxDimension >= 1800 ? `full:${hashSourceKey(sourceUrl)}` : cacheKey;
        setLruEntry(targetCache, keyToStore, { url: objUrl, sizeHint: blob.size }, maxCap);
        return objUrl;
      }

      const scale = origW > 0 && origH > 0 ? Math.min(1, maxDimension / Math.max(origW, origH)) : 1;
      const targetW = Math.max(1, Math.round(origW * scale));
      const targetH = Math.max(1, Math.round(origH * scale));

      canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        if (blob) {
          const objUrl = URL.createObjectURL(blob);
          setLruEntry(fullBlobCache, `full:${hashSourceKey(sourceUrl)}`, { url: objUrl, sizeHint: blob.size }, MAX_FULL_BLOB_CACHE_ENTRIES);
          return objUrl;
        }
        return sourceUrl;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = maxDimension >= 1000 ? 'high' : 'medium';
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const outBlob = await new Promise<Blob | null>((resolve) => {
        canvas?.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });

      if (!outBlob) {
        return sourceUrl;
      }

      const objUrl = URL.createObjectURL(outBlob);
      const targetCache = maxDimension >= 1800 ? fullBlobCache : thumbCache;
      const maxCap = maxDimension >= 1800 ? MAX_FULL_BLOB_CACHE_ENTRIES : MAX_THUMB_CACHE_ENTRIES;
      const keyToStore = maxDimension >= 1800 ? `full:${hashSourceKey(sourceUrl)}` : cacheKey;
      setLruEntry(targetCache, keyToStore, { url: objUrl, sizeHint: outBlob.size }, maxCap);
      return objUrl;
    } catch {
      if (blob) {
        const objUrl = URL.createObjectURL(blob);
        setLruEntry(fullBlobCache, `full:${hashSourceKey(sourceUrl)}`, { url: objUrl, sizeHint: blob.size }, MAX_FULL_BLOB_CACHE_ENTRIES);
        return objUrl;
      }
      return sourceUrl;
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
      if (img) {
        img.src = '';
        img = null;
      }
      if (blob && inputUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(inputUrl);
        } catch {}
      }
    }
  }).finally(() => {
    inFlightTasks.delete(cacheKey);
  });

  inFlightTasks.set(cacheKey, taskPromise);
  return taskPromise;
}

/**
 * Synchronous LRU lookup for an already-cached compact ObjectURL.
 */
export function getCachedCompactDisplayUrl(sourceUrl?: string, maxDimension: number = 480): string | null {
  if (!sourceUrl) return null;
  if (!sourceUrl.startsWith('data:image/')) return sourceUrl;
  if (sourceUrl.length <= 42_000 && maxDimension >= 320) {
    return touchLruEntry(thumbCache, `raw:${hashSourceKey(sourceUrl)}`);
  }
  if (maxDimension >= 1800) {
    return touchLruEntry(fullBlobCache, `full:${hashSourceKey(sourceUrl)}`);
  }
  return touchLruEntry(thumbCache, `${maxDimension}:${hashSourceKey(sourceUrl)}`);
}

/**
 * React hook returning a lightweight, memory-safe ObjectURL (downscaled to `maxDimension`)
 * for large base64 `data:image/` photos so mobile iOS WebKit never decodes dozens of 2K bitmaps at once.
 */
export function useDisplayImageUrl(
  sourceUrl?: string,
  maxDimension: number = 480,
  quality: number = 0.74
): string {
  const [resolvedUrl, setResolvedUrl] = useState<string>(() => {
    if (!sourceUrl) return '';
    if (!sourceUrl.startsWith('data:image/')) return sourceUrl;
    if (maxDimension >= 1800) {
      return getCachedCompactDisplayUrl(sourceUrl, maxDimension) || sourceUrl;
    }
    if (sourceUrl.length <= 42_000 && maxDimension >= 320) {
      return getCachedCompactDisplayUrl(sourceUrl, maxDimension) || sourceUrl;
    }
    return getCachedCompactDisplayUrl(sourceUrl, maxDimension) || '';
  });

  useEffect(() => {
    if (!sourceUrl) {
      setResolvedUrl('');
      return;
    }
    if (!sourceUrl.startsWith('data:image/')) {
      setResolvedUrl(sourceUrl);
      return;
    }

    const immediate = getCachedCompactDisplayUrl(sourceUrl, maxDimension);
    if (immediate) {
      setResolvedUrl(immediate);
      return;
    }

    // Show full lightbox or small inline thumbnails immediately while promoting to Blob URL,
    // and avoid passing multi-megabyte 2K strings to feed/thumb <img> prior to downscaling.
    if (maxDimension >= 1800 || (sourceUrl.length <= 42_000 && maxDimension >= 320)) {
      setResolvedUrl(sourceUrl);
    } else {
      setResolvedUrl('');
    }

    let active = true;
    getCompactDisplayUrl(sourceUrl, maxDimension, quality)
      .then((url) => {
        if (active) setResolvedUrl(url);
      })
      .catch(() => {
        if (active) setResolvedUrl(sourceUrl);
      });

    return () => {
      active = false;
    };
  }, [sourceUrl, maxDimension, quality]);

  return resolvedUrl;
}
