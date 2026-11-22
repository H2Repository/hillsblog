import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import { DiaryEntry } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { getLocalizedDiary } from '../utils/translationService';
import { useTranslationVersion } from '../utils/translationService';
import { getCurrentGpsPosition, reverseGeocode } from '../utils/geo';
import { filterValidPhotos } from '../utils/storage';
import { getCompactDisplayUrl, useDisplayImageUrl } from '../utils/imageDisplay';
import { sortDiariesChronological, useRoadDistances } from '../services/roadDistanceService';
import { 
  MapPin, 
  Navigation, 
  Layers, 
  Calendar, 
  Camera, 
  Route, 
  ChevronRight,
  Loader2
} from 'lucide-react';

interface TravelMapViewProps {
  diaries: DiaryEntry[];
  onSelectDiary: (diary: DiaryEntry) => void;
  selectedDiaryId?: string | null;
}

const MapSidebarThumb: React.FC<{ src: string; onError: () => void }> = ({ src, onError }) => {
  const displayUrl = useDisplayImageUrl(src, 140, 0.7);
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

export const TravelMapView: React.FC<TravelMapViewProps> = ({
  diaries,
  onSelectDiary,
  selectedDiaryId,
}) => {
  const { t, language } = useLanguage();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [id: string]: L.Marker }>({});
  const polylineRef = useRef<L.Polyline | null>(null);
  const currentGpsMarkerRef = useRef<L.Marker | null>(null);
  const translationVersion = useTranslationVersion();
  const hasInitialFitRef = useRef(false);
  const prevSelectedIdRef = useRef<string | null>(null);

  // Localize diaries
  const localizedDiaries = useMemo(() => {
    return diaries.map((d) => getLocalizedDiary(d, language));
  }, [diaries, language, translationVersion]);

  // Sort diaries chronologically for travel route
  const sortedDiaries = useMemo(() => {
    return sortDiariesChronological(localizedDiaries);
  }, [localizedDiaries]);

  // Reversed list for the side itinerary (newest first)
  const listDiaries = useMemo(() => {
    return [...sortedDiaries].reverse();
  }, [sortedDiaries]);

  const [isLocating, setIsLocating] = useState(false);
  const [failedPhotoKeys, setFailedPhotoKeys] = useState<Record<string, boolean>>({});
  const [locateError, setLocateError] = useState<string | null>(null);
  const {
    cumulativeDistanceKm: totalDistance,
    cumulativeHasRoadData,
    isCalculatingRoadDistances,
  } = useRoadDistances(diaries);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const latestDiary = sortedDiaries.length > 0 ? sortedDiaries[sortedDiaries.length - 1] : null;
    const defaultCenter: [number, number] = latestDiary
      ? [latestDiary.location.lat, latestDiary.location.lng]
      : [34.1205, 133.0076]; // Default touring center

    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: sortedDiaries.length > 0 ? 8 : 7,
      zoomControl: false,
    });

    // OpenStreetMap standard tiles (Free, no API key required)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 4. 폰에서 히스토리 지도 클릭시 현재 지도에서 +2 확대
    map.on('click', (e: L.LeafletMouseEvent) => {
      const isMobile = 
        window.innerWidth <= 768 || 
        ('ontouchstart' in window && window.innerWidth <= 1024) ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (isMobile) {
        const currentZoom = map.getZoom();
        const maxZoom = map.getMaxZoom() || 19;
        const newZoom = Math.min(currentZoom + 2, maxZoom);
        map.setView(e.latlng, newZoom, { animate: true });
      }
    });

    mapInstanceRef.current = map;

    // Fix for "gray map" issue: invalidate size after a short delay and observe container resize
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update markers and route line whenever sortedDiaries changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old markers
    (Object.values(markersRef.current) as L.Marker[]).forEach((m) => m.remove());
    markersRef.current = {};

    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    if (sortedDiaries.length === 0) return;

    const latLngs: [number, number][] = [];

    let isCancelled = false;

    const createMarkerIcon = (index: number, isIncluded: boolean) => {
      const badgeClass = isIncluded
        ? 'bg-amber-600 border-white text-white shadow-md'
        : 'bg-stone-600 border-stone-200 text-stone-100 shadow-md';
      const arrowColor = isIncluded ? 'bg-amber-600' : 'bg-stone-600';

      return L.divIcon({
        className: 'custom-travel-pin',
        html: `
          <div class="relative flex flex-col items-center group cursor-pointer transition-transform duration-150 hover:scale-110">
            <div class="min-w-[26px] h-[26px] px-1.5 rounded-full ${badgeClass} border-2 flex items-center justify-center text-[11px] font-extrabold leading-none tracking-tight">
              ${!isIncluded ? '<span class="mr-0.5 text-[9px]">🚫</span>' : ''}${index + 1}
            </div>
            <div class="w-2 h-2 ${arrowColor} rotate-45 -mt-1 border-r border-b ${isIncluded ? 'border-white/90' : 'border-stone-200/90'}"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 31],
        popupAnchor: [0, -30],
      });
    };

    sortedDiaries.forEach((diary, index) => {
      const { lat, lng } = diary.location;
      latLngs.push([lat, lng]);

      const isIncluded = (diary.location?.includeInDistance ?? diary.includeInDistance ?? true) !== false;
      const validPhotos = filterValidPhotos(diary.photos);
      const coverPhoto = validPhotos.find(p => p.isCover) || validPhotos[0];

      const marker = L.marker([lat, lng], {
        icon: createMarkerIcon(index, isIncluded),
      }).addTo(map);

      // Lazy popup image: avoid injecting full-size base64 strings into every marker popup upfront
      const popupImgId = `popup-img-${diary.id}`;
      const popupContent = `
        <div style="font-family: inherit; min-width: 200px; max-width: 260px;">
          ${coverPhoto ? `<img id="${popupImgId}" src="" style="display: none; width: 100%; height: 110px; object-fit: cover; border-radius: 8px; margin-bottom: 8px;" />` : ''}
          <div style="font-size: 11px; color: ${isIncluded ? '#d97706' : '#78716c'}; font-weight: 600; margin-bottom: 2px;">
            ${index + 1} • ${diary.date}
          </div>
          <div style="font-size: 14px; font-weight: 700; color: #1c1917; margin-bottom: 4px; line-height: 1.3;">
            ${diary.title}
          </div>
          <div style="font-size: 12px; color: #78716c; margin-bottom: 4px;">
            📍 ${diary.location.region}
          </div>
          ${!isIncluded ? `
          <div style="margin-bottom: 6px;">
            <span style="display: inline-block; font-size: 10px; color: #57534e; background: #f5f5f4; border: 1px solid #d6d3d1; padding: 2px 8px; border-radius: 9999px; font-weight: 600;">
              🚫 누적 주행거리 제외 위치
            </span>
          </div>
          ` : ''}
          <button id="popup-btn-${diary.id}" style="width: 100%; padding: 6px 12px; background: ${isIncluded ? '#d97706' : '#57534e'}; color: white; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
            ${t('mapRead')}
          </button>
        </div>
      `;

      marker.bindPopup(popupContent, {
        closeButton: true,
        className: 'modern-travel-popup',
      });

      marker.on('popupopen', () => {
        if (coverPhoto) {
          const imgEl = document.getElementById(popupImgId) as HTMLImageElement | null;
          if (imgEl) {
            getCompactDisplayUrl(coverPhoto.url, 360, 0.74).then((url) => {
              if (!isCancelled && imgEl && url) {
                imgEl.src = url;
                imgEl.style.display = 'block';
              }
            }).catch(() => {});
          }
        }
        const btn = document.getElementById(`popup-btn-${diary.id}`);
        if (btn) {
          btn.onclick = () => {
            const original = diaries.find(item => item.id === diary.id) || diary;
            onSelectDiary(original);
          };
        }
      });

      markersRef.current[diary.id] = marker;
    });

    // Draw route trail polyline for cumulative riding route (only includeInDistance !== false)
    const ridingDiaries = sortedDiaries.filter(
      (d) => (d.location?.includeInDistance ?? d.includeInDistance ?? true) !== false
    );
    const ridingLatLngs: [number, number][] = ridingDiaries.map((d) => [d.location.lat, d.location.lng]);

    if (ridingLatLngs.length > 1) {
      const polyline = L.polyline(ridingLatLngs, {
        color: '#d97706',
        weight: 3.5,
        opacity: 0.85,
        dashArray: '6, 8',
        lineCap: 'round',
      }).addTo(map);
      polylineRef.current = polyline;
    }

    // Fit bounds only once upon initial map load so viewing or closing diaries NEVER resets user's zoom/pan
    if (!hasInitialFitRef.current && sortedDiaries.length > 0) {
      const latestDiary = sortedDiaries[sortedDiaries.length - 1];
      map.setView([latestDiary.location.lat, latestDiary.location.lng], 13);
      hasInitialFitRef.current = true;
    }

    return () => {
      isCancelled = true;
    };
  }, [sortedDiaries, onSelectDiary, t, diaries]);

  // Pan to selected diary if changed externally
  useEffect(() => {
    if (!selectedDiaryId || !mapInstanceRef.current) {
      prevSelectedIdRef.current = selectedDiaryId || null;
      return;
    }
    if (prevSelectedIdRef.current !== selectedDiaryId) {
      prevSelectedIdRef.current = selectedDiaryId;
      const diary = diaries.find(d => d.id === selectedDiaryId);
      if (diary) {
        mapInstanceRef.current.flyTo([diary.location.lat, diary.location.lng], 13, { duration: 1.2 });
        const marker = markersRef.current[diary.id];
        if (marker) {
          setTimeout(() => marker.openPopup(), 400);
        }
      }
    }
  }, [selectedDiaryId, diaries]);

  // Manually fit entire route overview on demand
  const handleFitAllRoute = () => {
    const map = mapInstanceRef.current;
    if (!map || sortedDiaries.length === 0) return;
    const latLngs = sortedDiaries.map((d) => [d.location.lat, d.location.lng] as [number, number]);
    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
  };

  // Real-time GPS locate action
  const handleLocateMe = async () => {
    setIsLocating(true);
    try {
      const pos = await getCurrentGpsPosition();
      const map = mapInstanceRef.current;
      if (!map) return;

      if (currentGpsMarkerRef.current) {
        currentGpsMarkerRef.current.remove();
      }

      const gpsIcon = L.divIcon({
        className: 'gps-live-dot',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-7 h-7 rounded-full bg-emerald-500/30 animate-ping absolute"></div>
            <div class="w-4 h-4 rounded-full bg-emerald-600 border-2 border-white shadow-lg z-10"></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const gpsMarker = L.marker([pos.lat, pos.lng], { icon: gpsIcon }).addTo(map);
      currentGpsMarkerRef.current = gpsMarker;

      const info = await reverseGeocode(pos.lat, pos.lng);
      gpsMarker.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; padding: 4px;">
          <b style="color: #059669;">🟢 ${t('mapRealtimeLocation')}</b><br/>
          <span>${info.address}</span>
        </div>
      `).openPopup();

      map.flyTo([pos.lat, pos.lng], 14, { duration: 1.5 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '위치를 확인할 수 없습니다.';
      setLocateError(msg);
      setTimeout(() => setLocateError(null), 4000);
    } finally {
      setIsLocating(false);
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-140px)] min-h-[550px] bg-stone-100 flex flex-col md:flex-row overflow-hidden rounded-2xl border border-stone-300/80 shadow-lg">
      {/* Map Container */}
      <div className="relative flex-1 min-h-[340px] h-2/3 md:h-full w-full">
        <div ref={mapContainerRef} className="w-full h-full min-h-[340px] z-0" />

        {/* Floating Quick Locate Controls */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
          <div className="flex items-center gap-1.5">
            <button
              id="btn-fit-all-route"
              type="button"
              onClick={handleFitAllRoute}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/95 hover:bg-white text-stone-800 text-xs font-semibold shadow-md hover:shadow-lg border border-stone-200 transition active:scale-95 cursor-pointer"
              title="전체 여행 경로 한눈에 보기"
            >
              <Layers className="w-4 h-4 text-amber-600" />
              <span>전체 경로</span>
            </button>

            <button
              id="btn-map-locate-me"
              type="button"
              onClick={handleLocateMe}
              disabled={isLocating}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/95 hover:bg-white text-stone-800 text-xs font-semibold shadow-md hover:shadow-lg border border-stone-200 transition active:scale-95 cursor-pointer"
            >
              {isLocating ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              ) : (
                <Navigation className="w-4 h-4 text-emerald-600" />
              )}
              <span>{t('mapRealtimeLocation')}</span>
            </button>
          </div>

          {locateError && (
            <div className="px-3 py-1.5 rounded-xl bg-rose-950/90 text-rose-200 border border-rose-700/70 text-[11px] font-semibold shadow-lg">
              {locateError}
            </div>
          )}
        </div>

        {/* Floating Route Summary Overlay on Map */}
        <div className="absolute top-3 sm:top-4 left-3 sm:left-4 z-10 bg-stone-900/90 text-white backdrop-blur-md px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl shadow-xl border border-stone-700/60 flex items-center gap-2.5 sm:gap-4 text-[11px] sm:text-xs max-w-[calc(100vw-1.5rem)]">
          <div
            className="flex items-center gap-1.5"
            title={cumulativeHasRoadData ? '실제 도로 거리 합산 (미연결 구간은 직선거리 반영)' : '경로 거리 계산 중'}
          >
            <Route className="w-4 h-4 text-amber-400" />
            <span className="text-stone-400">{t('mapTotalDistance')}:</span>
            <span className="font-bold text-amber-300">{totalDistance.toLocaleString()} km</span>
            {isCalculatingRoadDistances ? (
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
            ) : cumulativeHasRoadData ? (
              <span className="text-[10px] text-stone-400 hidden sm:inline">실도로</span>
            ) : null}
          </div>
          <div className="w-px h-3 bg-stone-700" />
          <div className="flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-amber-400" />
            <span className="text-stone-400">{t('mapVisitedPlaces')}:</span>
            <span className="font-bold text-white">{sortedDiaries.length}</span>
          </div>
          <div className="w-px h-3 bg-stone-700" />
          <div className="flex items-center gap-1.5 hidden sm:flex">
            <Camera className="w-4 h-4 text-amber-400" />
            <span className="text-stone-400">{t('mapPhotosCount')}:</span>
            <span className="font-bold text-white">
              {sortedDiaries.reduce((sum, d) => sum + Math.max(d.totalPhotosCount || 0, d.photos?.length || 0), 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Side Travel Log Footprint Itinerary (발자취 경로순서 - 원복, 단 검은색 바탕의 하단 일기 프리뷰는 완전 삭제) */}
      <div className="w-full md:w-88 lg:w-96 h-1/3 md:h-full bg-white border-t md:border-t-0 md:border-l border-stone-200 flex flex-col z-10 shadow-lg">
        <div className="p-4 border-b border-stone-100 bg-stone-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
              👣
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-900">{t('mapTrailOrder')}</h3>
              <p className="text-[11px] text-stone-500">{t('mapTrailSubtitle')}</p>
            </div>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">
            {sortedDiaries.length} Stops
          </span>
        </div>

        {/* Scrollable list of stops */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {listDiaries.map((diary, index) => {
            const validPhotos = filterValidPhotos(diary.photos).filter(
              (p) => !failedPhotoKeys[`${diary.id}:${p.id}`]
            );
            const coverPhoto = validPhotos.find(p => p.isCover) || validPhotos[0];
            const originalDiary = diaries.find(item => item.id === diary.id) || diary;
            const sequenceNumber = sortedDiaries.length - index;

            return (
              <div
                key={diary.id}
                onClick={() => {
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.flyTo([diary.location.lat, diary.location.lng], 13, { duration: 1 });
                    const marker = markersRef.current[diary.id];
                    if (marker) {
                      marker.openPopup();
                    }
                  }
                }}
                className="p-3 rounded-xl border border-stone-200 hover:border-amber-400 bg-white hover:bg-stone-50/50 transition-all cursor-pointer flex gap-3 shadow-2xs"
              >
                {/* Photo Thumbnail */}
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 shrink-0 border border-stone-200 relative">
                  {coverPhoto ? (
                    <MapSidebarThumb
                      src={coverPhoto.url}
                      onError={() =>
                        setFailedPhotoKeys((prev) => ({
                          ...prev,
                          [`${diary.id}:${coverPhoto.id}`]: true,
                        }))
                      }
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">
                      No photo
                    </div>
                  )}
                  <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-stone-900/80 text-white text-[10px] font-bold flex items-center justify-center">
                    {sequenceNumber}
                  </span>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-1 text-[11px] text-stone-500 mb-0.5">
                      <span className="flex items-center gap-1 text-amber-700 font-semibold">
                        <MapPin className="w-3 h-3" />
                        {diary.location.region}
                      </span>
                      <span>{diary.date}</span>
                    </div>
                    <h4 className="text-xs font-bold text-stone-900 truncate leading-snug">
                      {diary.title}
                    </h4>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-stone-500 truncate max-w-[140px]">
                      {diary.location.landmark || diary.location.address}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDiary(originalDiary);
                      }}
                      className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 flex items-center cursor-pointer"
                    >
                      <span>{t('mapRead')}</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
