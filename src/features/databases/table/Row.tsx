import { GripVertical } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableColumn } from '@/features/databases/useDatabaseTable';
import { useTableSortable } from '@/features/databases/dnd/useTableSortable';
import type { PageLock, Row } from '@/lib/commands';
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
  sortIndex: number;
  group: string;
  canDrag: boolean;
  onKeyboardMove: (by: number) => void;
  lock: PageLock;
  readOnly: boolean;
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
  sortIndex,
  group,
  canDrag,
  onKeyboardMove,
  lock,
  readOnly,
}: TableRowProps) {
  const { t } = useTranslation();
  const { toggleRow } = useTableActions();
  const { ref, handleRef, isDragging } = useTableSortable({
    id: row.id,
    index: sortIndex,
    kind: 'row',
    group,
    disabled: !canDrag,
  });
  const contentReadOnly = readOnly || lock !== 'none';
  const cellsReadOnly = readOnly || lock === 'all';

  return (
    <div
      ref={ref}
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
        isDragging && 'z-10 opacity-60',
      )}
    >
      <div
        className={cn(
          'absolute right-full flex h-full items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 has-[:focus-visible]:opacity-100',
          canDrag ? 'w-14' : 'w-7',
          selecting && 'opacity-100',
        )}
      >
        {canDrag ? (
          <button
            ref={handleRef}
            type="button"
            aria-label={t('databases.table.dragRow', {
              title: row.title || t('pages.untitled'),
            })}
            onKeyDown={(event) => {
              const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
              if (by !== 0) {
                event.preventDefault();
                event.stopPropagation();
                onKeyboardMove(by);
              }
            }}
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 flex h-6 w-6 cursor-grab items-center justify-center rounded-sm outline-none focus-visible:ring-2 active:cursor-grabbing"
          >
            <GripVertical size={16} aria-hidden />
          </button>
        ) : null}
        <Checkbox
          checked={selected}
          disabled={contentReadOnly}
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
            readOnly={cellsReadOnly}
          />
        ) : (
          <TitleCell key={column.id} {...position} title={row.title} readOnly={contentReadOnly} />
        );
      })}
    </div>
  );
});
