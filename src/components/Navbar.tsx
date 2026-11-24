import React, { useState, useEffect, useRef } from 'react';
import { ViewMode } from '../types';
import { 
  Compass, 
  MapPin, 
  Database,
  BookOpen, 
  Map as MapIcon, 
  Plus, 
  Navigation,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  Menu,
  X,
  Wifi,
  WifiOff,
  RefreshCw,
  KeyRound,
  Clock
} from 'lucide-react';
import { getCurrentGpsPosition, reverseGeocode } from '../utils/geo';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSelector } from './LanguageSelector';
import { useAuth } from '../context/AuthContext';
import { getInitialDisplayVersion, syncDeployedVersion } from '../services/appVersionService';

interface NavbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenNewDiary: () => void;
  onExportData: () => void;
  totalDiariesCount: number;
  serverDiariesCount: number | null;
  isServerOnline: boolean;
  isQuotaExceeded?: boolean;
  isCheckingServer?: boolean;
  onRefreshServerStatus?: () => void;
  onQuickLocate?: (lat: number, lng: number, address: string, region: string) => void;
  onTriggerAutoDiaryNow?: () => Promise<void> | void;
  isAutoDiaryRunning?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  onViewModeChange,
  onOpenNewDiary,
  onExportData,
  totalDiariesCount,
  serverDiariesCount,
  isServerOnline,
  isQuotaExceeded = false,
  isCheckingServer = false,
  onRefreshServerStatus,
  onQuickLocate,
  onTriggerAutoDiaryNow,
  isAutoDiaryRunning = false,
}) => {
  const { t } = useLanguage();
  const {
    isAdmin,
    isLocalEditUnlocked,
    canEditLocal,
    lockLocalEdit,
    currentUser,
    autoDiarySettings,
    updateAutoDiarySettings,
    openLoginModal,
    logout,
  } = useAuth();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [currentGpsInfo, setCurrentGpsInfo] = useState<{ region: string; address: string } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>(() => getInitialDisplayVersion());
  const menuRef = useRef<HTMLDivElement>(null);
  const isOffline = !isServerOnline;
  const isStatusAlert = isOffline || isQuotaExceeded;

  useEffect(() => {
    let active = true;
    syncDeployedVersion().then((resolved) => {
      if (active && resolved) {
        setAppVersion(resolved);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Close hamburger menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleFetchCurrentGps = async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const pos = await getCurrentGpsPosition();
      const info = await reverseGeocode(pos.lat, pos.lng);
      setCurrentGpsInfo({
        region: info.region,
        address: info.address,
      });
      if (onQuickLocate) {
        onQuickLocate(pos.lat, pos.lng, info.address, info.region);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '위치를 확인할 수 없습니다.';
      setGpsError(msg);
      setTimeout(() => setGpsError(null), 4000);
    } finally {
      setGpsLoading(false);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-stone-900/95 text-stone-100 backdrop-blur-md border-b border-stone-800 shadow-md">
      <div className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4">
        {/* Top Bar: Logo, Language, Actions */}
        <div className="flex items-center justify-between h-12 sm:h-14 gap-1.5">
          {/* Logo & Blog Identity */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl overflow-hidden shadow-lg shrink-0 border flex items-center justify-center relative transition-all ${
              isOffline ? 'border-rose-500 ring-2 ring-rose-500/60 shadow-rose-950/50' : 'border-amber-500/30 shadow-amber-900/30'
            }`}>
              <img 
                src="/icon.png" 
                alt="App Icon" 
                className="w-full h-full object-cover" 
              />
              {isOffline && (
                <span className="absolute bottom-0 inset-x-0 bg-rose-600 text-[8px] font-black text-center text-white py-0.2 tracking-wider">
                  OFF
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-xl font-bold tracking-tight text-white flex items-center gap-1.5 truncate">
                  {t('appTitle')}
                </h1>
              </div>
              <p className="text-xs text-stone-400 hidden sm:block">
                {t('appSubtitle')}
              </p>
            </div>
          </div>

          {/* Online Icon + Server Diary Count & Language Selector */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              id="btn-server-status-count"
              type="button"
              onClick={onRefreshServerStatus}
              className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                !isStatusAlert
                  ? 'bg-emerald-950/60 hover:bg-emerald-900/70 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/70 hover:bg-rose-900/70 border-rose-500/50 text-rose-300'
              }`}
              title={
                !isServerOnline
                  ? `오프라인 상태 · 서버 일기 ${serverDiariesCount !== null ? serverDiariesCount : '-'}개 (클릭하여 연결 확인)`
                  : isQuotaExceeded
                    ? `일일 무료 읽기 할당량 초과 (내일 초기화) · 캐시 일기 ${serverDiariesCount !== null ? serverDiariesCount : '-'}개 (클릭하여 재확인)`
                    : `온라인 연결됨 · 서버 일기 ${serverDiariesCount !== null ? serverDiariesCount : '-'}개 (클릭하여 새로고침)`
              }
            >
              {isCheckingServer ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-300 shrink-0" />
              ) : !isServerOnline ? (
                <WifiOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : isQuotaExceeded ? (
                <span className="relative flex items-center justify-center shrink-0">
                  <Wifi className="w-3.5 h-3.5 text-rose-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-rose-400" />
                </span>
              ) : (
                <span className="relative flex items-center justify-center shrink-0">
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </span>
              )}
              <span className="hidden md:inline text-[11px] font-bold">
                {!isServerOnline ? '오프라인' : isQuotaExceeded ? '할당초과' : '온라인'}
              </span>
              <span className="text-stone-500 hidden md:inline">·</span>
              <span
                className={`text-[11px] font-bold font-mono px-1.5 py-0.2 rounded-md ${
                  !isStatusAlert
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-200 border border-rose-500/30'
                }`}
              >
                {serverDiariesCount !== null ? serverDiariesCount : '-'}
              </span>
            </button>

            <LanguageSelector />
          </div>

          {/* Action Buttons: New Diary & Hamburger Menu */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* New Diary Write Button */}
            <button
              id="btn-new-diary-modal"
              type="button"
              onClick={onOpenNewDiary}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all duration-150 cursor-pointer ${
                isStatusAlert
                  ? 'bg-rose-700 hover:bg-rose-600 text-white shadow-rose-950/50 ring-1 ring-rose-500/80'
                  : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40'
              }`}
              title={
                !canEditLocal
                  ? '새 일기 쓰기 (앱 사용 패스워드 또는 관리자 로그인 필요)'
                  : isOffline
                    ? 'Off Mode (오프라인 로컬 일기 등록 가능)'
                    : isQuotaExceeded
                      ? '일일 무료 할당량 초과 (로컬 일기 작성 가능)'
                      : '새 일기 쓰기 (로컬 저장 후 서버 동기화 가능)'
              }
            >
              {isOffline ? (
                <WifiOff className="w-4 h-4 text-rose-200" />
              ) : (
                <Plus className={`w-4 h-4 ${isQuotaExceeded ? 'text-rose-200' : 'text-white'}`} />
              )}
              <span className="hidden sm:inline">
                일기 쓰기
              </span>
              {isOffline && (
                <span className="sm:hidden px-1 rounded text-[9px] font-bold bg-white text-rose-700">
                  OFF
                </span>
              )}
            </button>

            {/* Hamburger Menu Area */}
            <div className="relative" ref={menuRef}>
              <button
                id="btn-hamburger-menu"
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`relative p-2 rounded-xl border transition-all duration-150 flex items-center justify-center cursor-pointer ${
                  isMenuOpen
                    ? 'bg-amber-600/20 border-amber-500/40 text-amber-300 shadow-inner'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white border-stone-700'
                }`}
                title="더보기 메뉴 (백업, 관리자 로그온)"
                aria-expanded={isMenuOpen}
                aria-label="메뉴 열기"
              >
                {isMenuOpen ? (
                  <X className="w-5 h-5 text-amber-400" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
                {/* Admin / Local edit indicator dot on hamburger icon */}
                {(isAdmin || isLocalEditUnlocked) && (
                  <span 
                    className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-2 ring-stone-900 ${
                      isAdmin ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                    title={isAdmin ? '블로그 관리자 로그인 상태' : '앱 사용 패스워드(로컬 편집) 활성화 상태'}
                  />
                )}
              </button>

              {/* Hamburger Dropdown Menu Modal */}
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] max-w-[284px] sm:w-[288px] max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain rounded-2xl bg-stone-900/98 border border-stone-700/90 shadow-2xl backdrop-blur-xl p-2 z-50 text-stone-200">
                  {/* Menu Title Header */}
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-stone-800">
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-amber-400" />
                      여행일기 메뉴
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsMenuOpen(false)}
                      className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition"
                      aria-label="메뉴 닫기"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 1. 관리자 모드 로그온 (블로그 관리자 로그인 / 앱 사용 패스워드 구분) */}
                  <div className="p-2 rounded-xl bg-stone-800/90 border border-stone-700/80 mb-1.5 shadow-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        관리자 모드 로그온
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        isAdmin
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : canEditLocal
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-stone-700/60 text-stone-400'
                      }`}>
                        {isAdmin ? '블로그 관리자' : canEditLocal ? '로컬 편집 허용' : '읽기 전용'}
                      </span>
                    </div>

                    {/* Local & Server Diary Count */}
                    <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-stone-900/50 border border-stone-700/50 text-[11px] gap-1.5">
                      <span className="text-stone-400">로컬 / 서버 일기</span>
                      <div className="flex items-center gap-1.5 font-mono font-bold">
                        <span className="text-amber-400">로컬 {totalDiariesCount}개</span>
                        <span className="text-stone-600">/</span>
                        <span className={isServerOnline ? 'text-emerald-400' : 'text-rose-400'}>
                          서버 {serverDiariesCount !== null ? `${serverDiariesCount}개` : '-'}
                        </span>
                      </div>
                    </div>

                    {/* 1-A. 앱 사용 패스워드 (로컬 추가/수정/삭제 + 자동 위치 일기) */}
                    <div className="p-2 rounded-lg bg-stone-900/60 border border-stone-700/60 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <KeyRound className={`w-3.5 h-3.5 shrink-0 ${canEditLocal ? 'text-amber-400' : 'text-stone-400'}`} />
                          <span className="text-[11px] font-bold text-stone-200 truncate">앱 사용 패스워드</span>
                        </div>
                        <span className={`text-[10px] font-semibold shrink-0 ${canEditLocal ? 'text-amber-300' : 'text-stone-500'}`}>
                          {isLocalEditUnlocked ? '편집 허용됨' : '추가·수정·삭제용'}
                        </span>
                      </div>

                      {isLocalEditUnlocked ? (
                        <div className="space-y-1.5">
                          {/* Auto Location & Auto Diary Settings (앱 사용 패스워드 해제 시에만 표시) */}
                          <div className="p-1.5 rounded-lg bg-stone-800/80 border border-stone-700/70 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-bold text-stone-200 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-emerald-400" />
                                자동 위치·일기 작성
                              </span>
                              <button
                                id="btn-menu-toggle-auto-diary"
                                type="button"
                                onClick={() => updateAutoDiarySettings({ enabled: !autoDiarySettings.enabled })}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition cursor-pointer ${
                                  autoDiarySettings.enabled
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                    : 'bg-stone-700/70 text-stone-400 border-stone-600'
                                }`}
                              >
                                {autoDiarySettings.enabled ? 'ON' : 'OFF'}
                              </button>
                            </div>

                            <div className="flex items-center justify-between gap-1.5 text-[10px] text-stone-300">
                              <div className="flex items-center gap-1">
                                <span className={autoDiarySettings.enabled ? 'text-stone-400' : 'text-stone-500'}>주기</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={240}
                                  disabled={!autoDiarySettings.enabled}
                                  value={autoDiarySettings.intervalMinutes}
                                  onChange={(e) =>
                                    updateAutoDiarySettings({ intervalMinutes: Number(e.target.value) || 60 })
                                  }
                                  className={`w-[66px] px-1.5 py-0.5 rounded bg-stone-900 border text-center !text-xs font-bold focus:outline-none ${
                                    autoDiarySettings.enabled
                                      ? 'border-stone-600 text-amber-300'
                                      : 'border-stone-700/60 text-stone-500 opacity-50 cursor-not-allowed'
                                  }`}
                                />
                                <span className={autoDiarySettings.enabled ? '' : 'text-stone-500'}>분</span>
                              </div>
                              {onTriggerAutoDiaryNow && (
                                <button
                                  id="btn-menu-run-auto-diary-now"
                                  type="button"
                                  disabled={!autoDiarySettings.enabled || isAutoDiaryRunning}
                                  onClick={() => onTriggerAutoDiaryNow()}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                                    autoDiarySettings.enabled
                                      ? 'bg-amber-600/80 hover:bg-amber-500 text-white disabled:opacity-50 cursor-pointer'
                                      : 'bg-stone-700/50 text-stone-500 border border-stone-700/70 opacity-60 cursor-not-allowed'
                                  }`}
                                >
                                  {isAutoDiaryRunning ? '확인 중...' : '지금 기록'}
                                </button>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {[5, 10, 15, 30, 60, 120].map((mins) => (
                                <button
                                  key={mins}
                                  type="button"
                                  disabled={!autoDiarySettings.enabled}
                                  onClick={() => updateAutoDiarySettings({ intervalMinutes: mins })}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                                    !autoDiarySettings.enabled
                                      ? 'bg-stone-900/50 text-stone-500 border-stone-700/60 opacity-50 cursor-not-allowed'
                                      : autoDiarySettings.intervalMinutes === mins
                                        ? 'bg-amber-600 text-white border-amber-500 cursor-pointer'
                                        : 'bg-stone-900/80 text-stone-400 border-stone-700 hover:text-stone-200 hover:bg-stone-700/70 cursor-pointer'
                                  }`}
                                >
                                  {mins}
                                </button>
                              ))}
                            </div>

                            {(autoDiarySettings.enabled || autoDiarySettings.lastAutoDiaryAt) && (
                              <div className="text-[9px] text-stone-400 flex items-center justify-between pt-0.5">
                                {autoDiarySettings.enabled && autoDiarySettings.nextAutoDiaryAt ? (
                                  <span className="text-emerald-400/90">
                                    다음 자동 확인:{' '}
                                    {`${String(new Date(autoDiarySettings.nextAutoDiaryAt).getHours()).padStart(2, '0')}:${String(
                                      new Date(autoDiarySettings.nextAutoDiaryAt).getMinutes()
                                    ).padStart(2, '0')}`}
                                  </span>
                                ) : (
                                  <span>자동 작성 꺼짐</span>
                                )}
                                {autoDiarySettings.lastAutoDiaryAt && (
                                  <span>
                                    최근{' '}
                                    {`${String(new Date(autoDiarySettings.lastAutoDiaryAt).getHours()).padStart(2, '0')}:${String(
                                      new Date(autoDiarySettings.lastAutoDiaryAt).getMinutes()
                                    ).padStart(2, '0')}`}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <button
                            id="btn-menu-lock-local"
                            type="button"
                            onClick={async () => {
                              await lockLocalEdit();
                              setIsMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-stone-700/70 hover:bg-rose-950/60 hover:text-rose-300 text-stone-300 text-[11px] font-semibold border border-stone-600/80 transition cursor-pointer"
                          >
                            <Lock className="w-3.5 h-3.5 text-amber-400" />
                            <span>{isAdmin ? '로컬 편집 잠금 (관리자 로그아웃)' : '로컬 편집 잠금'}</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          id="btn-menu-local-passcode"
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            openLoginModal(undefined, 'local');
                          }}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold shadow-sm shadow-amber-900/30 transition cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>앱 사용 패스워드 입력</span>
                        </button>
                      )}
                    </div>

                    {/* 1-B. 블로그 관리자 로그인 (앱 사용 패스워드 해제 시에만 표시) */}
                    {isLocalEditUnlocked && (
                      <div className="p-2 rounded-lg bg-stone-900/60 border border-stone-700/60 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <ShieldCheck
                              className={`w-3.5 h-3.5 shrink-0 ${
                                currentUser ? 'text-emerald-400' : 'text-stone-400'
                              }`}
                            />
                            <span className="text-[11px] font-bold text-stone-200 truncate">블로그 관리자 로그인</span>
                          </div>
                          <span
                            className={`text-[10px] font-semibold shrink-0 ${
                              currentUser ? 'text-emerald-400' : 'text-stone-500'
                            }`}
                          >
                            {currentUser ? 'Google 인증됨' : '서버 동기화용'}
                          </span>
                        </div>

                        {currentUser ? (
                          <button
                            id="btn-menu-logout"
                            type="button"
                            onClick={() => {
                              logout();
                              setIsMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-stone-700/70 hover:bg-rose-950/60 hover:text-rose-300 text-stone-300 text-[11px] font-semibold border border-stone-600/80 transition cursor-pointer"
                          >
                            <LogOut className="w-3.5 h-3.5 text-rose-400" />
                            <span>블로그 관리자 로그아웃</span>
                          </button>
                        ) : (
                          <button
                            id="btn-menu-login"
                            type="button"
                            onClick={() => {
                              setIsMenuOpen(false);
                              openLoginModal(undefined, 'admin');
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-stone-700 hover:bg-stone-600 text-white text-[11px] font-bold border border-stone-600 transition cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span>블로그 관리자 로그인 (Google)</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 1.5. 실시간 내 위치 확인 (새로 이동됨) */}
                  <div className="p-2 rounded-xl bg-stone-800/60 border border-stone-700/60 mb-1.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                        실시간 내 위치 확인
                      </span>
                    </div>
                    {currentGpsInfo ? (
                      <div className="flex items-center gap-2 p-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] text-emerald-300 font-bold truncate">{currentGpsInfo.region}</p>
                          <p className="text-[10px] text-emerald-400/80 truncate">{currentGpsInfo.address}</p>
                        </div>
                        <button 
                          onClick={handleFetchCurrentGps}
                          disabled={gpsLoading}
                          className="ml-auto p-1 rounded-lg bg-emerald-900/50 hover:bg-emerald-800 text-emerald-400 transition"
                        >
                          {gpsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleFetchCurrentGps}
                        disabled={gpsLoading}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-stone-700 hover:bg-stone-600 text-white text-xs font-bold transition disabled:opacity-50"
                      >
                        {gpsLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                        ) : (
                          <Navigation className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        <span>{gpsLoading ? '위치 확인 중...' : '현재 위치 확인하기'}</span>
                      </button>
                    )}
                    {gpsError && (
                      <p className="text-[10px] text-rose-400 mt-1 px-1">{gpsError}</p>
                    )}
                  </div>

                  {/* 2. Menu Action Items List */}
                  <div className="space-y-1">
                    {/* 데이터 관리 (백업 및 가져오기) */}
                    <button
                      id="btn-menu-export-backup"
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onExportData();
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                    >
                      <div className="w-7 h-7 rounded-lg bg-stone-800 group-hover:bg-amber-600/20 flex items-center justify-center text-amber-400 border border-stone-700 group-hover:border-amber-500/40 transition shrink-0">
                        <Database className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white group-hover:text-amber-300 transition">
                          데이터 관리 (백업 및 가져오기)
                        </p>
                        <p className="text-[10px] text-stone-400 truncate">
                          전체 백업 다운로드 / JSON 파일 가져오기
                        </p>
                      </div>
                    </button>
                  </div>

                  {/* 앱 버전 정보 */}
                  <div className="mt-1.5 pt-1.5 border-t border-stone-800 flex items-center justify-between gap-2 px-1 text-[10px] text-stone-400 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <span>앱버전</span>
                      <span className="font-mono font-semibold text-stone-300">{appVersion}</span>
                    </span>
                    <span className="font-mono font-semibold text-stone-300">{__APP_BUILD_TIME__}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* View Switcher Sub-bar */}
        <div className="flex items-center justify-between pb-1.5 pt-1 border-t border-stone-800/60 overflow-x-auto gap-2">
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              id="nav-view-blog"
              type="button"
              onClick={() => onViewModeChange('blog')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                viewMode === 'blog'
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30 font-semibold'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>{t('tabBlog')}</span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-stone-800 text-stone-400">
                {totalDiariesCount}
              </span>
            </button>

            <button
              id="nav-view-map"
              type="button"
              onClick={() => onViewModeChange('map')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                viewMode === 'map'
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30 font-semibold'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
              }`}
            >
              <MapIcon className="w-4 h-4" />
              <span>{t('tabMap')}</span>
            </button>
          </nav>

          {/* Mobile GPS Tracker indicator (compact) */}
          <div className="md:hidden flex items-center gap-1.5">
            {/* Mobile GPS trigger moved to menu */}
          </div>
        </div>
      </div>
    </header>
  );
};
