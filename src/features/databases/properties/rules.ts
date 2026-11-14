import type { CellValue, FilterOperator, Property, ViewFilter, ViewSort } from '@/lib/commands';
import { i18n } from '@/lib/i18n';
import { parseStoredDate } from './format';
import type { PropertyValueRules } from './types';

type Cell = CellValue | undefined;

/** Operators that a row without a value passes, because it holds nothing to compare. */
const negativeOperators: readonly FilterOperator[] = ['notContains', 'notEquals'];

/**
 * Builds the rules of a type from three pieces: how a cell reads as a value of
 * the type (`undefined` when it is empty), how two such values are ordered, and
 * how a value is tested against the value of a filter.
 */
function defineRules<T, F>({
  read,
  order,
  readFilter,
  operators,
  test,
}: {
  read: (value: Cell, property: Property) => T | undefined;
  order: (a: T, b: T, property: Property) => number;
  /** `undefined` when the filter is still being built or names something that is gone. */
  readFilter: (value: ViewFilter['value'], property: Property) => F | undefined;
  operators: readonly FilterOperator[];
  test: (value: T, filterValue: F, operator: FilterOperator) => boolean;
}): PropertyValueRules {
  const isEmpty = (value: Cell, property: Property) => read(value, property) === undefined;

  return {
    isEmpty,
    operators,
    compare: (a, b, property) => {
      const left = read(a, property);
      const right = read(b, property);
      if (left === undefined) return right === undefined ? 0 : 1;
      if (right === undefined) return -1;
      return order(left, right, property);
    },
    matches: (value, filter, property) => {
      // A filter from an older configuration hides nothing rather than everything.
      if (!operators.includes(filter.operator)) return true;
      if (filter.operator === 'isEmpty') return isEmpty(value, property);
      if (filter.operator === 'isNotEmpty') return !isEmpty(value, property);

      const filterValue = readFilter(filter.value, property);
      if (filterValue === undefined) return true;
      const cell = read(value, property);
      if (cell === undefined) return negativeOperators.includes(filter.operator);
      return test(cell, filterValue, filter.operator);
    },
  };
}

const collators = new Map<string, Intl.Collator>();

/** Compares text in the UI language, ignoring case, with "2" before "10". */
function compareText(a: string, b: string) {
  const language = i18n.language || 'en';
  let collator = collators.get(language);
  if (!collator) {
    collator = new Intl.Collator(language, { sensitivity: 'accent', numeric: true });
    collators.set(language, collator);
  }
  return collator.compare(a, b);
}

function lowerCase(text: string) {
  return text.toLocaleLowerCase(i18n.language || 'en');
}

export const textRules = defineRules<string, string>({
  read: (value) => (typeof value === 'string' && value !== '' ? value : undefined),
  order: compareText,
  readFilter: (value) => {
    if (value === null || value === '') return undefined;
    return lowerCase(String(value));
  },
  operators: ['contains', 'notContains', 'equals', 'isEmpty', 'isNotEmpty'],
  test: (value, filterValue, operator) => {
    const text = lowerCase(value);
    if (operator === 'contains') return text.includes(filterValue);
    if (operator === 'notContains') return !text.includes(filterValue);
    return text === filterValue;
  },
});

export const numberRules = defineRules<number, number>({
  read: (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined),
  order: (a, b) => a - b,
  readFilter: (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (value === null || value.trim() === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  },
  operators: ['equals', 'notEquals', 'greaterThan', 'lessThan', 'isEmpty', 'isNotEmpty'],
  test: (value, filterValue, operator) => {
    if (operator === 'equals') return value === filterValue;
    if (operator === 'notEquals') return value !== filterValue;
    if (operator === 'greaterThan') return value > filterValue;
    return value < filterValue;
  },
});

function readDate(value: Cell | ViewFilter['value']) {
  return typeof value === 'string' && parseStoredDate(value) ? value : undefined;
}

/** `yyyy-MM-dd` strings sort chronologically as text. */
function compareDates(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const dateRules = defineRules<string, string>({
  read: readDate,
  order: compareDates,
  readFilter: readDate,
  operators: ['equals', 'before', 'after', 'isEmpty', 'isNotEmpty'],
  test: (value, filterValue, operator) => {
    const order = compareDates(value, filterValue);
    if (operator === 'before') return order < 0;
    if (operator === 'after') return order > 0;
    return order === 0;
  },
});

/** The position of an option in the property's list, or `undefined` when there is none. */
function optionIndex(value: Cell | ViewFilter['value'], property: Property) {
  if (typeof value !== 'string') return undefined;
  const index = property.options.findIndex((option) => option.id === value);
  return index === -1 ? undefined : index;
}

export const selectRules = defineRules<number, number>({
  // An option that has been deleted reads as an empty cell.
  read: optionIndex,
  order: (a, b) => a - b,
  readFilter: optionIndex,
  operators: ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'],
  test: (value, filterValue, operator) =>
    operator === 'equals' ? value === filterValue : value !== filterValue,
});

/**
 * Orders two cells in a sort's direction. Empty cells stay after every other
 * value in both directions; only the order of the other values is reversed.
 */
export function compareInDirection(
  rules: PropertyValueRules,
  a: Cell,
  b: Cell,
  property: Property,
  direction: ViewSort['direction'],
) {
  const order = rules.compare(a, b, property);
  if (direction === 'asc' || rules.isEmpty(a, property) || rules.isEmpty(b, property)) {
    return order;
  }
  return -order;
}
