import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import {
  memo,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineInput } from '@/features/databases/properties/InlineInput';
import type { PropertyTypeDefinition } from '@/features/databases/properties/registry';
import {
  useCellMode,
  useCellStore,
  useIsFallbackTabStop,
  type CellAddress,
  type CellMode,
} from '@/features/databases/uiStore';
import { TITLE_COLUMN_ID } from '@/features/databases/useDatabaseTable';
import type { CellValue, Property } from '@/lib/commands';
import { cn } from '@/lib/utils';
import { isSameValue } from './layout';
import { useTableActions } from './tableActions';

type Position = {
  rowId: string;
  rowIndex: number;
  /** Whether no row comes before this one; groups put their header first. */
  firstRow: boolean;
  columnIndex: number;
  width: number;
};

const arrows: Record<string, [rows: number, columns: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/**
 * A grid cell that can be focused, moved through with the arrow keys and
 * opened for editing with a click or Enter. Events from the editor's popovers
 * reach the cell through React's portals; they are left alone.
 */
function GridCell({
  rowId,
  rowIndex,
  firstRow,
  columnIndex,
  width,
  columnId,
  readOnly = false,
  className,
  children,
}: Position & {
  columnId: string;
  readOnly?: boolean;
  className?: string;
  children: (mode: CellMode, close: () => void) => ReactNode;
}) {
  const { tableId, move } = useTableActions();
  const address: CellAddress = { tableId, rowId, columnId };
  const mode = useCellMode(address);
  const isTabStop = useIsFallbackTabStop(tableId, firstRow && columnIndex === 0);
  const ref = useRef<HTMLDivElement>(null);

  // The active cell takes the focus back from a closed editor, and keeps it
  // while it is moved with the keyboard, but never from outside the table.
  useEffect(() => {
    const cell = ref.current;
    if (mode !== 'active' || !cell) return;
    const focused = document.activeElement;
    const isLost = focused === null || focused === document.body;
    if (focused !== cell && (isLost || cell.closest('[role="grid"]')?.contains(focused))) {
      // The least scrolling that shows the cell; the virtualiser has already brought its row.
      cell.focus({ preventScroll: true });
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [mode]);

  const activate = (edit: boolean) => useCellStore.getState().activate(address, edit);
  const close = () => useCellStore.getState().stopEditing(address);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (readOnly || mode === 'editing' || !event.currentTarget.contains(event.target as Node))
      return;
    activate(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if ((event.key === 'Enter' || event.key === 'F2') && !readOnly) {
      event.preventDefault();
      activate(true);
      return;
    }
    const arrow = arrows[event.key];
    if (arrow) {
      event.preventDefault();
      move(rowIndex, columnIndex, ...arrow);
    }
  };

  return (
    <div
      ref={ref}
      role="gridcell"
      aria-colindex={columnIndex + 1}
      aria-selected={mode !== null}
      aria-readonly={readOnly || undefined}
      tabIndex={mode !== null || isTabStop ? 0 : -1}
      data-editing={mode === 'editing' || undefined}
      style={{ width }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget && mode === null) activate(false);
      }}
      className={cn(
        'border-border relative flex h-full shrink-0 items-center overflow-hidden border-r text-sm outline-none',
        'focus-visible:ring-ring/60 data-editing:ring-ring/60 focus-visible:ring-2 focus-visible:ring-inset data-editing:ring-2 data-editing:ring-inset',
        className,
      )}
    >
      {children(readOnly ? null : mode, close)}
    </div>
  );
}

type PropertyCellProps = Position & {
  readOnly?: boolean;
  property: Property;
  definition: PropertyTypeDefinition;
  value: CellValue;
};

/** A cell of a property: its value, or the editor of its type while it is edited. */
export const PropertyCell = memo(function PropertyCell({
  property,
  definition: { Display, Editor },
  value,
  ...position
}: PropertyCellProps) {
  const { setCell } = useTableActions();

  return (
    <GridCell {...position} columnId={property.id}>
      {(mode, close) =>
        mode === 'editing' ? (
          <div
            className={cn(
              'flex h-full w-full min-w-0 items-center px-1',
              // A popover editor shows the value in its anchor, centred like the display.
              '[&>[data-slot=popover-anchor]]:flex [&>[data-slot=popover-anchor]]:items-center',
            )}
          >
            <Editor
              value={value}
              property={property}
              onCommit={(next) => {
                // Every editor commits, also when nothing changed.
                if (!isSameValue(next, value)) setCell(position.rowId, property.id, next);
                close();
              }}
              onCancel={close}
            />
          </div>
        ) : (
          <div className="flex h-full w-full min-w-0 items-center px-2">
            <Display value={value} property={property} />
          </div>
        )
      }
    </GridCell>
  );
});

/** The title of a row: typed in place, and with "Open" and the row's menu while hovered. */
export const TitleCell = memo(function TitleCell({
  title,
  ...position
}: Position & { title: string; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { renameRow, deleteRow } = useTableActions();

  return (
    <GridCell {...position} columnId={TITLE_COLUMN_ID}>
      {(mode, close) =>
        mode === 'editing' ? (
          <div className="flex h-full w-full min-w-0 items-center px-1">
            <InlineInput
              initialText={title}
              label={t('databases.table.titleColumn')}
              onSubmit={(text) => {
                if (text !== title) renameRow(position.rowId, text);
                close();
                return true;
              }}
              onCancel={close}
            />
          </div>
        ) : (
          <>
            <span
              className={cn(
                'min-w-0 flex-1 truncate px-2 font-medium',
                title === '' && 'text-muted-foreground/60',
              )}
            >
              {title || t('pages.untitled')}
            </span>
            <RowButtons
              rowId={position.rowId}
              // Reached with Tab from the title, so that rows add no Tab stops of their own.
              tabbable={mode !== null}
              deleteDisabled={position.readOnly}
              onDelete={() => deleteRow(position.rowId)}
            />
          </>
        )
      }
    </GridCell>
  );
});

const rowButton =
  'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground flex h-6 items-center rounded-sm border text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

function RowButtons({
  rowId,
  tabbable,
  deleteDisabled = false,
  onDelete,
}: {
  rowId: string;
  tabbable: boolean;
  deleteDisabled?: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div
      className={cn(
        'mr-1 flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        'has-[[data-state=open]]:opacity-100',
      )}
    >
      <Link
        to="/page/$pageId"
        params={{ pageId: rowId }}
        tabIndex={tabbable ? 0 : -1}
        onClick={stop}
        className={cn(rowButton, 'px-1.5')}
      >
        {t('databases.table.open')}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('databases.table.rowActions')}
            tabIndex={tabbable ? 0 : -1}
            onClick={stop}
            className={cn(rowButton, 'w-6 justify-center')}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max min-w-40">
          <DropdownMenuItem variant="destructive" disabled={deleteDisabled} onSelect={onDelete}>
            <Trash2 aria-hidden />
            {t('databases.table.deleteRow')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
