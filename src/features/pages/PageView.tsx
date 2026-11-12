import { Navigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePages, useRenamePage } from '@/features/pages/api';
import { rememberLastPage } from '@/lib/localState';

export function PageView({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const pages = usePages();
  const renamePage = useRenamePage();
  const page = pages.data?.find((candidate) => candidate.id === pageId);

  useEffect(() => {
    if (page) rememberLastPage(page.id);
  }, [page]);

  if (pages.isPending) return null;
  // The page was deleted, or a remembered page no longer exists.
  if (!page) return <Navigate to="/" replace />;

  return (
    <article className="mx-auto w-full max-w-[720px] px-12 pt-16 pb-32">
      <input
        // A fresh input per page, so focus and undo history do not carry over.
        key={page.id}
        autoFocus={page.title === ''}
        aria-label={t('pages.title')}
        placeholder={t('pages.untitled')}
        value={page.title}
        onChange={(event) => renamePage(page.id, event.currentTarget.value)}
        className="placeholder:text-muted-foreground/50 w-full bg-transparent text-4xl font-bold tracking-tight outline-none"
      />
    </article>
  );
}
