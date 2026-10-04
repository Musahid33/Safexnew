'use client';

import { LANGUAGES } from '@/lib/i18n';
import type { Language } from '@/lib/types';
import { useI18n } from './I18nProvider';

type Props = {
  language: Language;
  onChange: (language: Language) => void;
  className?: string;
};

export default function LanguageStrip({ language, onChange, className = '' }: Props) {
  const { T } = useI18n();
  return <nav className={`language-strip ${className}`.trim()} aria-label={T('Choose language')}>
    {LANGUAGES.map((item) => <button
      key={item.id}
      type="button"
      className={`language-chip ${language === item.id ? 'active' : ''}`}
      aria-pressed={language === item.id}
      title={item.native}
      onClick={() => onChange(item.id)}
    >{item.native}</button>)}
  </nav>;
}
