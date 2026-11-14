import { createContext, useContext } from 'react';
import type { CellValue } from '@/lib/commands';

/**
 * What cells can do to the table around them. The functions never change, so
 * passing them does not re-render memoised rows and cells.
 */
export type TableActions = {
  /** Tells apart two tables of the same database. */
  tableId: string;
  setCell: (rowId: string, propertyId: string, value: CellValue) => void;
  renameRow: (rowId: string, title: string) => void;
  /** Asks first, then deletes the row. */
  deleteRow: (rowId: string) => void;
  /** Makes the cell `rows` rows and `columns` columns away the active one. */
  move: (rowIndex: number, columnIndex: number, rows: number, columns: number) => void;
};

export const TableActionsContext = createContext<TableActions | null>(null);

export function useTableActions() {
  const actions = useContext(TableActionsContext);
  if (actions === null) throw new Error('a cell is rendered outside of a table');
  return actions;
}
