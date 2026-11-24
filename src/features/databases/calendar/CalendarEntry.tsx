import { Link } from '@tanstack/react-router';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CalendarEntry as Entry } from './toCalendarEntries';

type Drag = { pointerId: number; x: number; y: number; moved: boolean };

function dateAt(event: ReactPointerEvent<HTMLAnchorElement>) {
  return document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest('[data-calendar-date]')
    ?.getAttribute('data-calendar-date');
}

export function CalendarEntry({
  entry,
  editable,
  onMove,
  onTargetChange,
}: {
  entry: Entry;
  editable: boolean;
  onMove: (date: string) => void;
  onTargetChange: (date: string | null) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<Drag | null>(null);
  const didDrag = useRef(false);
  const [dragging, setDragging] = useState(false);

  const finish = (event: ReactPointerEvent<HTMLAnchorElement>, move: boolean) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    if (move && current.moved) {
      const date = dateAt(event);
      if (date != null && date !== entry.date) onMove(date);
    }
    didDrag.current = move && current.moved;
    drag.current = null;
    setDragging(false);
    onTargetChange(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  return (
    <Link
      to="/page/$pageId"
      params={{ pageId: entry.id }}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onClick={(event) => {
        if (didDrag.current) event.preventDefault();
        didDrag.current = false;
      }}
      onPointerDown={(event) => {
        if (!editable || event.button !== 0) return;
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
        if (!current.moved && distance < 5) return;
        current.moved = true;
        setDragging(true);
        onTargetChange(dateAt(event) ?? null);
      }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      className={cn(
        'bg-primary text-primary-foreground block truncate rounded-sm px-1.5 py-1 text-left text-xs',
        editable ? 'cursor-grab' : 'cursor-pointer',
        dragging && 'pointer-events-none relative z-20 cursor-grabbing opacity-80 shadow-lg',
      )}
    >
      {entry.title || t('pages.untitled')}
    </Link>
  );
}
