import type {
  ColumnOrderState,
  ColumnSizingState,
  ColumnVisibilityState,
  GroupingState,
  SortingState,
} from '@tanstack/react-table';
import {
  propertyTypeDefinition,
  type PropertyTypeDefinition,
} from '@/features/databases/properties/registry';
import type { CellValue, Property, ViewConfig, ViewFilter, ViewSort } from '@/lib/commands';

/**
 * A stored view configuration and the state of the TanStack table, in both
 * directions. The configuration is what is saved; the table state is what the
 * row models read.
 *
 * Reading skips everything that mentions a property or an option that is gone,
 * and a filter whose operator the property's type does not have (its type
 * changed). Writing goes part by part: a part whose state did not change is
 * kept exactly as it was stored, stale entries included; a part that changed
 * is written from the state, and then holds only what is live. Entries about a
 * property that exists but has no column in this version (relation) are kept.
 */

/** The reserved property id of the title column. */
export const TITLE_PROPERTY_ID = 'title';

/** A condition with its place in the stored list, so that the order survives the round trip. */
export type FilterCondition = { index: number; filter: ViewFilter };

/** One column filter per property; it holds every condition on that property. */
export type ConditionFilter = { id: string; value: FilterCondition[] };

export type TableViewState = {
  sorting: SortingState;
  columnFilters: ConditionFilter[];
  grouping: GroupingState;
  /** Group rows by id that are folded away (`false`). A group not named here is open. */
  expanded: Record<string, boolean>;
  columnOrder: ColumnOrderState;
  columnVisibility: ColumnVisibilityState;
  columnSizing: ColumnSizingState;
};

type ViewType = ViewConfig['type'];

/** The configuration of a new view of a type: nothing filtered, sorted, grouped or chosen. */
export function emptyViewConfig(type: ViewType): ViewConfig {
  const base = { version: 1 as const, filters: [], sorts: [], properties: [] };
  switch (type) {
    case 'table':
      return { ...base, type, groupBy: null };
    case 'kanban':
      return { ...base, type, groupPropertyId: null, hiddenGroups: [] };
    case 'calendar':
      return { ...base, type, datePropertyId: null };
  }
}

/** A field a view can filter and sort by: the title or a property with a column. */
export type ViewField = { id: string; property: Property; definition: PropertyTypeDefinition };

/**
 * The title as a property, so that it is filtered and sorted with the rules of
 * text. `name` is filled in by the caller for display.
 */
export function titleProperty(databaseId: string, name = ''): Property {
  return {
    id: TITLE_PROPERTY_ID,
    databaseId,
    name,
    type: 'text',
    position: -1,
    options: [],
    targetId: null,
  };
}

/** The properties that have a column, in the database's order. */
export function columnProperties(properties: readonly Property[]) {
  return [...properties]
    .sort((a, b) => a.position - b.position)
    .filter((property) => propertyTypeDefinition(property.type) !== undefined);
}

/** The title first, then every property with a column, in the database's order. */
export function viewFields(properties: readonly Property[], titleName = ''): ViewField[] {
  const databaseId = properties[0]?.databaseId ?? '';
  return [titleProperty(databaseId, titleName), ...columnProperties(properties)].map(
    (property) => ({
      id: property.id,
      property,
      definition: propertyTypeDefinition(property.type)!,
    }),
  );
}

function fieldsById(properties: readonly Property[]) {
  return new Map(viewFields(properties).map((field) => [field.id, field]));
}

/** Whether an id names a property that exists but has no column (kept on writing). */
function isColumnless(id: string, properties: readonly Property[]) {
  const property = properties.find((candidate) => candidate.id === id);
  return property !== undefined && propertyTypeDefinition(property.type) === undefined;
}

/** Whether a stored value still names an option of a select. Other types take any value. */
function isLiveValue(value: string | number | null, property: Property) {
  if (property.type !== 'select' || value === null) return true;
  return property.options.some((option) => option.id === value);
}

function isLiveFilter(filter: ViewFilter, fields: Map<string, ViewField>) {
  const field = fields.get(filter.propertyId);
  return (
    field !== undefined &&
    field.definition.operators.includes(filter.operator) &&
    isLiveValue(filter.value, field.property)
  );
}

/** The conditions a view applies, in their order. */
export function readFilters(config: ViewConfig, properties: readonly Property[]): ViewFilter[] {
  const fields = fieldsById(properties);
  return config.filters.filter((filter) => isLiveFilter(filter, fields));
}

/** The sorts a view applies, in their order; a property counts once. */
export function readSorts(config: ViewConfig, properties: readonly Property[]): ViewSort[] {
  const fields = fieldsById(properties);
  const seen = new Set<string>();
  return config.sorts.filter((sort) => {
    if (!fields.has(sort.propertyId) || seen.has(sort.propertyId)) return false;
    seen.add(sort.propertyId);
    return true;
  });
}

/** The key of the group a value falls into; `''` for rows without a value. */
export function groupKey(value: CellValue | undefined, property: Property): string {
  const definition = propertyTypeDefinition(property.type);
  if (!definition || definition.isEmpty(value, property)) return '';
  return Array.isArray(value) ? value.join(',') : String(value);
}

/** The id TanStack gives the row of a group. */
export function groupRowId(propertyId: string, key: string) {
  return `${propertyId}:${key}`;
}

/** The property a table view is grouped by, when it still exists and can be grouped. */
function groupProperty(config: ViewConfig, properties: readonly Property[]) {
  if (config.type !== 'table' || config.groupBy === null) return null;
  const id = config.groupBy.propertyId;
  return columnProperties(properties).find((property) => property.id === id) ?? null;
}

/** The order, visibility and widths of the columns. */
function readColumns(config: ViewConfig, properties: readonly Property[]) {
  const shown = columnProperties(properties);
  const known = new Set([TITLE_PROPERTY_ID, ...shown.map((property) => property.id)]);
  const mentioned = new Map<string, ViewConfig['properties'][number]>();
  for (const entry of config.properties) {
    if (known.has(entry.propertyId) && !mentioned.has(entry.propertyId)) {
      mentioned.set(entry.propertyId, entry);
    }
  }

  const columnOrder = [
    TITLE_PROPERTY_ID,
    ...[...mentioned.keys()].filter((id) => id !== TITLE_PROPERTY_ID),
    ...shown.map((property) => property.id).filter((id) => !mentioned.has(id)),
  ];
  const columnVisibility: ColumnVisibilityState = {};
  const columnSizing: ColumnSizingState = {};
  for (const id of columnOrder) {
    const entry = mentioned.get(id);
    columnVisibility[id] = id === TITLE_PROPERTY_ID || (entry?.visible ?? true);
    if (entry?.width !== null && entry?.width !== undefined) columnSizing[id] = entry.width;
  }
  return { columnOrder, columnVisibility, columnSizing };
}

/** The table state a stored configuration stands for. */
export function fromConfig(config: ViewConfig, properties: readonly Property[]): TableViewState {
  const fields = fieldsById(properties);

  const columnFilters: ConditionFilter[] = [];
  config.filters.forEach((filter, index) => {
    if (!isLiveFilter(filter, fields)) return;
    const existing = columnFilters.find((entry) => entry.id === filter.propertyId);
    if (existing) existing.value.push({ index, filter });
    else columnFilters.push({ id: filter.propertyId, value: [{ index, filter }] });
  });

  const grouped = groupProperty(config, properties);
  const expanded: Record<string, boolean> = {};
  if (grouped && config.type === 'table' && config.groupBy) {
    for (const key of config.groupBy.collapsed) {
      if (key === '' || isLiveValue(key, grouped)) expanded[groupRowId(grouped.id, key)] = false;
    }
  }

  return {
    sorting: readSorts(config, properties).map((sort) => ({
      id: sort.propertyId,
      desc: sort.direction === 'desc',
    })),
    columnFilters,
    grouping: grouped ? [grouped.id] : [],
    expanded,
    ...readColumns(config, properties),
  };
}

function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean) {
  return a.length === b.length && a.every((item, index) => same(item, b[index]!));
}

const sameFilter = (a: ViewFilter, b: ViewFilter) =>
  a.propertyId === b.propertyId && a.operator === b.operator && a.value === b.value;

/** The conditions of the column filters in their stored order. */
function conditionsOf(columnFilters: readonly ConditionFilter[]): ViewFilter[] {
  return columnFilters
    .flatMap((entry) => entry.value)
    .sort((a, b) => a.index - b.index)
    .map((condition) => condition.filter);
}

/**
 * The configuration after the table state changed. Parts that did not change
 * stay as they were; nothing that is not in `base` is invented.
 */
export function toConfig(
  state: TableViewState,
  base: ViewConfig,
  properties: readonly Property[],
): ViewConfig {
  const current = fromConfig(base, properties);
  let next: ViewConfig = base;

  const sorting = state.sorting.map((sort) => ({ ...sort, desc: !!sort.desc }));
  if (!sameList(sorting, current.sorting, (a, b) => a.id === b.id && a.desc === b.desc)) {
    next = {
      ...next,
      sorts: [
        ...sorting.map((sort): ViewSort => ({
          propertyId: sort.id,
          direction: sort.desc ? 'desc' : 'asc',
        })),
        ...base.sorts.filter((sort) => isColumnless(sort.propertyId, properties)),
      ],
    };
  }

  const filters = conditionsOf(state.columnFilters);
  if (!sameList(filters, conditionsOf(current.columnFilters), sameFilter)) {
    next = {
      ...next,
      filters: [
        ...filters.map((filter) => ({ ...filter })),
        ...base.filters.filter((filter) => isColumnless(filter.propertyId, properties)),
      ],
    };
  }

  const columnsChanged =
    !sameList(state.columnOrder, current.columnOrder, (a, b) => a === b) ||
    !sameRecord(state.columnVisibility, current.columnVisibility) ||
    !sameRecord(state.columnSizing, current.columnSizing);
  if (columnsChanged) {
    next = { ...next, properties: writeColumns(state, base, properties) };
  }

  if (next.type === 'table') {
    const groupingChanged =
      !sameList(state.grouping, current.grouping, (a, b) => a === b) ||
      !sameRecord(state.expanded, current.expanded);
    if (groupingChanged) next = { ...next, groupBy: writeGroupBy(state, properties) };
  }

  return next;
}

function writeColumns(
  state: TableViewState,
  base: ViewConfig,
  properties: readonly Property[],
): ViewConfig['properties'] {
  const shown = columnProperties(properties).map((property) => property.id);
  const order = [
    ...state.columnOrder.filter((id) => shown.includes(id)),
    ...shown.filter((id) => !state.columnOrder.includes(id)),
  ].filter((id, index, ids) => ids.indexOf(id) === index);

  const titleWidth = state.columnSizing[TITLE_PROPERTY_ID] ?? null;
  const hadTitle = base.properties.some((entry) => entry.propertyId === TITLE_PROPERTY_ID);
  const title =
    hadTitle || titleWidth !== null
      ? [{ propertyId: TITLE_PROPERTY_ID, visible: true, width: titleWidth }]
      : [];

  return [
    ...title,
    ...order.map((id) => ({
      propertyId: id,
      visible: state.columnVisibility[id] ?? true,
      width: state.columnSizing[id] ?? null,
    })),
    ...base.properties.filter((entry) => isColumnless(entry.propertyId, properties)),
  ];
}

function writeGroupBy(state: TableViewState, properties: readonly Property[]) {
  const id = state.grouping[0];
  if (id === undefined || !columnProperties(properties).some((property) => property.id === id)) {
    return null;
  }
  const prefix = groupRowId(id, '');
  const collapsed = Object.entries(state.expanded)
    .filter(([rowId, open]) => !open && rowId.startsWith(prefix))
    .map(([rowId]) => rowId.slice(prefix.length));
  return { propertyId: id, collapsed };
}

/** The configuration with other conditions, in their order. */
export function withFilters(
  config: ViewConfig,
  properties: readonly Property[],
  filters: readonly ViewFilter[],
): ViewConfig {
  const columnFilters: ConditionFilter[] = [];
  filters.forEach((filter, index) => {
    const existing = columnFilters.find((entry) => entry.id === filter.propertyId);
    if (existing) existing.value.push({ index, filter });
    else columnFilters.push({ id: filter.propertyId, value: [{ index, filter }] });
  });
  return toConfig({ ...fromConfig(config, properties), columnFilters }, config, properties);
}

/** The configuration with other sorts, applied in their order. */
export function withSorts(
  config: ViewConfig,
  properties: readonly Property[],
  sorts: readonly ViewSort[],
): ViewConfig {
  const sorting = sorts.map((sort) => ({ id: sort.propertyId, desc: sort.direction === 'desc' }));
  return toConfig({ ...fromConfig(config, properties), sorting }, config, properties);
}

/** The configuration grouped by another property, or by none; a new grouping starts open. */
export function withGroupBy(
  config: ViewConfig,
  properties: readonly Property[],
  propertyId: string | null,
): ViewConfig {
  const state = fromConfig(config, properties);
  if ((state.grouping[0] ?? null) === propertyId) return config;
  return toConfig(
    { ...state, grouping: propertyId === null ? [] : [propertyId], expanded: {} },
    config,
    properties,
  );
}

/** The configuration with one column shown or hidden. The title is always shown. */
export function withVisibility(
  config: ViewConfig,
  properties: readonly Property[],
  propertyId: string,
  visible: boolean,
): ViewConfig {
  if (propertyId === TITLE_PROPERTY_ID) return config;
  const state = fromConfig(config, properties);
  return toConfig(
    { ...state, columnVisibility: { ...state.columnVisibility, [propertyId]: visible } },
    config,
    properties,
  );
}
