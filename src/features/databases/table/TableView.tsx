import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateRow, useSetCell, databaseKeys } from '@/features/databases/api';
import { TableDragProvider, type TableReorder } from '@/features/databases/dnd/TableDnd';
import { mergeVisibleColumnOrder, rowMoveAfterReorder } from '@/features/databases/dnd/order';
import { useCellStore } from '@/features/databases/uiStore';
import { TITLE_COLUMN_ID, useDatabaseTable } from '@/features/databases/useDatabaseTable';
import { readSorts } from '@/features/databases/viewState';
import { useDeletePage, usePages, useRenamePage } from '@/features/pages/api';
import { pagesKey } from '@/features/pages/queryKeys';
import { DeletePageDialog } from '@/features/pages/DeletePageDialog';
import { commands, type Database, type Row, type View, type ViewConfig } from '@/lib/commands';
import { AddPropertyMenu } from './AddPropertyMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { PropertyHeaderCell, TitleHeaderCell } from './HeaderCell';
import { GroupRow } from './GroupRow';
import {
  ADD_COLUMN_WIDTH,
  columnWidth,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  TABLE_INSET,
  TABLE_MAX_HEIGHT,
  tableWidth,
} from './layout';
import { TableRow } from './Row';
import { TableActionsContext, type TableActions } from './tableActions';

type TableViewProps = {
  database: Database;
  rows: Row[];
  /** The view whose filters, sorts, grouping and columns apply; `null` shows everything. */
  view?: View | null;
  onConfigChange?: (config: ViewConfig) => void;
};

const noRowsKept: ReadonlySet<string> = new Set();

/**
 * The table of a database: a sticky header, virtualised rows and "New" below
 * them. It scrolls in both directions inside the main area and is never taller
 * than it. Grouped, the header of each group is a line of the body as tall as
 * a row.
 */
export function TableView({ database, rows, view = null, onConfigChange }: TableViewProps) {
  const { t } = useTranslation();
  const databaseId = database.page.id;
  const tableId = useId();
  // A row added here stays in sight although it may not pass the view's filters.
  const [keepRowIds, setKeepRowIds] = useState(noRowsKept);
  const {
    table,
    columns: storedColumns,
    items,
  } = useDatabaseTable(database.properties, rows, view?.config ?? null, {
    onConfigChange,
    keepRowIds,
  });
  const [previewWidth, setPreviewWidth] = useState<{ id: string; width: number } | null>(null);
  const columns = useMemo(
    () =>
      storedColumns.map((column) =>
        previewWidth?.id === column.id ? { ...column, width: previewWidth.width } : column,
      ),
    [storedColumns, previewWidth],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowToDelete, setRowToDelete] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(noRowsKept);
  const [deletingChosen, setDeletingChosen] = useState(false);

  const setCell = useSetCell(databaseId);
  const renamePage = useRenamePage();
  const deletePage = useDeletePage();
  const createRow = useCreateRow(databaseId);
  const queryClient = useQueryClient();
  const pages = usePages();
  const unlockedRowIds = useMemo(
    () => new Set(pages.data?.filter((page) => page.lock === 'none').map((page) => page.id)),
    [pages.data],
  );
  const moveRow = useMutation({
    mutationFn: ({ rowId, afterRowId }: { rowId: string; afterRowId: string | null }) =>
      commands.moveRow(rowId, afterRowId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: databaseKeys.rows(databaseId) }),
        queryClient.invalidateQueries({ queryKey: pagesKey }),
      ]),
  });
  const canConfigureColumns =
    view !== null && onConfigChange !== undefined && database.page.lock !== 'all';
  const hasSort = view ? readSorts(view.config, database.properties).length > 0 : false;
  const canDragRows = database.page.lock !== 'all' && !hasSort;

  // The app does not use the React Compiler; rows are memoised by hand instead.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => items[index]!.id,
    overscan: 10,
    // The rows start below the sticky header, which also covers the top of the view.
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });

  // The first row holds the table's Tab stop; with groups, a header comes before it.
  const firstRowIndex = useMemo(() => items.findIndex((item) => item.kind === 'row'), [items]);

  // Rows and cells get functions that never change, so that they stay memoised.
  const latest = useRef({ setCell, renamePage, items, columns, table });
  useLayoutEffect(() => {
    latest.current = { setCell, renamePage, items, columns, table };
  });
  const actions = useMemo<TableActions>(
    () => ({
      tableId,
      setCell: (rowId, propertyId, value) => latest.current.setCell(rowId, propertyId, value),
      renameRow: (rowId, title) => latest.current.renamePage(rowId, title),
      deleteRow: setRowToDelete,
      toggleRow: (rowId) =>
        setChosen((current) => {
          const next = new Set(current);
          if (!next.delete(rowId)) next.add(rowId);
          return next;
        }),
      move: (rowIndex, columnIndex, byRows, byColumns) => {
        const { items, columns } = latest.current;
        // The headers of groups hold no cells; the move goes past them.
        let index = Math.min(Math.max(rowIndex + byRows, 0), items.length - 1);
        const step = byRows < 0 ? -1 : 1;
        while (items[index]?.kind === 'group') index += step;
        const row = items[index] ?? items[rowIndex];
        const column = columns[Math.min(Math.max(columnIndex + byColumns, 0), columns.length - 1)];
        if (row?.kind === 'row' && column) {
          useCellStore.getState().activate({ tableId, rowId: row.id, columnId: column.id });
        }
      },
    }),
    [tableId],
  );
  const toggleGroup = useMemo(
    () => (id: string, expanded: boolean) =>
      latest.current.table.setExpanded((state) => ({
        ...(state === true ? {} : state),
        [id]: expanded,
      })),
    [],
  );

  useEffect(() => () => useCellStore.getState().forget(tableId), [tableId]);

  // A cell that becomes active is scrolled into view, once its row exists.
  const activeRowId = useCellStore((state) =>
    state.active?.tableId === tableId ? state.active.rowId : null,
  );
  const scrollPending = useRef<string | null>(null);
  useEffect(() => {
    scrollPending.current = activeRowId;
  }, [activeRowId]);
  useEffect(() => {
    if (scrollPending.current === null) return;
    const index = items.findIndex((item) => item.id === scrollPending.current);
    if (index === -1) return;
    scrollPending.current = null;
    virtualizer.scrollToIndex(index);
  }, [activeRowId, items, virtualizer]);

  const addRow = () =>
    createRow.mutate(undefined, {
      onSuccess: (row) => {
        setKeepRowIds((kept) => new Set([...kept, row.id]));
        useCellStore
          .getState()
          .activate({ tableId, rowId: row.id, columnId: TITLE_COLUMN_ID }, true);
      },
    });

  const width = tableWidth(columns);
  const visibleRowIds = useMemo(
    () => items.flatMap((item) => (item.kind === 'row' ? [item.id] : [])),
    [items],
  );
  const visibleRowIndices = useMemo(
    () => new Map(visibleRowIds.map((id, index) => [id, index])),
    [visibleRowIds],
  );
  const rowsShown = visibleRowIds.length;
  const reorder = ({ kind, from, to }: TableReorder) => {
    if (kind === 'column') {
      if (!canConfigureColumns) return;
      const visible = storedColumns.flatMap((column) => (column.property ? [column.id] : []));
      table.setColumnOrder((current) => mergeVisibleColumnOrder(current, visible, from, to));
      return;
    }
    const request = rowMoveAfterReorder(visibleRowIds, from, to);
    if (request && canDragRows && unlockedRowIds.has(request.rowId)) moveRow.mutate(request);
  };
  const widthChange = (id: string, width: number, done: boolean) => {
    if (done) {
      setPreviewWidth(null);
      table.setColumnSizing((current) => ({ ...current, [id]: Math.max(40, Math.round(width)) }));
    } else {
      setPreviewWidth({ id, width });
    }
  };
  // Rows that were filtered away or deleted drop out of the selection.
  const selection = visibleRowIds.filter((id) => chosen.has(id));
  const allChosen = rowsShown > 0 && selection.length === rowsShown;
  const pendingRow = rows.find((row) => row.id === rowToDelete);

  return (
    <TableActionsContext.Provider value={actions}>
      <TableDragProvider onReorder={reorder}>
        <section
          aria-label={t('databases.table.rows')}
          ref={scrollRef}
          // Inline, so that the test setup can tell the scroll container apart.
          style={{ overflow: 'auto', maxHeight: TABLE_MAX_HEIGHT }}
          className="overscroll-x-contain"
        >
          <div
            className="group/table pb-4"
            // Fills the area; only more columns than fit make it scroll.
            style={{
              paddingLeft: TABLE_INSET,
              paddingRight: TABLE_INSET,
              minWidth: `calc(${width}px + 2 * ${TABLE_INSET})`,
            }}
          >
            {selection.length > 0 ? (
              <div
                role="toolbar"
                aria-label={t('databases.table.selection')}
                className="border-border bg-popover mb-1 flex h-8 w-max items-center gap-1 rounded-md border pr-1 pl-2.5 text-sm"
              >
                <span className="text-primary tabular-nums">
                  {t('databases.table.selected', { count: selection.length })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('databases.table.deleteSelected')}
                  onClick={() => setDeletingChosen(true)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ) : null}
            <div
              role="grid"
              aria-label={database.page.title || t('pages.untitled')}
              aria-rowcount={items.length + 1}
              aria-colcount={columns.length}
              style={{ minWidth: width }}
            >
              <div role="rowgroup" className="bg-background sticky top-0 z-10">
                <div
                  role="row"
                  aria-rowindex={1}
                  style={{ height: HEADER_HEIGHT, minWidth: width }}
                  className="border-border relative flex border-b"
                >
                  <div
                    className={cn(
                      'absolute right-full flex h-full items-center justify-center opacity-0 group-hover/table:opacity-100 hover:opacity-100 has-[:focus-visible]:opacity-100',
                      canDragRows ? 'w-14' : 'w-7',
                      selection.length > 0 && 'opacity-100',
                    )}
                  >
                    <Checkbox
                      checked={allChosen ? true : selection.length > 0 ? 'indeterminate' : false}
                      disabled={rowsShown === 0}
                      aria-label={t('databases.table.selectAll')}
                      onCheckedChange={() =>
                        setChosen(allChosen ? noRowsKept : new Set(visibleRowIds))
                      }
                    />
                  </div>
                  {columns.map((column, columnIndex) =>
                    column.property ? (
                      <PropertyHeaderCell
                        key={column.id}
                        property={column.property}
                        definition={column.definition}
                        columnIndex={columnIndex}
                        width={columnWidth(column)}
                        sortIndex={columnIndex - 1}
                        sortingDisabled={!canConfigureColumns}
                        onWidthChange={
                          canConfigureColumns
                            ? (width, done) => widthChange(column.id, width, done)
                            : undefined
                        }
                      />
                    ) : (
                      <TitleHeaderCell
                        key={column.id}
                        width={columnWidth(column)}
                        onWidthChange={
                          canConfigureColumns
                            ? (width, done) => widthChange(column.id, width, done)
                            : undefined
                        }
                      />
                    ),
                  )}
                  <div
                    role="columnheader"
                    aria-label={t('databases.table.addProperty')}
                    style={{ width: ADD_COLUMN_WIDTH }}
                    className="h-full shrink-0"
                  >
                    <AddPropertyMenu databaseId={databaseId} />
                  </div>
                </div>
              </div>
              <div
                role="rowgroup"
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((virtual) => {
                  const item = items[virtual.index]!;
                  return item.kind === 'group' ? (
                    <GroupRow
                      key={virtual.key}
                      id={item.id}
                      value={item.value}
                      property={item.property}
                      count={item.count}
                      expanded={item.expanded}
                      rowIndex={virtual.index}
                      columnCount={columns.length}
                      top={virtual.start - HEADER_HEIGHT}
                      width={width}
                      onToggle={toggleGroup}
                    />
                  ) : (
                    <TableRow
                      key={virtual.key}
                      row={item.row}
                      columns={columns}
                      rowIndex={virtual.index}
                      first={virtual.index === firstRowIndex}
                      top={virtual.start - HEADER_HEIGHT}
                      width={width}
                      selected={chosen.has(item.row.id)}
                      selecting={selection.length > 0}
                      sortIndex={visibleRowIndices.get(item.id) ?? 0}
                      canDrag={canDragRows && unlockedRowIds.has(item.id)}
                    />
                  );
                })}
              </div>
            </div>
            {items.length === 0 ? (
              <p className="sr-only">
                {rows.length === 0 ? t('databases.table.noRows') : t('databases.table.noMatches')}
              </p>
            ) : null}
            <button
              type="button"
              onClick={addRow}
              style={{ minWidth: width }}
              className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 flex h-8 w-full items-center gap-2 px-2 text-sm outline-none focus-visible:ring-2"
            >
              <Plus size={16} aria-hidden />
              {t('databases.table.newRow')}
            </button>
            {rows.length > 0 ? (
              <p className="text-muted-foreground px-2 pt-2 text-xs tabular-nums">
                {rowsShown === rows.length
                  ? t('databases.rowCount', { count: rows.length })
                  : t('databases.table.rowsShown', { shown: rowsShown, total: rows.length })}
              </p>
            ) : null}
          </div>
        </section>
      </TableDragProvider>
      <ConfirmDialog
        open={deletingChosen}
        title={t('databases.table.deleteSelectedTitle', { count: selection.length })}
        description={t('databases.table.deleteSelectedDescription')}
        confirmLabel={t('databases.table.delete')}
        onConfirm={() => {
          selection.forEach((id) => deletePage.mutate(id));
          setChosen(noRowsKept);
          setDeletingChosen(false);
        }}
        onCancel={() => setDeletingChosen(false)}
      />
      <DeletePageDialog
        page={pendingRow ? { title: pendingRow.title, subpages: 0, rows: 0 } : null}
        onConfirm={() => {
          if (rowToDelete !== null) deletePage.mutate(rowToDelete);
          setRowToDelete(null);
        }}
        onCancel={() => setRowToDelete(null)}
      />
    </TableActionsContext.Provider>
  );
}
