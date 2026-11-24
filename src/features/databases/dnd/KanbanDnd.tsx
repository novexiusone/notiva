import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import { useRef, type ReactNode } from 'react';
import { KANBAN_CARD_TYPE as CARD_TYPE } from './useKanbanSortable';

export type KanbanDrag = {
  source: { rowId: string; group: string };
  target: { group: string; index: number };
};

/** The drag context of one board, deliberately below the database view. */
export function KanbanDragProvider({
  children,
  onMove,
}: {
  children: ReactNode;
  onMove: (drag: KanbanDrag) => Promise<void> | void;
}) {
  const rejectedDrag = useRef(false);

  return (
    <DragDropProvider
      onDragStart={() => {
        rejectedDrag.current = false;
      }}
      onDragOver={(event) => {
        const { source, target } = event.operation;

        if (source && target && source.type !== target.type) {
          rejectedDrag.current = true;
          event.preventDefault();
        }
      }}
      onDragEnd={(event) => {
        const rejected = rejectedDrag.current;
        rejectedDrag.current = false;
        if (event.canceled || rejected) return;
        const { source, target } = event.operation;
        if (!isSortable(source) || source.type !== CARD_TYPE) return;

        const moveTo = (candidate: typeof target) => {
          if (!candidate || candidate.disabled || !candidate.accepts(source)) return false;
          let group: string;
          let index: number;
          if (isSortable(candidate)) {
            if (
              candidate.id === source.id &&
              source.index === source.initialIndex &&
              source.sortable.group === source.sortable.initialGroup
            ) {
              return false;
            }
            group = String(candidate.sortable.group ?? '');
            index = candidate.id === source.id ? source.index : candidate.sortable.initialIndex;
          } else {
            const data = candidate.data as { group?: unknown; index?: unknown };
            if (typeof data.group !== 'string' || typeof data.index !== 'number') return false;
            group = data.group;
            index =
              group === String(source.sortable.initialGroup ?? '') &&
              source.index !== source.initialIndex
                ? source.index
                : data.index;
          }

          const moving = onMove({
            source: {
              rowId: String(source.id),
              group: String(source.sortable.initialGroup ?? ''),
            },
            target: { group, index },
          });
          if (moving instanceof Promise) {
            const suspension = event.suspend();
            moving.then(suspension.resume, suspension.abort);
          }
          return true;
        };

        const unchangedSource =
          source.index === source.initialIndex &&
          source.sortable.group === source.sortable.initialGroup;
        if (unchangedSource && event.nativeEvent instanceof PointerEvent) {
          const { clientX, clientY } = event.nativeEvent;
          if (event.operation.shape?.initial.containsPoint({ x: clientX, y: clientY })) return;
        }
        if (
          unchangedSource &&
          !(event.nativeEvent instanceof PointerEvent) &&
          isSortable(target) &&
          target.id === source.id
        ) {
          return;
        }
        if (moveTo(target)) return;
        if (!source.manager || !(event.nativeEvent instanceof PointerEvent)) return;
        const pointer = event.nativeEvent;
        const elements = document.elementsFromPoint(pointer.clientX, pointer.clientY);
        const beneathPointer = [...source.manager.registry.droppables].filter(
          (candidate) =>
            candidate.element && elements.some((element) => candidate.element!.contains(element)),
        );
        if (
          beneathPointer.some(
            (candidate) => candidate.type !== CARD_TYPE && !candidate.accepts(source),
          )
        ) {
          return;
        }
        const accepted = beneathPointer.filter(
          (candidate) => !candidate.disabled && candidate.accepts(source),
        );
        moveTo(accepted.find((candidate) => candidate.id !== source.id) ?? accepted[0] ?? null);
      }}
    >
      {children}
    </DragDropProvider>
  );
}
