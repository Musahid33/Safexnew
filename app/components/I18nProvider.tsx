'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/types';

const LANGUAGE_STORAGE_KEY = 'safex-language';
const LANGUAGE_HTML_TAG: Record<Language, string> = {
  en: 'en', hi: 'hi-IN', or: 'or-IN', bn: 'bn-IN', pa: 'pa-IN', mr: 'mr-IN'
};

export type TranslationParams = Record<string, string | number>;
export type Translator = (source: string, params?: TranslationParams) => string;

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  T: Translator;
};

const I18nContext = createContext<I18nContextValue | null>(null);
const ALL_LANGUAGES: Language[] = ['en', 'hi', 'or', 'bn', 'pa', 'mr'];

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('hi');
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
      if (stored && ALL_LANGUAGES.includes(stored)) setLanguageState(stored);
    } catch { /* Keep the session language if browser storage is unavailable. */ }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = LANGUAGE_HTML_TAG[language];
    if (!preferencesReady) return;
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); }
    catch { /* The language still applies for this session if storage is blocked. */ }
  }, [language, preferencesReady]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY || !event.newValue) return;
      if (ALL_LANGUAGES.includes(event.newValue as Language)) setLanguageState(event.newValue as Language);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); }
    catch { /* State is still changed immediately for this session. */ }
  }, []);

  const translate = useCallback<Translator>((source, params) => t(language, source, params), [language]);
  const value = useMemo(() => ({ language, setLanguage, T: translate }), [language, setLanguage, translate]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider.');
  return context;
}
