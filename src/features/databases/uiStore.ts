import { create } from 'zustand';

/** One cell of one table on screen. `tableId` tells apart two tables of the same database. */
export type CellAddress = { tableId: string; rowId: string; columnId: string };

/** What a cell is right now: the one being edited, the one that is active, or neither. */
export type CellMode = 'editing' | 'active' | null;

type CellStore = {
  /** The cell that has the keyboard focus or was clicked last. */
  active: CellAddress | null;
  /** Whether the active cell shows its editor. */
  editing: boolean;
  /** Makes a cell the active one. Any other editor closes, even one that refused its value. */
  activate: (cell: CellAddress, edit?: boolean) => void;
  /** Closes the editor of `cell`; does nothing when another cell has become active meanwhile. */
  stopEditing: (cell: CellAddress) => void;
  /** Forgets the active cell of a table that is going away. */
  forget: (tableId: string) => void;
};

function isSame(a: CellAddress | null, b: CellAddress) {
  return a?.tableId === b.tableId && a.rowId === b.rowId && a.columnId === b.columnId;
}

/** The active and the edited cell. Everything else about a database lives in TanStack Query. */
export const useCellStore = create<CellStore>()((set) => ({
  active: null,
  editing: false,
  activate: (cell, edit = false) =>
    set((state) =>
      isSame(state.active, cell) && state.editing === edit
        ? state
        : { active: cell, editing: edit },
    ),
  stopEditing: (cell) =>
    set((state) => (isSame(state.active, cell) && state.editing ? { editing: false } : state)),
  forget: (tableId) =>
    set((state) => (state.active?.tableId === tableId ? { active: null, editing: false } : state)),
}));

/** The mode of one cell. A cell re-renders only when its own mode changes. */
export function useCellMode(cell: CellAddress): CellMode {
  return useCellStore((state) => {
    if (!isSame(state.active, cell)) return null;
    return state.editing ? 'editing' : 'active';
  });
}

/**
 * Whether a cell is the Tab stop of its table although it is not active: the
 * first cell is, as long as no cell of the table is active. Other cells never
 * re-render because of it.
 */
export function useIsFallbackTabStop(tableId: string, isFirst: boolean) {
  return useCellStore((state) => isFirst && state.active?.tableId !== tableId);
}
