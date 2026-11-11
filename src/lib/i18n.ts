import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

export const supportedLanguages = ['en', 'de'] as const;
export type Language = (typeof supportedLanguages)[number];

/** Picks the first supported language from a list of BCP 47 tags, falling back to English. */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const match = supportedLanguages.find((language) => language === base);
    if (match) return match;
  }
  return 'en';
}

const language = detectLanguage(navigator.languages);
document.documentElement.lang = language;

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export { i18n };
