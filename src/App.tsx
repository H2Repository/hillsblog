import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DiaryEntry, TravelPhoto, ViewMode } from './types';
import { 
  getStoredDiaries, 
  saveDiaries, 
  exportDiariesWithOptions,
  ExportOptions,
  sortDiariesDescending,
  deduplicateDiaries,
  isDiaryDuplicate,
  sanitizeDiaryEntry,
  diaryNeedsPhotoHydration,
  filterDiariesForExport,
  filterValidPhotos
} from './utils/storage';
import { Navbar } from './components/Navbar';
import { BlogFeedView } from './components/BlogFeedView';
import { TravelMapView } from './components/TravelMapView';
import { DiaryEditorModal } from './components/DiaryEditorModal';
import { DiaryDetailModal } from './components/DiaryDetailModal';
import { PhotoLightbox } from './components/PhotoLightbox';
import { ConfirmModal } from './components/ConfirmModal';
import { DataManagementModal } from './components/DataManagementModal';
import { AppHelpModal } from './components/AppHelpModal';
import { LoginModal } from './components/LoginModal';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { getCurrentGpsPosition, reverseGeocode, getLocalDateString } from './utils/geo';
import { getCachedDiaryTranslation, hasKorean, translateDiaryAsync } from './utils/translationService';
import { 
  getAllLocalDiaries, 
  getLocalDiaryById,
  saveLocalDiary,
  saveMultipleLocalDiaries,
  deleteLocalDiary,
  clearLocalDb
} from './utils/localDb';
import {
  ServerDiaryMeta,
  addPendingServerDeleteId,
  areDiaryPhotosSyncedWithMeta,
  clearServerSyncCaches,
  findMatchingServerMeta,
  flushPendingDeletesToServer,
  fetchVisitsMapForExport,
  getCachedServerMetaMap,
  getDiaryServerStatus,
  getPendingServerDeleteIds,
  hasCompletedServerIncludeAllMigration,
  hydrateDiaryPhotosFromServer,
  importDiaryVisitsToServer,
  includeAllServerDiariesInDistance,
  loadDurablePendingServerDeleteIds,
  markServerIncludeAllMigrationDone,
  migrateLocalDiariesIncludeAllDistance,
  removePendingServerDeleteIds,
  restoreDurableSyncCachesFromIdb,
  sanitizeImportedVisits,
  saveCachedServerMetaMap,
  saveImportedVisitsLocally,
  savePendingServerDeleteIds,
  syncMissingAndUpdatedFromServer,
  upsertDiaryToServer,
} from './services/diaryCloudSql';
import { useRoadDistances } from './services/roadDistanceService';
import { 
  Compass, 
  CheckCircle2,
  AlertTriangle,
  Route,
  Loader2
} from 'lucide-react';

export default function App() {
  const { t, language } = useLanguage();
  const {
    isAdmin,
    canEditLocal,
    isLoginModalOpen,
    getIdToken,
    openLoginModal,
    autoLogoutNotice,
    clearAutoLogoutNotice,
    autoDiarySettings,
    updateAutoDiarySettings,
  } = useAuth();
  const [diaries, setDiaries] = useState<DiaryEntry[]>(() => getStoredDiaries());
  const [viewMode, setViewMode] = useState<ViewMode>('blog');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [initialServerMeta] = useState(() => getCachedServerMetaMap());
  const [serverMetaMap, setServerMetaMap] = useState<Record<string, ServerDiaryMeta>>(initialServerMeta.metaMap);
  const [hasLoadedServerMeta, setHasLoadedServerMeta] = useState(initialServerMeta.hasLoaded);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>(() => getPendingServerDeleteIds());
  const [isServerOnline, setIsServerOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isInitialSyncing, setIsInitialSyncing] = useState(true);
  const [isCheckingServer, setIsCheckingServer] = useState(false);
  const [uploadingDiaryIds, setUploadingDiaryIds] = useState<Record<string, boolean>>({});
  const inFlightUploadIdsRef = useRef<Set<string>>(new Set());
  const pendingUploadDiaryRef = useRef<DiaryEntry | null>(null);
  const pendingStep2AfterUnlockRef = useRef<boolean>(false);
  const pendingLocalActionRef = useRef<
    { type: 'new' } | { type: 'edit'; diary: DiaryEntry } | { type: 'delete'; diary: DiaryEntry } | null
  >(null);
  const isFlushingDeletesRef = useRef(false);
  const isAutoPushingRef = useRef(false);
  const failedAutoPushCooldownRef = useRef<Map<string, number>>(new Map());
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  const canEditLocalRef = useRef(canEditLocal);
  canEditLocalRef.current = canEditLocal;
  const autoDiarySettingsRef = useRef(autoDiarySettings);
  autoDiarySettingsRef.current = autoDiarySettings;
  const isAutoDiaryRunningRef = useRef(false);
  const [isAutoDiaryRunning, setIsAutoDiaryRunning] = useState(false);
  const lastManualSyncAtRef = useRef<number>(0);
  const lastAutoSyncAtRef = useRef<number>(0);

  // Auto-logout notice handler
  useEffect(() => {
    if (autoLogoutNotice) {
      const msg = autoLogoutNotice;
      setToastMessage({ text: msg, type: 'error' });

      setTimeout(() => {
        setToastMessage(prev => (prev?.text === msg ? null : prev));
      }, 3000);

      clearAutoLogoutNotice();
    }
  }, [autoLogoutNotice, clearAutoLogoutNotice]);

  // Initial Load from local IndexedDB storage, then pull missing/updated diaries from server
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      let currentLocal: DiaryEntry[] = [];
      try {
        const cached = await getAllLocalDiaries();
        if (cached && cached.length > 0 && isMounted) {
          const sanitizedEntries: DiaryEntry[] = [];
          const repairedLocalRows: DiaryEntry[] = [];
          for (const item of cached) {
            const { entry, strippedCount } = sanitizeDiaryEntry(item);
            const normalizedEntry: DiaryEntry = entry.localSyncStatus
              ? entry
              : { ...entry, localSyncStatus: 'synced' };
            sanitizedEntries.push(normalizedEntry);
            if (strippedCount > 0 || !entry.localSyncStatus) {
              repairedLocalRows.push(normalizedEntry);
            }
          }
          if (repairedLocalRows.length > 0) {
            saveMultipleLocalDiaries(repairedLocalRows, true).catch(() => {});
          }
          const { deduplicated } = deduplicateDiaries(sanitizedEntries);
          const { entries: migratedEntries } = await migrateLocalDiariesIncludeAllDistance(deduplicated);
          currentLocal = migratedEntries;
          if (isMounted) {
            setDiaries(migratedEntries);
          }
        } else if (isMounted) {
          // If IndexedDB is empty, display localStorage fallback in memory (do not persist stripped stubs into IndexedDB)
          const fallback = getStoredDiaries().map((d) =>
            d.localSyncStatus ? d : { ...d, localSyncStatus: 'synced' as const }
          );
          if (fallback.length > 0) {
            const completeOnly = fallback.filter((d) => !diaryNeedsPhotoHydration(d));
            if (completeOnly.length > 0) {
              await saveMultipleLocalDiaries(completeOnly, false);
            }
            currentLocal = fallback;
            setDiaries(fallback);
          }
        }
      } catch (dbErr) {
        console.error('[Storage] Failed to access local database at boot:', dbErr);
        if (isMounted) {
          setToastMessage({ 
            text: '로컬 저장소 연결 실패. 브라우저 설정을 확인해주세요.', 
            type: 'error' 
          });
        }
      }

      try {
        const restored = await restoreDurableSyncCachesFromIdb();
        if (isMounted) {
          if (restored.hasLoaded) {
            setServerMetaMap(restored.metaMap);
            setHasLoadedServerMeta(true);
          }
          setPendingDeleteIds(restored.pendingDeleteIds);
        }
      } catch {}

      if (isMounted && typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsServerOnline(false);
        setIsInitialSyncing(false);
      } else if (isMounted) {
        const runBootSync = async (localList: DiaryEntry[]): Promise<boolean> => {
          try {
            if (isAdminRef.current) {
              const delRes = await flushPendingDeletesToServer(getIdToken);
              if (isMounted) {
                setPendingDeleteIds(delRes.failedIds);
              }
            }
            const syncRes = await syncMissingAndUpdatedFromServer(localList, getIdToken);
            if (!isMounted) return true;
            setIsServerOnline(syncRes.online);
            if (syncRes.online && !syncRes.errorMessage) {
              lastAutoSyncAtRef.current = Date.now();
              setServerMetaMap(syncRes.serverMetaMap);
              setHasLoadedServerMeta(true);
              if (syncRes.addedCount > 0 || syncRes.updatedCount > 0) {
                const freshLocal = await getAllLocalDiaries();
                const cleaned = freshLocal.map((item) => sanitizeDiaryEntry(item).entry);
                setDiaries(deduplicateDiaries(cleaned).deduplicated);
              }
              return true;
            }
          } catch {}
          return false;
        };

        const ok = await runBootSync(currentLocal);
        if (!ok && isMounted) {
          // One delayed retry in case Cloud SQL Developer Edition was waking from scale-to-zero
          setTimeout(() => {
            if (!isMounted) return;
            getAllLocalDiaries()
              .then((latestLocal) => runBootSync(latestLocal.map((item) => sanitizeDiaryEntry(item).entry)))
              .catch(() => {})
              .finally(() => {
                if (isMounted) setIsInitialSyncing(false);
              });
          }, 4000);
        } else if (isMounted) {
          setIsInitialSyncing(false);
        }
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const syncPendingDeletesWithServer = async (options?: {
    showToastOnComplete?: boolean;
  }): Promise<string[]> => {
    if (isFlushingDeletesRef.current) return [];
    if (typeof navigator !== 'undefined' && !navigator.onLine) return [];
    const currentPending = await loadDurablePendingServerDeleteIds();
    if (currentPending.length === 0) {
      setPendingDeleteIds([]);
      return [];
    }

    isFlushingDeletesRef.current = true;
    try {
      const res = await flushPendingDeletesToServer(getIdToken);
      setPendingDeleteIds(res.failedIds);
      if (res.deletedIds.length > 0) {
        setServerMetaMap((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const delId of res.deletedIds) {
            if (next[delId]) {
              delete next[delId];
              changed = true;
            }
          }
          if (changed) {
            saveCachedServerMetaMap(next);
            return next;
          }
          return prev;
        });
        if (options?.showToastOnComplete) {
          setToastMessage({
            text: `로컬에서 삭제된 일기 ${res.deletedIds.length}건을 Cloud SQL 서버에서도 삭제했습니다.`,
            type: 'success',
          });
          setTimeout(() => setToastMessage(null), 3000);
        }
      }
      return res.deletedIds;
    } finally {
      isFlushingDeletesRef.current = false;
    }
  };

  const pushUnsyncedDiariesToServer = async (options?: {
    bypassCooldown?: boolean;
    currentMetaMap?: Record<string, ServerDiaryMeta>;
    currentHasLoaded?: boolean;
  }): Promise<{ uploaded: number; failed: number; serverCount: number }> => {
    const activeMetaMap = options?.currentMetaMap || serverMetaMap;
    const metaLoaded = options?.currentHasLoaded ?? hasLoadedServerMeta;
    if (
      isAutoPushingRef.current ||
      !isAdminRef.current ||
      !metaLoaded ||
      (typeof navigator !== 'undefined' && !navigator.onLine)
    ) {
      return { uploaded: 0, failed: 0, serverCount: Object.keys(activeMetaMap).length };
    }

    isAutoPushingRef.current = true;
    try {
      const [localRows, pendingDelList] = await Promise.all([
        getAllLocalDiaries().catch(() => diaries),
        loadDurablePendingServerDeleteIds().catch(() => []),
      ]);
      const pendingDeleteSet = new Set(pendingDelList);
      const sourceList = deduplicateDiaries(
        localRows.map((item) => sanitizeDiaryEntry(item).entry)
      ).deduplicated;

      const now = Date.now();
      const targets = sourceList.filter((d) => {
        if (pendingDeleteSet.has(d.id)) return false;
        if (inFlightUploadIdsRef.current.has(d.id)) return false;
        if (getDiaryServerStatus(d, activeMetaMap, true) === 'synced') return false;
        if (!options?.bypassCooldown) {
          const cooldownUntil = failedAutoPushCooldownRef.current.get(d.id) || 0;
          if (cooldownUntil > now) return false;
        }
        return true;
      });

      if (targets.length === 0) {
        return { uploaded: 0, failed: 0, serverCount: Object.keys(activeMetaMap).length };
      }

      let uploaded = 0;
      let failed = 0;
      const nextMetaMap = { ...activeMetaMap };

      for (let i = 0; i < targets.length; i++) {
        const rawTarget = targets[i];
        const originalId = rawTarget.id;
        inFlightUploadIdsRef.current.add(originalId);
        setUploadingDiaryIds((prev) => ({ ...prev, [originalId]: true }));
        setToastMessage({
          text: `미등록·수정 일기를 서버에 자동 반영 중 (${i + 1}/${targets.length})...`,
          type: 'info',
        });

        try {
          let target = rawTarget;
          const existingMeta = findMatchingServerMeta(target, nextMetaMap);
          if (existingMeta && existingMeta.id !== target.id) {
            target = { ...target, id: existingMeta.id };
          }

          if (diaryNeedsPhotoHydration(target)) {
            if (existingMeta) {
              const hydrated = await hydrateDiaryPhotosFromServer(target, getIdToken, { force: true }).catch(() => null);
              if (hydrated && !diaryNeedsPhotoHydration(hydrated)) {
                target = hydrated;
              } else {
                failed++;
                failedAutoPushCooldownRef.current.set(originalId, Date.now() + 60_000);
                continue;
              }
            } else {
              const uploadablePhotos = filterValidPhotos(target.photos)
                .filter((p) => !p.url.startsWith('/api/'))
                .map((p) => ({ ...p, isThumbnailOnly: false }));
              target = {
                ...target,
                photos: uploadablePhotos,
                totalPhotosCount: uploadablePhotos.length,
                hasSubcollectionPhotos: uploadablePhotos.some((p) => p.url.startsWith('data:image/')),
              };
            }
          }

          const { updatedDiary, meta } = await upsertDiaryToServer(target, getIdToken);
          if (updatedDiary.id !== originalId) {
            await deleteLocalDiary(originalId).catch(() => {});
          }
          await saveLocalDiary(updatedDiary);
          nextMetaMap[meta.id] = {
            ...meta,
            visitCount: nextMetaMap[meta.id]?.visitCount ?? meta.visitCount,
          };
          failedAutoPushCooldownRef.current.delete(originalId);
          uploaded++;
        } catch (err) {
          console.error(`Auto-sync upload failed for ${originalId}:`, err);
          failed++;
          failedAutoPushCooldownRef.current.set(originalId, Date.now() + 60_000);
        } finally {
          inFlightUploadIdsRef.current.delete(originalId);
          setUploadingDiaryIds((prev) => {
            const next = { ...prev };
            delete next[originalId];
            return next;
          });
        }
      }

      if (uploaded > 0) {
        saveCachedServerMetaMap(nextMetaMap);
        setServerMetaMap(nextMetaMap);
        setHasLoadedServerMeta(true);
        setIsServerOnline(true);

        const refreshed = await getAllLocalDiaries();
        const finalDiaries = deduplicateDiaries(
          refreshed.map((item) => sanitizeDiaryEntry(item).entry)
        ).deduplicated;
        setDiaries(finalDiaries);
        setSelectedDiary((prev) => (prev ? finalDiaries.find((d) => d.id === prev.id) || prev : null));

        setToastMessage({
          text:
            failed === 0
              ? `일기 ${uploaded}개를 서버에 반영해 서버·로컬(${Object.keys(nextMetaMap).length}개)이 모두 "서버됨"으로 동기화되었습니다.`
              : `일기 ${uploaded}개 서버 반영 완료 (${failed}개 실패 - 다시 시도해 주세요)`,
          type: failed === 0 ? 'success' : 'error',
        });
        setTimeout(() => setToastMessage(null), 4000);
      } else if (failed > 0) {
        setToastMessage({
          text: `서버 미반영 일기 ${failed}개 업로드 실패. 네트워크 상태를 확인 후 다시 시도해 주세요.`,
          type: 'error',
        });
        setTimeout(() => setToastMessage(null), 4000);
      }

      return { uploaded, failed, serverCount: Object.keys(nextMetaMap).length };
    } finally {
      isAutoPushingRef.current = false;
    }
  };

  const unsyncedLocalCount = useMemo(
    () =>
      hasLoadedServerMeta
        ? diaries.filter((d) => getDiaryServerStatus(d, serverMetaMap, true) !== 'synced').length
        : 0,
    [diaries, serverMetaMap, hasLoadedServerMeta]
  );

  const prevIsAdminRef = useRef(isAdmin);

  const isUpdatingDistanceIncludeRef = useRef(false);

  const ensureAllDiariesIncludedInDistance = async (
    currentMetaMap: Record<string, ServerDiaryMeta>,
    options?: { force?: boolean }
  ): Promise<{ localUpdated: number; serverUpdated: number }> => {
    if (isUpdatingDistanceIncludeRef.current) {
      return { localUpdated: 0, serverUpdated: 0 };
    }
    isUpdatingDistanceIncludeRef.current = true;
    try {
      const localList = await getAllLocalDiaries().catch(() => diaries);
      const cleanedLocal = deduplicateDiaries(
        localList.map((item) => sanitizeDiaryEntry(item).entry)
      ).deduplicated;

      const { entries: migratedLocal, changedCount: localUpdated } =
        await migrateLocalDiariesIncludeAllDistance(cleanedLocal, { force: options?.force });

      if (localUpdated > 0) {
        setDiaries(migratedLocal);
      }

      const metaValues = Object.values(currentMetaMap) as ServerDiaryMeta[];
      const hasServerExcluded = metaValues.some((m) => m.includeInDistance === false);
      let serverUpdated = 0;

      if (
        metaValues.length > 0 &&
        !hasServerExcluded &&
        !options?.force
      ) {
        await markServerIncludeAllMigrationDone().catch(() => {});
        return { localUpdated, serverUpdated: 0 };
      }

      if (
        isAdminRef.current &&
        (typeof navigator === 'undefined' || navigator.onLine) &&
        (options?.force || hasServerExcluded)
      ) {
        const res = await includeAllServerDiariesInDistance(getIdToken);
        serverUpdated = res.updatedCount;

        const nextMeta: Record<string, ServerDiaryMeta> = {};
        for (const [id, meta] of Object.entries(currentMetaMap)) {
          nextMeta[id] = {
            ...meta,
            includeInDistance: true,
            updatedAt: meta.includeInDistance === false ? Math.max(meta.updatedAt || 0, res.updatedAtMs) : meta.updatedAt,
          };
        }
        saveCachedServerMetaMap(nextMeta);
        setServerMetaMap(nextMeta);

        if (serverUpdated > 0) {
          const syncAfter = await syncMissingAndUpdatedFromServer(migratedLocal, getIdToken, { force: true });
          if (syncAfter.online && !syncAfter.errorMessage) {
            setServerMetaMap(syncAfter.serverMetaMap);
            setHasLoadedServerMeta(true);
            const fresh = await getAllLocalDiaries();
            const finalEntries = deduplicateDiaries(
              fresh.map((item) => sanitizeDiaryEntry(item).entry)
            ).deduplicated;
            setDiaries(finalEntries);
          }
        }
      }

      return { localUpdated, serverUpdated };
    } finally {
      isUpdatingDistanceIncludeRef.current = false;
    }
  };

  // Automatically flush pending deletions, pull server updates, fix legacy distance flags, and push local unsynced entries
  useEffect(() => {
    const becameAdmin = !prevIsAdminRef.current && isAdmin;
    prevIsAdminRef.current = isAdmin;

    if (!isAdmin || !isServerOnline) return;
    if (pendingDeleteIds.length > 0) {
      syncPendingDeletesWithServer({ showToastOnComplete: true }).catch(() => {});
    }
    if (becameAdmin && !isInitialSyncing) {
      refreshServerStatus({ bypassCooldown: true }).catch(() => {});
      return;
    }
    if (!isInitialSyncing && hasLoadedServerMeta) {
      const hasServerExcluded = (Object.values(serverMetaMap) as ServerDiaryMeta[]).some(
        (m) => m.includeInDistance === false
      );
      if (hasServerExcluded) {
        hasCompletedServerIncludeAllMigration().then((alreadyDone) => {
          if (!alreadyDone) {
            ensureAllDiariesIncludedInDistance(serverMetaMap).catch(() => {});
          }
        });
      }
      if (unsyncedLocalCount > 0) {
        pushUnsyncedDiariesToServer().catch(() => {});
      }
    }
  }, [isAdmin, isServerOnline, pendingDeleteIds.length, isInitialSyncing, hasLoadedServerMeta, unsyncedLocalCount, serverMetaMap]);

  // Refresh Cloud SQL server connectivity, server diary count, and pull any missing/updated diaries
  const refreshServerStatus = async (options?: { bypassCooldown?: boolean } | unknown) => {
    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!browserOnline) {
      setIsServerOnline(false);
      return;
    }
    const bypassCooldown = Boolean(
      options && typeof options === 'object' && 'bypassCooldown' in options && (options as { bypassCooldown?: boolean }).bypassCooldown
    );
    const now = Date.now();
    if (isCheckingServer || (!bypassCooldown && now - lastManualSyncAtRef.current < 3000)) {
      return;
    }
    setIsCheckingServer(true);
    try {
      let deletedOnServerCount = 0;
      const queuedDeletes = await loadDurablePendingServerDeleteIds();
      if (queuedDeletes.length > 0) {
        if (isAdminRef.current) {
          const deletedIds = await syncPendingDeletesWithServer();
          deletedOnServerCount = deletedIds.length;
        } else {
          openLoginModal(
            canEditLocalRef.current
              ? '로컬에서 삭제한 일기를 서버에서도 삭제하려면 블로그 관리자 로그인이 필요합니다.'
              : '서버 삭제 동기화를 위해 먼저 앱 사용 패스워드를 해제해 주세요.',
            canEditLocalRef.current ? 'admin' : 'local'
          );
        }
      }

      const currentLocal = await getAllLocalDiaries();
      const syncRes = await syncMissingAndUpdatedFromServer(currentLocal, getIdToken, { force: true });
      setIsServerOnline(syncRes.online);
      if (syncRes.online && !syncRes.errorMessage) {
        lastManualSyncAtRef.current = Date.now();
        setServerMetaMap(syncRes.serverMetaMap);
        setHasLoadedServerMeta(true);
        const latestPending = await loadDurablePendingServerDeleteIds();
        setPendingDeleteIds(latestPending);

        const latestLocalRows = await getAllLocalDiaries();
        const latestCleaned = deduplicateDiaries(
          latestLocalRows.map((item) => sanitizeDiaryEntry(item).entry)
        ).deduplicated;
        if (syncRes.addedCount > 0 || syncRes.updatedCount > 0 || deletedOnServerCount > 0) {
          setDiaries(latestCleaned);
        }

        let pushedCount = 0;
        let failedPushCount = 0;
        if (isAdminRef.current) {
          const pushRes = await pushUnsyncedDiariesToServer({
            bypassCooldown: true,
            currentMetaMap: syncRes.serverMetaMap,
            currentHasLoaded: true,
          });
          pushedCount = pushRes.uploaded;
          failedPushCount = pushRes.failed;
        } else if (!bypassCooldown) {
          const remainingUnsynced = latestCleaned.filter(
            (d) => getDiaryServerStatus(d, syncRes.serverMetaMap, true) !== 'synced'
          ).length;
          if (remainingUnsynced > 0) {
            openLoginModal(
              canEditLocalRef.current
                ? `로컬에 서버 미반영 일기 ${remainingUnsynced}개가 있습니다. 서버와 일치시키려면 블로그 관리자 로그인이 필요합니다.`
                : `로컬에 서버 미반영 일기 ${remainingUnsynced}개가 있습니다. 먼저 앱 사용 패스워드를 해제한 뒤 관리자 로그인을 진행해 주세요.`,
              canEditLocalRef.current ? 'admin' : 'local'
            );
          }
        }

        if (pushedCount === 0 && failedPushCount === 0) {
          if (syncRes.addedCount > 0 || syncRes.updatedCount > 0 || deletedOnServerCount > 0) {
            const parts: string[] = [];
            if (syncRes.addedCount > 0) parts.push(`새 일기 ${syncRes.addedCount}개 추가`);
            if (syncRes.updatedCount > 0) parts.push(`업데이트 ${syncRes.updatedCount}개 반영`);
            if (deletedOnServerCount > 0) parts.push(`삭제 ${deletedOnServerCount}개 반영`);
            setToastMessage({
              text: `Cloud SQL 서버에서 ${parts.join(', ')} 완료`,
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 3000);
          } else {
            setToastMessage({
              text: `Cloud SQL 서버 연결 정상 · 총 ${Object.keys(syncRes.serverMetaMap).length}개 동기화됨`,
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 2500);
          }
        }
      } else if (syncRes.errorMessage) {
        setToastMessage({
          text: `서버 동기화 지연: ${syncRes.errorMessage}`,
          type: 'error',
        });
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch {
      setIsServerOnline(typeof navigator !== 'undefined' ? navigator.onLine : false);
    } finally {
      setIsCheckingServer(false);
    }
  };

  useEffect(() => {
    let active = true;

    const silentBackgroundSync = async () => {
      if (!active) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const now = Date.now();
      if (now - lastAutoSyncAtRef.current < 30_000) return;
      lastAutoSyncAtRef.current = now;
      try {
        if (isAdminRef.current) {
          await syncPendingDeletesWithServer({ showToastOnComplete: true }).catch(() => {});
        }
        const localList = await getAllLocalDiaries();
        const cleanedLocal = localList.map((item) => sanitizeDiaryEntry(item).entry);
        const syncRes = await syncMissingAndUpdatedFromServer(cleanedLocal, getIdToken);
        if (!active) return;
        setIsServerOnline(syncRes.online);
        if (syncRes.online && !syncRes.errorMessage) {
          setServerMetaMap(syncRes.serverMetaMap);
          setHasLoadedServerMeta(true);
          if (syncRes.addedCount > 0 || syncRes.updatedCount > 0) {
            const refreshed = await getAllLocalDiaries();
            const cleaned = refreshed.map((item) => sanitizeDiaryEntry(item).entry);
            setDiaries(deduplicateDiaries(cleaned).deduplicated);
          }
        }
      } catch {}
    };

    const handleOnline = () => {
      if (!active) return;
      setIsServerOnline(true);
      if (isAdminRef.current) {
        syncPendingDeletesWithServer({ showToastOnComplete: true }).catch(() => {});
      }
      silentBackgroundSync();
    };

    const handleOffline = () => {
      if (active) setIsServerOnline(false);
    };

    const handleVisibility = () => {
      if (active && document.visibilityState === 'visible') {
        silentBackgroundSync();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Modals state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | null>(null);
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null);
  const [openDetailAtVisits, setOpenDetailAtVisits] = useState(false);
  const [visitSyncVersion, setVisitSyncVersion] = useState(0);
  const [focusedMapDiaryId, setFocusedMapDiaryId] = useState<string | null>(null);

  // Translation
  useEffect(() => {
    if (language === 'ko') return;
    let isSubscribed = true;
    const translateEntries = async () => {
      for (const diary of diaries) {
        if (!isSubscribed) break;
        const cached = getCachedDiaryTranslation(diary.id, language);
        if (cached) continue;
        if (hasKorean(diary.title) || hasKorean(diary.content)) {
          try { await translateDiaryAsync(diary, language); } catch {}
        }
      }
    };
    translateEntries();
    return () => { isSubscribed = false; };
  }, [diaries, language]);

  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState<TravelPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DiaryEntry | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDiaries(diaries);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [diaries]);

  const handleSaveDiary = async (entry: DiaryEntry): Promise<boolean> => {
    if (!canEditLocalRef.current) {
      openLoginModal('일기를 추가·수정하려면 앱 사용 패스워드 또는 블로그 관리자 로그인이 필요합니다.', 'local');
      return false;
    }
    const exactMatch =
      diaries.find((d) => d.id === entry.id) ||
      (await getLocalDiaryById(entry.id).catch(() => null)) ||
      diaries.find((d) => isDiaryDuplicate(d, entry)) ||
      (entry.isModified && editingDiary
        ? diaries.find((d) => d.id === editingDiary.id) || editingDiary
        : null);
    const existingMatch = exactMatch;

    const targetEntry: DiaryEntry = { ...entry };
    let obsoleteIdToDelete: string | null = null;
    if (existingMatch) {
      const matchedMeta = findMatchingServerMeta(existingMatch, serverMetaMap);
      const wasNotOnServer = existingMatch.localSyncStatus === 'not_on_server' && !matchedMeta;
      targetEntry.id = existingMatch.id;
      targetEntry.createdAt = existingMatch.createdAt || (Date.now() - 3600000);
      targetEntry.updatedAt = Date.now();
      targetEntry.isModified = !wasNotOnServer;
      targetEntry.localSyncStatus = wasNotOnServer ? 'not_on_server' : 'needs_update';
      if (entry.id !== existingMatch.id) obsoleteIdToDelete = entry.id;
      if (editingDiary && editingDiary.id !== existingMatch.id) {
        obsoleteIdToDelete = editingDiary.id;
      }
    } else {
      targetEntry.createdAt = targetEntry.createdAt || Date.now();
      targetEntry.updatedAt = targetEntry.createdAt;
      targetEntry.isModified = false;
      targetEntry.localSyncStatus = 'not_on_server';
    }

    try {
      // Commit to IndexedDB first via pooled connection so save completes immediately without React render contention
      if (obsoleteIdToDelete) {
        await deleteLocalDiary(obsoleteIdToDelete).catch(() => {});
      }
      await saveLocalDiary(targetEntry);
      removePendingServerDeleteIds([targetEntry.id]).then(setPendingDeleteIds).catch(() => {});

      setDiaries((prev) => {
        const filtered = prev.filter(d => d.id !== targetEntry.id && (!obsoleteIdToDelete || d.id !== obsoleteIdToDelete));
        return sortDiariesDescending([targetEntry, ...filtered]);
      });

      if (selectedDiary && (selectedDiary.id === targetEntry.id || (obsoleteIdToDelete && selectedDiary.id === obsoleteIdToDelete))) {
        setSelectedDiary(targetEntry);
      }

      setToastMessage({
        text:
          targetEntry.localSyncStatus === 'not_on_server'
            ? '일기가 로컬에 등록(미등록)되었습니다. 필요 시 서버에 추가할 수 있습니다.'
            : '일기가 로컬 저장소에 수정 저장되었습니다.',
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 3000);
      return true;
    } catch (err: any) {
      console.error('Failed to save to local database:', err);
      setToastMessage({ 
        text: `로컬 저장소 오류: ${err.message || '데이터베이스에 저장할 수 없습니다.'}`, 
        type: 'error' 
      });
      setTimeout(() => setToastMessage(null), 5000);
      return false;
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (!canEditLocalRef.current) {
      setDeleteTarget(null);
      openLoginModal('일기를 삭제하려면 앱 사용 패스워드 또는 블로그 관리자 로그인이 필요합니다.', 'local');
      return;
    }
    const target = deleteTarget;
    const targetId = target.id;
    const matchedServerMeta = findMatchingServerMeta(target, serverMetaMap);
    const serverIdToDelete =
      matchedServerMeta?.id ||
      (target.localSyncStatus !== 'not_on_server' || Boolean(serverMetaMap[targetId]) ? targetId : null);

    setDeleteTarget(null);
    setDiaries((prev) => prev.filter(d => d.id !== targetId));
    if (selectedDiary && selectedDiary.id === targetId) setSelectedDiary(null);

    try {
      await deleteLocalDiary(targetId);
    } catch (err) {
      console.error('Failed to delete local diary:', err);
    }

    if (!serverIdToDelete) {
      setToastMessage({ text: '로컬 미등록 일기가 삭제되었습니다.', type: 'success' });
      setTimeout(() => setToastMessage(null), 2500);
      return;
    }

    const nextPending = await addPendingServerDeleteId(serverIdToDelete);
    setPendingDeleteIds(nextPending);

    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (browserOnline && isServerOnline && isAdminRef.current) {
      const deletedIds = await syncPendingDeletesWithServer();
      if (deletedIds.includes(serverIdToDelete)) {
        setToastMessage({ text: '로컬 및 Cloud SQL 서버에서 일기가 삭제되었습니다.', type: 'success' });
        setTimeout(() => setToastMessage(null), 3000);
        return;
      }
    }

    setToastMessage({
      text: browserOnline
        ? '로컬에서 삭제되었습니다. 관리자 로그인 시 서버에서도 삭제됩니다.'
        : '로컬에서 삭제되었습니다. 온라인 연결 시 서버에서도 삭제됩니다.',
      type: 'info',
    });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleSelectDiary = async (diary: DiaryEntry, options?: { scrollToVisits?: boolean }) => {
    const original = diaries.find((item) => item.id === diary.id) || diary;
    setOpenDetailAtVisits(Boolean(options?.scrollToVisits));
    setSelectedDiary(original);

    // If this diary exists on server and has deferred/missing HD photos, re-hydrate on demand
    if (diaryNeedsPhotoHydration(original) && Boolean(serverMetaMap[original.id])) {
      hydrateDiaryPhotosFromServer(original, getIdToken)
        .then((repaired) => {
          if (!repaired) return;
          setDiaries((prev) => prev.map((d) => (d.id === repaired.id ? repaired : d)));
          setSelectedDiary((prev) => (prev && prev.id === repaired.id ? repaired : prev));
        })
        .catch(() => {});
    }
  };

  const handleRequestNewDiary = () => {
    if (!canEditLocalRef.current) {
      pendingLocalActionRef.current = { type: 'new' };
      openLoginModal('새 일기를 추가하려면 앱 사용 패스워드 또는 블로그 관리자 로그인이 필요합니다.', 'local');
      return;
    }
    setEditingDiary(null);
    setIsEditorOpen(true);
  };

  const handleRequestDeleteDiary = (diary: DiaryEntry) => {
    if (!canEditLocalRef.current) {
      pendingLocalActionRef.current = { type: 'delete', diary };
      openLoginModal('일기를 삭제하려면 앱 사용 패스워드 또는 블로그 관리자 로그인이 필요합니다.', 'local');
      return;
    }
    setDeleteTarget(diary);
  };

  const handleOpenEditDiary = async (diary: DiaryEntry) => {
    if (!canEditLocalRef.current) {
      pendingLocalActionRef.current = { type: 'edit', diary };
      openLoginModal('일기를 수정하려면 앱 사용 패스워드 또는 블로그 관리자 로그인이 필요합니다.', 'local');
      return;
    }
    const original = diaries.find((item) => item.id === diary.id) || diary;
    if (
      diaryNeedsPhotoHydration(original) &&
      Boolean(serverMetaMap[original.id]) &&
      (typeof navigator === 'undefined' || navigator.onLine)
    ) {
      setToastMessage({ text: '수정 전 고화질 사진을 불러오는 중...', type: 'info' });
      const repaired = await hydrateDiaryPhotosFromServer(original, getIdToken, { force: true }).catch(() => null);
      setToastMessage(null);
      if (repaired) {
        setDiaries((prev) => prev.map((d) => (d.id === repaired.id ? repaired : d)));
        setEditingDiary(repaired);
        setIsEditorOpen(true);
        return;
      }
    }
    setEditingDiary(original);
    setIsEditorOpen(true);
  };

  const { cumulativeDistanceKm, cumulativeHasRoadData } = useRoadDistances(diaries);

  const handleUploadDiaryToServer = async (diary: DiaryEntry) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setToastMessage({ text: '오프라인 상태에서는 서버에 반영할 수 없습니다.', type: 'error' });
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    if (!isAdmin) {
      pendingUploadDiaryRef.current = diary;
      pendingStep2AfterUnlockRef.current = !canEditLocalRef.current;
      openLoginModal(
        canEditLocalRef.current
          ? '온라인에서 미등록 일기를 서버에 추가하려면 블로그 관리자 로그인이 필요합니다.'
          : '서버에 일기를 추가하려면 먼저 앱 사용 패스워드를 해제한 뒤 블로그 관리자 로그인을 진행해 주세요.',
        canEditLocalRef.current ? 'admin' : 'local'
      );
      return;
    }

    const originalId = diary.id;
    // Synchronous guard to prevent duplicate concurrent uploads from rapid double-clicks
    if (inFlightUploadIdsRef.current.has(originalId)) {
      return;
    }

    const existingMeta = findMatchingServerMeta(diary, serverMetaMap);
    const isExistingOnServer = Boolean(existingMeta);
    const currentStatus = getDiaryServerStatus(diary, serverMetaMap, hasLoadedServerMeta);

    // Prevent overwriting complete server HD photos if this device still holds a deferred stub
    let diaryToUpload = existingMeta && existingMeta.id !== diary.id ? { ...diary, id: existingMeta.id } : diary;
    if (isExistingOnServer && diaryNeedsPhotoHydration(diaryToUpload)) {
      const hydrated = await hydrateDiaryPhotosFromServer(diaryToUpload, getIdToken, { force: true }).catch(() => null);
      if (hydrated && !diaryNeedsPhotoHydration(hydrated)) {
        diaryToUpload = hydrated;
        setDiaries((prev) => prev.map((d) => (d.id === hydrated.id ? hydrated : d)));
      }
    }

    // Prevent redundant server writes when already synced with identical photo signatures
    if (
      currentStatus === 'synced' &&
      !diaryNeedsPhotoHydration(diaryToUpload) &&
      areDiaryPhotosSyncedWithMeta(diaryToUpload, existingMeta)
    ) {
      setToastMessage({
        text: `'${diaryToUpload.title || '일기'}'는 이미 Cloud SQL 서버에 최신 상태로 저장되어 있습니다.`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 2500);
      return;
    }

    inFlightUploadIdsRef.current.add(originalId);
    setUploadingDiaryIds((prev) => ({ ...prev, [originalId]: true }));
    try {
      const { updatedDiary, meta } = await upsertDiaryToServer(diaryToUpload, getIdToken);

      const localEntryChanged =
        updatedDiary.id !== originalId ||
        updatedDiary.updatedAt !== diary.updatedAt ||
        updatedDiary.localSyncStatus !== diary.localSyncStatus ||
        updatedDiary.hasSubcollectionPhotos !== diary.hasSubcollectionPhotos ||
        updatedDiary.photos !== diary.photos;

      if (localEntryChanged) {
        if (updatedDiary.id !== originalId) {
          await deleteLocalDiary(originalId).catch(() => {});
        }
        await saveLocalDiary(updatedDiary);
        setDiaries((prev) =>
          sortDiariesDescending(prev.map((d) => (d.id === originalId ? updatedDiary : d)))
        );
        if (selectedDiary?.id === originalId) {
          setSelectedDiary(updatedDiary);
        }
      }

      setServerMetaMap((prev) => {
        const next = {
          ...prev,
          [meta.id]: {
            ...meta,
            visitCount: prev[meta.id]?.visitCount ?? meta.visitCount,
          },
        };
        saveCachedServerMetaMap(next);
        return next;
      });
      setHasLoadedServerMeta(true);
      setIsServerOnline(true);

      setToastMessage({
        text: isExistingOnServer
          ? `'${updatedDiary.title || '일기'}'가 Cloud SQL 서버에 업데이트되었습니다.`
          : `'${updatedDiary.title || '일기'}'가 Cloud SQL 서버에 추가되었습니다.`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to upload diary to Cloud SQL:', err);
      const readableMsg = err?.message || '잠시 후 다시 시도해주세요.';
      if (readableMsg.includes('로그인') || readableMsg.includes('인증') || readableMsg.includes('401')) {
        pendingUploadDiaryRef.current = diaryToUpload;
        openLoginModal(
          canEditLocalRef.current
            ? '서버에 일기를 추가하려면 Google 관리자 로그인이 필요합니다.'
            : '먼저 앱 사용 패스워드를 해제한 뒤 Google 관리자 로그인을 진행해 주세요.',
          canEditLocalRef.current ? 'admin' : 'local'
        );
        return;
      }
      setToastMessage({
        text: `서버 반영 실패: ${readableMsg}`,
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 5000);
    } finally {
      inFlightUploadIdsRef.current.delete(originalId);
      setUploadingDiaryIds((prev) => {
        const next = { ...prev };
        delete next[originalId];
        return next;
      });
    }
  };

  // Automatically continue uploading a pending diary once Google login finishes (or advance Step 1 -> Step 2)
  useEffect(() => {
    if (isAdmin && pendingUploadDiaryRef.current) {
      const pending = pendingUploadDiaryRef.current;
      pendingUploadDiaryRef.current = null;
      pendingStep2AfterUnlockRef.current = false;
      handleUploadDiaryToServer(pending);
    } else if (canEditLocal && !isAdmin && pendingStep2AfterUnlockRef.current && !isLoginModalOpen) {
      pendingStep2AfterUnlockRef.current = false;
      openLoginModal('2단계: 서버에 일기를 반영하려면 블로그 관리자 로그인을 진행해 주세요.', 'admin');
    } else if (!isLoginModalOpen && !isAdmin && !pendingStep2AfterUnlockRef.current) {
      pendingUploadDiaryRef.current = null;
    }
  }, [isAdmin, canEditLocal, isLoginModalOpen]);

  // Automatically resume pending local create/edit/delete once passcode or admin login finishes
  useEffect(() => {
    if (canEditLocal && pendingLocalActionRef.current) {
      const action = pendingLocalActionRef.current;
      pendingLocalActionRef.current = null;
      if (action.type === 'new') {
        setEditingDiary(null);
        setIsEditorOpen(true);
      } else if (action.type === 'edit') {
        handleOpenEditDiary(action.diary);
      } else if (action.type === 'delete') {
        setDeleteTarget(action.diary);
      }
    } else if (!isLoginModalOpen && !canEditLocal) {
      pendingLocalActionRef.current = null;
    }
  }, [canEditLocal, isLoginModalOpen]);

  const runAutoLocationDiaryCheck = async (source: 'auto' | 'manual' = 'auto') => {
    if (!canEditLocalRef.current || isAutoDiaryRunningRef.current) return;
    isAutoDiaryRunningRef.current = true;
    setIsAutoDiaryRunning(true);

    if (source === 'manual') {
      setToastMessage({ text: '현재 위치를 확인해 자동 일기를 작성하는 중...', type: 'info' });
    }

    try {
      const pos = await getCurrentGpsPosition();
      const geoInfo = await reverseGeocode(pos.lat, pos.lng);
      const now = new Date();
      const nowMs = now.getTime();
      const dateStr = getLocalDateString(now);
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const placeLabel = geoInfo.landmark || geoInfo.region || geoInfo.address;

      const autoEntry: DiaryEntry = {
        id: `diary-${nowMs}`,
        date: dateStr,
        time: timeStr,
        title: `[자동 기록] ${placeLabel} (${timeStr})`,
        content: [
          '[자동 위치 확인 일기]',
          `• 기록 시각: ${dateStr} ${timeStr}`,
          `• 위치 지역: ${geoInfo.region}`,
          `• 상세 주소: ${geoInfo.address}`,
          `• GPS 좌표: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (정확도 ±${pos.accuracy}m)`,
          '',
          '설정된 자동 위치 확인 주기에 따라 현재 위치가 자동으로 일기에 기록되었습니다.',
        ].join('\n'),
        location: {
          lat: pos.lat,
          lng: pos.lng,
          accuracy: pos.accuracy,
          address: geoInfo.address,
          region: geoInfo.region,
          landmark: geoInfo.landmark,
          isRealtimeGps: true,
          includeInDistance: true,
        },
        photos: [],
        weather: 'sunny',
        moodTags: ['#자동위치기록', '#자전거여행'],
        localInsights: {
          recommendedForSolo: '자동 위치 확인으로 기록된 이동 포인트입니다.',
        },
        rating: 5,
        includeInDistance: true,
        createdAt: nowMs,
        updatedAt: nowMs,
        isModified: false,
        localSyncStatus: 'not_on_server',
      };

      await saveLocalDiary(autoEntry);
      setDiaries((prev) => sortDiariesDescending([autoEntry, ...prev]));

      const currentSettings = autoDiarySettingsRef.current;
      updateAutoDiarySettings({
        lastAutoDiaryAt: nowMs,
        nextAutoDiaryAt: currentSettings.enabled
          ? nowMs + currentSettings.intervalMinutes * 60_000
          : null,
      });

      setToastMessage({
        text: `자동 일기 작성 완료: ${placeLabel} (${timeStr})`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      const errMsg = err?.message || '자동 위치 확인에 실패했습니다.';
      const isPermissionDenied = errMsg.includes('권한') || errMsg.includes('거부');
      const currentSettings = autoDiarySettingsRef.current;
      if (isPermissionDenied) {
        updateAutoDiarySettings({ enabled: false, nextAutoDiaryAt: null });
        setToastMessage({
          text: '위치 권한이 거부되어 자동 위치 확인 · 자동 일기 작성이 중지되었습니다.',
          type: 'error',
        });
        setTimeout(() => setToastMessage(null), 5000);
      } else {
        if (currentSettings.enabled) {
          updateAutoDiarySettings({
            nextAutoDiaryAt: Date.now() + currentSettings.intervalMinutes * 60_000,
          });
        }
        if (source === 'manual') {
          setToastMessage({ text: `자동 위치 확인 실패: ${errMsg}`, type: 'error' });
          setTimeout(() => setToastMessage(null), 4000);
        }
      }
    } finally {
      isAutoDiaryRunningRef.current = false;
      setIsAutoDiaryRunning(false);
    }
  };

  useEffect(() => {
    if (!canEditLocal || !autoDiarySettings.enabled) return;

    const checkDue = () => {
      const settings = autoDiarySettingsRef.current;
      if (!canEditLocalRef.current || !settings.enabled || !settings.nextAutoDiaryAt) return;
      if (Date.now() >= settings.nextAutoDiaryAt && !isAutoDiaryRunningRef.current) {
        runAutoLocationDiaryCheck('auto');
      }
    };

    checkDue();
    const timer = window.setInterval(checkDue, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkDue();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canEditLocal, autoDiarySettings.enabled, autoDiarySettings.nextAutoDiaryAt, autoDiarySettings.intervalMinutes]);

  const handleBatchUploadAllToServer = async (
    onProgress?: (current: number, total: number, title: string) => void
  ): Promise<{ uploaded: number; skipped: number; failed: number }> => {
    if (!isAdmin) {
      openLoginModal(
        canEditLocalRef.current
          ? '일괄 업로드를 위해 Google 관리자 로그인이 필요합니다.'
          : '먼저 앱 사용 패스워드를 해제한 뒤 Google 관리자 로그인을 진행해 주세요.',
        canEditLocalRef.current ? 'admin' : 'local'
      );
      throw new Error('관리자 로그인이 필요합니다.');
    }
    if (isAutoPushingRef.current) {
      throw new Error('현재 자동 서버 업로드가 진행 중입니다. 잠시 후 완료됩니다.');
    }

    isAutoPushingRef.current = true;
    try {
      await syncPendingDeletesWithServer();

      const targets = diaries.filter(
        (d) =>
          getDiaryServerStatus(d, serverMetaMap, hasLoadedServerMeta) !== 'synced' &&
          !inFlightUploadIdsRef.current.has(d.id)
      );
      const total = targets.length;
      if (total === 0) {
        return { uploaded: 0, skipped: diaries.length, failed: 0 };
      }

      let uploaded = 0;
      let failed = 0;
      const updatedMetaMap = { ...serverMetaMap };

      for (let i = 0; i < targets.length; i++) {
        let target = targets[i];
        const originalId = target.id;
        onProgress?.(i + 1, total, target.title || '제목 없음');

        const existingMeta = findMatchingServerMeta(target, updatedMetaMap);
        if (existingMeta && existingMeta.id !== target.id) {
          target = { ...target, id: existingMeta.id };
        }

        if (diaryNeedsPhotoHydration(target)) {
          if (existingMeta) {
            const hydrated = await hydrateDiaryPhotosFromServer(target, getIdToken, { force: true }).catch(() => null);
            if (hydrated && !diaryNeedsPhotoHydration(hydrated)) {
              target = hydrated;
            } else {
              failed++;
              continue;
            }
          } else {
            // Brand-new entry for this server (e.g., imported JSON): keep valid embedded/external photos and drop stale relative /api paths
            const uploadablePhotos = filterValidPhotos(target.photos)
              .filter((p) => !p.url.startsWith('/api/'))
              .map((p) => ({ ...p, isThumbnailOnly: false }));
            target = {
              ...target,
              photos: uploadablePhotos,
              totalPhotosCount: uploadablePhotos.length,
              hasSubcollectionPhotos: uploadablePhotos.some((p) => p.url.startsWith('data:image/')),
            };
          }
        }

        inFlightUploadIdsRef.current.add(originalId);
        try {
          const { updatedDiary, meta } = await upsertDiaryToServer(target, getIdToken);
          if (updatedDiary.id !== originalId) {
            await deleteLocalDiary(originalId).catch(() => {});
          }
          await saveLocalDiary(updatedDiary);
          updatedMetaMap[meta.id] = meta;
          uploaded++;
        } catch (err) {
          console.error(`Batch upload failed for ${target.id}:`, err);
          failed++;
        } finally {
          inFlightUploadIdsRef.current.delete(originalId);
        }
      }

      saveCachedServerMetaMap(updatedMetaMap);
      setServerMetaMap(updatedMetaMap);
      setHasLoadedServerMeta(true);
      setIsServerOnline(true);

      const refreshed = await getAllLocalDiaries();
      setDiaries(deduplicateDiaries(refreshed.map((item) => sanitizeDiaryEntry(item).entry)).deduplicated);

      return { uploaded, skipped: diaries.length - total, failed };
    } finally {
      isAutoPushingRef.current = false;
    }
  };

  const serverDiariesCount = hasLoadedServerMeta ? Object.keys(serverMetaMap).length : null;

  const handleExportWithOptions = async (options: ExportOptions) => {
    let sourceDiaries = diaries;
    const matched = filterDiariesForExport(sourceDiaries, options);
    const needHydration = matched.filter((d) => diaryNeedsPhotoHydration(d) && Boolean(serverMetaMap[d.id]));

    if (needHydration.length > 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
      const hydratedMap = new Map<string, DiaryEntry>();
      for (let i = 0; i < needHydration.length; i++) {
        const entry = needHydration[i];
        setToastMessage({
          text: `고화질 사진 백업 준비 중 (${i + 1}/${needHydration.length})...`,
          type: 'info',
        });
        const hydrated = await hydrateDiaryPhotosFromServer(entry, getIdToken, { force: true }).catch(() => null);
        if (hydrated) {
          hydratedMap.set(hydrated.id, hydrated);
        }
      }
      if (hydratedMap.size > 0) {
        sourceDiaries = sourceDiaries.map((d) => hydratedMap.get(d.id) || d);
        setDiaries(sourceDiaries);
      }
    }

    const matchedIds = matched.map((d) => d.id);
    const visitsByDiary = matchedIds.length > 0
      ? await fetchVisitsMapForExport(matchedIds).catch(() => ({}))
      : {};

    const result = await exportDiariesWithOptions(sourceDiaries, options, visitsByDiary);
    if (result.count > 0) {
      const visitsSummary = result.visitCount > 0 ? `, 방문기록 ${result.visitCount}개 포함` : '';
      setToastMessage({
        text: `${result.count}개의 일기${visitsSummary} JSON 다운로드 완료 (${result.fileName})`,
        type: 'success',
      });
    } else {
      setToastMessage({ text: '선택한 조건에 해당하는 일기가 없습니다 (0개)', type: 'info' });
    }
    setTimeout(() => setToastMessage(null), 3000);
    return { count: result.count, success: result.success };
  };

  return (
    <div className="flex flex-col flex-1 bg-stone-100 text-stone-900 font-sans selection:bg-amber-200 selection:text-amber-900 overflow-x-hidden pt-[90px] sm:pt-[100px]">
      <Navbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenNewDiary={handleRequestNewDiary}
        onExportData={() => {
          if (canEditLocal || isAdmin) {
            setIsExportModalOpen(true);
          }
        }}
        onOpenHelp={() => setIsHelpModalOpen(true)}
        totalDiariesCount={diaries.length}
        serverDiariesCount={serverDiariesCount}
        isServerOnline={isServerOnline}
        isQuotaExceeded={false}
        isCheckingServer={isCheckingServer}
        onRefreshServerStatus={refreshServerStatus}
        onTriggerAutoDiaryNow={() => runAutoLocationDiaryCheck('manual')}
        isAutoDiaryRunning={isAutoDiaryRunning}
      />

      <main className="flex-1 w-full max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 py-3 sm:py-4">
        {viewMode !== 'map' && (
          <div className="mb-3 rounded-2xl bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white px-4 py-2 sm:px-5 sm:py-2.5 shadow-xl relative overflow-hidden border border-stone-800 shrink-0">
            <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-amber-600/10 blur-3xl pointer-events-none" />
            <div className="relative z-10 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-2 sm:gap-3">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-semibold mb-1 shadow-2xs">
                  <Compass className="w-3.5 h-3.5" />
                  <span>{t('heroTag')}</span>
                </div>
                <p className="text-xs sm:text-sm text-stone-300 leading-snug max-w-2xl">{t('heroDescription')}</p>
              </div>
              <div
                className="flex items-center gap-3.5 bg-stone-900/90 backdrop-blur-md px-4 py-1.5 sm:py-2 rounded-xl border border-white/15 shadow-xl shrink-0 w-full md:w-auto"
                title={cumulativeHasRoadData ? '실제 도로 거리 기준 누적 총 주행 거리' : '누적 총 주행 거리'}
              >
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30"><Route className="w-5 h-5" /></div>
                <div className="flex-1 md:flex-initial">
                  <div className="text-[11px] text-stone-400 font-medium uppercase tracking-wider">{t('totalCumulativeDistance')}</div>
                  <div className="text-lg sm:text-xl font-extrabold text-white flex items-baseline gap-1.5">
                    <span>{cumulativeDistanceKm.toLocaleString()}</span>
                    <span className="text-xs font-bold text-amber-400">km</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'blog' && (
          <BlogFeedView
            diaries={diaries}
            serverMetaMap={serverMetaMap}
            hasLoadedServerMeta={hasLoadedServerMeta}
            uploadingDiaryIds={uploadingDiaryIds}
            isInitialSyncing={isInitialSyncing}
            isOffline={!isServerOnline}
            onUploadDiaryToServer={handleUploadDiaryToServer}
            onSelectDiary={(d) => handleSelectDiary(d)}
            onSelectDiaryVisits={(d) => handleSelectDiary(d, { scrollToVisits: true })}
            visitSyncVersion={visitSyncVersion}
            onEditDiary={handleOpenEditDiary}
            onDeleteDiary={handleRequestDeleteDiary}
            onViewOnMap={(d) => { setFocusedMapDiaryId(d.id); setViewMode('map'); }}
            onOpenNewDiary={handleRequestNewDiary}
          />
        )}

        {viewMode === 'map' && (
          <TravelMapView
            diaries={diaries}
            onSelectDiary={handleSelectDiary}
            selectedDiaryId={focusedMapDiaryId}
          />
        )}
      </main>

      <footer className="shrink-0 bg-stone-900 text-stone-300 border-t border-stone-800 py-3 sm:py-3.5 shadow-md mt-auto">
        <div className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-white tracking-tight truncate">{t('appTitle')}</span>
            <span className="hidden sm:inline text-stone-600">•</span>
            <span className="hidden sm:inline text-stone-400 truncate">{t('footerArchive')}</span>
          </div>
          <p className="text-[11px] sm:text-xs text-stone-400 font-medium shrink-0 ml-auto">Developer: H2 | Copyright: © 2026.10</p>
        </div>
      </footer>

      <DiaryEditorModal
        key={editingDiary ? `edit-${editingDiary.id}` : `new-${isEditorOpen}`}
        isOpen={isEditorOpen}
        onClose={() => { setIsEditorOpen(false); setEditingDiary(null); }}
        onSave={handleSaveDiary}
        initialEntry={editingDiary}
      />
      <DiaryDetailModal
        isOpen={!!selectedDiary}
        diary={selectedDiary}
        onClose={() => { setSelectedDiary(null); setOpenDetailAtVisits(false); }}
        onEdit={(d) => { setSelectedDiary(null); setOpenDetailAtVisits(false); handleOpenEditDiary(d); }}
        onDelete={(d) => handleRequestDeleteDiary(d)}
        onViewOnMap={(d) => { setFocusedMapDiaryId(d.id); setViewMode('map'); }}
        onOpenPhotoLightbox={(photos, index) => { setLightboxPhotos(photos); setLightboxIndex(index); setIsLightboxOpen(true); }}
        serverStatus={selectedDiary ? getDiaryServerStatus(selectedDiary, serverMetaMap, hasLoadedServerMeta) : 'not_on_server'}
        isUploadingToServer={selectedDiary ? Boolean(uploadingDiaryIds[selectedDiary.id]) : false}
        onUploadToServer={handleUploadDiaryToServer}
        initialScrollToVisits={openDetailAtVisits}
        onVisitsUpdated={(diaryId, totalCount) => {
          setVisitSyncVersion((v) => v + 1);
          setServerMetaMap((prev) => {
            if (!prev[diaryId]) return prev;
            const localOnlyCount = (() => {
              try {
                const raw = localStorage.getItem('hills_diary_local_visits_v1');
                const parsed = raw ? JSON.parse(raw) : {};
                return Array.isArray(parsed?.[diaryId]) ? parsed[diaryId].length : 0;
              } catch {
                return 0;
              }
            })();
            const serverCount = Math.max(0, totalCount - localOnlyCount);
            if (prev[diaryId].visitCount === serverCount) return prev;
            const next = {
              ...prev,
              [diaryId]: { ...prev[diaryId], visitCount: serverCount },
            };
            saveCachedServerMetaMap(next);
            return next;
          });
        }}
        onNextDiary={() => {
          const idx = diaries.findIndex(d => d.id === selectedDiary?.id);
          if (idx < diaries.length - 1) setSelectedDiary(diaries[idx + 1]);
        }}
        onPrevDiary={() => {
          const idx = diaries.findIndex(d => d.id === selectedDiary?.id);
          if (idx > 0) setSelectedDiary(diaries[idx - 1]);
        }}
        hasNext={!!selectedDiary && diaries.findIndex(d => d.id === selectedDiary.id) < diaries.length - 1}
        hasPrev={!!selectedDiary && diaries.findIndex(d => d.id === selectedDiary.id) > 0}
      />
      <PhotoLightbox
        isOpen={isLightboxOpen}
        photos={lightboxPhotos}
        currentIndex={lightboxIndex}
        onClose={() => setIsLightboxOpen(false)}
        onNavigate={(idx) => setLightboxIndex(idx)}
      />
      <ConfirmModal
        isOpen={!!deleteTarget}
        title={t('confirmDeleteTitle')}
        message={t('confirmDeleteMessage')}
        itemTitle={deleteTarget?.title}
        confirmText={t('confirmDeleteBtn')}
        cancelText={t('confirmCancel')}
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
      <DataManagementModal 
        isOpen={isExportModalOpen && (canEditLocal || isAdmin)} 
        onClose={() => setIsExportModalOpen(false)} 
        diaries={diaries} 
        unsyncedCount={
          diaries.filter((d) => getDiaryServerStatus(d, serverMetaMap, hasLoadedServerMeta) !== 'synced').length +
          pendingDeleteIds.length
        }
        excludedDistanceCount={
          diaries.filter((d) => (d.location?.includeInDistance ?? d.includeInDistance ?? true) === false).length
        }
        onBatchUploadToServer={handleBatchUploadAllToServer}
        onIncludeAllInDistance={async () => {
          const result = await ensureAllDiariesIncludedInDistance(serverMetaMap, { force: true });
          const stillHasServerExcluded = (Object.values(serverMetaMap) as ServerDiaryMeta[]).some(
            (m) => m.includeInDistance === false
          );
          if (!isAdminRef.current && stillHasServerExcluded && (typeof navigator === 'undefined' || navigator.onLine)) {
            openLoginModal(
              canEditLocalRef.current
                ? '서버 일기의 누적거리 포함 설정을 업데이트하려면 Google 관리자 로그인이 필요합니다.'
                : '먼저 앱 사용 패스워드를 해제한 뒤 Google 관리자 로그인을 진행해 주세요.',
              canEditLocalRef.current ? 'admin' : 'local'
            );
          } else {
            setToastMessage({
              text: `누적거리 포함 적용 완료 (로컬 ${result.localUpdated}개, 서버 ${result.serverUpdated}개)`,
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 3500);
          }
          return result;
        }}
        onExport={handleExportWithOptions} 
        onImport={async (importedDiaries) => {
          let addedCount = 0;
          let updatedCount = 0;
          let importedVisitsCount = 0;
          const toSave: DiaryEntry[] = [];
          const visitsToRestore: Array<{ diaryId: string; visits: ReturnType<typeof sanitizeImportedVisits>; isOnServer: boolean }> = [];

          for (const rawItem of importedDiaries) {
            const { visits: rawVisits, ...item } = rawItem;
            const matchedServer = findMatchingServerMeta(item, serverMetaMap);
            const normalized: DiaryEntry = {
              ...item,
              id: matchedServer ? matchedServer.id : item.id,
              location: item.location || { lat: 0, lng: 0, address: '', region: '알 수 없음' },
              photos: item.photos || [],
              moodTags: item.moodTags || (item as any).mood_tags || [],
              localInsights: item.localInsights || (item as any).local_insights || { recommendedForSolo: '' },
              createdAt: item.createdAt || Date.now(),
              updatedAt: item.updatedAt || Date.now(),
              localSyncStatus: matchedServer ? 'synced' : 'not_on_server',
            };

            const existing = diaries.find((d) => isDiaryDuplicate(d, normalized));
            let diarySkipped = false;
            if (existing) {
              normalized.id = existing.id;
              if ((existing.updatedAt || 0) > (normalized.updatedAt || 0) && !diaryNeedsPhotoHydration(existing)) {
                diarySkipped = true;
              } else {
                updatedCount++;
              }
            } else {
              addedCount++;
            }

            if (!diarySkipped) {
              toSave.push(normalized);
            }

            const cleanedVisits = sanitizeImportedVisits(normalized.id, rawVisits);
            if (cleanedVisits.length > 0) {
              visitsToRestore.push({
                diaryId: normalized.id,
                visits: cleanedVisits,
                isOnServer: Boolean(matchedServer || serverMetaMap[normalized.id]),
              });
            }
          }

          if (toSave.length > 0) {
            const { deduplicated: uniqueBatch } = deduplicateDiaries(toSave);
            await saveMultipleLocalDiaries(uniqueBatch, true);
            const fresh = await getAllLocalDiaries();
            const { deduplicated: finalList } = deduplicateDiaries(fresh);
            setDiaries(finalList);
          }

          if (visitsToRestore.length > 0) {
            const canImportToServer =
              isAdminRef.current && (typeof navigator === 'undefined' || navigator.onLine);

            for (const entry of visitsToRestore) {
              if (entry.isOnServer && canImportToServer) {
                try {
                  const res = await importDiaryVisitsToServer(entry.diaryId, entry.visits, getIdToken);
                  importedVisitsCount += res.importedCount;
                  setServerMetaMap((prev) => {
                    if (!prev[entry.diaryId]) return prev;
                    const next = {
                      ...prev,
                      [entry.diaryId]: { ...prev[entry.diaryId], visitCount: res.totalCount },
                    };
                    saveCachedServerMetaMap(next);
                    return next;
                  });
                  continue;
                } catch {}
              }
              importedVisitsCount += saveImportedVisitsLocally(entry.diaryId, entry.visits);
            }
            setVisitSyncVersion((v) => v + 1);
          }

          return { addedCount, updatedCount, total: toSave.length, importedVisitsCount };
        }}
        onResetLocalDb={async () => {
          try {
            await clearLocalDb();
            clearServerSyncCaches();
            localStorage.removeItem('hills_travel_diaries_v4');
            localStorage.removeItem('hills_travel_sync_queue_v4');
            localStorage.removeItem('hills_travel_idb_migrated_v5');
            localStorage.removeItem('hills_blog_diaries_v2');

            setPendingDeleteIds([]);
            setServerMetaMap({});
            setHasLoadedServerMeta(false);
            setDiaries([]);

            if (typeof navigator === 'undefined' || navigator.onLine) {
              setToastMessage({ text: '로컬 초기화 완료 · 서버 일기를 다시 불러오는 중...', type: 'info' });
              await refreshServerStatus({ bypassCooldown: true });
            } else {
              setToastMessage({ text: '로컬 저장소가 초기화되었습니다. (오프라인 상태)', type: 'success' });
              setTimeout(() => setToastMessage(null), 3000);
            }
          } catch (err: any) {
            setToastMessage({ text: `초기화 실패: ${err.message}`, type: 'error' });
          }
        }}
      />
      <AppHelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />
      <LoginModal />

      {toastMessage && (
        <div className={`fixed top-18 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl border flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 max-w-[90vw] ${
          toastMessage.type === 'error' ? 'bg-rose-950/95 text-rose-200 border-rose-800/80' :
          toastMessage.type === 'info' ? 'bg-stone-900/95 text-amber-300 border-amber-600/60' :
          'bg-stone-900/95 text-emerald-300 border-emerald-800/60'
        }`}>
          {toastMessage.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : toastMessage.type === 'info' ? (
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="truncate">{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
}
