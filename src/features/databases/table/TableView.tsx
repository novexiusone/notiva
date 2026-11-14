import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateRow, useSetCell } from '@/features/databases/api';
import { useCellStore } from '@/features/databases/uiStore';
import { TITLE_COLUMN_ID, useDatabaseTable } from '@/features/databases/useDatabaseTable';
import { useDeletePage, useRenamePage } from '@/features/pages/api';
import { DeletePageDialog } from '@/features/pages/DeletePageDialog';
import type { Database, Row } from '@/lib/commands';
import { AddPropertyMenu } from './AddPropertyMenu';
import { PropertyHeaderCell, TitleHeaderCell } from './HeaderCell';
import { ADD_COLUMN_WIDTH, columnWidth, HEADER_HEIGHT, ROW_HEIGHT, tableWidth } from './layout';
import { TableRow } from './Row';
import { TableActionsContext, type TableActions } from './tableActions';

// The first column lines up with the page title, which sits in a centred column
// of 720px with 48px on each side; the cell's own padding is taken off.
const inset = 'max(2.5rem, calc((100% - 720px) / 2 + 2.5rem))';

/**
 * The table of a database: a sticky header, virtualised rows and "New" below
 * them. It scrolls in both directions inside the main area and is never taller
 * than it.
 */
export function TableView({ database, rows }: { database: Database; rows: Row[] }) {
  const { t } = useTranslation();
  const databaseId = database.page.id;
  const tableId = useId();
  const { table, columns } = useDatabaseTable(database.properties, rows);
  const tableRows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowToDelete, setRowToDelete] = useState<string | null>(null);

  const setCell = useSetCell(databaseId);
  const renamePage = useRenamePage();
  const deletePage = useDeletePage();
  const createRow = useCreateRow(databaseId);

  // The app does not use the React Compiler; rows are memoised by hand instead.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => tableRows[index].id,
    overscan: 10,
    // The rows start below the sticky header, which also covers the top of the view.
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });

  // Rows and cells get functions that never change, so that they stay memoised.
  const latest = useRef({ setCell, renamePage, tableRows, columns });
  useLayoutEffect(() => {
    latest.current = { setCell, renamePage, tableRows, columns };
  });
  const actions = useMemo<TableActions>(
    () => ({
      tableId,
      setCell: (rowId, propertyId, value) => latest.current.setCell(rowId, propertyId, value),
      renameRow: (rowId, title) => latest.current.renamePage(rowId, title),
      deleteRow: setRowToDelete,
      move: (rowIndex, columnIndex, byRows, byColumns) => {
        const { tableRows, columns } = latest.current;
        const row = tableRows[Math.min(Math.max(rowIndex + byRows, 0), tableRows.length - 1)];
        const column = columns[Math.min(Math.max(columnIndex + byColumns, 0), columns.length - 1)];
        if (row && column) {
          useCellStore.getState().activate({ tableId, rowId: row.id, columnId: column.id });
        }
      },
    }),
    [tableId],
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
    const index = tableRows.findIndex((row) => row.id === scrollPending.current);
    if (index === -1) return;
    scrollPending.current = null;
    virtualizer.scrollToIndex(index);
  }, [activeRowId, tableRows, virtualizer]);

  const addRow = () =>
    createRow.mutate(undefined, {
      onSuccess: (row) =>
        useCellStore
          .getState()
          .activate({ tableId, rowId: row.id, columnId: TITLE_COLUMN_ID }, true),
    });

  const width = tableWidth(columns);
  const pendingRow = rows.find((row) => row.id === rowToDelete);

  return (
    <TableActionsContext.Provider value={actions}>
      <section
        aria-label={t('databases.table.rows')}
        ref={scrollRef}
        // Inline, so that the test setup can tell the scroll container apart.
        style={{ overflow: 'auto' }}
        className="max-h-[calc(100dvh-2.75rem)] overscroll-x-contain"
      >
        <div className="w-max min-w-full pb-4" style={{ paddingLeft: inset, paddingRight: inset }}>
          <div
            role="grid"
            aria-label={database.page.title || t('pages.untitled')}
            aria-rowcount={tableRows.length + 1}
            aria-colcount={columns.length}
            style={{ width }}
          >
            <div role="rowgroup" className="bg-background sticky top-0 z-10">
              <div
                role="row"
                aria-rowindex={1}
                style={{ height: HEADER_HEIGHT }}
                className="border-border flex border-y"
              >
                {columns.map((column, columnIndex) =>
                  column.property ? (
                    <PropertyHeaderCell
                      key={column.id}
                      property={column.property}
                      definition={column.definition}
                      columnIndex={columnIndex}
                      width={columnWidth(column)}
                    />
                  ) : (
                    <TitleHeaderCell key={column.id} width={columnWidth(column)} />
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
              {virtualizer.getVirtualItems().map((item) => (
                <TableRow
                  key={item.key}
                  row={tableRows[item.index].original}
                  columns={columns}
                  rowIndex={item.index}
                  top={item.start - HEADER_HEIGHT}
                  width={width}
                />
              ))}
            </div>
          </div>
          {tableRows.length === 0 ? (
            <p className="text-muted-foreground flex h-8 items-center px-2 text-sm opacity-70">
              {t('databases.table.noRows')}
            </p>
          ) : null}
          <button
            type="button"
            onClick={addRow}
            style={{ width }}
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 flex h-8 items-center gap-2 rounded-sm px-2 text-sm outline-none focus-visible:ring-2"
          >
            <Plus size={16} aria-hidden />
            {t('databases.table.newRow')}
          </button>
        </div>
      </section>
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
