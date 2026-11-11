import { detectLanguage } from '@/lib/i18n';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

function keys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null
      ? keys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('detectLanguage', () => {
  it('uses the first supported language', () => {
    expect(detectLanguage(['fr-FR', 'de-DE', 'en-US'])).toBe('de');
  });

  it('ignores the region', () => {
    expect(detectLanguage(['de-AT'])).toBe('de');
  });

  it('falls back to English', () => {
    expect(detectLanguage(['fr-FR'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
});

describe('locales', () => {
  it('have the same keys in every language', () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });
});
