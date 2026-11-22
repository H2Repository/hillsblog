import React, { useState, useEffect, useRef } from 'react';
import { DiaryEntry } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { getLocalizedDiary } from '../utils/translationService';
import { hasKorean, translateDiaryAsync } from '../utils/translationService';
import L from 'leaflet';
import { 
  X, 
  MapPin, 
  Calendar, 
  Clock, 
  Star, 
  Sun, 
  Cloud, 
  CloudRain, 
  Snowflake, 
  Wind, 
  Share2, 
  Edit3, 
  Trash2, 
  ExternalLink,
  Sparkles, 
  Map as MapIcon, 
  Check, 
  Compass,
  Languages,
  Loader2,
  Camera,
  CloudOff,
  CheckCircle2,
  RefreshCw,
  Upload
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ServerDiarySyncStatus } from '../services/diaryCloudSql';
import { filterValidPhotos } from '../utils/storage';
import { useDisplayImageUrl } from '../utils/imageDisplay';

const DetailHeroImage: React.FC<{
  src: string;
  alt: string;
  onError: () => void;
}> = ({ src, alt, onError }) => {
  const displayUrl = useDisplayImageUrl(src, 1280, 0.82);
  if (!displayUrl) {
    return <div className="w-full h-full bg-stone-800 animate-pulse" />;
  }
  return (
    <img
      src={displayUrl}
      alt={alt}
      className="w-full h-full object-cover group-hover:scale-102 transition duration-500"
      decoding="async"
      onError={onError}
    />
  );
};

const DetailThumbImage: React.FC<{
  src: string;
  onError: () => void;
}> = ({ src, onError }) => {
  const displayUrl = useDisplayImageUrl(src, 160, 0.7);
  if (!displayUrl) {
    return <div className="w-full h-full bg-stone-200 animate-pulse" />;
  }
  return (
    <img
      src={displayUrl}
      alt=""
      className="w-full h-full object-cover"
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
};

interface DiaryDetailModalProps {
  diary: DiaryEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (diary: DiaryEntry) => void;
  onDelete: (diary: DiaryEntry) => void;
  onViewOnMap: (diary: DiaryEntry) => void;
  onOpenPhotoLightbox: (photos: DiaryEntry['photos'], index: number) => void;
  serverStatus?: ServerDiarySyncStatus;
  isUploadingToServer?: boolean;
  onUploadToServer?: (diary: DiaryEntry) => void;
  onNextDiary?: () => void;
  onPrevDiary?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export const DiaryDetailModal: React.FC<DiaryDetailModalProps> = ({
  diary,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onViewOnMap,
  onOpenPhotoLightbox,
  serverStatus = 'not_on_server',
  isUploadingToServer = false,
  onUploadToServer,
  onNextDiary,
  onPrevDiary,
  hasNext = false,
  hasPrev = false,
}) => {
  const { t, language } = useLanguage();
  const { canEditLocal } = useAuth();
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [asyncDiary, setAsyncDiary] = useState<DiaryEntry | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<string, boolean>>({});
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    setShowOriginal(false);
    setFailedPhotoIds({});
  }, [diary?.id, isOpen]);

  useEffect(() => {
    if (!isOpen || !diary || language === 'ko' || showOriginal) {
      setAsyncDiary(null);
      setIsTranslating(false);
      return;
    }

    // Immediate localized diary from curated DIARY_TRANSLATIONS, cache, or dictionary phrases/tags
    const localized = getLocalizedDiary(diary, language);
    setAsyncDiary(localized);

    // If still containing untranslated Korean text in title, content, or insights, run background translator
    const needsTranslation =
      hasKorean(localized.title) ||
      hasKorean(localized.content) ||
      hasKorean(localized.localInsights.recommendedForSolo) ||
      (localized.localInsights.localFood ? hasKorean(localized.localInsights.localFood) : false) ||
      (localized.localInsights.transportTip ? hasKorean(localized.localInsights.transportTip) : false) ||
      (localized.localInsights.soloTravelTip ? hasKorean(localized.localInsights.soloTravelTip) : false);

    if (needsTranslation) {
      setIsTranslating(true);
      let isCancelled = false;

      translateDiaryAsync(diary, language)
        .then((content) => {
          if (!isCancelled) {
            setAsyncDiary({
              ...diary,
              title: content.title,
              content: content.content,
              location: {
                ...diary.location,
                region: content.region || diary.location.region,
                landmark: content.landmark ?? diary.location.landmark,
                address: content.address ?? diary.location.address,
              },
              moodTags: content.moodTags,
              localInsights: {
                ...diary.localInsights,
                recommendedForSolo: content.recommendedForSolo,
                localFood: content.localFood ?? diary.localInsights.localFood,
                transportTip: content.transportTip ?? diary.localInsights.transportTip,
                soloTravelTip: content.soloTravelTip ?? diary.localInsights.soloTravelTip,
              },
            });
          }
        })
        .catch((err) => console.warn('Online translation error:', err))
        .finally(() => {
          if (!isCancelled) setIsTranslating(false);
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [isOpen, diary, language, showOriginal]);

  useEffect(() => {
    if (!isOpen || !diary) return;

    let resizeObserver: ResizeObserver | null = null;
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapContainerRef.current, {
        center: [diary.location.lat, diary.location.lng],
        zoom: 14,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'detail-map-pin',
        html: `
          <div class="w-7 h-7 rounded-full bg-amber-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs">
            📍
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });

      L.marker([diary.location.lat, diary.location.lng], { icon: pinIcon }).addTo(map);
      mapInstanceRef.current = map;

      setTimeout(() => {
        map.invalidateSize();
      }, 100);

      if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          map.invalidateSize();
        });
        resizeObserver.observe(mapContainerRef.current);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      if (resizeObserver) resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen, diary]);

  if (!isOpen || !diary) return null;

  // Localized diary representation according to language and toggle
  const displayDiary = (showOriginal || language === 'ko')
    ? diary
    : (asyncDiary || getLocalizedDiary(diary, language));

  const weatherIcons: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    sunny: { label: t('editorWeatherSunny'), icon: Sun },
    cloudy: { label: t('editorWeatherCloudy'), icon: Cloud },
    rainy: { label: t('editorWeatherRainy'), icon: CloudRain },
    snowy: { label: 'Snow', icon: Snowflake },
    windy: { label: t('editorWeatherWindy'), icon: Wind },
    foggy: { label: 'Fog', icon: Cloud },
  };

  const WeatherIcon = weatherIcons[displayDiary.weather]?.icon || Sun;
  const validPhotos = filterValidPhotos(displayDiary.photos).filter((p) => !failedPhotoIds[p.id]);
  const coverPhoto = validPhotos.find((p) => p.isCover) || validPhotos[0];
  const coverIndex = coverPhoto ? Math.max(0, validPhotos.findIndex((p) => p.id === coverPhoto.id)) : 0;

  const handleShare = () => {
    const text = `[${t('appTitle')}] ${displayDiary.title}\n📍 ${displayDiary.location.region} (${displayDiary.date})\n\n"${displayDiary.content.slice(0, 100)}..."`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden my-auto max-h-[95dvh] flex flex-col">
        {/* Header bar */}
        <div className="px-3 sm:px-6 py-2.5 sm:py-3.5 bg-stone-900 text-white flex items-center justify-between border-b border-stone-800 gap-2">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="text-xs px-2 sm:px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30 truncate max-w-[120px] sm:max-w-none">
              {displayDiary.location.region}
            </span>
            <span className="text-[11px] sm:text-xs text-stone-400">
              {displayDiary.date} <span className="hidden xs:inline">{displayDiary.time}</span>
            </span>

            {/* Translation status badge and original toggle */}
            {language !== 'ko' && (
              <button
                type="button"
                onClick={() => setShowOriginal(!showOriginal)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition cursor-pointer"
                title={showOriginal ? t('btnViewTranslated') : t('btnViewOriginal')}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{showOriginal ? t('btnViewTranslated') : t('btnViewOriginal')}</span>
                <span className="text-[10px] px-1 rounded bg-amber-500/30">
                  {showOriginal ? t('originalBadge') : t('translatedBadge')}
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {language !== 'ko' && (
              <button
                type="button"
                onClick={() => setShowOriginal(!showOriginal)}
                className="sm:hidden p-1.5 rounded-lg text-amber-400 hover:text-white bg-amber-950/60 border border-amber-500/40 transition text-xs flex items-center gap-1"
                title={showOriginal ? t('btnViewTranslated') : t('btnViewOriginal')}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{showOriginal ? t('originalBadge') : t('translatedBadge')}</span>
              </button>
            )}

            {/* Per-diary Server Status & Add/Update Button */}
            {onUploadToServer && (
              <button
                type="button"
                onClick={() => onUploadToServer(diary)}
                disabled={isUploadingToServer}
                className={`px-2 py-1 rounded-lg border text-xs font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-60 ${
                  serverStatus === 'not_on_server'
                    ? 'bg-rose-600/25 hover:bg-rose-600/40 text-rose-300 border-rose-500/60'
                    : serverStatus === 'needs_update'
                      ? 'bg-amber-500/25 hover:bg-amber-500/40 text-amber-300 border-amber-500/60'
                      : 'bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border-emerald-500/50'
                }`}
                title={
                  serverStatus === 'not_on_server'
                    ? '서버 미등록 - 클릭하여 서버에 추가'
                    : serverStatus === 'needs_update'
                      ? '수정됨 - 클릭하여 서버에 업데이트'
                      : '서버에 추가/업데이트 완료됨'
                }
              >
                {isUploadingToServer ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : serverStatus === 'not_on_server' ? (
                  <CloudOff className="w-3.5 h-3.5 text-rose-400" />
                ) : serverStatus === 'needs_update' ? (
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span className="text-[11px] sm:text-xs">
                  {isUploadingToServer
                    ? '전송 중'
                    : serverStatus === 'not_on_server'
                      ? '미등록'
                      : serverStatus === 'needs_update'
                        ? '수정됨'
                        : '서버됨'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleShare}
              className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition text-xs flex items-center gap-1"
              title={t('btnShare')}
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? t('btnShared') : t('btnShare')}</span>
            </button>

            {/* Local actions: Edit & Delete (require app passcode or admin login) */}
            <button
              type="button"
              onClick={() => onEdit(diary)}
              className={`p-1.5 rounded-lg transition text-xs flex items-center gap-1 cursor-pointer ${
                canEditLocal
                  ? 'text-stone-400 hover:text-white hover:bg-stone-800'
                  : 'text-stone-500 hover:text-amber-300 hover:bg-stone-800'
              }`}
              title={canEditLocal ? t('cardEdit') : '수정 (앱 사용 패스워드 또는 관리자 로그인 필요)'}
            >
              <Edit3 className="w-4 h-4" />
              <span className="hidden sm:inline">{t('cardEdit')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onDelete(diary);
              }}
              className={`p-1.5 rounded-lg transition text-xs cursor-pointer ${
                canEditLocal
                  ? 'text-stone-400 hover:text-rose-400 hover:bg-stone-800'
                  : 'text-stone-500 hover:text-amber-300 hover:bg-stone-800'
              }`}
              title={canEditLocal ? t('cardDelete') : '삭제 (앱 사용 패스워드 또는 관리자 로그인 필요)'}
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-stone-700 mx-1" />

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Reader Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Main Cover Image */}
          {coverPhoto && (
            <div
              className="relative w-full h-72 sm:h-96 bg-stone-900 cursor-pointer overflow-hidden group"
              onClick={() => onOpenPhotoLightbox(validPhotos, coverIndex)}
            >
              <DetailHeroImage
                src={coverPhoto.url}
                alt={coverPhoto.caption || displayDiary.title}
                onError={() =>
                  setFailedPhotoIds((prev) => ({ ...prev, [coverPhoto.id]: true }))
                }
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-transparent to-black/20" />

              {/* Photo Count badge */}
              <div className="absolute top-4 right-4 bg-stone-900/80 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-full border border-white/20 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-amber-300" />
                <span>{t('totalPhotosCount', { count: Math.max(displayDiary.totalPhotosCount || 0, validPhotos.length) })}</span>
              </div>

              {/* Cover Caption */}
              {coverPhoto.caption && (
                <div className="absolute bottom-4 left-6 right-6 text-xs text-stone-200 bg-stone-900/60 backdrop-blur-sm px-3.5 py-1.5 rounded-lg max-w-max">
                  📷 {coverPhoto.caption}
                </div>
              )}
            </div>
          )}

          {/* Photo Thumbnail Strip if multiple photos */}
          {validPhotos.length > 1 && (
            <div className="px-6 py-3 bg-stone-100/70 border-b border-stone-200 flex items-center gap-2.5 overflow-x-auto">
              {validPhotos.map((photo, idx) => (
                <button
                  key={photo.id || idx}
                  type="button"
                  onClick={() => onOpenPhotoLightbox(validPhotos, idx)}
                  className="w-16 h-16 rounded-xl overflow-hidden border-2 border-white shadow-sm shrink-0 hover:opacity-90 hover:scale-105 transition cursor-pointer"
                  title={photo.caption || `사진 ${idx + 1}`}
                >
                  <DetailThumbImage
                    src={photo.url}
                    onError={() =>
                      setFailedPhotoIds((prev) => ({ ...prev, [photo.id]: true }))
                    }
                  />
                </button>
              ))}
            </div>
          )}

          {/* Diary Body Content */}
          <div className="p-6 sm:p-8 space-y-6">
            {/* Title & Metadata row */}
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-2">
                <span className="flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                  <MapPin className="w-3.5 h-3.5" />
                  {displayDiary.location.region}
                </span>

                <span className="flex items-center gap-1">
                  <WeatherIcon className="w-3.5 h-3.5 text-amber-600" />
                  {weatherIcons[displayDiary.weather]?.label}
                </span>

                <span>•</span>

                <div className="flex items-center">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`w-3.5 h-3.5 ${
                        s <= displayDiary.rating
                          ? 'text-amber-500 fill-amber-500'
                          : 'text-stone-300'
                      }`}
                    />
                  ))}
                </div>

                {displayDiary.location.isRealtimeGps && (
                  <span className="ml-auto text-[11px] text-emerald-600 font-medium flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded">
                    🟢 {t('realtimeGpsLinked')}
                  </span>
                )}
              </div>

              {/* Translation notice */}
              {language !== 'ko' && !showOriginal && (
                <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 rounded-full mb-2">
                  {isTranslating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                      <span>{language === 'es' ? 'Traduciendo...' : language === 'en' ? 'Translating...' : language === 'ja' ? '翻訳中...' : language === 'vi' ? 'Đang dịch...' : '번역 중...'}</span>
                    </>
                  ) : (
                    <>
                      <span>🌐</span>
                      <span>{t('translationActive')}</span>
                    </>
                  )}
                </div>
              )}

              <h1 className="text-xl sm:text-2xl font-bold text-stone-900 leading-snug tracking-tight mb-3">
                {displayDiary.title}
              </h1>
            </div>

            {/* Story Paragraphs */}
            <div className="prose prose-stone max-w-none text-stone-700 text-sm sm:text-base leading-relaxed whitespace-pre-line font-serif">
              {displayDiary.content}
            </div>

            {/* Mood Tags */}
            {displayDiary.moodTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-stone-200">
                {displayDiary.moodTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2.5 py-1 rounded-full bg-stone-100 text-stone-600 font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Regional Insights Block (지역 정보 & 여행자 맞춤 팁) */}
            <div className="rounded-2xl bg-amber-50/70 border border-amber-200/90 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-amber-600 text-white flex items-center justify-center text-xs">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-bold text-stone-900">
                  {t('detailCourseGuideTitle', { region: displayDiary.location.region })}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                  <span className="font-bold text-amber-900 block mb-1">
                    🚲 {t('insightWhyRecommend')}
                  </span>
                  <p className="text-stone-700 leading-relaxed">
                    {displayDiary.localInsights.recommendedForSolo}
                  </p>
                </div>

                {displayDiary.localInsights.localFood && (
                  <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                    <span className="font-bold text-amber-900 block mb-1">
                      🍲 {t('insightFood')}
                    </span>
                    <p className="text-stone-700 leading-relaxed">
                      {displayDiary.localInsights.localFood}
                    </p>
                  </div>
                )}

                {displayDiary.localInsights.transportTip && (
                  <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                    <span className="font-bold text-amber-900 block mb-1">
                      🚌 {t('insightTransport')}
                    </span>
                    <p className="text-stone-700 leading-relaxed">
                      {displayDiary.localInsights.transportTip}
                    </p>
                  </div>
                )}

                {displayDiary.localInsights.soloTravelTip && (
                  <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                    <span className="font-bold text-amber-900 block mb-1">
                      💡 {t('insightTravelTip')}
                    </span>
                    <p className="text-stone-700 leading-relaxed">
                      {displayDiary.localInsights.soloTravelTip}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Location & Mini Map Footer */}
            <div className="rounded-2xl border border-stone-200 p-4 bg-stone-50 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-44 h-32 rounded-xl overflow-hidden border border-stone-300 relative shrink-0">
                <div ref={mapContainerRef} className="w-full h-full" />
              </div>

              <div className="flex-1 min-w-0 space-y-1.5 w-full">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 font-bold">
                    <MapPin className="w-4 h-4" />
                    <span>{t('recordedLocation')}</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    (displayDiary.location.includeInDistance ?? displayDiary.includeInDistance ?? true) !== false
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-stone-200 text-stone-700 border border-stone-300'
                  }`}>
                    {(displayDiary.location.includeInDistance ?? displayDiary.includeInDistance ?? true) !== false
                      ? '🚴 누적 주행거리 포함'
                      : '🚫 누적 주행거리 제외'}
                  </span>
                </div>
                <p className="text-sm font-bold text-stone-900 truncate">
                  {displayDiary.location.landmark || displayDiary.location.region}
                </p>
                <p className="text-xs text-stone-500 break-all">
                  {displayDiary.location.address}
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onViewOnMap(displayDiary);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 hover:underline"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    <span>{t('viewOnFullMap')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
