import type { TableColumn } from '@/features/databases/useDatabaseTable';
import type { CellValue } from '@/lib/commands';

/** Every row has the same height, border included, so the virtualiser needs no measuring. */
export const ROW_HEIGHT = 33;
export const HEADER_HEIGHT = 33;
/** The column with the `+` that adds a property. */
export const ADD_COLUMN_WIDTH = 40;

// Fixed until `database-views` stores a width per column.
const TITLE_WIDTH = 280;
const PROPERTY_WIDTH = 200;

export function columnWidth(column: TableColumn) {
  return column.property ? PROPERTY_WIDTH : TITLE_WIDTH;
}

export function tableWidth(columns: readonly TableColumn[]) {
  return columns.reduce((sum, column) => sum + columnWidth(column), ADD_COLUMN_WIDTH);
}

/** Whether saving `next` over `current` would change anything. */
export function isSameValue(next: CellValue, current: CellValue) {
  if (Array.isArray(next) && Array.isArray(current)) {
    return next.length === current.length && next.every((id, index) => id === current[index]);
  }
  return next === current;
}
