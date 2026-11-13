import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DiaryEntry } from '../types';
import { 
  ExportMode, 
  ExportOptions, 
  filterDiariesForExport, 
  isDiaryModified 
} from '../utils/storage';
import { 
  Download, 
  Upload,
  X, 
  Calendar, 
  FileText, 
  Edit3, 
  Check, 
  Loader2, 
  AlertCircle,
  Database,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

interface DataManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  diaries: DiaryEntry[];
  onExport: (options: ExportOptions) => Promise<{ count: number; success: boolean }>;
  onImport: (importedDiaries: DiaryEntry[]) => Promise<{ addedCount: number; updatedCount: number; total: number }>;
  onResetLocalDb?: () => void;
}

export const DataManagementModal: React.FC<DataManagementModalProps> = ({
  isOpen,
  onClose,
  diaries,
  onExport,
  onImport,
  onResetLocalDb,
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'diag'>('export');
  const [exportMode, setExportMode] = useState<ExportMode>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [dbDiag, setDbDiag] = useState<{ count: number; persistent: boolean } | null>(null);
  const [importStatus, setImportStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message: string }>({ 
    type: 'idle', 
    message: '' 
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setIsImporting(false);
      setImportStatus({ type: 'idle', message: '' });
      const d = new Date();
      d.setDate(d.getDate() - 5);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(new Date().toISOString().slice(0, 10));
      
      // Load diagnostics
      const loadDiag = async () => {
        try {
          const { getLocalDiaryCount, isLocalDbPersistent } = await import('../utils/localDb');
          const count = await getLocalDiaryCount();
          const persistent = isLocalDbPersistent();
          setDbDiag({ count, persistent });
        } catch {}
      };
      loadDiag();
    }
  }, [isOpen]);

  // Handle ESC key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Calculate live counts
  const allCount = diaries.length;
  const modifiedCount = useMemo(() => diaries.filter(isDiaryModified).length, [diaries]);
  const rangeCount = useMemo(() => filterDiariesForExport(diaries, { mode: 'range', startDate, endDate }).length, [diaries, startDate, endDate]);

  const currentSelectedCount = useMemo(() => {
    if (exportMode === 'all') return allCount;
    if (exportMode === 'modified') return modifiedCount;
    if (exportMode === 'range') return rangeCount;
    return 0;
  }, [exportMode, allCount, modifiedCount, rangeCount]);

  const handleDownload = async () => {
    if (currentSelectedCount === 0 || isExporting) return;
    setIsExporting(true);
    try {
      await onExport({
        mode: exportMode,
        startDate: exportMode === 'range' ? startDate : undefined,
        endDate: exportMode === 'range' ? endDate : undefined,
      });
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus({ type: 'loading', message: '파일을 읽고 분석하는 중...' });

    try {
      const reader = new FileReader();
      const content = await new Promise<string>((resolve, reject) => {
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.onerror = (error) => reject(error);
        reader.readAsText(file);
      });

      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        throw new Error('유효한 일기 데이터 형식이 아닙니다. (배열 형태여야 함)');
      }

      // Basic structure validation
      const validEntries = parsed.filter(item => item.id && item.title && item.date);
      if (validEntries.length === 0) {
        throw new Error('가져올 수 있는 유효한 일기 항목이 없습니다.');
      }

      setImportStatus({ type: 'loading', message: `${validEntries.length}개의 일기를 로컬 데이터베이스에 저장 중...` });
      
      const result = await onImport(validEntries);
      
      setImportStatus({ 
        type: 'success', 
        message: `가져오기 성공: 신규 ${result.addedCount}개 추가, ${result.updatedCount}개 업데이트 완료.` 
      });
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setImportStatus({ 
        type: 'error', 
        message: err.message || '파일을 읽는 중 오류가 발생했습니다.' 
      });
    } finally {
      setIsImporting(false);
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
        <div className="p-4 sm:p-5 border-b border-stone-800 bg-stone-900/95 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  데이터 관리
                </h3>
                <p className="text-xs text-stone-400 mt-0.5">
                  일기 백업 다운로드 및 JSON 가져오기
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex p-1 rounded-xl bg-stone-800/60 border border-stone-700/50">
            <button
              onClick={() => setActiveTab('export')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'export' ? 'bg-stone-700 text-amber-400 shadow-sm' : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>백업 (내보내기)</span>
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'import' ? 'bg-stone-700 text-sky-400 shadow-sm' : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>복구 및 가져오기</span>
            </button>
            <button
              onClick={() => setActiveTab('diag')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'diag' ? 'bg-stone-700 text-amber-400 shadow-sm' : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>진단</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
          {activeTab === 'export' ? (
            <div className="space-y-3">
              {/* Option 1: 전체 일기 */}
              <div 
                onClick={() => setExportMode('all')}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                  exportMode === 'all'
                    ? 'bg-amber-950/30 border-amber-500/50 ring-1 ring-amber-500/40'
                    : 'bg-stone-800/60 border-stone-700/70 hover:bg-stone-800'
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  exportMode === 'all' ? 'border-amber-400 bg-amber-500 text-stone-900' : 'border-stone-500 bg-stone-900'
                }`}>
                  {exportMode === 'all' && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-amber-400" />
                      1. 전체 일기
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold font-mono border bg-stone-700/60 text-stone-300 border-stone-600">
                      {allCount}개
                    </span>
                  </div>
                  <p className="text-xs text-stone-400 mt-1">현재 보관 중인 전체 여행일기를 모두 다운로드합니다.</p>
                </div>
              </div>

              {/* Option 2: 수정된 일기 */}
              <div 
                onClick={() => setExportMode('modified')}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                  exportMode === 'modified'
                    ? 'bg-emerald-950/30 border-emerald-500/50 ring-1 ring-emerald-500/40'
                    : 'bg-stone-800/60 border-stone-700/70 hover:bg-stone-800'
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  exportMode === 'modified' ? 'border-emerald-400 bg-emerald-500 text-stone-900' : 'border-stone-500 bg-stone-900'
                }`}>
                  {exportMode === 'modified' && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Edit3 className="w-4 h-4 text-emerald-400" />
                      2. 수정된 일기 (최근 2주일)
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold font-mono border bg-stone-700/60 text-stone-300 border-stone-600">
                      {modifiedCount}개
                    </span>
                  </div>
                  <p className="text-xs text-stone-400 mt-1">최근 2주일 이내에 수정된 일기만 다운로드합니다.</p>
                </div>
              </div>

              {/* Option 3: 기간 설정 */}
              <div 
                onClick={() => setExportMode('range')}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2.5 ${
                  exportMode === 'range'
                    ? 'bg-sky-950/30 border-sky-500/50 ring-1 ring-sky-500/40'
                    : 'bg-stone-800/60 border-stone-700/70 hover:bg-stone-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    exportMode === 'range' ? 'border-sky-400 bg-sky-500 text-stone-900' : 'border-stone-500 bg-stone-900'
                  }`}>
                    {exportMode === 'range' && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-white flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-sky-400" />
                        3. 기간 설정
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold font-mono border bg-stone-700/60 text-stone-300 border-stone-600">
                        {rangeCount}개
                      </span>
                    </div>
                  </div>
                </div>
                <div className={`pt-2.5 mt-1 border-t border-stone-700/60 flex items-center gap-2 ${exportMode === 'range' ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-stone-900 px-2 py-1 rounded border border-stone-700 text-xs text-white outline-none flex-1" />
                  <span className="text-stone-500 text-xs">~</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-stone-900 px-2 py-1 rounded border border-stone-700 text-xs text-white outline-none flex-1" />
                </div>
              </div>
            </div>
          ) : activeTab === 'import' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-stone-800/40 border border-stone-700/60 flex flex-col items-center text-center gap-3">
                <div className="p-3 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <FileJson className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">JSON 파일 가져오기</h4>
                  <p className="text-xs text-stone-400 mt-1 max-w-[260px] mx-auto">
                    백업된 일기 JSON 파일을 선택하여 로컬 저장소(IndexedDB)에 저장합니다. 서버와 동기화되지 않습니다.
                  </p>
                </div>
                
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept=".json"
                  onChange={handleFileChange}
                  className="hidden"
                />
                
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-900/40 transition active:scale-95 disabled:opacity-50"
                >
                  {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  <span>일기 JSON 파일 선택</span>
                </button>
              </div>

              {importStatus.type !== 'idle' && (
                <div className={`p-4 rounded-xl border flex items-start gap-3 animate-in slide-in-from-top-2 duration-300 ${
                  importStatus.type === 'loading' ? 'bg-stone-800/60 border-stone-700 text-stone-300' :
                  importStatus.type === 'success' ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300' :
                  'bg-rose-950/30 border-rose-500/40 text-rose-300'
                }`}>
                  {importStatus.type === 'loading' ? <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" /> :
                   importStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> :
                   <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <p className="text-xs leading-relaxed font-medium">{importStatus.message}</p>
                </div>
              )}
              
              {importStatus.type === 'success' && (
                <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-2.5">
                  <div className="p-1 rounded bg-emerald-500/20 text-emerald-400 mt-0.5">
                    <Database className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-[11px] text-emerald-300/90 leading-relaxed">
                    로컬 저장소(IndexedDB)에 안전하게 저장되었습니다.
                  </p>
                </div>
              )}
            </div>
          ) : activeTab === 'diag' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-stone-800/40 border border-stone-700/60 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white mb-2">
                  <Database className="w-4 h-4 text-amber-400" />
                  로컬 저장소 진단
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-stone-900/50 border border-stone-700/50">
                    <p className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">저장된 일기 수</p>
                    <p className="text-xl font-black text-amber-400 font-mono">{dbDiag?.count ?? '...'}개</p>
                  </div>
                  <div className="p-3 rounded-lg bg-stone-900/50 border border-stone-700/50">
                    <p className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">영구 저장 상태</p>
                    <p className={`text-sm font-bold ${dbDiag?.persistent ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {dbDiag?.persistent ? '지원됨 (IndexedDB)' : '미지원 (휘발성)'}
                    </p>
                  </div>
                </div>

                {!dbDiag?.persistent && (
                  <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-900/30 text-[11px] text-rose-300 space-y-2">
                    <p className="font-bold">⚠️ 영구 저장이 비활성된 상태입니다.</p>
                    <p className="leading-relaxed opacity-90">
                      현재 브라우저에서 IndexedDB 영구 저장이 차단되어 있습니다. 시크릿 모드를 해제하고 일반 브라우저 모드를 사용해주세요.
                    </p>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-rose-950/10 border border-rose-900/20 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-rose-300 mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  위험 구역
                </div>
                <p className="text-[11px] text-stone-400 leading-relaxed">
                  로컬 데이터베이스를 완전히 초기화합니다. 저장되지 않은 데이터는 삭제되며 복구할 수 없습니다.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('정말로 로컬 데이터베이스를 초기화하시겠습니까? 모든 로컬 데이터가 삭제됩니다.')) {
                      onResetLocalDb?.();
                      onClose();
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-rose-900/40 hover:bg-rose-900/60 text-rose-200 text-xs font-bold border border-rose-800/40 transition"
                >
                  로컬 데이터베이스 초기화
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-stone-800 bg-stone-900/90 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold border border-stone-700 transition"
          >
            닫기
          </button>
          
          {activeTab === 'export' && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={currentSelectedCount === 0 || isExporting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md shadow-amber-900/40 transition active:scale-95 disabled:opacity-40"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{currentSelectedCount}개 일기 다운로드</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
