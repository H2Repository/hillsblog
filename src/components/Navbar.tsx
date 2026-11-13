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
  Eye,
  Menu,
  X,
  Wifi,
  WifiOff,
  RefreshCw,
  Smartphone,
  Share2,
  PlusSquare,
  Check
} from 'lucide-react';
import { getCurrentGpsPosition, reverseGeocode } from '../utils/geo';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSelector } from './LanguageSelector';
import { useAuth } from '../context/AuthContext';
import { FlutterIcon } from './FlutterIcon';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface NavbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenNewDiary: () => void;
  onExportData: () => void;
  totalDiariesCount: number;
  serverDiariesCount: number | null;
  isServerOnline: boolean;
  isCheckingServer?: boolean;
  onRefreshServerStatus?: () => void;
  totalViewsCount?: number;
  visitorLogsCount?: number;
  onOpenVisitorModal?: () => void;
  onOpenFlutterCode: () => void;
  onQuickLocate?: (lat: number, lng: number, address: string, region: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  onViewModeChange,
  onOpenNewDiary,
  onExportData,
  totalDiariesCount,
  serverDiariesCount,
  isServerOnline,
  isCheckingServer = false,
  onRefreshServerStatus,
  totalViewsCount,
  onOpenVisitorModal,
  onOpenFlutterCode,
  onQuickLocate,
}) => {
  const { t } = useLanguage();
  const { isAdmin, currentUser, openLoginModal, logout } = useAuth();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [currentGpsInfo, setCurrentGpsInfo] = useState<{ region: string; address: string } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOffline = !isServerOnline;
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showPWAInstallGuide, setShowPWAInstallGuide] = useState(false);

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
    <header className="sticky top-0 z-40 bg-stone-900/95 text-stone-100 backdrop-blur-md border-b border-stone-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Bar: Logo, Language, Actions */}
        <div className="flex items-center justify-between h-18">
          {/* Logo & Blog Identity */}
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl overflow-hidden shadow-lg shrink-0 border flex items-center justify-center relative transition-all ${
              isOffline ? 'border-rose-500 ring-2 ring-rose-500/60 shadow-rose-950/50' : 'border-amber-500/30 shadow-amber-900/30'
            }`}>
              <img 
                src="assets/aistudio/bicycle_journey_icon.png" 
                alt="App Icon" 
                className="w-full h-full object-cover" 
              />
              {isOffline && (
                <span className="absolute bottom-0 inset-x-0 bg-rose-600 text-[8px] font-black text-center text-white py-0.2 tracking-wider">
                  OFF
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                  {t('appTitle')}
                </h1>
              </div>
              <p className="text-xs text-stone-400 hidden sm:block">
                {t('appSubtitle')}
              </p>
            </div>
          </div>

          {/* Online Icon + Server Diary Count & Language Selector */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              id="btn-server-status-count"
              type="button"
              onClick={onRefreshServerStatus}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                isServerOnline
                  ? 'bg-emerald-950/60 hover:bg-emerald-900/70 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/70 hover:bg-rose-900/70 border-rose-500/50 text-rose-300'
              }`}
              title={
                isServerOnline
                  ? `온라인 연결됨 · 서버 일기 ${serverDiariesCount !== null ? serverDiariesCount : '-'}개 (클릭하여 새로고침)`
                  : `오프라인 상태 · 서버 일기 ${serverDiariesCount !== null ? serverDiariesCount : '-'}개 (클릭하여 연결 확인)`
              }
            >
              {isCheckingServer ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-300 shrink-0" />
              ) : isServerOnline ? (
                <span className="relative flex items-center justify-center shrink-0">
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </span>
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              )}
              <span className="hidden md:inline text-[11px] font-bold">
                {isServerOnline ? '온라인' : '오프라인'}
              </span>
              <span className="text-stone-500 hidden md:inline">·</span>
              <span
                className={`text-[11px] font-bold font-mono px-1.5 py-0.2 rounded-md ${
                  isServerOnline
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
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* New Diary Write Button */}
            <button
              id="btn-new-diary-modal"
              type="button"
              onClick={() => {
                if (isAdmin) {
                  onOpenNewDiary();
                } else {
                  openLoginModal('새 일기 작성은 관리자만 가능합니다. 로그인해주세요.');
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all duration-150 cursor-pointer ${
                isOffline
                  ? 'bg-rose-700 hover:bg-rose-600 text-white shadow-rose-950/50 ring-1 ring-rose-500/80'
                  : isAdmin
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700'
              }`}
              title={isOffline ? 'Off Mode (오프라인 일기 작성)' : isAdmin ? '새 일기 쓰기' : '새 일기 쓰기 (관리자 로그인 필요)'}
            >
              {isOffline ? (
                <WifiOff className="w-4 h-4 text-rose-200" />
              ) : (
                <Plus className="w-4 h-4 text-amber-400" />
              )}
              <span className="hidden sm:inline">
                {isOffline ? '일기 쓰기' : isAdmin ? '일기 쓰기' : '일기쓰기'}
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
                title="더보기 메뉴 (Flutter 다운로드, 백업, 관리자 로그온)"
                aria-expanded={isMenuOpen}
                aria-label="메뉴 열기"
              >
                {isMenuOpen ? (
                  <X className="w-5 h-5 text-amber-400" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
                {/* Admin indicator dot on hamburger icon */}
                {currentUser && (
                  <span 
                    className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-stone-900" 
                    title="관리자 로그인 상태"
                  />
                )}
              </button>

              {/* Hamburger Dropdown Menu Modal */}
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-[calc(100vw-1.5rem)] max-w-xs sm:w-80 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain rounded-2xl bg-stone-900/98 border border-stone-700/90 shadow-2xl backdrop-blur-xl p-3 z-50 text-stone-200">
                  {/* Menu Title Header */}
                  <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-stone-800">
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

                  {/* 1. 관리자 로그온 / 로그아웃 섹션 */}
                  <div className="p-3 rounded-xl bg-stone-800/90 border border-stone-700/80 mb-2.5 shadow-xs">
                    {currentUser ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-white truncate">
                                {currentUser.displayName || '관리자'}
                              </p>
                              <p className="text-[10px] text-stone-400 truncate">
                                {currentUser.email}
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold shrink-0 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-amber-400" />
                            관리자
                          </span>
                        </div>
                        
                        {/* Local & Server Diary Count */}
                        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-stone-900/50 border border-stone-700/50 text-[11px] gap-2">
                          <span className="text-stone-400">로컬 / 서버 일기</span>
                          <div className="flex items-center gap-1.5 font-mono font-bold">
                            <span className="text-amber-400">로컬 {totalDiariesCount}개</span>
                            <span className="text-stone-600">/</span>
                            <span className={isServerOnline ? 'text-emerald-400' : 'text-rose-400'}>
                              서버 {serverDiariesCount !== null ? `${serverDiariesCount}개` : '-'}
                            </span>
                          </div>
                        </div>

                        <button
                          id="btn-menu-logout"
                          type="button"
                          onClick={() => {
                            logout();
                            setIsMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-stone-700/70 hover:bg-rose-950/60 hover:text-rose-300 text-stone-300 text-xs font-semibold border border-stone-600/80 transition cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5 text-rose-400" />
                          <span>관리자 로그아웃</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-amber-400" />
                            관리자 모드
                          </span>
                          <span className="text-[10px] text-stone-400 bg-stone-700/50 px-2 py-0.5 rounded-full">
                            읽기 전용
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-400 leading-snug">
                          일기 작성, 수정, 삭제 및 관리자 기능을 사용하려면 로그인하세요.
                        </p>
                        <button
                          id="btn-menu-login"
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            openLoginModal();
                          }}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md shadow-amber-900/30 transition cursor-pointer"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>관리자 로그온</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 1.5. 실시간 내 위치 확인 (새로 이동됨) */}
                  <div className="p-3 rounded-xl bg-stone-800/60 border border-stone-700/60 mb-2.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                        실시간 내 위치 확인
                      </span>
                    </div>
                    {currentGpsInfo ? (
                      <div className="flex items-center gap-2.5 p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] text-emerald-300 font-bold truncate">{currentGpsInfo.region}</p>
                          <p className="text-[10px] text-emerald-400/80 truncate">{currentGpsInfo.address}</p>
                        </div>
                        <button 
                          onClick={handleFetchCurrentGps}
                          disabled={gpsLoading}
                          className="ml-auto p-1.5 rounded-lg bg-emerald-900/50 hover:bg-emerald-800 text-emerald-400 transition"
                        >
                          {gpsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleFetchCurrentGps}
                        disabled={gpsLoading}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-stone-700 hover:bg-stone-600 text-white text-xs font-bold transition disabled:opacity-50"
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
                      <p className="text-[10px] text-rose-400 mt-1.5 px-1">{gpsError}</p>
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
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                    >
                      <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-amber-600/20 flex items-center justify-center text-amber-400 border border-stone-700 group-hover:border-amber-500/40 transition shrink-0">
                        <Database className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white group-hover:text-amber-300 transition">
                          데이터 관리 (백업 및 가져오기)
                        </p>
                        <p className="text-[11px] text-stone-400 truncate">
                          전체 백업 다운로드 / JSON 파일 가져오기
                        </p>
                      </div>
                    </button>

                    {/* 홈 화면에 앱 설치하기 (PWA) */}
                    {!isInstalled && (
                      <button
                        id="btn-menu-pwa-install"
                        type="button"
                        onClick={() => {
                          if (isInstallable) {
                            setIsMenuOpen(false);
                            install();
                          } else {
                            setShowPWAInstallGuide(true);
                          }
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-amber-600/20 flex items-center justify-center text-amber-400 border border-stone-700 group-hover:border-amber-500/40 transition shrink-0">
                          <Smartphone className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className="text-xs font-bold text-white group-hover:text-amber-300 transition">
                              홈 화면에 앱 설치하기
                            </p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                              오프라인 지원
                            </span>
                          </div>
                          <p className="text-[11px] text-stone-400 truncate">
                            스마트폰 홈 화면에 추가하여 인터넷 없이도 바로 실행
                          </p>
                        </div>
                      </button>
                    )}

                    {/* 관리자 전용: Flutter 모바일 앱 다운로드 */}
                    {isAdmin && (
                      <button
                        id="btn-menu-flutter-download"
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onOpenFlutterCode();
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-sky-600/20 flex items-center justify-center text-sky-400 border border-stone-700 group-hover:border-sky-500/40 transition shrink-0">
                          <FlutterIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white group-hover:text-sky-300 transition">
                            Flutter 모바일 앱 다운로드
                          </p>
                          <p className="text-[11px] text-stone-400 truncate">
                            Android / iOS 네이티브 앱 소스 및 설치 안내
                          </p>
                        </div>
                      </button>
                    )}

                    {/* Admin-only: Visitor Location Modal trigger */}
                    {isAdmin && onOpenVisitorModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onOpenVisitorModal();
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-emerald-600/20 flex items-center justify-center text-emerald-400 border border-stone-700 group-hover:border-emerald-500/40 transition shrink-0">
                          <Eye className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white group-hover:text-emerald-300 transition">
                            방문자 통계 및 접속 위치
                          </p>
                          <p className="text-[11px] text-stone-400 truncate">
                            총 {(totalViewsCount || 0).toLocaleString()}회 조회 / 접속 지역 지도
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* View Switcher Sub-bar */}
        <div className="flex items-center justify-between pb-3 pt-1 border-t border-stone-800/60 overflow-x-auto gap-2">
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



            {/* Total Visitor Reads & Location Indicator (Admin Only) */}
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenVisitorModal}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-800/80 hover:bg-sky-950/60 border border-stone-700/80 hover:border-sky-500/50 text-xs text-stone-300 hover:text-sky-300 ml-2 transition cursor-pointer"
                title="방문자 위치 현황 및 접속 통계 열기"
              >
                <Eye className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold text-sky-300 font-mono">
                  {(totalViewsCount || 0).toLocaleString()}
                </span>
                <span className="text-stone-400 text-[11px]">
                  {t('diaryViewLabel')}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30">
                  위치확인
                </span>
              </button>
            )}
          </nav>

          {/* Mobile GPS Tracker indicator (compact) */}
          <div className="md:hidden flex items-center gap-1.5">
            {/* Mobile GPS trigger moved to menu */}
          </div>
        </div>
      </div>

      {/* PWA Home Screen Installation Guide Modal */}
      {showPWAInstallGuide && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/70 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setShowPWAInstallGuide(false)}
        >
          <div 
            className="relative w-full max-w-sm bg-stone-900 text-stone-100 rounded-2xl shadow-2xl border border-stone-800 p-5 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-stone-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {isIOS ? 'iPhone / iPad 앱 설치' : '홈 화면에 앱 설치'}
                  </h3>
                  <p className="text-[11px] text-stone-400">인터넷 없이도 바로 실행 가능</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPWAInstallGuide(false)}
                className="p-1.5 text-stone-400 hover:text-white rounded-lg hover:bg-stone-800 transition cursor-pointer"
                aria-label="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-3 text-xs text-stone-300">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-stone-800/60 border border-stone-700/60">
                  <div className="p-1.5 rounded-lg bg-stone-700 text-sky-400 shrink-0 mt-0.5">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-white mb-0.5">1. Safari 공유 버튼 누르기</p>
                    <p className="text-stone-400 leading-relaxed">
                      화면 하단(또는 상단)의 <strong>공유 아이콘(네모 위 화살표)</strong>을 탭합니다.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-stone-800/60 border border-stone-700/60">
                  <div className="p-1.5 rounded-lg bg-stone-700 text-amber-400 shrink-0 mt-0.5">
                    <PlusSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-white mb-0.5">2. '홈 화면에 추가' 선택</p>
                    <p className="text-stone-400 leading-relaxed">
                      메뉴를 아래로 스크롤하여 <strong>'홈 화면에 추가'</strong>를 누르고 우측 상단 <strong>'추가'</strong>를 누릅니다.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>홈 화면에 앱 아이콘이 생성되어 인터넷 없이도 바로 열립니다!</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-stone-300">
                <div className="p-3 rounded-xl bg-stone-800/60 border border-stone-700/60 space-y-2">
                  <p className="font-bold text-white">Chrome / Whale / 삼성인터넷 설치 방법</p>
                  <p className="text-stone-400 leading-relaxed">
                    브라우저 우측 상단의 <strong>더보기(점 3개)</strong> 메뉴를 누른 후 <strong>'앱 설치'</strong> 또는 <strong>'홈 화면에 추가'</strong>를 선택해주세요.
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>홈 화면에 아이콘이 추가되면 독립 앱으로 실행됩니다.</span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowPWAInstallGuide(false)}
              className="mt-4 w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-md transition cursor-pointer"
            >
              확인 완료
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
