import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

const MIN_WIDTH = 40;
const KEYBOARD_STEP = 10;

/** The edge of a column header: dragged with a pointer, or resized with arrow keys. */
export function ColumnResizeHandle({
  name,
  width,
  onChange,
}: {
  name: string;
  width: number;
  /** Previews a width, then commits it when `done` is true. */
  onChange: (width: number, done: boolean) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, width };
    onChange(width, false);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    event.stopPropagation();
    current.width = Math.max(MIN_WIDTH, current.startWidth + event.clientX - current.startX);
    onChange(Math.round(current.width), false);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    event.stopPropagation();
    drag.current = null;
    onChange(Math.round(current.width), true);
  };
  const cancel = () => {
    if (!drag.current) return;
    drag.current = null;
    onChange(width, true);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (direction !== 0) {
      event.preventDefault();
      event.stopPropagation();
      onChange(Math.max(MIN_WIDTH, width + direction * KEYBOARD_STEP), true);
    }
  };

  return (
    <div
      role="separator"
      aria-label={t('databases.table.resizeColumn', { name })}
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className="hover:bg-primary/40 focus-visible:bg-primary/50 absolute top-0 right-0 z-20 h-full w-2 shrink-0 cursor-col-resize touch-none outline-none"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={keyDown}
    />
  );
}
