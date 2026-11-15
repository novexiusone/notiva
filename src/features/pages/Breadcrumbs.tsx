import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { pathTo } from '@/features/pages/path';
import { PageIcon } from '@/features/pages/PageIcon';
import type { Page } from '@/lib/commands';

const label = (page: Page, untitled: string) => (page.title === '' ? untitled : page.title);

export function Breadcrumbs({ page, pages }: { page: Page; pages: Page[] }) {
  const { t } = useTranslation();
  const path = pathTo(pages, page);
  // A long path keeps its first page and the last two, and hides the middle.
  const hidden = path.length > 4 ? path.slice(1, -2) : [];
  const shown = path.length > 4 ? [path[0], null, ...path.slice(-2)] : path;

  return (
    <nav aria-label={t('pages.path')} className="min-w-0">
      <ol className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
        {shown.map((item, index) => (
          <li key={item?.id ?? 'more'} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground/50">
                /
              </span>
            ) : null}
            {item === null ? (
              <span
                title={hidden
                  .map((hiddenPage) => label(hiddenPage, t('pages.untitled')))
                  .join(' / ')}
              >
                …
              </span>
            ) : item.id === page.id ? (
              <span
                aria-current="page"
                className="text-foreground flex min-w-0 items-center gap-1.5 px-1"
              >
                <PageIcon page={item} size={14} className="shrink-0" />
                <span className="max-w-56 truncate">{label(item, t('pages.untitled'))}</span>
              </span>
            ) : (
              <Link
                to="/page/$pageId"
                params={{ pageId: item.id }}
                className="hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center gap-1.5 rounded-sm px-1 outline-none focus-visible:ring-2"
              >
                <PageIcon page={item} size={14} className="shrink-0" />
                <span className="max-w-40 truncate">{label(item, t('pages.untitled'))}</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
