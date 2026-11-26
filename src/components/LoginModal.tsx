import React, { useEffect, useState } from 'react';
import {
  X,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  UserCheck,
  LogOut,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  Clock,
  MapPin,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

const AUTO_DIARY_PRESET_MINUTES = [5, 10, 15, 30, 60, 120];

function formatShortTime(ts: number | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const LoginModal: React.FC = () => {
  const { t } = useLanguage();
  const {
    isLoginModalOpen,
    loginModalTab,
    setLoginModalTab,
    closeLoginModal,
    loginActionPrompt,
    loginWithGoogle,
    loginWithGoogleRedirect,
    unlockLocalEditWithPassword,
    lockLocalEdit,
    isAdmin,
    isLocalEditUnlocked,
    canUseRedirectFallback,
    isLoading,
    currentUser,
    autoDiarySettings,
    updateAutoDiarySettings,
    logout,
  } = useAuth();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRedirectFallback, setShowRedirectFallback] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [returnToAdminAfterUnlock, setReturnToAdminAfterUnlock] = useState(false);

  useEffect(() => {
    if (isLoginModalOpen) {
      setErrorMessage(null);
      setShowRedirectFallback(false);
      setPasscodeInput('');
      setPasscodeError(null);
      setShowPasscode(false);
      setReturnToAdminAfterUnlock(false);
    }
  }, [isLoginModalOpen]);

  if (!isLoginModalOpen) return null;

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const res = await loginWithGoogle();
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || t('loginGoogleErrFallback'));
      if (res.offerRedirectFallback) {
        setShowRedirectFallback(true);
      }
    }
  };

  const handleRedirectLogin = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const res = await loginWithGoogleRedirect();
    if (!res.success) {
      setIsSubmitting(false);
      setErrorMessage(res.error || t('loginRedirectErrFallback'));
    }
  };

  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasscodeError(null);
    const shouldReturnToAdmin = returnToAdminAfterUnlock;
    const shouldKeepOpen = shouldReturnToAdmin || !loginActionPrompt;
    const res = unlockLocalEditWithPassword(passcodeInput, {
      enabled: false,
      intervalMinutes: autoDiarySettings.intervalMinutes || 60,
      keepModalOpen: shouldKeepOpen,
    });
    if (!res.success) {
      setPasscodeError(res.error || t('loginPasscodeErrorFallback'));
    } else {
      setPasscodeInput('');
      if (shouldReturnToAdmin) {
        setReturnToAdminAfterUnlock(false);
        setLoginModalTab('admin');
      }
    }
  };

  const renderAutoDiaryControls = (isUnlocked: boolean) => {
    const activeEnabled = isUnlocked ? autoDiarySettings.enabled : false;
    const activeInterval = autoDiarySettings.intervalMinutes || 60;

    const handleToggle = () => {
      if (!isUnlocked) return;
      updateAutoDiarySettings({ enabled: !autoDiarySettings.enabled });
    };

    const handleIntervalChange = (nextMinutes: number) => {
      if (!activeEnabled) return;
      const clamped = Math.max(1, Math.min(240, Math.round(nextMinutes || 60)));
      updateAutoDiarySettings({ intervalMinutes: clamped });
    };

    return (
      <div
        className={`p-3.5 rounded-xl border space-y-3 text-left transition ${
          isUnlocked
            ? 'bg-stone-50 border-stone-200'
            : 'bg-stone-100/80 border-stone-200/70 opacity-65'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800 flex-wrap">
              <MapPin className={`w-3.5 h-3.5 shrink-0 ${activeEnabled ? 'text-emerald-600' : 'text-stone-400'}`} />
              <span>{t('loginAutoTitle')}</span>
              {!isUnlocked && (
                <span className="px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 text-[10px] font-semibold">
                  {t('loginAutoUnlockBadge')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">
              {isUnlocked ? t('loginAutoDescUnlocked') : t('loginAutoDescLocked')}
            </p>
          </div>
          <button
            id="btn-toggle-auto-diary"
            type="button"
            role="switch"
            aria-checked={activeEnabled}
            disabled={!isUnlocked}
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              !isUnlocked
                ? 'bg-stone-300 cursor-not-allowed opacity-60'
                : activeEnabled
                  ? 'bg-emerald-600 cursor-pointer'
                  : 'bg-stone-300 cursor-pointer'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                activeEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="space-y-2 pt-2 border-t border-stone-200/80">
          <div className={`space-y-2 transition-opacity ${activeEnabled ? 'opacity-100' : 'opacity-55'}`}>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className={`font-semibold flex items-center gap-1 ${activeEnabled ? 'text-stone-700' : 'text-stone-400'}`}>
                <Clock className={`w-3.5 h-3.5 ${activeEnabled ? 'text-amber-600' : 'text-stone-400'}`} />
                {t('loginAutoIntervalTitle')}
              </span>
              <div className="flex items-center gap-1">
                <input
                  id="input-auto-diary-interval"
                  type="number"
                  min={1}
                  max={240}
                  disabled={!activeEnabled}
                  value={activeInterval}
                  onChange={(e) => handleIntervalChange(Number(e.target.value))}
                  className="w-[66px] px-2 py-1 rounded-lg border border-stone-300 bg-white text-center !text-xs font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:bg-stone-100 disabled:border-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
                />
                <span className={`font-semibold ${activeEnabled ? 'text-stone-600' : 'text-stone-400'}`}>
                  {t('loginAutoEveryUnit')}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {AUTO_DIARY_PRESET_MINUTES.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  disabled={!activeEnabled}
                  onClick={() => handleIntervalChange(mins)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                    !activeEnabled
                      ? 'bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed'
                      : activeInterval === mins
                        ? 'bg-amber-600 text-white border-amber-600 cursor-pointer'
                        : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-100 cursor-pointer'
                  }`}
                >
                  {t('loginAutoPresetUnit', { mins })}
                </button>
              ))}
            </div>
          </div>

          {isUnlocked && (
            <div className="flex items-center justify-between text-[10px] text-stone-500 pt-1">
              <span>
                {t('loginAutoStatusLabel')}{' '}
                <strong className={autoDiarySettings.enabled ? 'text-emerald-700' : 'text-stone-600'}>
                  {autoDiarySettings.enabled ? t('loginAutoStatusOn') : t('loginAutoStatusOff')}
                </strong>
              </span>
              <span>
                {autoDiarySettings.enabled
                  ? t('loginAutoNextRecord', { time: formatShortTime(autoDiarySettings.nextAutoDiaryAt) })
                  : autoDiarySettings.lastAutoDiaryAt
                    ? t('menuAutoLastRun', { time: formatShortTime(autoDiarySettings.lastAutoDiaryAt) })
                    : t('loginAutoWaiting')}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
      onClick={closeLoginModal}
    >
      <div
        className="bg-white border border-stone-200 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col text-stone-900 my-auto max-h-[88dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3.5 sm:p-5 bg-stone-900 text-stone-100 flex items-start justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              {!isLocalEditUnlocked || loginModalTab === 'local' ? (
                <KeyRound className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 truncate">
                {t('menuAdminModeTitle')}
              </h2>
              <p className="text-[10px] sm:text-xs text-stone-400 mt-0.5 leading-tight">
                {!isLocalEditUnlocked || loginModalTab === 'local'
                  ? t('loginSubtitleLocal')
                  : t('loginSubtitleAdmin')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeLoginModal}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition shrink-0 ml-2 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs (블로그 관리자 로그인 탭은 앱 사용 패스워드 해제 시에만 표시) */}
        {isLocalEditUnlocked && (
          <div className="px-4 pt-3 pb-2 bg-stone-100 border-b border-stone-200 flex gap-2 shrink-0">
            <button
              id="tab-auth-local-passcode"
              type="button"
              onClick={() => {
                setLoginModalTab('local');
                setPasscodeError(null);
              }}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                loginModalTab === 'local'
                  ? 'bg-stone-900 text-amber-300 shadow-sm'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{t('loginTabPasscode')}</span>
            </button>
            <button
              id="tab-auth-google-admin"
              type="button"
              onClick={() => {
                setLoginModalTab('admin');
                setErrorMessage(null);
              }}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                loginModalTab === 'admin'
                  ? 'bg-stone-900 text-emerald-300 shadow-sm'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t('loginTabAdmin')}</span>
            </button>
          </div>
        )}

        {/* Action prompt */}
        {loginActionPrompt && (
          <div className="px-4 sm:px-5 py-2.5 bg-amber-50 border-b border-amber-200/80 flex items-center gap-2 text-[11px] sm:text-xs text-amber-900 shrink-0">
            <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 shrink-0" />
            <span className="font-medium">{loginActionPrompt}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
          {!isLocalEditUnlocked || loginModalTab === 'local' ? (
            isLocalEditUnlocked ? (
              <div className="space-y-4 text-center py-1">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900">
                    {isAdmin ? t('loginUnlockedAdminTitle') : t('loginUnlockedLocalTitle')}
                  </h3>
                  <p className="text-[11px] sm:text-xs text-stone-500 mt-1 leading-relaxed">
                    {isAdmin ? t('loginUnlockedAdminDesc') : t('loginUnlockedLocalDesc')}
                  </p>
                </div>

                {renderAutoDiaryControls(true)}

                <div className="pt-1 space-y-2">
                  <button
                    type="button"
                    onClick={closeLoginModal}
                    className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition cursor-pointer"
                  >
                    {t('loginDoneClose')}
                  </button>
                  {!currentUser && (
                    <button
                      type="button"
                      onClick={() => setLoginModalTab('admin')}
                      className="w-full py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-emerald-300 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{t('loginGoToAdminTab')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await lockLocalEdit();
                      closeLoginModal();
                    }}
                    className="w-full py-2.5 rounded-xl border border-stone-300 hover:bg-stone-50 text-xs font-semibold text-stone-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5 text-rose-500" />
                    <span>{isAdmin ? t('loginLockBtnAdmin') : t('loginLockBtnLocal')}</span>
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handlePasscodeSubmit} className="space-y-4 py-1">
                <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-stone-700 text-[11px] sm:text-xs space-y-1.5">
                  <p className="font-bold text-amber-950">{t('loginStep1Title')}</p>
                  <p className="leading-relaxed text-stone-600">{t('loginStep1Desc')}</p>
                </div>

                {passcodeError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] sm:text-xs text-rose-700 flex items-start gap-2 leading-relaxed">
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <span>{passcodeError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="input-app-passcode" className="block text-xs font-bold text-stone-700">
                    {t('loginTabPasscode')}
                  </label>
                  <div className="relative">
                    <input
                      id="input-app-passcode"
                      type={showPasscode ? 'text' : 'password'}
                      value={passcodeInput}
                      onChange={(e) => {
                        setPasscodeInput(e.target.value);
                        if (passcodeError) setPasscodeError(null);
                      }}
                      placeholder={t('loginPasscodePlaceholder')}
                      autoFocus
                      autoComplete="current-password"
                      className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-stone-300 bg-white text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasscode((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700 transition cursor-pointer"
                      aria-label={showPasscode ? t('loginPasscodeHide') : t('loginPasscodeShow')}
                    >
                      {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  id="btn-unlock-local-passcode"
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-98 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm shadow-amber-900/20 transition cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>
                    {returnToAdminAfterUnlock ? t('loginUnlockThenAdminBtn') : t('loginUnlockBtn')}
                  </span>
                </button>
              </form>
            )
          ) : !isLocalEditUnlocked ? (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <span className="inline-block px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                  {t('loginNeedStep1Badge')}
                </span>
                <h3 className="text-sm font-bold text-stone-900">{t('loginNeedStep1Title')}</h3>
                <p className="text-[11px] sm:text-xs text-stone-500 leading-relaxed">
                  {t('loginNeedStep1Desc')}
                </p>
              </div>
              <button
                id="btn-go-unlock-passcode-first"
                type="button"
                onClick={() => {
                  setReturnToAdminAfterUnlock(true);
                  setLoginModalTab('local');
                }}
                className="w-full py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
                <span>{t('loginGoStep1Btn')}</span>
              </button>
            </div>
          ) : currentUser ? (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-stone-900">{t('loginSignedInTitle')}</h3>
                <p className="text-[11px] sm:text-xs text-stone-500 mt-1 break-all">
                  {t('loginVerifiedAccount')}{' '}
                  <span className="font-semibold text-stone-800">{currentUser.displayName || t('menuRoleAdmin')}</span>
                </p>
                <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] sm:text-xs font-semibold">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>{t('loginAdminRoleBadge')}</span>
                </div>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={logout}
                  className="w-full py-2.5 rounded-xl border border-stone-300 hover:bg-stone-50 text-xs font-semibold text-stone-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-500" />
                  <span>{t('menuAdminLogout')}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 text-stone-600 text-[11px] sm:text-xs space-y-1.5">
                <p className="font-bold text-stone-800">{t('loginStep2Title')}</p>
                <p className="leading-relaxed">{t('loginStep2Desc')}</p>
              </div>

              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] sm:text-xs text-rose-700 flex items-start gap-2 leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                id="btn-google-signin"
                type="button"
                onClick={handleGoogleLogin}
                disabled={isSubmitting || isLoading}
                className="w-full py-3 px-4 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 active:scale-98 text-stone-800 text-xs sm:text-sm font-bold flex items-center justify-center gap-2.5 shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                )}
                <span>{isSubmitting ? t('loginGoogleSigningIn') : t('loginGoogleBtn')}</span>
              </button>

              {canUseRedirectFallback && showRedirectFallback && (
                <button
                  type="button"
                  onClick={handleRedirectLogin}
                  disabled={isSubmitting || isLoading}
                  className="w-full py-2.5 px-4 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  <span>{t('loginGoogleRedirectBtn')}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 sm:px-6 py-3 bg-stone-50 border-t border-stone-200 text-[10px] sm:text-[11px] text-stone-500 flex items-center justify-between shrink-0">
          <span className="truncate mr-2">{t('loginFooterVisitor')}</span>
          <span className="text-amber-700 font-bold shrink-0">
            {!isLocalEditUnlocked || loginModalTab === 'local' ? t('loginFooterLocal') : t('loginFooterAdmin')}
          </span>
        </div>
      </div>
    </div>
  );
};
