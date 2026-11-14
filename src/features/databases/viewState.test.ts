import type { Property, PropertyType, ViewConfig } from '@/lib/commands';
import {
  emptyViewConfig,
  fromConfig,
  groupKey,
  groupRowId,
  readFilters,
  readSorts,
  toConfig,
  withFilters,
  withGroupBy,
  withSorts,
} from './viewState';

function property(id: string, type: PropertyType, position: number): Property {
  return { id, databaseId: 'db', name: id, type, position, options: [], targetId: null };
}

const properties: Property[] = [
  {
    ...property('status', 'select', 2),
    options: [
      { id: 'open', name: 'Open', color: 'green' },
      { id: 'done', name: 'Done', color: 'gray' },
    ],
  },
  property('pages', 'number', 0),
  property('due', 'date', 1),
  property('notes', 'text', 3),
  // No column yet, but it exists.
  { ...property('link', 'relation', 4), targetId: 'db' },
];

const table: ViewConfig = {
  version: 1,
  type: 'table',
  filters: [
    { propertyId: 'status', operator: 'equals', value: 'open' },
    { propertyId: 'pages', operator: 'greaterThan', value: 300 },
    { propertyId: 'status', operator: 'notEquals', value: 'done' },
    { propertyId: 'due', operator: 'isNotEmpty', value: null },
    { propertyId: 'title', operator: 'contains', value: '' },
  ],
  sorts: [
    { propertyId: 'title', direction: 'desc' },
    { propertyId: 'pages', direction: 'asc' },
  ],
  properties: [
    { propertyId: 'title', visible: true, width: 240 },
    { propertyId: 'notes', visible: true, width: 120 },
    { propertyId: 'pages', visible: false, width: 80.5 },
    { propertyId: 'status', visible: true, width: null },
  ],
  groupBy: { propertyId: 'status', collapsed: ['open', ''] },
};

const kanban: ViewConfig = {
  version: 1,
  type: 'kanban',
  filters: [{ propertyId: 'title', operator: 'notContains', value: 'draft' }],
  sorts: [],
  properties: [{ propertyId: 'notes', visible: true, width: null }],
  groupPropertyId: 'status',
  hiddenGroups: ['done', ''],
};

const calendar: ViewConfig = {
  version: 1,
  type: 'calendar',
  filters: [{ propertyId: 'due', operator: 'before', value: '2026-12-24' }],
  sorts: [{ propertyId: 'due', direction: 'asc' }],
  properties: [],
  datePropertyId: 'due',
};

describe('the round trip through the table state', () => {
  it.each([
    ['table', table],
    ['kanban', kanban],
    ['calendar', calendar],
    ['empty table', emptyViewConfig('table')],
  ])('leaves a %s configuration unchanged', (_, config) => {
    const state = fromConfig(config, properties);
    expect(toConfig(structuredClone(state), config, properties)).toEqual(config);
  });

  it('reads a table into sorting, filters, grouping, collapsed groups and columns', () => {
    const state = fromConfig(table, properties);

    expect(state.sorting).toEqual([
      { id: 'title', desc: true },
      { id: 'pages', desc: false },
    ]);
    // Several conditions on one property share its column filter and keep their place.
    expect(state.columnFilters).toEqual([
      {
        id: 'status',
        value: [
          { index: 0, filter: table.filters[0] },
          { index: 2, filter: table.filters[2] },
        ],
      },
      { id: 'pages', value: [{ index: 1, filter: table.filters[1] }] },
      { id: 'due', value: [{ index: 3, filter: table.filters[3] }] },
      { id: 'title', value: [{ index: 4, filter: table.filters[4] }] },
    ]);
    expect(state.grouping).toEqual(['status']);
    expect(state.expanded).toEqual({ 'status:open': false, 'status:': false });
    expect(state.columnOrder).toEqual(['title', 'notes', 'pages', 'status', 'due']);
    expect(state.columnVisibility).toEqual({
      title: true,
      notes: true,
      pages: false,
      status: true,
      due: true,
    });
    expect(state.columnSizing).toEqual({ title: 240, notes: 120, pages: 80.5 });
  });

  it('writes a change to one part and keeps the rest as it was, with null for missing values', () => {
    const state = fromConfig(table, properties);

    const sorted = toConfig({ ...state, sorting: [{ id: 'due', desc: true }] }, table, properties);
    expect(sorted).toEqual({ ...table, sorts: [{ propertyId: 'due', direction: 'desc' }] });

    const resized = toConfig(
      { ...state, columnSizing: { ...state.columnSizing, due: 90 } },
      table,
      properties,
    );
    expect(resized.properties).toEqual([
      { propertyId: 'title', visible: true, width: 240 },
      { propertyId: 'notes', visible: true, width: 120 },
      { propertyId: 'pages', visible: false, width: 80.5 },
      { propertyId: 'status', visible: true, width: null },
      { propertyId: 'due', visible: true, width: 90 },
    ]);
    expect({ ...resized, properties: table.properties }).toEqual(table);

    const expanded = toConfig({ ...state, expanded: { 'status:': false } }, table, properties);
    expect(expanded).toMatchObject({ groupBy: { propertyId: 'status', collapsed: [''] } });

    const ungrouped = toConfig({ ...state, grouping: [] }, table, properties);
    expect(ungrouped).toEqual({ ...table, groupBy: null });
  });

  it('starts a new grouping with every group open', () => {
    const state = fromConfig(table, properties);
    expect(toConfig({ ...state, grouping: ['due'] }, table, properties)).toMatchObject({
      groupBy: { propertyId: 'due', collapsed: [] },
    });
  });

  it('does not write grouping into a view type that has none', () => {
    const state = fromConfig(kanban, properties);
    expect(toConfig({ ...state, grouping: ['status'] }, kanban, properties)).toEqual(kanban);
  });
});

describe('a configuration that mentions what is gone', () => {
  const stale: ViewConfig = {
    version: 1,
    type: 'table',
    filters: [
      { propertyId: 'deleted', operator: 'equals', value: 'a' },
      { propertyId: 'status', operator: 'equals', value: 'deleted-option' },
      { propertyId: 'status', operator: 'equals', value: 'open' },
      // The type changed from text to number.
      { propertyId: 'pages', operator: 'contains', value: 'x' },
    ],
    sorts: [
      { propertyId: 'deleted', direction: 'asc' },
      { propertyId: 'pages', direction: 'desc' },
    ],
    properties: [
      { propertyId: 'deleted', visible: false, width: 50 },
      { propertyId: 'pages', visible: false, width: null },
    ],
    groupBy: { propertyId: 'status', collapsed: ['deleted-option', 'done'] },
  };

  it('reads without the deleted property and the deleted option', () => {
    const state = fromConfig(stale, properties);

    expect(state.columnFilters).toEqual([
      { id: 'status', value: [{ index: 2, filter: stale.filters[2] }] },
    ]);
    expect(state.sorting).toEqual([{ id: 'pages', desc: true }]);
    expect(state.columnOrder).toEqual(['title', 'pages', 'due', 'status', 'notes']);
    expect(state.columnVisibility).toMatchObject({ pages: false });
    expect(state.columnVisibility).not.toHaveProperty('deleted');
    expect(state.columnSizing).toEqual({});
    expect(state.expanded).toEqual({ 'status:done': false });
    expect(readFilters(stale, properties)).toEqual([stale.filters[2]]);
    expect(readSorts(stale, properties)).toEqual([stale.sorts[1]]);
  });

  it('ignores grouping by a property that is gone', () => {
    const gone = { ...stale, groupBy: { propertyId: 'deleted', collapsed: ['a'] } };
    expect(fromConfig(gone, properties).grouping).toEqual([]);
    expect(fromConfig(gone, properties).expanded).toEqual({});
  });

  it('keeps the stale entries of a part that did not change, and drops them from one that did', () => {
    const state = fromConfig(stale, properties);

    const sorted = toConfig({ ...state, sorting: [] }, stale, properties);

    expect(sorted).toEqual({ ...stale, sorts: [] });
  });

  it('keeps what it mentions about a property that exists but has no column', () => {
    const config: ViewConfig = {
      ...emptyViewConfig('table'),
      filters: [{ propertyId: 'link', operator: 'isEmpty', value: null }],
      sorts: [{ propertyId: 'link', direction: 'asc' }],
      properties: [{ propertyId: 'link', visible: false, width: 300 }],
    };
    const state = fromConfig(config, properties);
    expect(state.columnFilters).toEqual([]);

    const changed = toConfig(
      {
        ...state,
        sorting: [{ id: 'pages', desc: false }],
        columnFilters: [
          {
            id: 'pages',
            value: [
              { index: 0, filter: { propertyId: 'pages', operator: 'isEmpty', value: null } },
            ],
          },
        ],
        columnVisibility: { ...state.columnVisibility, due: false },
      },
      config,
      properties,
    );

    expect(changed.sorts).toEqual([
      { propertyId: 'pages', direction: 'asc' },
      { propertyId: 'link', direction: 'asc' },
    ]);
    expect(changed.filters).toEqual([
      { propertyId: 'pages', operator: 'isEmpty', value: null },
      { propertyId: 'link', operator: 'isEmpty', value: null },
    ]);
    expect(changed.properties).toEqual([
      { propertyId: 'pages', visible: true, width: null },
      { propertyId: 'due', visible: false, width: null },
      { propertyId: 'status', visible: true, width: null },
      { propertyId: 'notes', visible: true, width: null },
      { propertyId: 'link', visible: false, width: 300 },
    ]);
  });
});

describe('the columns of a view', () => {
  it('shows the properties a view does not mention after the mentioned ones, in database order', () => {
    const config: ViewConfig = {
      ...emptyViewConfig('table'),
      properties: [{ propertyId: 'status', visible: true, width: null }],
    };

    expect(fromConfig(config, properties).columnOrder).toEqual([
      'title',
      'status',
      'pages',
      'due',
      'notes',
    ]);
  });

  it('puts the title first and always shows it', () => {
    const config: ViewConfig = {
      ...emptyViewConfig('table'),
      properties: [
        { propertyId: 'notes', visible: true, width: null },
        { propertyId: 'title', visible: false, width: 300 },
      ],
    };

    const state = fromConfig(config, properties);

    expect(state.columnOrder[0]).toBe('title');
    expect(state.columnVisibility.title).toBe(true);
    expect(state.columnSizing.title).toBe(300);
  });

  it('applies widths and order a configuration holds', () => {
    const config: ViewConfig = {
      ...emptyViewConfig('table'),
      properties: [
        { propertyId: 'notes', visible: true, width: 310 },
        { propertyId: 'due', visible: true, width: 90 },
      ],
    };

    const state = fromConfig(config, properties);

    expect(state.columnOrder).toEqual(['title', 'notes', 'due', 'pages', 'status']);
    expect(state.columnSizing).toEqual({ notes: 310, due: 90 });
  });

  it('writes every column once a column changes, so the order stays as it is shown', () => {
    const config = emptyViewConfig('table');
    const state = fromConfig(config, properties);

    const hidden = toConfig(
      { ...state, columnVisibility: { ...state.columnVisibility, due: false } },
      config,
      properties,
    );

    expect(hidden.properties).toEqual([
      { propertyId: 'pages', visible: true, width: null },
      { propertyId: 'due', visible: false, width: null },
      { propertyId: 'status', visible: true, width: null },
      { propertyId: 'notes', visible: true, width: null },
    ]);
    expect(fromConfig(hidden, properties).columnOrder).toEqual(state.columnOrder);
  });
});

describe('the helpers the toolbar uses', () => {
  it('replace the filters, the sorts and the grouping', () => {
    const config = emptyViewConfig('table');
    const filter = { propertyId: 'pages', operator: 'lessThan', value: 3 } as const;

    expect(withFilters(config, properties, [filter]).filters).toEqual([filter]);
    expect(withSorts(config, properties, [{ propertyId: 'due', direction: 'desc' }]).sorts).toEqual(
      [{ propertyId: 'due', direction: 'desc' }],
    );
    expect(withGroupBy(config, properties, 'status')).toMatchObject({
      groupBy: { propertyId: 'status', collapsed: [] },
    });
    expect(withGroupBy(table, properties, 'status')).toEqual(table);
    expect(withGroupBy(table, properties, null)).toMatchObject({ groupBy: null });
  });

  it('give every group a key, the rows without a value the empty one', () => {
    const [status, pages, due, notes] = properties;

    expect(groupKey('open', status!)).toBe('open');
    expect(groupKey('deleted-option', status!)).toBe('');
    expect(groupKey(3.5, pages!)).toBe('3.5');
    expect(groupKey('2026-11-14', due!)).toBe('2026-11-14');
    expect(groupKey('', notes!)).toBe('');
    expect(groupKey(null, notes!)).toBe('');
    expect(groupKey(undefined, notes!)).toBe('');
    expect(groupRowId('status', '')).toBe('status:');
  });
});
