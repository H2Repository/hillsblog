import React, { useEffect, useState, useMemo } from 'react';
import { TravelPhoto } from '../types';
import { X, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { filterValidPhotos } from '../utils/storage';
import { useDisplayImageUrl } from '../utils/imageDisplay';

interface PhotoLightboxProps {
  photos: TravelPhoto[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
}) => {
  const validPhotos = useMemo(() => filterValidPhotos(photos), [photos]);
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const safeIndex = Math.min(Math.max(0, currentIndex), Math.max(0, validPhotos.length - 1));

  useEffect(() => {
    if (!isOpen) {
      setFailedIds({});
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && safeIndex < validPhotos.length - 1) onNavigate(safeIndex + 1);
      if (e.key === 'ArrowLeft' && safeIndex > 0) onNavigate(safeIndex - 1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, safeIndex, validPhotos.length, onClose, onNavigate]);

  const currentPhoto = validPhotos[safeIndex] || validPhotos[0];
  const displayUrl = useDisplayImageUrl(isOpen && currentPhoto ? currentPhoto.url : '', 1920, 0.86);

  if (!isOpen || validPhotos.length === 0 || !currentPhoto) return null;

  const isCurrentFailed = Boolean(failedIds[currentPhoto.id]);

  return (
    <div className="fixed inset-0 z-60 bg-black/95 flex flex-col items-center justify-center p-4">
      {/* Top Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-white z-10">
        <div className="text-sm font-medium text-stone-300">
          {safeIndex + 1} / {validPhotos.length}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Image View */}
      <div className="relative max-w-5xl max-h-[80vh] w-full flex items-center justify-center">
        {isCurrentFailed ? (
          <div className="flex flex-col items-center justify-center gap-2 text-stone-400 py-16">
            <ImageOff className="w-10 h-10" />
            <span className="text-sm">사진을 불러올 수 없습니다.</span>
          </div>
        ) : !displayUrl ? (
          <div className="w-64 h-64 rounded-lg bg-stone-900 animate-pulse" />
        ) : (
          <img
            src={displayUrl}
            alt={currentPhoto.caption || 'Travel photo'}
            className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl"
            decoding="async"
            onError={() => setFailedIds((prev) => ({ ...prev, [currentPhoto.id]: true }))}
          />
        )}

        {/* Prev / Next controls */}
        {validPhotos.length > 1 && (
          <>
            <button
              type="button"
              disabled={safeIndex === 0}
              onClick={() => onNavigate(safeIndex - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-stone-900/60 hover:bg-stone-900 text-white disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              type="button"
              disabled={safeIndex === validPhotos.length - 1}
              onClick={() => onNavigate(safeIndex + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-stone-900/60 hover:bg-stone-900 text-white disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {/* Caption Overlay */}
      {currentPhoto.caption && (
        <div className="mt-4 px-6 py-2 rounded-full bg-stone-900/80 text-stone-200 text-sm max-w-xl text-center backdrop-blur border border-stone-800">
          {currentPhoto.caption}
        </div>
      )}
    </div>
  );
};
