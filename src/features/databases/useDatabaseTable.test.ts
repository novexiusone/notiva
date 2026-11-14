import { act, renderHook } from '@testing-library/react';
import type {
  CellValue,
  FilterOperator,
  Property,
  PropertyType,
  Row,
  ViewConfig,
  ViewFilter,
  ViewSort,
} from '@/lib/commands';
import { useDatabaseTable } from './useDatabaseTable';
import { emptyViewConfig } from './viewState';

function property(id: string, type: PropertyType, position: number): Property {
  return { id, databaseId: 'db', name: id, type, position, options: [], targetId: null };
}

const properties: Property[] = [
  property('notes', 'text', 0),
  property('hours', 'number', 1),
  property('due', 'date', 2),
  {
    ...property('status', 'select', 3),
    options: [
      { id: 'todo', name: 'Todo', color: 'gray' },
      { id: 'doing', name: 'Doing', color: 'blue' },
      { id: 'done', name: 'Done', color: 'green' },
    ],
  },
];

function row(id: string, title: string, cells: Record<string, CellValue>, position = 0): Row {
  return { id, title, position, cells };
}

// In their manual order. "e" has nothing but a title, "f" not even that.
const rows: Row[] = [
  row('a', 'Write spec', { notes: 'First Draft', hours: 3, due: '2026-11-14', status: 'done' }),
  row('b', 'Build it', { notes: 'later', hours: 8, due: '2026-12-01', status: 'doing' }),
  row('c', 'Test it', { notes: 'draft two', hours: 3, due: '2026-10-01', status: 'todo' }),
  row('d', 'Ship it', { notes: '', hours: 0.5, status: 'gone-option' }),
  row('e', 'Celebrate', {}),
  row('f', '', { hours: 13 }),
];

function shown(config: ViewConfig | null, data = rows) {
  const { result } = renderHook(() => useDatabaseTable(properties, data, config));
  return result.current.items.map((item) => (item.kind === 'row' ? item.id : `[${item.key}]`));
}

function filtered(...filters: ViewFilter[]) {
  return shown({ ...emptyViewConfig('table'), filters });
}

function sorted(...sorts: ViewSort[]) {
  return shown({ ...emptyViewConfig('table'), sorts });
}

const filter = (
  propertyId: string,
  operator: FilterOperator,
  value: ViewFilter['value'] = null,
): ViewFilter => ({ propertyId, operator, value });

describe('filtering in the table', () => {
  it('shows every row in its manual order without a view or a filter', () => {
    expect(shown(null)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(filtered()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it.each<[string, ViewFilter, string[]]>([
    ['text contains, ignoring case', filter('notes', 'contains', 'DRAFT'), ['a', 'c']],
    ['text does not contain', filter('notes', 'notContains', 'draft'), ['b', 'd', 'e', 'f']],
    ['text is', filter('notes', 'equals', 'later'), ['b']],
    ['text is empty', filter('notes', 'isEmpty'), ['d', 'e', 'f']],
    ['text is not empty', filter('notes', 'isNotEmpty'), ['a', 'b', 'c']],
    ['title contains', filter('title', 'contains', ' it'), ['b', 'c', 'd']],
    ['title is empty', filter('title', 'isEmpty'), ['f']],
    ['number =', filter('hours', 'equals', 3), ['a', 'c']],
    ['number = written as text', filter('hours', 'equals', '3'), ['a', 'c']],
    ['number ≠', filter('hours', 'notEquals', 3), ['b', 'd', 'e', 'f']],
    ['number >', filter('hours', 'greaterThan', 3), ['b', 'f']],
    ['number <', filter('hours', 'lessThan', 3), ['d']],
    ['number is empty', filter('hours', 'isEmpty'), ['e']],
    ['number is not empty', filter('hours', 'isNotEmpty'), ['a', 'b', 'c', 'd', 'f']],
    ['date is', filter('due', 'equals', '2026-11-14'), ['a']],
    ['date before', filter('due', 'before', '2026-11-14'), ['c']],
    ['date after', filter('due', 'after', '2026-11-14'), ['b']],
    ['date is empty', filter('due', 'isEmpty'), ['d', 'e', 'f']],
    ['date is not empty', filter('due', 'isNotEmpty'), ['a', 'b', 'c']],
    ['select is', filter('status', 'equals', 'doing'), ['b']],
    ['select is not', filter('status', 'notEquals', 'doing'), ['a', 'c', 'd', 'e', 'f']],
    // An option that is gone reads as an empty cell.
    ['select is empty', filter('status', 'isEmpty'), ['d', 'e', 'f']],
    ['select is not empty', filter('status', 'isNotEmpty'), ['a', 'b', 'c']],
  ])('%s', (_, condition, expected) => {
    expect(filtered(condition)).toEqual(expected);
  });

  it.each<[string, ViewFilter]>([
    ['text', filter('notes', 'contains', '')],
    ['number', filter('hours', 'greaterThan', null)],
    ['number written as nothing', filter('hours', 'equals', '  ')],
    ['date', filter('due', 'before', null)],
    ['select', filter('status', 'equals', null)],
  ])('lets every row pass a %s condition whose value is still empty', (_, condition) => {
    expect(filtered(condition)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('shows the rows that meet every condition', () => {
    expect(
      filtered(
        filter('hours', 'greaterThan', 1),
        filter('notes', 'contains', 'draft'),
        filter('hours', 'lessThan', 5),
      ),
    ).toEqual(['a', 'c']);
  });

  it('skips a condition on a property that is gone', () => {
    expect(filtered(filter('gone', 'isEmpty'), filter('hours', 'equals', 3))).toEqual(['a', 'c']);
  });

  it('keeps the rows it is told to keep, whatever the filters say', () => {
    const config = { ...emptyViewConfig('table'), filters: [filter('hours', 'equals', 3)] };
    const { result, rerender } = renderHook(
      ({ keep }) => useDatabaseTable(properties, rows, config, { keepRowIds: keep }),
      { initialProps: { keep: new Set<string>() } },
    );
    expect(result.current.items.map((item) => item.id)).toEqual(['a', 'c']);

    rerender({ keep: new Set(['e']) });

    expect(result.current.items.map((item) => item.id)).toEqual(['a', 'c', 'e']);
  });
});

describe('sorting in the table', () => {
  it('sorts ascending and descending with empty values last in both directions', () => {
    expect(sorted({ propertyId: 'hours', direction: 'asc' })).toEqual([
      'd',
      'a',
      'c',
      'b',
      'f',
      'e',
    ]);
    expect(sorted({ propertyId: 'hours', direction: 'desc' })).toEqual([
      'f',
      'b',
      'a',
      'c',
      'd',
      'e',
    ]);
    expect(sorted({ propertyId: 'due', direction: 'desc' })).toEqual([
      'b',
      'a',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it('sorts a select by the order of its options and the title as text', () => {
    expect(sorted({ propertyId: 'status', direction: 'asc' })).toEqual([
      'c',
      'b',
      'a',
      'd',
      'e',
      'f',
    ]);
    expect(sorted({ propertyId: 'title', direction: 'asc' })).toEqual([
      'b',
      'e',
      'd',
      'c',
      'a',
      'f',
    ]);
  });

  it('applies several sorts in order', () => {
    expect(
      sorted({ propertyId: 'hours', direction: 'asc' }, { propertyId: 'title', direction: 'desc' }),
    ).toEqual(['d', 'a', 'c', 'b', 'f', 'e']);
    expect(
      sorted({ propertyId: 'hours', direction: 'asc' }, { propertyId: 'title', direction: 'asc' }),
    ).toEqual(['d', 'c', 'a', 'b', 'f', 'e']);
  });
});

describe('grouping in the table', () => {
  const grouped = (
    propertyId: string,
    collapsed: string[] = [],
    more: Partial<ViewConfig> = {},
  ): ViewConfig => ({
    ...emptyViewConfig('table'),
    ...more,
    type: 'table',
    groupBy: { propertyId, collapsed },
  });

  it('groups by the options in their order, with the rows without a value last', () => {
    expect(shown(grouped('status'))).toEqual([
      '[todo]',
      'c',
      '[doing]',
      'b',
      '[done]',
      'a',
      '[]',
      'd',
      'e',
      'f',
    ]);
  });

  it('groups numbers and dates by their values', () => {
    expect(shown(grouped('hours'))).toEqual([
      '[0.5]',
      'd',
      '[3]',
      'a',
      'c',
      '[8]',
      'b',
      '[13]',
      'f',
      '[]',
      'e',
    ]);
  });

  it('counts the rows of each group and hides the rows of a collapsed one', () => {
    const { result } = renderHook(() =>
      useDatabaseTable(properties, rows, grouped('status', ['done', ''])),
    );

    expect(result.current.items).toEqual([
      expect.objectContaining({ kind: 'group', key: 'todo', count: 1, expanded: true }),
      expect.objectContaining({ kind: 'row', id: 'c' }),
      expect.objectContaining({ kind: 'group', key: 'doing', count: 1 }),
      expect.objectContaining({ kind: 'row', id: 'b' }),
      expect.objectContaining({ kind: 'group', key: 'done', count: 1, expanded: false }),
      expect.objectContaining({ kind: 'group', key: '', value: null, count: 3, expanded: false }),
    ]);
  });

  it('sorts within the groups and follows a sort by the grouping property', () => {
    expect(
      shown(grouped('hours', [], { sorts: [{ propertyId: 'title', direction: 'asc' }] })),
    ).toEqual(['[0.5]', 'd', '[3]', 'c', 'a', '[8]', 'b', '[13]', 'f', '[]', 'e']);
    expect(
      shown(grouped('hours', [], { sorts: [{ propertyId: 'hours', direction: 'desc' }] })),
    ).toEqual(['[13]', 'f', '[8]', 'b', '[3]', 'a', 'c', '[0.5]', 'd', '[]', 'e']);
  });

  it('filters before it groups', () => {
    expect(shown(grouped('status', [], { filters: [filter('hours', 'lessThan', 4)] }))).toEqual([
      '[todo]',
      'c',
      '[done]',
      'a',
      '[]',
      'd',
    ]);
  });

  it('collapses a group through the table, into the configuration', () => {
    const onConfigChange = vi.fn();
    const config = grouped('status', ['done']);
    const { result } = renderHook(() =>
      useDatabaseTable(properties, rows, config, { onConfigChange }),
    );

    act(() =>
      result.current.table.setExpanded((expanded) => ({
        ...(expanded === true ? {} : expanded),
        'status:': false,
      })),
    );

    expect(onConfigChange).toHaveBeenCalledWith({
      ...config,
      groupBy: { propertyId: 'status', collapsed: ['done', ''] },
    });
  });
});

describe('the columns of the table', () => {
  it('follow the order, visibility and widths of the view', () => {
    const config: ViewConfig = {
      ...emptyViewConfig('table'),
      properties: [
        { propertyId: 'title', visible: true, width: 300 },
        { propertyId: 'status', visible: true, width: 120 },
        { propertyId: 'notes', visible: false, width: null },
      ],
    };
    const { result } = renderHook(() => useDatabaseTable(properties, rows, config));

    expect(result.current.columns.map((column) => [column.id, column.width])).toEqual([
      ['title', 300],
      ['status', 120],
      ['hours', 200],
      ['due', 200],
    ]);
  });
});

describe('a large database', () => {
  it('filters and groups 5,000 rows quickly enough to type', () => {
    const many = Array.from({ length: 5_000 }, (_, index) =>
      row(`r${index}`, `Row ${index}`, {
        hours: index % 17,
        status: ['todo', 'doing', 'done'][index % 4] ?? null,
      }),
    );
    const config: ViewConfig = {
      ...emptyViewConfig('table'),
      type: 'table',
      filters: [filter('hours', 'greaterThan', 3)],
      sorts: [{ propertyId: 'hours', direction: 'desc' }],
      groupBy: { propertyId: 'status', collapsed: [] },
    };

    const started = performance.now();
    const items = shown(config, many);
    const elapsed = performance.now() - started;

    expect(items.filter((item) => item.startsWith('['))).toEqual([
      '[todo]',
      '[doing]',
      '[done]',
      '[]',
    ]);
    expect(items).toHaveLength(
      4 + many.filter((entry) => (entry.cells.hours as number) > 3).length,
    );
    // Generous, for a slow machine under test load; it takes a few dozen milliseconds.
    expect(elapsed).toBeLessThan(1_000);
  });
});
