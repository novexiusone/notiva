import { Link } from '@tanstack/react-router';
import { FileText, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCreateRow, useRows } from '@/features/databases/api';
import { cn } from '@/lib/utils';

const column = 'mx-auto w-full max-w-[720px] px-12';
const line =
  'text-muted-foreground hover:bg-accent hover:text-foreground flex h-7 items-center gap-2 rounded-sm px-2 text-sm';

/**
 * What a database page shows below its title. Until the table exists this is
 * the list of its rows. It sets its own width, so that the table can use the
 * whole main area without a change to the page around it.
 */
export function DatabaseView({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  const rows = useRows(databaseId);
  const createRow = useCreateRow(databaseId);

  if (rows.isError) {
    return (
      <p role="alert" className={cn(column, 'text-muted-foreground text-sm')}>
        {t('databases.loadFailed')}
      </p>
    );
  }
  if (!rows.isSuccess) return null;

  return (
    <section aria-label={t('databases.rows')} className={column}>
      {/* Pulled out by their padding, so that the icons line up with the title. */}
      <div className="-mx-2">
        {rows.data.length === 0 ? (
          <p className="text-muted-foreground flex h-7 items-center px-2 text-sm opacity-70">
            {t('databases.noRows')}
          </p>
        ) : (
          <ul>
            {rows.data.map((row) => (
              <li key={row.id}>
                <Link to="/page/$pageId" params={{ pageId: row.id }} className={line}>
                  <FileText size={16} aria-hidden />
                  <span className="truncate">{row.title || t('pages.untitled')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className={cn(line, 'mt-1 w-full')}
          onClick={() => createRow.mutate()}
        >
          <Plus size={16} aria-hidden />
          {t('databases.newRow')}
        </button>
      </div>
    </section>
  );
}
