import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import { useRef, type ReactNode } from 'react';

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
  const rejectedDrag = useRef(false);

  return (
    <DragDropProvider
      onDragStart={() => {
        rejectedDrag.current = false;
      }}
      onDragOver={(event) => {
        const { source, target } = event.operation;
        if (
          isSortable(source) &&
          isSortable(target) &&
          source.id !== target.id &&
          (source.type !== target.type || source.sortable.group !== target.sortable.group)
        ) {
          rejectedDrag.current = true;
          event.preventDefault();
        }
      }}
      onDragEnd={(event) => {
        const rejected = rejectedDrag.current;
        rejectedDrag.current = false;
        if (event.canceled || rejected) return;
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
          const beneathPointer = [...source.manager.registry.droppables].filter(
            (candidate) =>
              candidate.element && elements.some((element) => candidate.element!.contains(element)),
          );
          if (
            beneathPointer.some((candidate) => !candidate.disabled && !candidate.accepts(source))
          ) {
            return;
          }
          const accepted = beneathPointer.filter(
            (candidate) => !candidate.disabled && candidate.accepts(source),
          );
          const targetBeneathPointer = accepted.find((candidate) => candidate.id !== source.id);
          const sortableBeneath = targetBeneathPointer ?? null;
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
        const to = useSourceIndex ? source.index : targetIndex;
        if ((kind === 'column' || kind === 'row') && to !== null && source.initialIndex !== to) {
          onReorder({ kind, from: source.initialIndex, to });
        }
      }}
    >
      {children}
    </DragDropProvider>
  );
}
