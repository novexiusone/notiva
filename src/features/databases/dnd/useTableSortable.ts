import { useSortable } from '@dnd-kit/react/sortable';
import type { TableDragKind } from './TableDnd';

/** The only sortable hook used by the table; columns and rows never accept each other. */
export function useTableSortable({
  id,
  index,
  kind,
  group,
  disabled = false,
}: {
  id: string;
  index: number;
  kind: TableDragKind;
  group: string;
  disabled?: boolean;
}) {
  return useSortable({
    id,
    index,
    group,
    type: kind,
    accept: (source) =>
      source.type === kind &&
      (source as typeof source & { sortable?: { group?: unknown } }).sortable?.group === group,
    disabled,
    transition: null,
  });
}
