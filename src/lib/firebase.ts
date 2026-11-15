import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore, 
  memoryLocalCache,
  doc, 
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

let firestoreInstance: ReturnType<typeof getFirestore>;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: true,
  }, firebaseConfig.firestoreDatabaseId);
} catch {
  firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = firestoreInstance;
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isFirestoreQuotaExceededError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const msg = error instanceof Error ? error.message : String(error || '');
  return (
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('Quota exceeded') ||
    msg.includes('Quota limit exceeded')
  );
}

export function isFirestoreOfflineError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const msg = error instanceof Error ? error.message : String(error || '');
  return (
    code === 'unavailable' ||
    msg.includes('the client is offline') ||
    msg.includes('Failed to get document because the client is offline')
  );
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Lightweight connection test on demand (single document ping, never scans full collection)
export async function testFirestoreConnection(timeoutMs = 8000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    await Promise.race([
      getDocFromServer(doc(db, 'test', 'connection')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore connection check timeout')), timeoutMs)
      ),
    ]);
    return true;
  } catch (error: any) {
    // Quota exceeded or permission/not-found means the Firestore server IS reachable and online
    if (
      isFirestoreQuotaExceededError(error) ||
      error?.code === 'permission-denied' ||
      error?.code === 'not-found'
    ) {
      return true;
    }
    if (isFirestoreOfflineError(error)) {
      return typeof navigator !== 'undefined' ? navigator.onLine : false;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      return true;
    }
    return false;
  }
}

