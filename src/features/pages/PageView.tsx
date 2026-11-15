import { Navigate } from '@tanstack/react-router';
import { Star } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { Editor, type EditorHandle } from '@/features/editor/Editor';
import { Backlinks } from '@/features/links/Backlinks';
import { usePages, useRenamePage, useSetFavorite } from '@/features/pages/api';
import { rememberLastPage } from '@/lib/localState';
import { cn } from '@/lib/utils';

const column = 'mx-auto w-full max-w-[720px] px-12';

export function PageView({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const pages = usePages();
  const renamePage = useRenamePage();
  const setFavorite = useSetFavorite();
  const editor = useRef<EditorHandle>(null);
  const page = pages.data?.find((candidate) => candidate.id === pageId);

  useEffect(() => {
    if (page) rememberLastPage(page.id);
  }, [page]);

  if (pages.isPending) return null;
  // The page was deleted, or a remembered page no longer exists.
  if (!page) return <Navigate to="/" replace />;

  const favouriteButton = (
    <button
      type="button"
      aria-label={t(page.isFavorite ? 'pages.removeFavorite' : 'pages.addFavorite')}
      aria-pressed={page.isFavorite}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 absolute top-4 right-4 flex size-8 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
      onClick={() => setFavorite(page.id, !page.isFavorite)}
    >
      <Star size={18} className={page.isFavorite ? 'fill-current' : undefined} aria-hidden />
    </button>
  );

  const title = (
    <input
      // A fresh input per page, so focus and undo history do not carry over.
      key={page.id}
      autoFocus={page.title === ''}
      aria-label={t('pages.title')}
      placeholder={t('pages.untitled')}
      value={page.title}
      onChange={(event) => renamePage(page.id, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          editor.current?.focus();
        }
      }}
      className="placeholder:text-muted-foreground/50 mb-4 w-full bg-transparent text-4xl font-bold tracking-tight outline-none"
    />
  );

  // A database shows its rows where a page has its text. Only the title keeps
  // the reading width; what is below it decides for itself.
  if (page.kind === 'database') {
    return (
      <article className="relative pt-16 pb-32">
        {favouriteButton}
        <div className={column}>{title}</div>
        <DatabaseView databaseId={page.id} />
      </article>
    );
  }

  return (
    <article className={cn(column, 'relative pt-16 pb-32')}>
      {favouriteButton}
      {title}
      <Editor pageId={page.id} ref={editor} />
      <Backlinks pageId={page.id} />
    </article>
  );
}
