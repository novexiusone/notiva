import { createColumnHelper, metaHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import {
  propertyTypeDefinition,
  type PropertyTypeDefinition,
} from '@/features/databases/properties/registry';
import type { CellValue, Property, Row } from '@/lib/commands';

/** The id of the column that holds the titles of the rows. No property can have it. */
export const TITLE_COLUMN_ID = 'title';

/** A column as the table renders it: the title, or a property with its type's definition. */
export type TableColumn =
  | { id: typeof TITLE_COLUMN_ID; property: null; definition: null }
  | { id: string; property: Property; definition: PropertyTypeDefinition };

const features = tableFeatures({ columnMeta: metaHelper<{ column: TableColumn }>() });
const helper = createColumnHelper<typeof features, Row>();

const titleColumn: TableColumn = { id: TITLE_COLUMN_ID, property: null, definition: null };

/** The title first, then every property this version can show, in `position` order. */
function tableColumns(properties: Property[]): TableColumn[] {
  const shown = [...properties]
    .sort((a, b) => a.position - b.position)
    .flatMap((property): TableColumn[] => {
      const definition = propertyTypeDefinition(property.type);
      return definition ? [{ id: property.id, property, definition }] : [];
    });
  return [titleColumn, ...shown];
}

/**
 * Builds the TanStack table of a database from its properties and rows. The
 * rows come in the order `list_rows` returns them; sorting, filtering and
 * grouping are added here by `database-views`, as row models of `features`.
 */
export function useDatabaseTable(properties: Property[], rows: Row[]) {
  const columns = useMemo(() => tableColumns(properties), [properties]);

  const columnDefs = useMemo(
    () =>
      helper.columns(
        columns.map((column) =>
          helper.accessor(
            (row): CellValue => (column.property ? (row.cells[column.id] ?? null) : row.title),
            { id: column.id, header: column.property?.name, meta: { column } },
          ),
        ),
      ),
    [columns],
  );

  const table = useTable(
    { features, columns: columnDefs, data: rows, getRowId: (row) => row.id },
    // No table state is used yet, so nothing in it re-renders the owner.
    () => null,
  );

  return { table, columns };
}
