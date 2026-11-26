import { Link } from '@tanstack/react-router';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKanbanCardSortable } from '@/features/databases/dnd/useKanbanSortable';
import type { TableColumn } from '@/features/databases/useDatabaseTable';
import type { Row } from '@/lib/commands';
import { cn } from '@/lib/utils';

export function KanbanCard({
  row,
  properties,
  index,
  group,
  canDrag,
  sorted,
  readOnly,
}: {
  row: Row;
  properties: readonly TableColumn[];
  index: number;
  group: string;
  canDrag: boolean;
  sorted: boolean;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const title = row.title || t('pages.untitled');
  const { ref, handleRef, isDragging } = useKanbanCardSortable({
    id: row.id,
    index,
    group,
    canDrag,
    sorted,
    readOnly,
  });

  return (
    <div
      ref={ref}
      role="listitem"
      data-row-id={row.id}
      className={cn('group relative', isDragging && 'z-10 opacity-60')}
    >
      {canDrag ? (
        <button
          ref={handleRef}
          type="button"
          aria-label={t('databases.kanban.dragCard', { title })}
          className="border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 absolute top-2 right-2 z-10 flex size-6 cursor-grab items-center justify-center rounded-sm border opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 active:cursor-grabbing"
        >
          <GripVertical size={14} aria-hidden />
        </button>
      ) : null}
      <Link
        to="/page/$pageId"
        params={{ pageId: row.id }}
        aria-label={title}
        className={cn(
          'border-border bg-background hover:border-foreground/20 block min-w-0 rounded-md border p-3 shadow-xs outline-none',
          'focus-visible:ring-ring/60 focus-visible:ring-2',
        )}
      >
        <span
          className={cn(
            'block truncate text-sm font-medium',
            row.title === '' && 'text-muted-foreground/60',
          )}
        >
          {title}
        </span>
        {properties.length > 0 ? (
          <dl className="text-muted-foreground mt-2 flex flex-col gap-1 text-xs">
            {properties.flatMap((column) => {
              if (!column.property || !column.definition) return [];
              const { Display } = column.definition;
              return [
                <div key={column.id} className="min-w-0">
                  <dt className="sr-only">{column.property.name}</dt>
                  <dd className="min-w-0">
                    <Display value={row.cells[column.id] ?? null} property={column.property} />
                  </dd>
                </div>,
              ];
            })}
          </dl>
        ) : null}
      </Link>
    </div>
  );
}
