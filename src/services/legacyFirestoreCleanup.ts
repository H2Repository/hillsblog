import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { app } from '../lib/firebase';

let legacyDb: ReturnType<typeof getFirestore> | null = null;

function getLegacyFirestore() {
  if (legacyDb) return legacyDb;
  try {
    legacyDb = initializeFirestore(
      app,
      {
        localCache: memoryLocalCache(),
        experimentalForceLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    legacyDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
  return legacyDb;
}

/**
 * Deletes all documents in the legacy Firestore `diaries` collection (and nested `photos`/`chunks`).
 * Intended to be called manually only if residual Firestore cleanup is needed after quota resets.
 */
export async function wipeLegacyFirestoreDiaries(): Promise<{
  deletedDiaries: number;
  deletedPhotos: number;
  deletedChunks: number;
}> {
  const db = getLegacyFirestore();
  const diariesSnap = await getDocs(collection(db, 'diaries'));
  let deletedPhotos = 0;
  let deletedChunks = 0;

  for (const d of diariesSnap.docs) {
    const photosSnap = await getDocs(collection(db, 'diaries', d.id, 'photos'));
    for (const p of photosSnap.docs) {
      const chunksSnap = await getDocs(collection(db, 'diaries', d.id, 'photos', p.id, 'chunks'));
      for (const c of chunksSnap.docs) {
        await deleteDoc(doc(db, 'diaries', d.id, 'photos', p.id, 'chunks', c.id));
        deletedChunks++;
      }
      await deleteDoc(doc(db, 'diaries', d.id, 'photos', p.id));
      deletedPhotos++;
    }
    await deleteDoc(doc(db, 'diaries', d.id));
  }

  // Also clear old Firestore client metadata caches
  try {
    localStorage.removeItem('hills_server_meta_cache_v1');
    localStorage.removeItem('hills_server_sync_state_v1');
  } catch {}

  return {
    deletedDiaries: diariesSnap.size,
    deletedPhotos,
    deletedChunks,
  };
}
