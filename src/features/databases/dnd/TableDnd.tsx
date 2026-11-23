import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import type { ReactNode } from 'react';

export type TableDragKind = 'column' | 'row';

export type TableReorder = { kind: TableDragKind; from: number; to: number };

/** The drag context of one database table, deliberately below the app shell. */
export function TableDragProvider({
  children,
  onReorder,
}: {
  children: ReactNode;
  onReorder: (reorder: TableReorder) => void;
}) {
  return (
    <DragDropProvider
      onDragOver={(event) => {
        const { source, target } = event.operation;
        if (
          isSortable(source) &&
          isSortable(target) &&
          source.id !== target.id &&
          (source.type !== target.type || source.sortable.group !== target.sortable.group)
        ) {
          event.preventDefault();
        }
      }}
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source, target } = event.operation;
        if (!isSortable(source)) return;
        const kind = source.type;
        let targetIndex =
          isSortable(target) &&
          target.id !== source.id &&
          !target.disabled &&
          target.accepts(source)
            ? target.sortable.initialIndex
            : null;
        if (targetIndex === null && source.manager && event.nativeEvent instanceof PointerEvent) {
          const pointer = event.nativeEvent;
          const elements = document.elementsFromPoint(pointer.clientX, pointer.clientY);
          const accepted = [...source.manager.registry.droppables].filter(
            (candidate) =>
              !candidate.disabled &&
              candidate.accepts(source) &&
              candidate.element &&
              elements.some((element) => candidate.element!.contains(element)),
          );
          const beneathPointer = accepted.find((candidate) => candidate.id !== source.id);
          const sortableBeneath = beneathPointer ?? null;
          if (isSortable(sortableBeneath)) {
            targetIndex = sortableBeneath.sortable.initialIndex;
          } else if (accepted.length > 0 && source.index !== source.initialIndex) {
            targetIndex = source.index;
          }
        }
        const useSourceIndex =
          isSortable(target) &&
          target.id === source.id &&
          !target.disabled &&
          target.accepts(source) &&
          source.index !== source.initialIndex;
        const to =
          event.nativeEvent instanceof PointerEvent
            ? targetIndex
            : useSourceIndex
              ? source.index
              : targetIndex;
        if ((kind === 'column' || kind === 'row') && to !== null && source.initialIndex !== to) {
          onReorder({ kind, from: source.initialIndex, to });
        }
      }}
    >
      {children}
    </DragDropProvider>
  );
}
