import { DiaryEntry } from '../types';
import { sortDiariesDescending, saveDiaries } from './storage';

// Database configuration
const DB_NAME = 'hills_travel_storage_v5';
const DB_VERSION = 2;
const STORE_DIARIES = 'diaries';
const STORE_META = 'meta';

let cachedDbPromise: Promise<IDBDatabase> | null = null;
let v4MigrationChecked = false;

/**
 * IndexedDB storage implementation for permanent local browser storage.
 * Reuses a singleton IDBDatabase connection so local writes commit immediately.
 */
async function openDB(): Promise<IDBDatabase> {
  if (!cachedDbPromise) {
    cachedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_DIARIES)) {
          db.createObjectStore(STORE_DIARIES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          cachedDbPromise = null;
        };
        db.onclose = () => {
          cachedDbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        cachedDbPromise = null;
        reject(request.error);
      };
    });
  }

  const db = await cachedDbPromise;

  // One-time migration from localStorage (v4) to IndexedDB (v5)
  if (!v4MigrationChecked) {
    v4MigrationChecked = true;
    const MIGRATION_KEY = 'hills_travel_idb_migrated_v5';
    if (!localStorage.getItem(MIGRATION_KEY)) {
      try {
        const oldDiaries = localStorage.getItem('hills_travel_diaries_v4');
        if (oldDiaries) {
          const parsed = JSON.parse(oldDiaries);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`[Migration] Moving ${parsed.length} diaries from localStorage to IndexedDB...`);
            const tx = db.transaction(STORE_DIARIES, 'readwrite');
            const store = tx.objectStore(STORE_DIARIES);
            parsed.forEach(d => store.put(d));
          }
        }
        localStorage.setItem(MIGRATION_KEY, 'true');
      } catch (err) {
        console.warn('[Migration] Error during localStorage to IndexedDB migration:', err);
      }
    }
  }

  return db;
}

async function getFromStore<T>(storeName: string, id: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function saveToStore<T>(storeName: string, item: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    store.put(item);
  });
}

async function deleteFromStore(storeName: string, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    store.delete(id);
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    store.clear();
  });
}

export function isLocalDbPersistent(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function getLocalDiaryCount(): Promise<number> {
  const diaries = await getAllLocalDiaries();
  return diaries.length;
}

export async function getAllLocalDiaries(): Promise<DiaryEntry[]> {
  try {
    const diaries = await getAllFromStore<DiaryEntry>(STORE_DIARIES);
    return sortDiariesDescending(diaries);
  } catch (err) {
    console.error('getAllLocalDiaries IndexedDB error:', err);
    return [];
  }
}

export async function getLocalDiaryById(id: string): Promise<DiaryEntry | null> {
  return getFromStore<DiaryEntry>(STORE_DIARIES, id);
}

export async function saveLocalDiary(entry: DiaryEntry): Promise<void> {
  await saveToStore(STORE_DIARIES, entry);
}

export async function saveMultipleLocalDiaries(entries: DiaryEntry[], forceOverwrite = false): Promise<void> {
  if (!entries || entries.length === 0) return;
  const existingMap = new Map<string, DiaryEntry>();
  if (!forceOverwrite) {
    const current = await getAllLocalDiaries();
    current.forEach(item => existingMap.set(item.id, item));
  }

  const db = await openDB();
  const CHUNK_SIZE = 10;
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_DIARIES, 'readwrite');
      const store = transaction.objectStore(STORE_DIARIES);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));

      chunk.forEach((entry) => {
        if (!forceOverwrite) {
          const existing = existingMap.get(entry.id);
          if (existing && (existing.updatedAt || 0) > (entry.updatedAt || 0)) {
            return;
          }
        }
        store.put(entry);
      });
    });
  }
}

export async function deleteLocalDiary(id: string): Promise<void> {
  await deleteFromStore(STORE_DIARIES, id);
}

export async function clearLocalDb(): Promise<void> {
  await clearStore(STORE_DIARIES);
  await clearStore(STORE_META);
  saveDiaries([]);
}

export async function getLocalMeta<T>(key: string): Promise<T | null> {
  try {
    const record = await getFromStore<{ key: string; value: T }>(STORE_META, key);
    return record ? record.value : null;
  } catch {
    return null;
  }
}

export async function setLocalMeta<T>(key: string, value: T): Promise<void> {
  try {
    await saveToStore(STORE_META, { key, value });
  } catch {}
}
