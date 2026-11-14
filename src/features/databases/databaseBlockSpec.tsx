import { createReactBlockSpec } from '@blocknote/react';
import { Link } from '@tanstack/react-router';
import { Maximize2, Table } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { EMBEDDED_TABLE_MAX_HEIGHT } from '@/features/databases/table/layout';
import { usePages } from '@/features/pages/api';
import { cn } from '@/lib/utils';

/**
 * Inside the block the table starts at the edge of the text column instead of
 * lining up with a page title, and it is only so tall before it scrolls
 * itself, so that a long database does not make the page endless.
 */
const embeddedLayout = {
  '--table-inset': '0px',
  '--table-max-height': EMBEDDED_TABLE_MAX_HEIGHT,
} as CSSProperties;

/**
 * A database inside a page. It shows the same view as the database's own
 * page; the block itself stores nothing but the database's id, so every
 * block of one database shows the same rows.
 */
export function DatabaseBlock({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  // The page list is loaded for every page view, so this costs no request.
  const pages = usePages();
  const database = pages.data?.find(
    (candidate) => candidate.id === databaseId && candidate.kind === 'database',
  );

  // Until the pages have loaded it is not known whether the database exists.
  if (!pages.isSuccess) return null;

  if (!database) {
    return (
      <div
        data-database-block="deleted"
        // Only "deleted" says so; the reset keeps BlockNote's paragraph rule away.
        className="database-block text-muted-foreground flex w-full items-center gap-1.5 py-1 line-through decoration-1"
      >
        <Table size={16} aria-hidden className="shrink-0" />
        {t('databases.embed.deleted')}
      </div>
    );
  }

  const title = database.title || t('pages.untitled');

  return (
    <section
      aria-label={t('databases.embed.label', { title })}
      data-database-block={databaseId}
      style={embeddedLayout}
      className="database-block flex w-full min-w-0 flex-col gap-1 py-1"
    >
      <div className="flex h-8 min-w-0 items-center gap-1">
        <span className="min-w-0 truncate text-lg font-semibold">{title}</span>
        <Link
          to="/page/$pageId"
          params={{ pageId: databaseId }}
          // No view in the address: the database shows the view that was active last.
          search={{}}
          aria-label={t('databases.embed.open')}
          title={t('databases.embed.open')}
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md outline-none',
            'focus-visible:ring-ring/60 focus-visible:ring-2',
          )}
        >
          <Maximize2 size={14} aria-hidden />
        </Link>
      </div>
      <DatabaseView databaseId={databaseId} embedded />
    </section>
  );
}

/** The `database` block: an embedded database, stored as `{ databaseId }`. */
export const databaseBlock = createReactBlockSpec(
  { type: 'database', propSchema: { databaseId: { default: '' } }, content: 'none' },
  {
    render: ({ block }) => <DatabaseBlock databaseId={block.props.databaseId} />,
    // Copied or exported, the block says what it was and which database it named.
    toExternalHTML: ({ block }) => <p data-database-id={block.props.databaseId}>Database</p>,
  },
);
