import { useSortable } from '@dnd-kit/react/sortable';
import type { TableDragKind } from './TableDnd';

/** The only sortable hook used by the table; columns and rows never accept each other. */
export function useTableSortable({
  id,
  index,
  kind,
  disabled = false,
}: {
  id: string;
  index: number;
  kind: TableDragKind;
  disabled?: boolean;
}) {
  return useSortable({
    id,
    index,
    group: 'database-table',
    type: kind,
    accept: kind,
    disabled,
    transition: null,
  });
}
