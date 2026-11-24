export type KanbanMoveColumn = {
  /** The dnd group: the option id, or the empty string for rows without a value. */
  key: string;
  value: string | null;
  rowIds: readonly string[];
};

export type CardMove = {
  rowId: string;
  value: string | null;
  /** `null` means only the value changes; `afterRowId: null` moves to the database's start. */
  position: { afterRowId: string | null } | null;
};

/** Works out the cell and manual-position changes made by dropping a card. */
export function moveCard(
  columns: readonly KanbanMoveColumn[],
  source: { rowId: string; group: string },
  target: { group: string; index: number },
  { sorted = false }: { sorted?: boolean } = {},
): CardMove | null {
  const from = columns.find((column) => column.key === source.group);
  const to = columns.find((column) => column.key === target.group);
  if (!from || !to || !Number.isInteger(target.index)) return null;
  const fromIndex = from.rowIds.indexOf(source.rowId);
  if (fromIndex === -1 || target.index < 0 || target.index > to.rowIds.length) return null;

  if (from.key === to.key) {
    if (sorted || fromIndex === target.index) return null;
    const reordered = [...from.rowIds];
    reordered.splice(fromIndex, 1);
    if (target.index === from.rowIds.length) {
      if (fromIndex === from.rowIds.length - 1) return null;
      return {
        rowId: source.rowId,
        value: from.value,
        position: { afterRowId: reordered[reordered.length - 1] ?? null },
      };
    }
    reordered.splice(target.index, 0, source.rowId);
    return {
      rowId: source.rowId,
      value: from.value,
      position: { afterRowId: reordered[target.index - 1] ?? null },
    };
  }

  return {
    rowId: source.rowId,
    value: to.value,
    position: sorted ? null : { afterRowId: to.rowIds[target.index - 1] ?? null },
  };
}
