import React, { useState, useEffect, useMemo } from 'react';
import { DiaryEntry } from '../types';
import { 
  ExportMode, 
  ExportOptions, 
  filterDiariesForExport, 
  isDiaryModified 
} from '../utils/storage';
import { 
  Download, 
  X, 
  Calendar, 
  FileText, 
  Edit3, 
  Check, 
  Loader2, 
  AlertCircle 
} from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  diaries: DiaryEntry[];
  onExport: (options: ExportOptions) => Promise<{ count: number; success: boolean }>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  diaries,
  onExport,
}) => {
  const [mode, setMode] = useState<ExportMode>('all');
  const [isExporting, setIsExporting] = useState(false);

  // Default: 5 days ago to today
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setIsExporting(false);
      const d = new Date();
      d.setDate(d.getDate() - 5);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(new Date().toISOString().slice(0, 10));
    }
  }, [isOpen]);

  // Handle ESC key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Calculate live counts
  const allCount = diaries.length;

  const modifiedCount = useMemo(() => {
    return diaries.filter(isDiaryModified).length;
  }, [diaries]);

  const rangeCount = useMemo(() => {
    return filterDiariesForExport(diaries, { mode: 'range', startDate, endDate }).length;
  }, [diaries, startDate, endDate]);

  const currentSelectedCount = useMemo(() => {
    if (mode === 'all') return allCount;
    if (mode === 'modified') return modifiedCount;
    if (mode === 'range') return rangeCount;
    return 0;
  }, [mode, allCount, modifiedCount, rangeCount]);

  const handleDownload = async () => {
    if (currentSelectedCount === 0 || isExporting) return;

    setIsExporting(true);
    try {
      await onExport({
        mode,
        startDate: mode === 'range' ? startDate : undefined,
        endDate: mode === 'range' ? endDate : undefined,
      });
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/70 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-lg bg-stone-900 text-stone-100 rounded-2xl shadow-2xl border border-stone-800 overflow-hidden transform transition-all scale-100 my-auto flex flex-col max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-800 flex items-center justify-between bg-stone-900/95">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                여행일기 JSON 다운로드
              </h3>
              <p className="text-xs text-stone-400 mt-0.5">
                백업할 일기 항목의 범위를 선택해주세요
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition cursor-pointer"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Options */}
        <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
          {/* Option 1: 전체 일기 */}
          <div 
            onClick={() => setMode('all')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
              mode === 'all'
                ? 'bg-amber-950/30 border-amber-500/50 shadow-sm shadow-amber-900/20 ring-1 ring-amber-500/40'
                : 'bg-stone-800/60 border-stone-700/70 hover:bg-stone-800 hover:border-stone-600'
            }`}
          >
            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
              mode === 'all' ? 'border-amber-400 bg-amber-500 text-stone-900' : 'border-stone-500 bg-stone-900'
            }`}>
              {mode === 'all' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-white flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-amber-400" />
                  1. 전체 일기
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold font-mono border ${
                  mode === 'all' 
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                    : 'bg-stone-700/60 text-stone-300 border-stone-600'
                }`}>
                  {allCount}개
                </span>
              </div>
              <p className="text-xs text-stone-400 mt-1">
                현재 보관 중인 전체 여행일기를 모두 다운로드합니다.
              </p>
            </div>
          </div>

          {/* Option 2: 수정된 일기 */}
          <div 
            onClick={() => setMode('modified')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
              mode === 'modified'
                ? 'bg-amber-950/30 border-amber-500/50 shadow-sm shadow-amber-900/20 ring-1 ring-amber-500/40'
                : 'bg-stone-800/60 border-stone-700/70 hover:bg-stone-800 hover:border-stone-600'
            }`}
          >
            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
              mode === 'modified' ? 'border-amber-400 bg-amber-500 text-stone-900' : 'border-stone-500 bg-stone-900'
            }`}>
              {mode === 'modified' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4 text-emerald-400" />
                  2. 수정된 일기 (최근 2주일 이내)
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold font-mono border ${
                  mode === 'modified' 
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                    : 'bg-stone-700/60 text-stone-300 border-stone-600'
                }`}>
                  {modifiedCount}개
                </span>
              </div>
              <p className="text-xs text-stone-400 mt-1">
                최근 2주일 이내에 내용이나 사진이 수정된 일기만 선별하여 다운로드합니다.
              </p>
            </div>
          </div>

          {/* Option 3: 기간 설정 (년월일 ~ 년월일) */}
          <div 
            onClick={() => setMode('range')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2.5 ${
              mode === 'range'
                ? 'bg-amber-950/30 border-amber-500/50 shadow-sm shadow-amber-900/20 ring-1 ring-amber-500/40'
                : 'bg-stone-800/60 border-stone-700/70 hover:bg-stone-800 hover:border-stone-600'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                mode === 'range' ? 'border-amber-400 bg-amber-500 text-stone-900' : 'border-stone-500 bg-stone-900'
              }`}>
                {mode === 'range' && <Check className="w-3 h-3 stroke-[3]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-sky-400" />
                    3. 기간 설정 (년월일 ~ 년월일)
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold font-mono border ${
                    mode === 'range' 
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' 
                      : 'bg-stone-700/60 text-stone-300 border-stone-600'
                  }`}>
                    {rangeCount}개
                  </span>
                </div>
                <p className="text-xs text-stone-400 mt-1">
                  지정한 여행 날짜 구간에 작성된 일기만 다운로드합니다. (기본: 최근 5일 전 ~ 오늘)
                </p>
              </div>
            </div>

            {/* Date Pickers (Active when range mode is selected) */}
            <div 
              className={`pt-2.5 mt-1 border-t border-stone-700/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ${
                mode === 'range' ? 'opacity-100' : 'opacity-60 pointer-events-none'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-1 flex items-center gap-2 bg-stone-900/80 px-3 py-1.5 rounded-lg border border-stone-700">
                <span className="text-[11px] font-bold text-stone-400 shrink-0">시작일</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-xs text-white outline-none w-full cursor-pointer"
                />
              </div>
              <span className="text-stone-400 text-center font-bold hidden sm:inline">~</span>
              <div className="flex-1 flex items-center gap-2 bg-stone-900/80 px-3 py-1.5 rounded-lg border border-stone-700">
                <span className="text-[11px] font-bold text-stone-400 shrink-0">종료일</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-xs text-white outline-none w-full cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-stone-800 bg-stone-900/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="text-xs text-stone-400 flex items-center gap-1.5">
            {currentSelectedCount === 0 ? (
              <span className="text-rose-400 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                선택한 조건에 해당하는 일기가 없습니다.
              </span>
            ) : (
              <span>
                다운로드 대상: <strong className="text-amber-400 font-mono text-sm">{currentSelectedCount}개</strong>의 일기
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold border border-stone-700 transition cursor-pointer disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={currentSelectedCount === 0 || isExporting}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-amber-900/40 transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>다운로드 중...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-amber-300" />
                  <span>{currentSelectedCount}개 일기 다운로드</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
