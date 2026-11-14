import type { CellValue, FilterOperator, Property, PropertyType, ViewFilter } from '@/lib/commands';
import { i18n } from '@/lib/i18n';
import { propertyTypeDefinition } from './registry';
import { compareInDirection, dateRules, numberRules, selectRules, textRules } from './rules';
import type { PropertyValueRules } from './types';

function property(type: PropertyType, more: Partial<Property> = {}): Property {
  return {
    id: 'p',
    databaseId: 'db',
    name: 'P',
    type,
    position: 0,
    options: [],
    targetId: null,
    ...more,
  };
}

const text = property('text');
const number = property('number');
const date = property('date');
// The order of the options is not the order of their names or ids.
const select = property('select', {
  options: [
    { id: 'c', name: 'Todo', color: 'gray' },
    { id: 'a', name: 'Doing', color: 'blue' },
    { id: 'b', name: 'Done', color: 'green' },
  ],
});

function sorted(
  rules: PropertyValueRules,
  prop: Property,
  values: (CellValue | undefined)[],
  direction: 'asc' | 'desc' = 'asc',
) {
  return [...values].sort((a, b) => compareInDirection(rules, a, b, prop, direction));
}

function filter(operator: FilterOperator, value: ViewFilter['value']): ViewFilter {
  return { propertyId: 'p', operator, value };
}

describe('the registry', () => {
  it('has an entry for text, number, date and select', () => {
    for (const type of ['text', 'number', 'date', 'select'] as const) {
      expect(propertyTypeDefinition(type)).toBeDefined();
    }
  });

  it('has none for relation yet, so callers can skip it', () => {
    expect(propertyTypeDefinition('relation')).toBeUndefined();
  });
});

describe('compare', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('orders text ignoring case, in the UI language, empties last', () => {
    expect(textRules.compare('apple', 'Banana', text)).toBeLessThan(0);
    expect(textRules.compare('Apple', 'apple', text)).toBe(0);
    expect(
      sorted(textRules, text, ['b', null, 'B2', '', 'a', undefined, 'Item 10', 'Item 2']),
    ).toEqual(['a', 'b', 'B2', 'Item 2', 'Item 10', null, '', undefined]);
  });

  it('places umlauts the way the UI language does', async () => {
    await i18n.changeLanguage('de');
    expect(sorted(textRules, text, ['Zebra', 'Äpfel', 'Apfel'])).toEqual([
      'Apfel',
      'Äpfel',
      'Zebra',
    ]);
  });

  it('orders numbers numerically, empties last', () => {
    expect(sorted(numberRules, number, [10, null, 9, -1.5, undefined, 100, 0])).toEqual([
      -1.5,
      0,
      9,
      10,
      100,
      null,
      undefined,
    ]);
  });

  it('orders dates chronologically, empties and invalid dates last', () => {
    expect(
      sorted(dateRules, date, ['2026-11-14', null, '2025-12-31', 'not a date', '2026-02-01']),
    ).toEqual(['2025-12-31', '2026-02-01', '2026-11-14', null, 'not a date']);
  });

  it('orders select values by the position of their option, deleted options last', () => {
    expect(sorted(selectRules, select, ['b', null, 'gone', 'c', 'a'])).toEqual([
      'c',
      'a',
      'b',
      null,
      'gone',
    ]);
  });

  it('treats values of the wrong kind as empty', () => {
    expect(textRules.compare(5, 'a', text)).toBe(1);
    expect(numberRules.compare('5', 1, number)).toBe(1);
    expect(numberRules.compare(Number.NaN, 1, number)).toBe(1);
  });

  it('keeps empties last when sorting in descending order', () => {
    expect(sorted(textRules, text, ['a', null, 'c', '', 'b'], 'desc')).toEqual([
      'c',
      'b',
      'a',
      null,
      '',
    ]);
    expect(sorted(numberRules, number, [1, 3, null, 2], 'desc')).toEqual([3, 2, 1, null]);
    // A missing key: \`Array.sort\` would move \`undefined\` to the end without asking.
    expect(compareInDirection(numberRules, undefined, 1, number, 'desc')).toBeGreaterThan(0);
    expect(compareInDirection(numberRules, 1, undefined, number, 'desc')).toBeLessThan(0);
    expect(sorted(dateRules, date, ['2026-01-01', null, '2026-03-01'], 'desc')).toEqual([
      '2026-03-01',
      '2026-01-01',
      null,
    ]);
    expect(sorted(selectRules, select, ['c', 'gone', 'b', 'a'], 'desc')).toEqual([
      'b',
      'a',
      'c',
      'gone',
    ]);
  });

  it('keeps empties last when sorting in ascending order', () => {
    expect(sorted(numberRules, number, [null, 2, 1], 'asc')).toEqual([1, 2, null]);
    expect(compareInDirection(numberRules, undefined, 1, number, 'asc')).toBeGreaterThan(0);
    expect(compareInDirection(numberRules, 1, undefined, number, 'asc')).toBeLessThan(0);
    expect(compareInDirection(numberRules, undefined, null, number, 'asc')).toBe(0);
  });
});

describe('matches for text', () => {
  const m = (
    value: CellValue | undefined,
    operator: FilterOperator,
    filterValue: ViewFilter['value'],
  ) => textRules.matches(value, filter(operator, filterValue), text);

  it('offers the operators of the views spec', () => {
    expect(textRules.operators).toEqual([
      'contains',
      'notContains',
      'equals',
      'isEmpty',
      'isNotEmpty',
    ]);
  });

  it('contains, ignoring case', () => {
    expect(m('Write the Spec', 'contains', 'spec')).toBe(true);
    expect(m('Write the Spec', 'contains', 'code')).toBe(false);
    expect(m(null, 'contains', 'spec')).toBe(false);
  });

  it('does not contain, ignoring case; an empty cell contains nothing', () => {
    expect(m('Write the Spec', 'notContains', 'SPEC')).toBe(false);
    expect(m('Write the Spec', 'notContains', 'code')).toBe(true);
    expect(m(null, 'notContains', 'code')).toBe(true);
  });

  it('equals, ignoring case', () => {
    expect(m('Done', 'equals', 'done')).toBe(true);
    expect(m('Done!', 'equals', 'done')).toBe(false);
    expect(m(undefined, 'equals', 'done')).toBe(false);
  });

  it('is empty and is not empty; an empty string is empty', () => {
    expect(m(null, 'isEmpty', null)).toBe(true);
    expect(m(undefined, 'isEmpty', null)).toBe(true);
    expect(m('', 'isEmpty', null)).toBe(true);
    expect(m('a', 'isEmpty', null)).toBe(false);
    expect(m('a', 'isNotEmpty', null)).toBe(true);
    expect(m('', 'isNotEmpty', null)).toBe(false);
  });

  it('lets every row through while the filter has no value', () => {
    for (const operator of ['contains', 'notContains', 'equals'] as const) {
      expect(m('a', operator, null)).toBe(true);
      expect(m(null, operator, null)).toBe(true);
      expect(m('a', operator, '')).toBe(true);
    }
  });
});

describe('matches for number', () => {
  const m = (
    value: CellValue | undefined,
    operator: FilterOperator,
    filterValue: ViewFilter['value'],
  ) => numberRules.matches(value, filter(operator, filterValue), number);

  it('offers the operators of the views spec', () => {
    expect(numberRules.operators).toEqual([
      'equals',
      'notEquals',
      'greaterThan',
      'lessThan',
      'isEmpty',
      'isNotEmpty',
    ]);
  });

  it('equals and does not equal', () => {
    expect(m(3, 'equals', 3)).toBe(true);
    expect(m(3, 'equals', 4)).toBe(false);
    expect(m(null, 'equals', 3)).toBe(false);
    expect(m(3, 'notEquals', 3)).toBe(false);
    expect(m(3, 'notEquals', 4)).toBe(true);
    expect(m(null, 'notEquals', 3)).toBe(true);
  });

  it('is greater than and less than', () => {
    expect(m(5, 'greaterThan', 3)).toBe(true);
    expect(m(3, 'greaterThan', 3)).toBe(false);
    expect(m(null, 'greaterThan', 3)).toBe(false);
    expect(m(2, 'lessThan', 3)).toBe(true);
    expect(m(3, 'lessThan', 3)).toBe(false);
    expect(m(null, 'lessThan', 3)).toBe(false);
  });

  it('accepts a filter value typed as text', () => {
    expect(m(2.5, 'equals', '2.5')).toBe(true);
    expect(m(2, 'greaterThan', '1')).toBe(true);
  });

  it('is empty and is not empty', () => {
    expect(m(null, 'isEmpty', null)).toBe(true);
    expect(m(0, 'isEmpty', null)).toBe(false);
    expect(m(0, 'isNotEmpty', null)).toBe(true);
    expect(m(undefined, 'isNotEmpty', null)).toBe(false);
  });

  it('lets every row through while the filter has no number', () => {
    for (const operator of ['equals', 'notEquals', 'greaterThan', 'lessThan'] as const) {
      expect(m(1, operator, null)).toBe(true);
      expect(m(null, operator, null)).toBe(true);
      expect(m(1, operator, 'abc')).toBe(true);
    }
  });
});

describe('matches for date', () => {
  const m = (
    value: CellValue | undefined,
    operator: FilterOperator,
    filterValue: ViewFilter['value'],
  ) => dateRules.matches(value, filter(operator, filterValue), date);

  it('offers the operators of the views spec', () => {
    expect(dateRules.operators).toEqual(['equals', 'before', 'after', 'isEmpty', 'isNotEmpty']);
  });

  it('is, before and after', () => {
    expect(m('2026-11-14', 'equals', '2026-11-14')).toBe(true);
    expect(m('2026-11-15', 'equals', '2026-11-14')).toBe(false);
    expect(m('2026-11-13', 'before', '2026-11-14')).toBe(true);
    expect(m('2026-11-14', 'before', '2026-11-14')).toBe(false);
    expect(m('2026-11-15', 'after', '2026-11-14')).toBe(true);
    expect(m('2026-11-14', 'after', '2026-11-14')).toBe(false);
    for (const operator of ['equals', 'before', 'after'] as const) {
      expect(m(null, operator, '2026-11-14')).toBe(false);
    }
  });

  it('is empty and is not empty', () => {
    expect(m(null, 'isEmpty', null)).toBe(true);
    expect(m('2026-11-14', 'isEmpty', null)).toBe(false);
    expect(m('2026-11-14', 'isNotEmpty', null)).toBe(true);
    expect(m(undefined, 'isNotEmpty', null)).toBe(false);
  });

  it('lets every row through while the filter has no date', () => {
    for (const operator of ['equals', 'before', 'after'] as const) {
      expect(m('2026-11-14', operator, null)).toBe(true);
      expect(m(null, operator, null)).toBe(true);
      expect(m('2026-11-14', operator, '14.11.2026')).toBe(true);
    }
  });
});

describe('matches for select', () => {
  const m = (
    value: CellValue | undefined,
    operator: FilterOperator,
    filterValue: ViewFilter['value'],
  ) => selectRules.matches(value, filter(operator, filterValue), select);

  it('offers the operators of the views spec', () => {
    expect(selectRules.operators).toEqual(['equals', 'notEquals', 'isEmpty', 'isNotEmpty']);
  });

  it('is and is not', () => {
    expect(m('a', 'equals', 'a')).toBe(true);
    expect(m('b', 'equals', 'a')).toBe(false);
    expect(m(null, 'equals', 'a')).toBe(false);
    expect(m('a', 'notEquals', 'a')).toBe(false);
    expect(m('b', 'notEquals', 'a')).toBe(true);
    expect(m(null, 'notEquals', 'a')).toBe(true);
  });

  it('counts a value that is no option as empty', () => {
    expect(m('gone', 'isEmpty', null)).toBe(true);
    expect(m('gone', 'isNotEmpty', null)).toBe(false);
    expect(m('gone', 'equals', 'a')).toBe(false);
    expect(m('gone', 'notEquals', 'a')).toBe(true);
    expect(m('a', 'isNotEmpty', null)).toBe(true);
  });

  it('lets every row through while the filter has no option, or one that is gone', () => {
    for (const operator of ['equals', 'notEquals'] as const) {
      expect(m('a', operator, null)).toBe(true);
      expect(m(null, operator, null)).toBe(true);
      expect(m('a', operator, 'gone')).toBe(true);
    }
  });
});

describe('matches with an operator the type does not have', () => {
  it('hides nothing', () => {
    expect(textRules.matches('a', filter('greaterThan', 'b'), text)).toBe(true);
    expect(selectRules.matches('a', filter('contains', 'b'), select)).toBe(true);
  });
});
