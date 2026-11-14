import {
  PROPERTY_WIDTH,
  TITLE_WIDTH,
  type TableColumn,
} from '@/features/databases/useDatabaseTable';
import type { CellValue } from '@/lib/commands';

/** Every row has the same height, border included, so the virtualiser needs no measuring. */
export const ROW_HEIGHT = 33;
export const HEADER_HEIGHT = 33;
/**
 * The space left and right of the table and its tabs. The first column lines up
 * with the page title, which sits in a centred column of 720px with 48px on
 * each side; the cell's own padding is taken off.
 */
export const TABLE_INSET = 'max(2.5rem, calc((100% - 720px) / 2 + 2.5rem))';

/** The column with the `+` that adds a property. */
export const ADD_COLUMN_WIDTH = 40;

/** The width the view gives a column, or the default width of its kind. */
export function columnWidth(column: TableColumn) {
  return column.width ?? (column.property ? PROPERTY_WIDTH : TITLE_WIDTH);
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
