import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  browserPopupRedirectResolver,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import firebaseConfig from '../../firebase-applet-config.json';

const LEGACY_ACTIVITY_STORAGE_KEY = 'hills_blog_last_activity';
const VERIFIED_ADMIN_UID_KEY = 'hills_blog_verified_admin_uid';
const PENDING_REDIRECT_KEY = 'hills_blog_pending_redirect';
const LOCAL_EDIT_UNLOCKED_KEY = 'hills_blog_local_edit_unlocked_v3';
const AUTO_DIARY_SETTINGS_KEY = 'hills_blog_auto_diary_settings_v3';
const LEGACY_AUTO_DIARY_SETTINGS_KEY = 'hills_blog_auto_diary_settings_v2';
const DEFAULT_AUTO_DIARY_INTERVAL_MINUTES = 60;
const LOCAL_EDIT_PASSCODE_SHA256 = '59a9722d8cf18d41942c717fef4eb5cd9e53fe188e5c860e4414c585aab93809';

export type LoginModalTab = 'local' | 'admin';

export interface AutoDiarySettings {
  enabled: boolean;
  intervalMinutes: number;
  lastAutoDiaryAt: number | null;
  nextAutoDiaryAt: number | null;
}

export interface AppUser {
  uid: string;
  displayName: string;
  photoURL?: string;
  isAdmin: boolean;
  provider: 'google';
}

export interface LoginResult {
  success: boolean;
  error?: string;
  offerRedirectFallback?: boolean;
}

interface AuthContextType {
  currentUser: AppUser | null;
  isAdmin: boolean;
  isLocalEditUnlocked: boolean;
  canEditLocal: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isLoginModalOpen: boolean;
  loginModalTab: LoginModalTab;
  loginActionPrompt: string | null;
  autoLogoutNotice: string | null;
  canUseRedirectFallback: boolean;
  autoDiarySettings: AutoDiarySettings;
  updateAutoDiarySettings: (patch: Partial<AutoDiarySettings>) => void;
  clearAutoLogoutNotice: () => void;
  setLoginModalTab: (tab: LoginModalTab) => void;
  openLoginModal: (promptReason?: string, defaultTab?: LoginModalTab) => void;
  closeLoginModal: () => void;
  loginWithGoogle: () => Promise<LoginResult>;
  loginWithGoogleRedirect: () => Promise<LoginResult>;
  unlockLocalEditWithPassword: (
    password: string,
    autoDiaryOptions?: { enabled: boolean; intervalMinutes: number; keepModalOpen?: boolean }
  ) => LoginResult;
  lockLocalEdit: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function probeGoogleAuthReachability(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = window.setTimeout(() => controller?.abort(), 2800);
  try {
    await Promise.all([
      fetch(`https://${firebaseConfig.authDomain}/__/auth/iframe`, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller?.signal,
      }),
      fetch('https://apis.google.com/js/api.js', {
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller?.signal,
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

async function verifyAdminWithServer(
  fbUser: FirebaseUser,
  retries: number = 1
): Promise<{ known: boolean; isAdmin: boolean }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { known: false, isAdmin: false };
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const token = await fbUser.getIdToken();
      if (!token) return { known: false, isAdmin: false };
      const res = await fetch('/api/auth/me', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { isAdmin?: boolean };
        return { known: true, isAdmin: Boolean(data?.isAdmin) };
      }
      if (res.status < 500 || attempt >= retries) {
        return { known: false, isAdmin: false };
      }
    } catch {
      if (attempt >= retries) {
        return { known: false, isAdmin: false };
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { known: false, isAdmin: false };
}

function getCachedVerifiedAdminUid(): string | null {
  try {
    return localStorage.getItem(VERIFIED_ADMIN_UID_KEY);
  } catch {
    return null;
  }
}

function setCachedVerifiedAdminUid(uid: string | null): void {
  try {
    if (uid) {
      localStorage.setItem(VERIFIED_ADMIN_UID_KEY, uid);
    } else {
      localStorage.removeItem(VERIFIED_ADMIN_UID_KEY);
    }
  } catch {}
}

function sha256Hex(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLen = utf8.length * 8;
  const paddedLen = Math.ceil((utf8.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(utf8);
  buf[utf8.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

function getInitialLocalEditUnlocked(): boolean {
  try {
    return localStorage.getItem(LOCAL_EDIT_UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

function setPersistedLocalEditUnlocked(unlocked: boolean): void {
  try {
    if (unlocked) {
      localStorage.setItem(LOCAL_EDIT_UNLOCKED_KEY, '1');
    } else {
      localStorage.removeItem(LOCAL_EDIT_UNLOCKED_KEY);
    }
  } catch {}
}

function clampIntervalMinutes(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_AUTO_DIARY_INTERVAL_MINUTES;
  return Math.max(1, Math.min(240, Math.round(num)));
}

function getInitialAutoDiarySettings(): AutoDiarySettings {
  try {
    const raw = localStorage.getItem(AUTO_DIARY_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const intervalMinutes = clampIntervalMinutes(
        parsed?.intervalMinutes ?? DEFAULT_AUTO_DIARY_INTERVAL_MINUTES
      );
      const enabled = Boolean(parsed?.enabled);
      const lastAutoDiaryAt = Number(parsed?.lastAutoDiaryAt) || null;
      const storedNext = Number(parsed?.nextAutoDiaryAt) || null;
      return {
        enabled,
        intervalMinutes,
        lastAutoDiaryAt,
        nextAutoDiaryAt: enabled ? (storedNext || Date.now() + intervalMinutes * 60_000) : null,
      };
    }

    const legacyRaw = localStorage.getItem(LEGACY_AUTO_DIARY_SETTINGS_KEY);
    const legacyLastAt = legacyRaw ? Number(JSON.parse(legacyRaw)?.lastAutoDiaryAt) || null : null;
    return {
      enabled: false,
      intervalMinutes: DEFAULT_AUTO_DIARY_INTERVAL_MINUTES,
      lastAutoDiaryAt: legacyLastAt,
      nextAutoDiaryAt: null,
    };
  } catch {}
  return {
    enabled: false,
    intervalMinutes: DEFAULT_AUTO_DIARY_INTERVAL_MINUTES,
    lastAutoDiaryAt: null,
    nextAutoDiaryAt: null,
  };
}

function persistAutoDiarySettings(settings: AutoDiarySettings): void {
  try {
    localStorage.setItem(AUTO_DIARY_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLocalEditUnlocked, setIsLocalEditUnlocked] = useState<boolean>(() =>
    getInitialLocalEditUnlocked()
  );
  const [autoDiarySettings, setAutoDiarySettings] = useState<AutoDiarySettings>(() =>
    getInitialAutoDiarySettings()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginModalTab, setLoginModalTab] = useState<LoginModalTab>('local');
  const [loginActionPrompt, setLoginActionPrompt] = useState<string | null>(null);
  const [autoLogoutNotice, setAutoLogoutNotice] = useState<string | null>(null);

  // Store Firebase User object in memory only; Firebase SDK persists session in IndexedDB across reloads/offline
  const firebaseUserRef = useRef<FirebaseUser | null>(null);

  const clearAutoLogoutNotice = useCallback(() => {
    setAutoLogoutNotice(null);
  }, []);

  const closeLoginModal = useCallback(() => {
    setIsLoginModalOpen(false);
    setLoginActionPrompt(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Firebase signout error:', e);
    }
    firebaseUserRef.current = null;
    setCachedVerifiedAdminUid(null);
    try {
      localStorage.removeItem('hills_blog_admin_session');
      localStorage.removeItem(LEGACY_ACTIVITY_STORAGE_KEY);
    } catch {}
    setCurrentUser(null);
    closeLoginModal();
  }, [closeLoginModal]);

  const canUseRedirectFallback =
    typeof window !== 'undefined' &&
    (() => {
      try {
        return window.self === window.top;
      } catch {
        return false;
      }
    })();

  useEffect(() => {
    let isMounted = true;
    // Clean up legacy session / inactivity keys so login persists until manual logout
    try {
      localStorage.removeItem('hills_blog_admin_session');
      localStorage.removeItem(LEGACY_ACTIVITY_STORAGE_KEY);
    } catch {}

    // Handle returning from signInWithRedirect if triggered on mobile
    (async () => {
      let hadPendingRedirect = false;
      try {
        hadPendingRedirect = sessionStorage.getItem(PENDING_REDIRECT_KEY) === '1';
      } catch {}

      try {
        const redirectResult = await getRedirectResult(auth, browserPopupRedirectResolver);
        try {
          sessionStorage.removeItem(PENDING_REDIRECT_KEY);
        } catch {}
        if (!isMounted) return;
        if (redirectResult?.user) {
          const check = await verifyAdminWithServer(redirectResult.user, 2);
          if (!isMounted) return;
          if (check.known && !check.isAdmin) {
            await signOut(auth).catch(() => {});
            setCachedVerifiedAdminUid(null);
            setAutoLogoutNotice('블로그 관리자 계정으로만 로그인할 수 있습니다.');
          } else if (check.known && check.isAdmin) {
            setCachedVerifiedAdminUid(redirectResult.user.uid);
            setIsLoginModalOpen(false);
            setLoginActionPrompt(null);
          }
        } else if (hadPendingRedirect && !auth.currentUser) {
          setLoginActionPrompt(
            '브라우저의 크로스 사이트 추적 방지 설정으로 리디렉션 로그인 응답이 차단되었습니다. Safari/Chrome 설정에서 추적 방지 또는 팝업 차단을 확인해 주세요.'
          );
          setIsLoginModalOpen(true);
        }
      } catch (redirectErr: any) {
        try {
          sessionStorage.removeItem(PENDING_REDIRECT_KEY);
        } catch {}
        if (!isMounted) return;
        const code = redirectErr?.code || '';
        if (code === 'auth/network-request-failed') {
          setAutoLogoutNotice('네트워크 또는 보안 설정(추적 방지/비공개 릴레이)으로 Google 인증이 완료되지 않았습니다.');
        } else if (code === 'auth/unauthorized-domain') {
          setAutoLogoutNotice(`현재 도메인(${window.location.hostname})이 Firebase 인증 도메인에 등록되어 있지 않습니다.`);
        } else if (redirectErr?.message) {
          setAutoLogoutNotice(redirectErr.message);
        }
      }
    })();

    const unsubscribe = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      firebaseUserRef.current = fbUser;
      if (!fbUser) {
        if (isMounted) {
          setCurrentUser(null);
          setIsLoading(false);
        }
        return;
      }

      const cachedAdmin = getCachedVerifiedAdminUid() === fbUser.uid;
      let isAdmin = cachedAdmin;

      const serverCheck = await verifyAdminWithServer(fbUser);
      if (!isMounted) return;

      if (serverCheck.known) {
        isAdmin = serverCheck.isAdmin;
        if (isAdmin) {
          setCachedVerifiedAdminUid(fbUser.uid);
        } else {
          setCachedVerifiedAdminUid(null);
          await signOut(auth).catch(() => {});
          firebaseUserRef.current = null;
          setCurrentUser(null);
          setIsLoading(false);
          return;
        }
      }

      const safeDisplayName =
        fbUser.displayName && !fbUser.displayName.includes('@')
          ? fbUser.displayName
          : '블로그 관리자';

      const appUser: AppUser = {
        uid: fbUser.uid,
        displayName: safeDisplayName,
        photoURL: fbUser.photoURL || undefined,
        isAdmin,
        provider: 'google',
      };
      setCurrentUser(appUser);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const updateAutoDiarySettings = useCallback((patch: Partial<AutoDiarySettings>) => {
    setAutoDiarySettings((prev) => {
      const nextInterval =
        patch.intervalMinutes !== undefined
          ? clampIntervalMinutes(patch.intervalMinutes)
          : prev.intervalMinutes;
      const nextEnabled = patch.enabled !== undefined ? Boolean(patch.enabled) : prev.enabled;
      const nextLastAt =
        patch.lastAutoDiaryAt !== undefined ? patch.lastAutoDiaryAt : prev.lastAutoDiaryAt;

      let nextScheduledAt = prev.nextAutoDiaryAt;
      if (!nextEnabled) {
        nextScheduledAt = null;
      } else if (patch.nextAutoDiaryAt !== undefined) {
        nextScheduledAt = patch.nextAutoDiaryAt;
      } else if (
        (!prev.enabled && nextEnabled) ||
        (patch.intervalMinutes !== undefined && nextInterval !== prev.intervalMinutes) ||
        !prev.nextAutoDiaryAt
      ) {
        nextScheduledAt = Date.now() + nextInterval * 60_000;
      }

      const updated: AutoDiarySettings = {
        enabled: nextEnabled,
        intervalMinutes: nextInterval,
        lastAutoDiaryAt: nextLastAt,
        nextAutoDiaryAt: nextScheduledAt,
      };
      persistAutoDiarySettings(updated);
      return updated;
    });
  }, []);

  const openLoginModal = useCallback((promptReason?: string, defaultTab: LoginModalTab = 'local') => {
    setLoginActionPrompt(promptReason || null);
    setLoginModalTab(isLocalEditUnlocked ? defaultTab : 'local');
    setIsLoginModalOpen(true);
  }, [isLocalEditUnlocked]);

  const unlockLocalEditWithPassword = useCallback(
    (
      password: string,
      autoDiaryOptions?: { enabled: boolean; intervalMinutes: number; keepModalOpen?: boolean }
    ): LoginResult => {
      const trimmed = password.trim();
      if (!trimmed) {
        return { success: false, error: '앱 사용 패스워드를 입력해 주세요.' };
      }
      if (sha256Hex(trimmed) !== LOCAL_EDIT_PASSCODE_SHA256) {
        return { success: false, error: '앱 사용 패스워드가 올바르지 않습니다.' };
      }
      setPersistedLocalEditUnlocked(true);
      setIsLocalEditUnlocked(true);
      if (autoDiaryOptions) {
        const intervalMinutes = clampIntervalMinutes(autoDiaryOptions.intervalMinutes);
        const enabled = Boolean(autoDiaryOptions.enabled);
        updateAutoDiarySettings({
          enabled,
          intervalMinutes,
          nextAutoDiaryAt: enabled ? Date.now() + intervalMinutes * 60_000 : null,
        });
      }
      if (!autoDiaryOptions?.keepModalOpen) {
        closeLoginModal();
      }
      return { success: true };
    },
    [closeLoginModal, updateAutoDiarySettings]
  );

  const lockLocalEdit = useCallback(async () => {
    setPersistedLocalEditUnlocked(false);
    setIsLocalEditUnlocked(false);
    updateAutoDiarySettings({
      enabled: false,
      intervalMinutes: DEFAULT_AUTO_DIARY_INTERVAL_MINUTES,
      nextAutoDiaryAt: null,
    });
    if (firebaseUserRef.current || auth.currentUser) {
      try {
        await signOut(auth);
      } catch {}
      firebaseUserRef.current = null;
      setCachedVerifiedAdminUid(null);
      setCurrentUser(null);
    }
  }, [updateAutoDiarySettings]);

  const loginWithGoogle = useCallback(async (): Promise<LoginResult> => {
    if (!isLocalEditUnlocked) {
      return {
        success: false,
        error: '먼저 앱 사용 패스워드를 해제한 후 블로그 관리자 로그인을 진행해 주세요.',
      };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        success: false,
        error: '현재 오프라인 상태입니다. 인터넷(Wi-Fi/모바일 데이터) 연결 후 다시 시도해주세요.',
      };
    }

    try {
      const result = await signInWithPopup(auth, googleAuthProvider, browserPopupRedirectResolver);
      const serverCheck = await verifyAdminWithServer(result.user, 2);
      if (!serverCheck.known) {
        await signOut(auth).catch(() => {});
        firebaseUserRef.current = null;
        return {
          success: false,
          error: '서버에서 관리자 권한을 확인할 수 없습니다. 네트워크 상태를 확인 후 다시 시도해주세요.',
        };
      }
      if (!serverCheck.isAdmin) {
        await signOut(auth).catch(() => {});
        firebaseUserRef.current = null;
        setCachedVerifiedAdminUid(null);
        return {
          success: false,
          error: '블로그 관리자 계정으로만 로그인할 수 있습니다.',
        };
      }

      firebaseUserRef.current = result.user;
      setCachedVerifiedAdminUid(result.user.uid);
      const safeDisplayName =
        result.user.displayName && !result.user.displayName.includes('@')
          ? result.user.displayName
          : '블로그 관리자';
      setCurrentUser({
        uid: result.user.uid,
        displayName: safeDisplayName,
        photoURL: result.user.photoURL || undefined,
        isAdmin: true,
        provider: 'google',
      });
      closeLoginModal();
      return { success: true };
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { success: false, error: '로그인 창이 닫혔습니다. 다시 시도해주세요.' };
      }
      if (code === 'auth/popup-blocked') {
        return {
          success: false,
          offerRedirectFallback: canUseRedirectFallback,
          error: canUseRedirectFallback
            ? '브라우저에서 로그인 팝업이 차단되었습니다. 팝업 차단을 해제하거나 아래 페이지 이동 로그인을 이용해주세요.'
            : '브라우저에서 로그인 팝업이 차단되었습니다. 팝업 차단을 해제 후 다시 시도해주세요.',
        };
      }
      if (code === 'auth/network-request-failed') {
        const reachable = await probeGoogleAuthReachability();
        return {
          success: false,
          offerRedirectFallback: canUseRedirectFallback,
          error: reachable
            ? '모바일 브라우저 팝업 통신이 중단되었거나 지연되었습니다(auth/network-request-failed). 다시 시도하거나 아래 페이지 이동 방식으로 로그인해 주세요.'
            : 'Google 인증 서버에 연결할 수 없습니다(auth/network-request-failed). 네트워크 연결 또는 iCloud 비공개 릴레이·광고 차단(AdGuard)·VPN 설정을 확인해 주세요.',
        };
      }
      if (code === 'auth/unauthorized-domain') {
        return {
          success: false,
          error: `현재 접속 도메인(${window.location.hostname})이 Firebase 승인 도메인에 등록되지 않았습니다.`,
        };
      }
      return {
        success: false,
        error: error?.message || 'Google 로그인 중 오류가 발생했습니다.',
      };
    }
  }, [canUseRedirectFallback, closeLoginModal, isLocalEditUnlocked]);

  const loginWithGoogleRedirect = useCallback(async (): Promise<LoginResult> => {
    if (!isLocalEditUnlocked) {
      return {
        success: false,
        error: '먼저 앱 사용 패스워드를 해제한 후 블로그 관리자 로그인을 진행해 주세요.',
      };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        success: false,
        error: '현재 오프라인 상태입니다. 인터넷 연결 후 다시 시도해주세요.',
      };
    }
    if (!canUseRedirectFallback) {
      return {
        success: false,
        error: '현재 화면에서는 페이지 이동 로그인을 시작할 수 없습니다. 새 탭에서 열어 시도해주세요.',
      };
    }
    try {
      try {
        sessionStorage.setItem(PENDING_REDIRECT_KEY, '1');
      } catch {}
      await signInWithRedirect(auth, googleAuthProvider, browserPopupRedirectResolver);
      return { success: true };
    } catch (error: any) {
      try {
        sessionStorage.removeItem(PENDING_REDIRECT_KEY);
      } catch {}
      const code = error?.code || '';
      if (code === 'auth/network-request-failed') {
        return {
          success: false,
          error: 'Google 인증 서버에 연결할 수 없습니다(auth/network-request-failed). 네트워크·VPN·광고 차단 설정을 확인해 주세요.',
        };
      }
      return {
        success: false,
        error: error?.message || 'Google 페이지 이동 로그인 중 오류가 발생했습니다.',
      };
    }
  }, [canUseRedirectFallback, isLocalEditUnlocked]);

  const getIdToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    const user = firebaseUserRef.current || auth.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch (err) {
      console.warn('Failed to get Firebase ID token:', err);
      return null;
    }
  }, []);

  const isAdmin = Boolean(isLocalEditUnlocked && currentUser && currentUser.isAdmin);
  const canEditLocal = isLocalEditUnlocked;
  const isAuthenticated = Boolean(isLocalEditUnlocked && currentUser);

  return (
    <AuthContext.Provider
      value={{
        currentUser: isLocalEditUnlocked ? currentUser : null,
        isAdmin,
        isLocalEditUnlocked,
        canEditLocal,
        isAuthenticated,
        isLoading,
        isLoginModalOpen,
        loginModalTab,
        loginActionPrompt,
        autoLogoutNotice,
        canUseRedirectFallback,
        autoDiarySettings,
        updateAutoDiarySettings,
        clearAutoLogoutNotice,
        setLoginModalTab,
        openLoginModal,
        closeLoginModal,
        loginWithGoogle,
        loginWithGoogleRedirect,
        unlockLocalEditWithPassword,
        lockLocalEdit,
        getIdToken,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
