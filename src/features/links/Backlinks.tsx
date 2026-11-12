import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBacklinks } from '@/features/links/api';

/** The pages that link to this page. Renders nothing when there are none. */
export function Backlinks({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const backlinks = useBacklinks(pageId);

  if (!backlinks.data || backlinks.data.length === 0) return null;

  return (
    <nav aria-label={t('links.backlinks')} className="mt-16 border-t pt-4">
      <h2 className="text-muted-foreground mb-1 text-xs font-medium">{t('links.backlinks')}</h2>
      <ul>
        {backlinks.data.map((page) => (
          <li key={page.id}>
            <Link
              to="/page/$pageId"
              params={{ pageId: page.id }}
              className="text-muted-foreground hover:bg-accent hover:text-foreground -mx-2 flex h-7 items-center gap-2 rounded-sm px-2 text-sm"
            >
              <FileText size={16} aria-hidden />
              <span className="truncate">{page.title || t('pages.untitled')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
