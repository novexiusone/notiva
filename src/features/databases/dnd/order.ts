import { arrayMove } from '@dnd-kit/helpers';
import { TITLE_COLUMN_ID } from '@/features/databases/useDatabaseTable';

/** Moves the visible columns while hidden columns keep their places and the title stays first. */
export function mergeVisibleColumnOrder(
  current: readonly string[],
  visible: readonly string[],
  from: number,
  to: number,
): string[] {
  const reordered = arrayMove([...visible], from, to);
  const isVisible = new Set(visible);
  let index = 0;
  return [
    TITLE_COLUMN_ID,
    ...current
      .filter((id) => id !== TITLE_COLUMN_ID)
      .map((id) => (isVisible.has(id) ? reordered[index++]! : id)),
  ];
}

/** The command arguments for a visible row after its drag, or null when it did not move. */
export function rowMoveAfterReorder(
  visible: readonly string[],
  from: number,
  to: number,
): { rowId: string; afterRowId: string | null } | null {
  const rowId = visible[from];
  if (rowId === undefined || from === to || to < 0 || to >= visible.length) return null;
  const reordered = arrayMove([...visible], from, to);
  return { rowId, afterRowId: reordered[to - 1] ?? null };
}
