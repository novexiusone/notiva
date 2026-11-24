import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TableColumn } from '@/features/databases/useDatabaseTable';
import type { Row } from '@/lib/commands';
import { cn } from '@/lib/utils';

export function KanbanCard({ row, properties }: { row: Row; properties: readonly TableColumn[] }) {
  const { t } = useTranslation();
  const title = row.title || t('pages.untitled');

  return (
    <div role="listitem" data-row-id={row.id} className="group relative">
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
