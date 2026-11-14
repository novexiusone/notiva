import { format, isValid, parse } from 'date-fns';
import { de as dateFnsDe, enUS as dateFnsEn } from 'date-fns/locale';
import { de as dayPickerDe, enUS as dayPickerEn } from 'react-day-picker/locale';

/** How dates are stored: a calendar day without a time or a time zone. */
export const DATE_FORMAT = 'yyyy-MM-dd';

function isGerman(language: string) {
  return language.toLowerCase().split('-')[0] === 'de';
}

/** The date-fns locale of a UI language. */
export function dateLocale(language: string) {
  return isGerman(language) ? dateFnsDe : dateFnsEn;
}

/** The calendar's locale of a UI language: month and weekday names, first day of the week. */
export function calendarLocale(language: string) {
  return isGerman(language) ? dayPickerDe : dayPickerEn;
}

/** A stored date as a local `Date`, or `null` when it is not a real calendar day. */
export function parseStoredDate(value: string): Date | null {
  const date = parse(value, DATE_FORMAT, new Date());
  // `parse` accepts "2026-1-5"; only the stored form counts.
  return isValid(date) && format(date, DATE_FORMAT) === value ? date : null;
}

export function toStoredDate(date: Date) {
  return format(date, DATE_FORMAT);
}

/** A stored date in the UI language, e.g. "Nov 14, 2026" or "14. Nov. 2026". */
export function formatDate(value: string, language: string) {
  const date = parseStoredDate(value);
  return date ? format(date, 'PP', { locale: dateLocale(language) }) : '';
}

/** A number in the UI language, with every fraction digit it has. */
export function formatNumber(value: number, language: string) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 20 }).format(value);
}

function decimalSeparator(language: string) {
  return (
    new Intl.NumberFormat(language).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  );
}

/** A number as the editor shows it: no grouping, the UI language's decimal separator. */
export function numberToInput(value: number, language: string) {
  return String(value).replace('.', decimalSeparator(language));
}

const numberPattern = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * What a user typed as a number: `null` for nothing, `undefined` for anything
 * that is not a finite number. The UI language's decimal separator and `.`
 * both work; grouping separators do not.
 */
export function parseNumberInput(text: string, language: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(decimalSeparator(language), '.');
  if (!numberPattern.test(normalized)) return undefined;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}
