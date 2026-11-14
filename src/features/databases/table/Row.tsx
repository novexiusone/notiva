import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableColumn } from '@/features/databases/useDatabaseTable';
import type { Row } from '@/lib/commands';
import { PropertyCell, TitleCell } from './Cell';
import { columnWidth, ROW_HEIGHT } from './layout';

type TableRowProps = {
  row: Row;
  columns: TableColumn[];
  rowIndex: number;
  /** Whether this is the first row of the table, which holds the table's Tab stop. */
  first: boolean;
  /** Where the virtualiser puts the row, from the top of the body. */
  top: number;
  width: number;
};

/**
 * One line of the table. Memoised: a change to one row or one cell re-renders
 * that row only, because the other rows keep their objects in the cache.
 */
export const TableRow = memo(function TableRow({
  row,
  columns,
  rowIndex,
  first,
  top,
  width,
}: TableRowProps) {
  const { t } = useTranslation();

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-label={row.title || t('pages.untitled')}
      style={{ width, height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
      className="group border-border hover:bg-accent/40 absolute top-0 left-0 flex border-b"
    >
      {columns.map((column, columnIndex) => {
        const position = {
          rowId: row.id,
          rowIndex,
          firstRow: first,
          columnIndex,
          width: columnWidth(column),
        };
        return column.property ? (
          <PropertyCell
            key={column.id}
            {...position}
            property={column.property}
            definition={column.definition}
            value={row.cells[column.id] ?? null}
          />
        ) : (
          <TitleCell key={column.id} {...position} title={row.title} />
        );
      })}
    </div>
  );
});
