import React, { useState, useEffect, useMemo } from 'react';
import { DiaryEntry, TravelPhoto, ViewMode, VisitorLog } from './types';
import { 
  getStoredDiaries, 
  saveDiaries, 
  exportDiariesWithOptions,
  ExportOptions,
  sortDiariesDescending,
  deduplicateDiaries,
  isDiaryDuplicate
} from './utils/storage';
import { recordVisitorLocation, subscribeVisitorLogs } from './services/visitorService';
import { calculateDistanceKm } from './utils/geo';
import { Navbar } from './components/Navbar';
import { BlogFeedView } from './components/BlogFeedView';
import { TravelMapView } from './components/TravelMapView';
import { VisitorLocationModal } from './components/VisitorLocationModal';
import { DiaryEditorModal } from './components/DiaryEditorModal';
import { DiaryDetailModal } from './components/DiaryDetailModal';
import { PhotoLightbox } from './components/PhotoLightbox';
import { ConfirmModal } from './components/ConfirmModal';
import { DataManagementModal } from './components/DataManagementModal';
import { FlutterCodeModal } from './components/FlutterCodeModal';
import { LoginModal } from './components/LoginModal';
import { downloadFlutterProjectZip } from './utils/flutterDownload';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { getCachedDiaryTranslation, hasKorean, translateDiaryAsync } from './utils/translationService';
import { 
  getAllLocalDiaries, 
  saveLocalDiary,
  saveMultipleLocalDiaries,
  deleteLocalDiary,
  clearLocalDb
} from './utils/localDb';
import {
  ServerDiaryMeta,
  getDiaryServerStatus,
  subscribeServerDiaryStatus,
  syncMissingAndUpdatedFromServer,
  upsertDiaryToFirestore,
} from './services/diaryFirestore';
import { testFirestoreConnection } from './lib/firebase';
import { 
  Compass, 
  CheckCircle2,
  AlertTriangle,
  Route,
  Loader2
} from 'lucide-react';

export default function App() {
  const { t, language } = useLanguage();
  const { isAdmin, openLoginModal, autoLogoutNotice, clearAutoLogoutNotice } = useAuth();
  const [diaries, setDiaries] = useState<DiaryEntry[]>(() => getStoredDiaries());
  const [viewMode, setViewMode] = useState<ViewMode>('blog');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [visitorLogs, setVisitorLogs] = useState<VisitorLog[]>([]);
  const [isVisitorModalOpen, setIsVisitorModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [serverMetaMap, setServerMetaMap] = useState<Record<string, ServerDiaryMeta>>({});
  const [hasLoadedServerMeta, setHasLoadedServerMeta] = useState(false);
  const [isServerOnline, setIsServerOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isCheckingServer, setIsCheckingServer] = useState(false);
  const [uploadingDiaryIds, setUploadingDiaryIds] = useState<Record<string, boolean>>({});

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
          const { deduplicated } = deduplicateDiaries(cached);
          currentLocal = deduplicated;
          setDiaries(deduplicated);
        } else if (isMounted) {
          // If IndexedDB is empty, seed from localStorage fallback if any exists
          const fallback = getStoredDiaries();
          if (fallback.length > 0) {
            await saveMultipleLocalDiaries(fallback, true);
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

      // Sync missing or server-updated diaries from Firestore into local IndexedDB
      if (!isMounted || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      try {
        const syncRes = await syncMissingAndUpdatedFromServer(currentLocal);
        if (!isMounted) return;
        setIsServerOnline(syncRes.online);
        if (syncRes.online) {
          setServerMetaMap(syncRes.serverMetaMap);
          setHasLoadedServerMeta(true);
          if (syncRes.addedCount > 0 || syncRes.updatedCount > 0) {
            const refreshedLocal = await getAllLocalDiaries();
            if (!isMounted) return;
            const { deduplicated } = deduplicateDiaries(refreshedLocal);
            setDiaries(deduplicated);
            const parts: string[] = [];
            if (syncRes.addedCount > 0) parts.push(`새 일기 ${syncRes.addedCount}개 추가`);
            if (syncRes.updatedCount > 0) parts.push(`업데이트 ${syncRes.updatedCount}개 반영`);
            setToastMessage({
              text: `서버에서 ${parts.join(', ')} 완료`,
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 3500);
          }
        }
      } catch (serverErr) {
        console.warn('[Firestore] Initial server-to-local sync skipped:', serverErr);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (isAdmin) {
      const unsubscribe = subscribeVisitorLogs(setVisitorLogs);
      return () => unsubscribe();
    }
  }, [isAdmin]);

  // Refresh server connectivity, server diary count, and pull any missing/updated diaries
  const refreshServerStatus = async () => {
    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!browserOnline) {
      setIsServerOnline(false);
      return;
    }
    setIsCheckingServer(true);
    try {
      const currentLocal = await getAllLocalDiaries();
      const syncRes = await syncMissingAndUpdatedFromServer(currentLocal);
      setIsServerOnline(syncRes.online);
      if (syncRes.online) {
        setServerMetaMap(syncRes.serverMetaMap);
        setHasLoadedServerMeta(true);
        if (syncRes.addedCount > 0 || syncRes.updatedCount > 0) {
          const refreshedLocal = await getAllLocalDiaries();
          const { deduplicated } = deduplicateDiaries(refreshedLocal);
          setDiaries(deduplicated);
          const parts: string[] = [];
          if (syncRes.addedCount > 0) parts.push(`새 일기 ${syncRes.addedCount}개 추가`);
          if (syncRes.updatedCount > 0) parts.push(`업데이트 ${syncRes.updatedCount}개 반영`);
          setToastMessage({
            text: `서버에서 ${parts.join(', ')} 완료`,
            type: 'success',
          });
          setTimeout(() => setToastMessage(null), 3000);
        }
      }
    } catch {
      setIsServerOnline(false);
    } finally {
      setIsCheckingServer(false);
    }
  };

  useEffect(() => {
    let active = true;

    const handleOnline = async () => {
      if (!active) return;
      const connected = await testFirestoreConnection();
      if (active) setIsServerOnline(connected);
      if (connected) {
        refreshServerStatus();
      }
    };

    const handleOffline = () => {
      if (active) setIsServerOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = subscribeServerDiaryStatus(
      (metaMap, fromCache) => {
        if (!active) return;
        setServerMetaMap(metaMap);
        setHasLoadedServerMeta(true);
        if (!fromCache && (typeof navigator === 'undefined' || navigator.onLine)) {
          setIsServerOnline(true);
        }
      },
      () => {
        if (active && typeof navigator !== 'undefined' && !navigator.onLine) {
          setIsServerOnline(false);
        }
      }
    );

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  // Modals state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | null>(null);
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null);
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

  const [isDownloadingFlutter, setIsDownloadingFlutter] = useState(false);
  const [isFlutterCodeOpen, setIsFlutterCodeOpen] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState<string | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState<TravelPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DiaryEntry | null>(null);

  useEffect(() => {
    saveDiaries(diaries);
  }, [diaries]);

  const handleSaveDiary = async (entry: DiaryEntry) => {
    if (!isAdmin) {
      openLoginModal('관리자 로그인이 필요합니다.');
      return;
    }
    const existingMatch = diaries.find((d) => isDiaryDuplicate(d, entry));
    const targetEntry: DiaryEntry = { ...entry };
    let obsoleteIdToDelete: string | null = null;
    if (existingMatch) {
      targetEntry.id = existingMatch.id;
      targetEntry.views = Math.max(existingMatch.views || 0, entry.views || 0);
      targetEntry.createdAt = existingMatch.createdAt || (Date.now() - 3600000);
      targetEntry.updatedAt = Date.now();
      targetEntry.isModified = true;
      if (entry.id !== existingMatch.id) obsoleteIdToDelete = entry.id;
    } else {
      targetEntry.createdAt = targetEntry.createdAt || Date.now();
      targetEntry.updatedAt = targetEntry.createdAt;
      targetEntry.isModified = false;
    }

    setDiaries((prev) => {
      const filtered = prev.filter(d => d.id !== targetEntry.id && (!obsoleteIdToDelete || d.id !== obsoleteIdToDelete));
      return sortDiariesDescending([targetEntry, ...filtered]);
    });

    if (selectedDiary && (selectedDiary.id === targetEntry.id || (obsoleteIdToDelete && selectedDiary.id === obsoleteIdToDelete))) {
      setSelectedDiary(targetEntry);
    }

    if (obsoleteIdToDelete) {
      await deleteLocalDiary(obsoleteIdToDelete).catch(() => {});
    }

    try {
      await saveLocalDiary(targetEntry);
      setToastMessage({ text: '일기가 로컬 저장소에 저장되었습니다.', type: 'success' });
      setTimeout(() => setToastMessage(null), 2500);
    } catch (err: any) {
      console.error('Failed to save to local database:', err);
      setToastMessage({ 
        text: `로컬 저장소 오류: ${err.message || '데이터베이스에 저장할 수 없습니다.'}`, 
        type: 'error' 
      });
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const handleConfirmDelete = async () => {
    if (!isAdmin || !deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    setDiaries((prev) => prev.filter(d => d.id !== targetId));
    if (selectedDiary && selectedDiary.id === targetId) setSelectedDiary(null);
    try {
      await deleteLocalDiary(targetId);
    } catch (err) {
      console.error('Failed to delete local diary:', err);
    }
  };

  const handleSelectDiary = async (diary: DiaryEntry) => {
    const original = diaries.find((item) => item.id === diary.id) || diary;
    if (!isAdmin) {
      const updated = { ...original, views: (original.views || 0) + 1 };
      setSelectedDiary(updated);
      setDiaries((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      saveLocalDiary(updated).catch(() => {});
      recordVisitorLocation(original.id, original.title).catch(console.warn);
    } else {
      setSelectedDiary(original);
    }
  };

  const handleResetAllViews = async () => {
    if (!isAdmin) return;
    try {
      const resetList = diaries.map((d) => ({ ...d, views: 0 }));
      setDiaries(resetList);
      await saveMultipleLocalDiaries(resetList, true);
      setToastMessage({ text: '방문자 수 초기화 완료', type: 'success' });
      setTimeout(() => setToastMessage(null), 2000);
    } catch {}
  };

  const cumulativeDistanceKm = useMemo(() => {
    const sorted = [...diaries].sort((a, b) => new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime());
    if (sorted.length === 0) return 0;
    const startIndex = sorted.findIndex(d => (d.date && d.date.includes('10-23')) || (d.title && d.title.includes('자전거')) || (d.content && d.content.includes('자전거')));
    const relevant = sorted.slice(startIndex !== -1 ? startIndex : 0).filter(d => (d.location?.includeInDistance ?? d.includeInDistance ?? true) !== false);
    let dist = 0;
    for (let i = 0; i < relevant.length - 1; i++) {
      const from = relevant[i]?.location, to = relevant[i + 1]?.location;
      if (from && to && typeof from.lat === 'number' && typeof to.lat === 'number') {
        dist += calculateDistanceKm(from.lat, from.lng, to.lat, to.lng);
      }
    }
    return Math.round(dist * 10) / 10;
  }, [diaries]);

  const handleUploadDiaryToServer = async (diary: DiaryEntry) => {
    if (!isAdmin) {
      openLoginModal('서버에 일기를 추가/수정하려면 관리자 로그인이 필요합니다.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setToastMessage({ text: '오프라인 상태에서는 서버에 반영할 수 없습니다.', type: 'error' });
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const originalId = diary.id;
    const isExistingOnServer = Boolean(serverMetaMap[originalId]);

    setUploadingDiaryIds((prev) => ({ ...prev, [originalId]: true }));
    try {
      const { updatedDiary, meta } = await upsertDiaryToFirestore(diary, { isExistingOnServer });

      if (updatedDiary.id !== originalId) {
        await deleteLocalDiary(originalId).catch(() => {});
        await saveLocalDiary(updatedDiary);
        setDiaries((prev) =>
          sortDiariesDescending(prev.map((d) => (d.id === originalId ? updatedDiary : d)))
        );
        if (selectedDiary?.id === originalId) {
          setSelectedDiary(updatedDiary);
        }
      }

      setServerMetaMap((prev) => ({ ...prev, [meta.id]: meta }));
      setHasLoadedServerMeta(true);
      setIsServerOnline(true);

      setToastMessage({
        text: isExistingOnServer
          ? `'${updatedDiary.title || '일기'}'가 서버에 업데이트되었습니다.`
          : `'${updatedDiary.title || '일기'}'가 서버에 추가되었습니다.`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to upload diary to Firestore:', err);
      let readableMsg = err?.message || '잠시 후 다시 시도해주세요.';
      if (typeof readableMsg === 'string' && readableMsg.startsWith('{')) {
        try {
          const parsed = JSON.parse(readableMsg);
          if (parsed?.error) readableMsg = parsed.error;
        } catch {}
      }
      setToastMessage({
        text: `서버 반영 실패: ${readableMsg}`,
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 4500);
    } finally {
      setUploadingDiaryIds((prev) => {
        const next = { ...prev };
        delete next[originalId];
        return next;
      });
    }
  };

  const serverDiariesCount = hasLoadedServerMeta ? Object.keys(serverMetaMap).length : null;

  const handleExportWithOptions = async (options: ExportOptions) => {
    const result = await exportDiariesWithOptions(diaries, options);
    if (result.count > 0) {
      setToastMessage({ text: `${result.count}개의 일기 JSON 다운로드 완료 (${result.fileName})`, type: 'success' });
    } else {
      setToastMessage({ text: '선택한 조건에 해당하는 일기가 없습니다 (0개)', type: 'info' });
    }
    setTimeout(() => setToastMessage(null), 3000);
    return { count: result.count, success: result.success };
  };

  return (
    <div className="flex flex-col flex-1 bg-stone-100 text-stone-900 font-sans selection:bg-amber-200 selection:text-amber-900 overflow-x-hidden pt-24">
      <Navbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenNewDiary={() => { setEditingDiary(null); setIsEditorOpen(true); }}
        onExportData={() => setIsExportModalOpen(true)}
        totalDiariesCount={diaries.length}
        serverDiariesCount={serverDiariesCount}
        isServerOnline={isServerOnline}
        isCheckingServer={isCheckingServer}
        onRefreshServerStatus={refreshServerStatus}
        totalViewsCount={isAdmin ? diaries.reduce((acc, d) => acc + (d.views || 0), 0) : undefined}
        visitorLogsCount={visitorLogs.length}
        onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
        onOpenFlutterCode={() => setIsFlutterCodeOpen(true)}
      />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {viewMode !== 'map' && (
          <div className="mb-6 rounded-2xl bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white p-4 sm:p-5 shadow-xl relative overflow-hidden border border-stone-800 shrink-0">
            <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-amber-600/10 blur-3xl pointer-events-none" />
            <div className="relative z-10 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-semibold mb-2 shadow-2xs">
                  <Compass className="w-3.5 h-3.5" />
                  <span>{t('heroTag')}</span>
                </div>
                <p className="text-xs sm:text-sm text-stone-300 leading-relaxed max-w-2xl">{t('heroDescription')}</p>
              </div>
              <div className="flex items-center gap-3.5 bg-stone-900/90 backdrop-blur-md px-5 py-3 rounded-xl border border-white/15 shadow-xl shrink-0 w-full md:w-auto">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30"><Route className="w-5 h-5" /></div>
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
            uploadingDiaryIds={uploadingDiaryIds}
            onUploadDiaryToServer={handleUploadDiaryToServer}
            onSelectDiary={handleSelectDiary}
            onEditDiary={(d) => { setEditingDiary(d); setIsEditorOpen(true); }}
            onDeleteDiary={(d) => setDeleteTarget(d)}
            onViewOnMap={(d) => { setFocusedMapDiaryId(d.id); setViewMode('map'); }}
            onOpenNewDiary={() => { setEditingDiary(null); setIsEditorOpen(true); }}
            onResetAllViews={handleResetAllViews}
            onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
          />
        )}

        {viewMode === 'map' && (
          <TravelMapView
            diaries={diaries}
            onSelectDiary={handleSelectDiary}
            selectedDiaryId={focusedMapDiaryId}
            visitorLogs={visitorLogs}
            onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
          />
        )}
      </main>

      <footer className="shrink-0 bg-stone-900 text-stone-300 border-t border-stone-800 py-3 sm:py-3.5 shadow-md mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-white tracking-tight truncate">{t('appTitle')}</span>
            <span className="hidden sm:inline text-stone-600">•</span>
            <span className="hidden sm:inline text-stone-400 truncate">{t('footerArchive')}</span>
          </div>
          <p className="text-[11px] sm:text-xs text-stone-400 font-medium shrink-0 ml-auto">Developer: H2 | Copyright: © 2026.10</p>
        </div>
      </footer>

      <LoginModal />
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
        onClose={() => setSelectedDiary(null)}
        onEdit={(d) => { setSelectedDiary(null); setEditingDiary(d); setIsEditorOpen(true); }}
        onDelete={(d) => setDeleteTarget(d)}
        onViewOnMap={(d) => { setFocusedMapDiaryId(d.id); setViewMode('map'); }}
        onOpenPhotoLightbox={(photos, index) => { setLightboxPhotos(photos); setLightboxIndex(index); setIsLightboxOpen(true); }}
        serverStatus={selectedDiary ? getDiaryServerStatus(selectedDiary, serverMetaMap) : 'not_on_server'}
        isUploadingToServer={selectedDiary ? Boolean(uploadingDiaryIds[selectedDiary.id]) : false}
        onUploadToServer={handleUploadDiaryToServer}
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
      <FlutterCodeModal isOpen={isFlutterCodeOpen && isAdmin} onClose={() => setIsFlutterCodeOpen(false)} onDownloadZip={async () => {
        try {
          setIsDownloadingFlutter(true);
          await downloadFlutterProjectZip();
          setDownloadNotification('다운로드 시작됨');
          setTimeout(() => setDownloadNotification(null), 3500);
        } catch { setDownloadNotification('다운로드 오류'); setTimeout(() => setDownloadNotification(null), 3500); }
        finally { setIsDownloadingFlutter(false); }
      }} />
      {isVisitorModalOpen && isAdmin && <VisitorLocationModal isOpen={isVisitorModalOpen} onClose={() => setIsVisitorModalOpen(false)} visitorLogs={visitorLogs} />}
      <DataManagementModal 
        isOpen={isExportModalOpen} 
        onClose={() => setIsExportModalOpen(false)} 
        diaries={diaries} 
        onExport={handleExportWithOptions} 
        onImport={async (importedDiaries) => {
          if (!isAdmin) {
            throw new Error('관리자 권한이 필요합니다.');
          }

          let addedCount = 0;
          let updatedCount = 0;
          const toSave: DiaryEntry[] = [];

          for (const item of importedDiaries) {
            const normalized: DiaryEntry = {
              ...item,
              location: item.location || { lat: 0, lng: 0, address: '', region: '알 수 없음' },
              photos: item.photos || [],
              moodTags: item.moodTags || (item as any).mood_tags || [],
              localInsights: item.localInsights || (item as any).local_insights || { recommendedForSolo: '' },
              createdAt: item.createdAt || Date.now(),
              updatedAt: item.updatedAt || Date.now(),
            };

            const existing = diaries.find(d => d.id === normalized.id);
            if (existing) {
              updatedCount++;
            } else {
              addedCount++;
            }
            toSave.push(normalized);
          }

          if (toSave.length > 0) {
            await saveMultipleLocalDiaries(toSave, true);
            const fresh = await getAllLocalDiaries();
            setDiaries(sortDiariesDescending(fresh));
          }

          return { addedCount, updatedCount, total: toSave.length };
        }}
        onResetLocalDb={async () => {
          if (!isAdmin) return;
          try {
            await clearLocalDb();
            localStorage.removeItem('hills_travel_diaries_v4');
            localStorage.removeItem('hills_travel_sync_queue_v4');
            localStorage.removeItem('hills_travel_idb_migrated_v5');
            localStorage.removeItem('hills_blog_diaries_v2');

            setDiaries([]);
            setToastMessage({ text: '로컬 저장소가 초기화되었습니다.', type: 'success' });
            setTimeout(() => setToastMessage(null), 3000);
          } catch (err: any) {
            setToastMessage({ text: `초기화 실패: ${err.message}`, type: 'error' });
          }
        }}
      />

      {(toastMessage || downloadNotification) && (
        <div className={`fixed top-18 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl border flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 max-w-[90vw] ${
          toastMessage?.type === 'error' ? 'bg-rose-950/95 text-rose-200 border-rose-800/80' :
          toastMessage?.type === 'info' ? 'bg-stone-900/95 text-amber-300 border-amber-600/60' :
          'bg-stone-900/95 text-emerald-300 border-emerald-800/60'
        }`}>
          {toastMessage?.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : toastMessage?.type === 'info' ? (
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="truncate">{toastMessage?.text || (isDownloadingFlutter ? 'Flutter 프로젝트 생성 중...' : downloadNotification)}</span>
        </div>
      )}
    </div>
  );
}
