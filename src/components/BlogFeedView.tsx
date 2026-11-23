import React, { useState, useMemo, useEffect } from 'react';
import { DiaryEntry } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { getLocalizedDiary } from '../utils/translationService';
import { useTranslationVersion } from '../utils/translationService';
import { 
  Search, 
  MapPin, 
  Calendar, 
  Clock, 
  Camera, 
  Star, 
  Sun, 
  Cloud, 
  CloudRain, 
  Snowflake, 
  Wind, 
  Compass, 
  ArrowRight, 
  Sparkles, 
  Edit3, 
  Trash2, 
  Share2,
  Plus,
  ChevronDown,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Loader2,
  CloudOff,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getDiaryServerStatus, ServerDiaryMeta } from '../services/diaryCloudSql';
import { sortDiariesChronological, useRoadDistances } from '../services/roadDistanceService';
import { filterValidPhotos } from '../utils/storage';
import { useDisplayImageUrl } from '../utils/imageDisplay';

const INITIAL_VISIBLE_COUNT = 4;
const PAGE_SIZE = 4;

const FeedCoverImage: React.FC<{
  src: string;
  alt: string;
  onError: () => void;
}> = ({ src, alt, onError }) => {
  const displayUrl = useDisplayImageUrl(src, 520, 0.74);
  if (!displayUrl) {
    return <div className="w-full h-full bg-stone-200 animate-pulse" />;
  }
  return (
    <img
      src={displayUrl}
      alt={alt}
      className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500"
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
};

interface BlogFeedViewProps {
  diaries: DiaryEntry[];
  serverMetaMap: Record<string, ServerDiaryMeta>;
  hasLoadedServerMeta?: boolean;
  uploadingDiaryIds: Record<string, boolean>;
  isInitialSyncing?: boolean;
  isOffline?: boolean;
  onUploadDiaryToServer: (diary: DiaryEntry) => void;
  onSelectDiary: (diary: DiaryEntry) => void;
  onEditDiary: (diary: DiaryEntry) => void;
  onDeleteDiary: (diary: DiaryEntry) => void;
  onViewOnMap: (diary: DiaryEntry) => void;
  onOpenNewDiary: () => void;
}

export const BlogFeedView: React.FC<BlogFeedViewProps> = ({
  diaries,
  serverMetaMap,
  hasLoadedServerMeta = false,
  uploadingDiaryIds,
  isInitialSyncing = false,
  isOffline = false,
  onUploadDiaryToServer,
  onSelectDiary,
  onEditDiary,
  onDeleteDiary,
  onViewOnMap,
  onOpenNewDiary,
}) => {
  const { t, language } = useLanguage();
  const { canEditLocal } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [failedPhotoKeys, setFailedPhotoKeys] = useState<Record<string, boolean>>({});

  const allLabel = t('filterAll');
  const translationVersion = useTranslationVersion();

  // Localize diaries according to active language
  const localizedDiaries = useMemo(() => {
    return diaries.map((d) => getLocalizedDiary(d, language));
  }, [diaries, language, translationVersion]);

  // Extract unique regions
  const availableRegions = useMemo(() => {
    const set = new Set<string>();
    localizedDiaries.forEach((d) => {
      const topArea = d.location.region.split(' ')[0] || d.location.region;
      if (topArea) set.add(topArea);
    });
    return ['ALL', ...Array.from(set)];
  }, [localizedDiaries]);

  // Extract unique tags
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    localizedDiaries.forEach((d) => {
      d.moodTags.forEach((t) => set.add(t));
    });
    return ['ALL', ...Array.from(set)];
  }, [localizedDiaries]);

  const { version: roadDistanceVersion, getSegmentDistance } = useRoadDistances(diaries);

  // Pre-calculate real road distance difference from the previous diary in chronological order
  const distanceDiffs = useMemo(() => {
    const sorted = sortDiariesChronological(diaries);

    const diffMap: Record<string, { km: number; isRoad: boolean } | null> = {};
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      if (i === 0) {
        diffMap[current.id] = null;
        continue;
      }
      const prev = sorted[i - 1];
      if (
        current.location && prev.location &&
        typeof current.location.lat === 'number' && typeof prev.location.lat === 'number'
      ) {
        diffMap[current.id] = getSegmentDistance(prev.location, current.location);
      } else {
        diffMap[current.id] = null;
      }
    }
    return diffMap;
  }, [diaries, roadDistanceVersion, getSegmentDistance]);

  // Filter & sort diaries (strictly newest travel date/time first by default)
  const filteredDiaries = useMemo(() => {
    const list = localizedDiaries.filter((d) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q) ||
        d.location.region.toLowerCase().includes(q) ||
        d.location.address.toLowerCase().includes(q) ||
        d.moodTags.some((t) => t.toLowerCase().includes(q));

      const matchesRegion =
        selectedRegion === 'ALL' ||
        d.location.region.includes(selectedRegion);

      const matchesTag =
        selectedTag === 'ALL' ||
        d.moodTags.includes(selectedTag);

      return matchesSearch && matchesRegion && matchesTag;
    });

    return list.sort((a, b) => {
      const dateTimeA = `${a.date || ''} ${a.time || ''}`.trim();
      const dateTimeB = `${b.date || ''} ${b.time || ''}`.trim();

      if (dateTimeA && dateTimeB && dateTimeA !== dateTimeB) {
        return sortOrder === 'newest'
          ? dateTimeB.localeCompare(dateTimeA)
          : dateTimeA.localeCompare(dateTimeB);
      }

      const createdA = a.createdAt || 0;
      const createdB = b.createdAt || 0;
      if (createdA !== createdB) {
        return sortOrder === 'newest' ? createdB - createdA : createdA - createdB;
      }

      const updatedA = a.updatedAt || 0;
      const updatedB = b.updatedAt || 0;
      return sortOrder === 'newest' ? updatedB - updatedA : updatedA - updatedB;
    });
  }, [localizedDiaries, searchQuery, selectedRegion, selectedTag, sortOrder]);

  // Visible diaries count (initially 2, increments by 2 on '더보기')
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COUNT);

  // Reset pagination back to 2 whenever search query, region, tag, or sort order changes
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [searchQuery, selectedRegion, selectedTag, sortOrder]);

  // Paginated slice of diaries to display
  const displayedDiaries = useMemo(() => {
    return filteredDiaries.slice(0, visibleCount);
  }, [filteredDiaries, visibleCount]);

  const weatherIcons: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    sunny: { label: t('editorWeatherSunny'), icon: Sun },
    cloudy: { label: t('editorWeatherCloudy'), icon: Cloud },
    rainy: { label: t('editorWeatherRainy'), icon: CloudRain },
    snowy: { label: 'Snow', icon: Snowflake },
    windy: { label: t('editorWeatherWindy'), icon: Wind },
    foggy: { label: 'Fog', icon: Cloud },
  };

  return (
    <div className="space-y-6">
      {/* Blog Feed Search & Filter Bar */}
      <div className="bg-white rounded-xl p-3 border border-stone-200/90 shadow-sm space-y-2">
        <div className="flex flex-col sm:flex-row items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 text-base sm:text-xs rounded-lg border border-stone-300 bg-stone-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition"
            />
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
            {/* Sort Order Selector (Newest First / Oldest First) with Icons */}
            <div className="inline-flex items-center gap-0.5 bg-stone-100 p-0.5 rounded-lg border border-stone-200 text-xs">
              <button
                type="button"
                onClick={() => setSortOrder('newest')}
                className={`p-1.5 rounded transition cursor-pointer flex items-center justify-center ${
                  sortOrder === 'newest'
                    ? 'bg-white text-stone-900 shadow-2xs font-bold'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
                title="최신순 (최신 일기부터 정렬)"
                aria-label="최신순 정렬"
              >
                <ArrowDownWideNarrow className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setSortOrder('oldest')}
                className={`p-1.5 rounded transition cursor-pointer flex items-center justify-center ${
                  sortOrder === 'oldest'
                    ? 'bg-white text-stone-900 shadow-2xs font-bold'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
                title="오래된순 (과거 일기부터 정렬)"
                aria-label="오래된순 정렬"
              >
                <ArrowUpNarrowWide className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-xs text-stone-500 whitespace-nowrap">
              {t('totalDiaries', { count: filteredDiaries.length })}
            </span>
          </div>
        </div>

        {/* Region Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-stone-400 font-medium shrink-0 mr-1">
            {t('filterRegionLabel')}
          </span>
          {availableRegions.map((region) => (
            <button
              key={region}
              type="button"
              onClick={() => setSelectedRegion(region)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] whitespace-nowrap transition font-medium ${
                selectedRegion === region
                  ? 'bg-stone-900 text-white shadow-sm'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {region === 'ALL' ? allLabel : region}
            </button>
          ))}
        </div>

        {/* Mood Tag Chips */}
        {availableTags.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-stone-100 text-xs">
            <span className="text-stone-400 font-medium shrink-0 mr-1">
              {t('filterTagLabel')}
            </span>
            {availableTags.slice(0, 8).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] whitespace-nowrap transition ${
                  selectedTag === tag
                    ? 'bg-amber-100 text-amber-900 font-semibold border border-amber-300'
                    : 'bg-stone-50 text-stone-500 hover:bg-stone-100'
                }`}
              >
                {tag === 'ALL' ? allLabel : tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Diary Feed List */}
      {filteredDiaries.length > 0 ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {displayedDiaries.map((diary) => {
            const originalDiary = diaries.find((item) => item.id === diary.id) || diary;
            const serverStatus = getDiaryServerStatus(originalDiary, serverMetaMap, hasLoadedServerMeta);
            const isUploading = Boolean(uploadingDiaryIds[originalDiary.id]);
            const validPhotos = filterValidPhotos(diary.photos).filter(
              (p) => !failedPhotoKeys[`${diary.id}:${p.id}`]
            );
            const coverPhoto = validPhotos.find((p) => p.isCover) || validPhotos[0];
            const WeatherIcon = weatherIcons[diary.weather]?.icon || Sun;

            return (
              <article
                key={diary.id}
                className="group bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 flex flex-col"
              >
                {/* Cover Image Container */}
                {coverPhoto && (
                  <div
                    className="relative h-60 w-full overflow-hidden bg-stone-100 cursor-pointer"
                    onClick={() => onSelectDiary(diary)}
                  >
                    <FeedCoverImage
                      src={coverPhoto.url}
                      alt={diary.title}
                      onError={() =>
                        setFailedPhotoKeys((prev) => ({
                          ...prev,
                          [`${diary.id}:${coverPhoto.id}`]: true,
                        }))
                      }
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-stone-950/60 via-transparent to-transparent opacity-80" />

                    {/* Photo Count Pill */}
                    {(() => {
                      const count = Math.max(diary.totalPhotosCount || 0, diary.photos?.length || 0);
                      if (count <= 1) return null;
                      return (
                        <span 
                          className="absolute top-3 right-3 bg-stone-900/85 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 border border-white/25 shadow-md"
                          title={t('totalPhotosCount', { count })}
                        >
                          <Camera className="w-3.5 h-3.5 text-amber-300" />
                          <span>{count}</span>
                        </span>
                      );
                    })()}

                    {/* Real-time GPS verification pill */}
                    {diary.location.isRealtimeGps && (
                      <span className="absolute top-3 left-3 bg-emerald-950/80 backdrop-blur-sm text-emerald-300 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>{t('realtimeGpsLinked')}</span>
                      </span>
                    )}

                    {/* Region on Cover */}
                    <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-white">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-black/40 backdrop-blur-sm border border-white/20 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-amber-400" />
                          {diary.location.region}
                        </span>
                        {(diary.location?.includeInDistance ?? diary.includeInDistance ?? true) === false && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-stone-900/80 backdrop-blur-sm border border-stone-400/40 text-stone-200 flex items-center gap-1">
                            <span>🚫</span>
                            <span>거리 제외</span>
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-stone-300">
                        {diary.date}
                      </span>
                    </div>
                  </div>
                )}

                {/* Content Section */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    {/* Top Row: Meta info */}
                    <div className="flex items-center justify-between text-xs text-stone-500 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <WeatherIcon className="w-3.5 h-3.5 text-amber-600" />
                          <span>{weatherIcons[diary.weather]?.label}</span>
                        </span>
                        <span>•</span>
                        <span>{diary.time}</span>
                        
                        {/* Distance from Previous Diary (real road distance when routable) */}
                        {distanceDiffs[diary.id] !== null && distanceDiffs[diary.id]!.km > 0 && (
                          <>
                            <span>•</span>
                            <span 
                              className="flex items-center gap-1 text-stone-600 font-medium bg-stone-100 px-2 py-0.5 rounded-full"
                              title={
                                distanceDiffs[diary.id]!.isRoad
                                  ? `이전 일기 위치로부터 실제 도로 거리 ${distanceDiffs[diary.id]!.km}km`
                                  : `이전 일기 위치로부터 직선 거리 ${distanceDiffs[diary.id]!.km}km`
                              }
                            >
                              <Compass className="w-3.5 h-3.5 text-sky-600" />
                              <span>{distanceDiffs[diary.id]!.km}km</span>
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`w-3 h-3 ${
                                s <= diary.rating
                                  ? 'text-amber-500 fill-amber-500'
                                  : 'text-stone-300'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Title */}
                    <h2
                      onClick={() => {
                        const original = diaries.find(item => item.id === diary.id) || diary;
                        onSelectDiary(original);
                      }}
                      className="text-lg font-bold text-stone-900 group-hover:text-amber-700 transition cursor-pointer leading-snug line-clamp-2 mb-2"
                    >
                      {diary.title || '제목 없음'}
                    </h2>

                    {/* Content Snippet */}
                    <p
                      onClick={() => {
                        const original = diaries.find(item => item.id === diary.id) || diary;
                        onSelectDiary(original);
                      }}
                      className="text-xs text-stone-600 line-clamp-3 leading-relaxed font-serif cursor-pointer whitespace-pre-line"
                    >
                      {diary.content || '(일기 내용이 없습니다)'}
                    </p>
                  </div>

                  {/* Tags */}
                  {diary.moodTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {diary.moodTags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Card Actions Footer */}
                  <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          onViewOnMap(originalDiary);
                        }}
                        className="text-xs font-semibold text-amber-700 hover:text-amber-800 px-2 py-1 rounded hover:bg-amber-50 transition flex items-center gap-1 cursor-pointer"
                        title={t('cardViewOnMap')}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{t('cardViewOnMap')}</span>
                      </button>

                      {/* Local Actions: Edit & Delete (only shown when app passcode permission is unlocked) */}
                      {canEditLocal && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              onEditDiary(originalDiary);
                            }}
                            className="p-1.5 rounded transition cursor-pointer text-stone-400 hover:text-stone-700 hover:bg-stone-100"
                            title={t('cardEdit')}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteDiary(originalDiary);
                            }}
                            className="p-1.5 rounded transition cursor-pointer text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                            title={t('cardDelete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {/* Server Status Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUploadDiaryToServer(originalDiary);
                        }}
                        disabled={isUploading}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-bold transition cursor-pointer disabled:opacity-60 ${
                          serverStatus === 'not_on_server'
                            ? 'bg-rose-50 text-rose-600 border-rose-300 hover:bg-rose-100'
                            : serverStatus === 'needs_update'
                              ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                        }`}
                        title={
                          serverStatus === 'not_on_server'
                            ? '서버 미등록 - 클릭하여 서버에 추가'
                            : serverStatus === 'needs_update'
                              ? '수정됨 - 클릭하여 서버 업데이트'
                              : '서버에 추가/업데이트 완료됨'
                        }
                        aria-label="서버 반영 상태"
                      >
                        {isUploading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : serverStatus === 'not_on_server' ? (
                          <CloudOff className="w-3.5 h-3.5 text-rose-600" />
                        ) : serverStatus === 'needs_update' ? (
                          <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                        <span>
                          {isUploading
                            ? '전송 중'
                            : serverStatus === 'not_on_server'
                              ? '미등록'
                              : serverStatus === 'needs_update'
                                ? '수정됨'
                                : '서버됨'}
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const original = diaries.find(item => item.id === diary.id) || diary;
                        onSelectDiary(original);
                      }}
                      className="text-xs font-bold text-stone-900 group-hover:text-amber-600 flex items-center gap-1 transition"
                    >
                      <span>
                        {t('readFullStory')}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Load More (더보기) Button & Status */}
        {filteredDiaries.length > visibleCount && (
          <div className="flex flex-col items-center justify-center pt-2 pb-2">
            <button
              id="btn-load-more-diaries"
              type="button"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white hover:bg-amber-50/80 text-stone-800 hover:text-amber-800 font-semibold text-xs sm:text-sm border border-stone-200 hover:border-amber-300 shadow-xs hover:shadow transition-all duration-200 cursor-pointer active:scale-95"
            >
              <span>{t('loadMoreDiaries')}</span>
              <ChevronDown className="w-4 h-4 text-stone-500 group-hover:text-amber-600 transition-transform duration-200 group-hover:translate-y-0.5" />
            </button>
            <p className="text-[11px] text-stone-400 mt-2 font-medium">
              {t('showingDiariesCount', { current: displayedDiaries.length, total: filteredDiaries.length })}
            </p>
          </div>
        )}

        {filteredDiaries.length > INITIAL_VISIBLE_COUNT && visibleCount >= filteredDiaries.length && (
          <div className="text-center py-2 text-xs text-stone-400 font-medium">
            ✓ {t('allDiariesLoaded')}
          </div>
        )}
      </div>
      ) : isInitialSyncing && diaries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center max-w-lg mx-auto space-y-3 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <h3 className="text-base font-bold text-stone-900">
            서버에서 일기를 불러오는 중...
          </h3>
          <p className="text-xs text-stone-500">
            Cloud SQL 서버에 저장된 기존 여행 일기를 자동으로 복원하고 있습니다.
          </p>
        </div>
      ) : (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-dashed border-stone-300 p-12 text-center max-w-lg mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <Compass className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-stone-900">
              일기를 찾을 수 없습니다
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              검색 결과가 없거나 저장된 일기가 없습니다. 새 일기를 작성하거나 JSON 백업 파일을 가져와 보세요.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenNewDiary}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('btnNewDiaryFirst')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
