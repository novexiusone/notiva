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
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source, target } = event.operation;
        if (!isSortable(source)) return;
        const kind = source.type;
        let targetIndex =
          isSortable(target) && target.id !== source.id ? target.sortable.initialIndex : null;
        if (targetIndex === null && source.manager && event.nativeEvent instanceof PointerEvent) {
          const pointer = event.nativeEvent;
          const elements = document.elementsFromPoint(pointer.clientX, pointer.clientY);
          const beneathPointer = [...source.manager.registry.droppables].find(
            (candidate) =>
              candidate.id !== source.id &&
              candidate.element &&
              elements.some((element) => candidate.element!.contains(element)),
          );
          const sortableBeneath = beneathPointer ?? null;
          if (isSortable(sortableBeneath)) {
            targetIndex = sortableBeneath.sortable.initialIndex;
          }
        }
        const to = source.index !== source.initialIndex ? source.index : targetIndex;
        if ((kind === 'column' || kind === 'row') && to !== null && source.initialIndex !== to) {
          onReorder({ kind, from: source.initialIndex, to });
        }
      }}
    >
      {children}
    </DragDropProvider>
  );
}
