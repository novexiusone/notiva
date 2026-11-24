import { useDroppable } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';

export const KANBAN_CARD_TYPE = 'kanban-card';
type DragSource = { type?: unknown; sortable?: { initialGroup?: unknown } };

function acceptsCard(source: DragSource, group: string, sorted: boolean) {
  if (source.type !== KANBAN_CARD_TYPE) return false;
  return !sorted || String(source.sortable?.initialGroup ?? '') !== group;
}

export function useKanbanCardSortable({
  id,
  index,
  group,
  canDrag,
  sorted,
  readOnly,
}: {
  id: string;
  index: number;
  group: string;
  canDrag: boolean;
  sorted: boolean;
  readOnly: boolean;
}) {
  return useSortable({
    id,
    index,
    group,
    type: KANBAN_CARD_TYPE,
    accept: (source) => acceptsCard(source, group, sorted),
    disabled: { draggable: !canDrag, droppable: readOnly },
    // React owns card order; the first default plugin handles keyboard targeting.
    plugins: ([keyboard]) => (keyboard ? [keyboard] : []),
    transition: null,
  });
}

export function useKanbanColumnDrop({
  group,
  index,
  sorted,
  readOnly,
}: {
  group: string;
  index: number;
  sorted: boolean;
  readOnly: boolean;
}) {
  return useDroppable({
    id: `kanban-column:${group || 'empty'}`,
    type: KANBAN_CARD_TYPE,
    data: { group, index },
    collisionPriority: 0,
    accept: (source) => acceptsCard(source, group, sorted),
    disabled: readOnly,
  });
}
