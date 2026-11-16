import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableColumn } from '@/features/databases/useDatabaseTable';
import type { Row } from '@/lib/commands';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { PropertyCell, TitleCell } from './Cell';
import { useTableActions } from './tableActions';
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
  selected: boolean;
  /** Whether any row is selected; the boxes of all rows then stay in sight. */
  selecting: boolean;
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
  selected,
  selecting,
}: TableRowProps) {
  const { t } = useTranslation();
  const { toggleRow } = useTableActions();

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-label={row.title || t('pages.untitled')}
      style={{
        width: '100%',
        minWidth: width,
        height: ROW_HEIGHT,
        transform: `translateY(${top}px)`,
      }}
      className={cn(
        'group border-border hover:bg-accent/40 absolute top-0 left-0 flex border-b',
        selected && 'bg-primary/10 hover:bg-primary/10',
      )}
    >
      <div
        className={cn(
          'absolute right-full flex h-full w-7 items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 has-[:focus-visible]:opacity-100',
          selecting && 'opacity-100',
        )}
      >
        <Checkbox
          checked={selected}
          aria-label={t('databases.table.selectRow', { title: row.title || t('pages.untitled') })}
          onCheckedChange={() => toggleRow(row.id)}
        />
      </div>
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
