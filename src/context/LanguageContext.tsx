import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { SupportedLanguage, translations, TranslationKeys, LANGUAGE_OPTIONS, LanguageOption } from '../i18n/translations';

interface LanguageContextType {
  language: SupportedLanguage;
  systemLanguage: SupportedLanguage;
  isSystemLanguage: boolean;
  hasManualOverride: boolean;
  setLanguage: (lang: SupportedLanguage) => void;
  resetToSystemLanguage: () => void;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  languageOptions: LanguageOption[];
  currentOption: LanguageOption;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const MANUAL_OVERRIDE_KEY = 'bike_diary_manual_override';
const LEGACY_STORAGE_KEY = 'bike_diary_lang_pref';

/**
 * Detect the operating system or browser's language preference.
 * Defaults to English ('en') when no supported system language matches.
 */
export const detectSystemLanguage = (): SupportedLanguage => {
  if (typeof navigator === 'undefined') return 'en';
  try {
    const candidateLangs: string[] = [];
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      candidateLangs.push(...navigator.languages);
    }
    if (navigator.language) {
      candidateLangs.push(navigator.language);
    }
    if ((navigator as any).userLanguage) {
      candidateLangs.push((navigator as any).userLanguage);
    }
    if ((navigator as any).browserLanguage) {
      candidateLangs.push((navigator as any).browserLanguage);
    }

    for (const lang of candidateLangs) {
      if (!lang || typeof lang !== 'string') continue;
      const clean = lang.toLowerCase().trim().split('-')[0].split('_')[0];
      const matched = LANGUAGE_OPTIONS.find(opt => opt.code === clean);
      if (matched) {
        return matched.code;
      }
      if (clean === 'eng') return 'en';
      if (clean === 'kor') return 'ko';
      if (clean === 'jpn' || clean === 'jp') return 'ja';
      if (clean === 'vie') return 'vi';
      if (clean === 'spa') return 'es';
    }
  } catch (e) {
    console.warn('System language detection error:', e);
  }
  return 'en';
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [systemLanguage, setSystemLanguage] = useState<SupportedLanguage>(() => detectSystemLanguage());
  const [hasManualOverride, setHasManualOverride] = useState<boolean>(false);
  const [language, setLanguageState] = useState<SupportedLanguage>(() => detectSystemLanguage());
  const lastSystemLangRef = useRef<SupportedLanguage>(systemLanguage);
  const hasManualOverrideRef = useRef<boolean>(hasManualOverride);

  useEffect(() => {
    hasManualOverrideRef.current = hasManualOverride;
  }, [hasManualOverride]);

  // Clear legacy persisted manual overrides on mount so startup always defaults to English / system language
  useEffect(() => {
    try {
      localStorage.removeItem(MANUAL_OVERRIDE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Listen to browser/system language changes in real-time (and re-check when returning to tab)
  useEffect(() => {
    const syncWithSystemLanguage = (forceOnChange: boolean) => {
      const detected = detectSystemLanguage();
      const prevSystemLang = lastSystemLangRef.current;
      lastSystemLangRef.current = detected;
      setSystemLanguage(detected);

      if (!hasManualOverrideRef.current || (forceOnChange && detected !== prevSystemLang)) {
        setHasManualOverride(false);
        setLanguageState(detected);
        document.documentElement.lang = detected;
      }
    };

    const handleLanguageChange = () => {
      syncWithSystemLanguage(true);
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        syncWithSystemLanguage(true);
      }
    };

    window.addEventListener('languagechange', handleLanguageChange);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('languagechange', handleLanguageChange);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

  const setLanguage = (newLang: SupportedLanguage) => {
    setLanguageState(newLang);
    setHasManualOverride(true);
    document.documentElement.lang = newLang;
  };

  const resetToSystemLanguage = useCallback(() => {
    try {
      localStorage.removeItem(MANUAL_OVERRIDE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
    const detected = detectSystemLanguage();
    lastSystemLangRef.current = detected;
    setSystemLanguage(detected);
    setHasManualOverride(false);
    setLanguageState(detected);
    document.documentElement.lang = detected;
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: TranslationKeys, params?: Record<string, string | number>): string => {
    const langDict = translations[language] || translations.en;
    let str: string = (langDict as any)[key] || (translations.en as any)[key] || (translations.ko as any)[key] || String(key);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }

    return str;
  };

  const currentOption = LANGUAGE_OPTIONS.find(opt => opt.code === language) || LANGUAGE_OPTIONS[0];
  const isSystemLanguage = language === systemLanguage && !hasManualOverride;

  return (
    <LanguageContext.Provider
      value={{
        language,
        systemLanguage,
        isSystemLanguage,
        hasManualOverride,
        setLanguage,
        resetToSystemLanguage,
        t,
        languageOptions: LANGUAGE_OPTIONS,
        currentOption,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
