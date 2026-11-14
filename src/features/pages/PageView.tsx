import { Navigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { Editor, type EditorHandle } from '@/features/editor/Editor';
import { Backlinks } from '@/features/links/Backlinks';
import { usePages, useRenamePage } from '@/features/pages/api';
import { rememberLastPage } from '@/lib/localState';
import { cn } from '@/lib/utils';

const column = 'mx-auto w-full max-w-[720px] px-12';

export function PageView({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const pages = usePages();
  const renamePage = useRenamePage();
  const editor = useRef<EditorHandle>(null);
  const page = pages.data?.find((candidate) => candidate.id === pageId);

  useEffect(() => {
    if (page) rememberLastPage(page.id);
  }, [page]);

  if (pages.isPending) return null;
  // The page was deleted, or a remembered page no longer exists.
  if (!page) return <Navigate to="/" replace />;

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
      <article className="pt-16 pb-32">
        <div className={column}>{title}</div>
        <DatabaseView databaseId={page.id} />
      </article>
    );
  }

  return (
    <article className={cn(column, 'pt-16 pb-32')}>
      {title}
      <Editor pageId={page.id} ref={editor} />
      <Backlinks pageId={page.id} />
    </article>
  );
}
