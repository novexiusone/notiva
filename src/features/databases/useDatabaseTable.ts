import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  functionalUpdate,
  metaHelper,
  rowExpandingFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Row as TanStackRow,
  type Updater,
} from '@tanstack/react-table';
import { useMemo } from 'react';
import {
  propertyTypeDefinition,
  type PropertyTypeDefinition,
} from '@/features/databases/properties/registry';
import type { CellValue, Property, Row, ViewConfig } from '@/lib/commands';
import {
  emptyViewConfig,
  fromConfig,
  groupKey,
  titleProperty,
  TITLE_PROPERTY_ID,
  toConfig,
  type FilterCondition,
  type TableViewState,
} from './viewState';

/** The id of the column that holds the titles of the rows. No property can have it. */
export const TITLE_COLUMN_ID = TITLE_PROPERTY_ID;

/** How wide a column is when its view does not say. */
export const TITLE_WIDTH = 280;
export const PROPERTY_WIDTH = 200;
/** A stored width below this is shown at this width, so the column stays usable. */
const MIN_WIDTH = 40;

/** A column as the table renders it: the title, or a property with its type's definition. */
export type TableColumn = (
  | { id: typeof TITLE_COLUMN_ID; property: null; definition: null }
  | { id: string; property: Property; definition: PropertyTypeDefinition }
) & {
  /** The width the view gives the column; the default width when it gives none. */
  width?: number;
};

/** A line of the table body: a row, or the header of a group of rows. */
export type TableItem =
  | { kind: 'row'; id: string; row: Row }
  | {
      kind: 'group';
      id: string;
      /** The value the rows of the group share; `null` for the rows without a value. */
      value: CellValue;
      /** What `groupBy.collapsed` stores for this group. */
      key: string;
      property: Property;
      count: number;
      expanded: boolean;
    };

/** What the column filter of a property holds: its conditions, and the rows to keep anyway. */
type FilterValue = { conditions: FilterCondition[]; keep: ReadonlySet<string> };

const features = tableFeatures({
  columnMeta: metaHelper<{ column: TableColumn }>(),
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  columnGroupingFeature,
  groupedRowModel: createGroupedRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowExpandingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnSizingFeature,
});
const helper = createColumnHelper<typeof features, Row>();

type Field = { column: TableColumn; property: Property; definition: PropertyTypeDefinition };

/** The title first, then every property this version can show, in `position` order. */
function tableFields(properties: readonly Property[]): Field[] {
  const textDefinition = propertyTypeDefinition('text')!;
  const title: Field = {
    column: { id: TITLE_COLUMN_ID, property: null, definition: null },
    property: titleProperty(properties[0]?.databaseId ?? ''),
    definition: textDefinition,
  };
  const shown = [...properties]
    .sort((a, b) => a.position - b.position)
    .flatMap((property): Field[] => {
      const definition = propertyTypeDefinition(property.type);
      return definition
        ? [{ column: { id: property.id, property, definition }, property, definition }]
        : [];
    });
  return [title, ...shown];
}

/** A cell as the row models read it: `undefined` when it is empty, so sorting puts it last. */
function readCell(row: Row, field: Field): CellValue | undefined {
  const value = field.column.property ? (row.cells[field.column.id] ?? null) : row.title;
  return field.definition.isEmpty(value, field.property) ? undefined : value;
}

type Options = {
  /** Called with the configuration after a change made through the table, e.g. a collapsed group. */
  onConfigChange?: (config: ViewConfig) => void;
  /** Rows that stay visible even when they do not pass the filters, e.g. one just added. */
  keepRowIds?: ReadonlySet<string>;
};

const noRows: ReadonlySet<string> = new Set();

/**
 * Builds the TanStack table of a database from its properties, its rows and
 * the configuration of the view. Filtering, sorting and grouping are row
 * models over all rows; the rows come in the order `list_rows` returns them,
 * which is the order without a sort.
 */
export function useDatabaseTable(
  properties: Property[],
  rows: Row[],
  config: ViewConfig | null = null,
  { onConfigChange, keepRowIds = noRows }: Options = {},
) {
  const fields = useMemo(() => tableFields(properties), [properties]);
  const viewConfig = useMemo(() => config ?? emptyViewConfig('table'), [config]);
  const state = useMemo(() => fromConfig(viewConfig, properties), [viewConfig, properties]);

  const columnDefs = useMemo(
    () =>
      helper.columns(
        fields.map((field) =>
          helper.accessor((row) => readCell(row, field), {
            id: field.column.id,
            header: field.property.name,
            meta: { column: field.column },
            size: field.column.property ? PROPERTY_WIDTH : TITLE_WIDTH,
            sortUndefined: 'last',
            sortFn: (a, b, id) =>
              field.definition.compare(a.getValue(id), b.getValue(id), field.property),
            filterFn: (row, id, { conditions, keep }: FilterValue) =>
              keep.has(row.original.id) ||
              conditions.every(({ filter }) =>
                field.definition.matches(row.getValue(id), filter, field.property),
              ),
            getGroupingValue: (row) => groupKey(readCell(row, field), field.property),
            enableGrouping: field.column.property !== null,
          }),
        ),
      ),
    [fields],
  );

  // Every condition filter is a new object when the rows to keep change, so the filters run again.
  const columnFilters = useMemo(
    () =>
      state.columnFilters.map((entry) => ({
        id: entry.id,
        value: { conditions: entry.value, keep: keepRowIds } satisfies FilterValue,
      })),
    [state.columnFilters, keepRowIds],
  );

  // Changes from TanStack's own setters go back into the configuration.
  const apply =
    <K extends keyof TableViewState>(key: K) =>
    (updater: Updater<TableViewState[K]>) => {
      if (!onConfigChange) return;
      const value = functionalUpdate(updater, state[key]);
      onConfigChange(toConfig({ ...state, [key]: value }, viewConfig, properties));
    };
  const change = {
    sorting: apply('sorting'),
    grouping: apply('grouping'),
    columnOrder: apply('columnOrder'),
    columnVisibility: apply('columnVisibility'),
    columnSizing: apply('columnSizing'),
    expanded: (updater: Updater<true | Record<string, boolean>>) => {
      const next = functionalUpdate(updater, state.expanded);
      apply('expanded')(next === true ? {} : next);
    },
  };

  const table = useTable(
    {
      features,
      columns: columnDefs,
      data: rows,
      getRowId: (row) => row.id,
      state: {
        sorting: state.sorting,
        columnFilters,
        grouping: state.grouping,
        expanded: state.expanded,
        columnOrder: state.columnOrder,
        columnVisibility: state.columnVisibility,
        columnSizing: state.columnSizing,
      },
      onSortingChange: change.sorting,
      onGroupingChange: change.grouping,
      onExpandedChange: change.expanded,
      onColumnOrderChange: change.columnOrder,
      onColumnVisibilityChange: change.columnVisibility,
      onColumnSizingChange: change.columnSizing,
      // A group is open unless the view says it is collapsed.
      getIsRowExpanded: (row) => state.expanded[row.id] !== false,
      groupedColumnMode: false,
      // The view's configuration decides; nothing is reset behind its back.
      autoResetAll: false,
    },
    // The state comes from the view, so its changes re-render the owner anyway.
    () => null,
  );

  // The table reads the same state; the columns are memoised on it so that rows stay memoised.
  const columns = useMemo(
    () => visibleColumns(fields, state.columnOrder, state.columnVisibility, state.columnSizing),
    [fields, state.columnOrder, state.columnVisibility, state.columnSizing],
  );

  const rowModel = table.getRowModel();
  const items = useMemo(() => tableItems(rowModel.rows, state, fields), [rowModel, state, fields]);

  return { table, columns, items };
}

/** The shown columns in their order, with their widths. */
function visibleColumns(
  fields: Field[],
  order: TableViewState['columnOrder'],
  visibility: TableViewState['columnVisibility'],
  sizing: TableViewState['columnSizing'],
): TableColumn[] {
  const byId = new Map(fields.map((field) => [field.column.id, field]));
  return order.flatMap((id) => {
    const field = byId.get(id);
    if (!field || visibility[id] === false) return [];
    const width = sizing[id] ?? (field.column.property ? PROPERTY_WIDTH : TITLE_WIDTH);
    return [{ ...field.column, width: Math.max(MIN_WIDTH, width) }];
  });
}

type ModelRow = TanStackRow<typeof features, Row>;

/**
 * The lines of the body in order. Grouped, the groups come in the order of
 * their values (select: the options' order) with the rows without a value
 * last, unless the view sorts by the grouping property itself.
 */
function tableItems(rows: ModelRow[], state: TableViewState, fields: Field[]): TableItem[] {
  const groupId = state.grouping[0];
  const field = fields.find((candidate) => candidate.column.id === groupId);
  if (groupId === undefined || !field) {
    return rows.map((row) => ({ kind: 'row', id: row.id, row: row.original }));
  }

  const groups = [...rows];
  if (!state.sorting.some((sort) => sort.id === groupId)) {
    groups.sort((a, b) =>
      field.definition.compare(
        readCell(a.original, field),
        readCell(b.original, field),
        field.property,
      ),
    );
  }

  return groups.flatMap((group): TableItem[] => {
    const value = readCell(group.original, field) ?? null;
    const expanded = state.expanded[group.id] !== false;
    const header: TableItem = {
      kind: 'group',
      id: group.id,
      value,
      key: groupKey(value, field.property),
      property: field.property,
      count: group.subRows.length,
      expanded,
    };
    if (!expanded) return [header];
    return [
      header,
      ...group.subRows.map((row): TableItem => ({ kind: 'row', id: row.id, row: row.original })),
    ];
  });
}
