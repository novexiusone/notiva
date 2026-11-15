import { Navigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { DatabaseLink, RowProperties } from '@/features/databases/RowProperties';
import { Editor, type EditorHandle } from '@/features/editor/Editor';
import { Backlinks } from '@/features/links/Backlinks';
import { PageHeader } from '@/features/pages/PageHeader';
import { PageIcon } from '@/features/pages/PageIcon';
import { usePages, useRenamePage } from '@/features/pages/api';
import { rememberLastPage } from '@/lib/localState';
import { cn } from '@/lib/utils';

const column = 'mx-auto w-full max-w-[720px] px-12';

export function PageView({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const pages = usePages();
  const renamePage = useRenamePage();
  const editor = useRef<EditorHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const page = pages.data?.find((candidate) => candidate.id === pageId);

  useEffect(() => {
    if (page) rememberLastPage(page.id);
  }, [page]);

  if (pages.isPending) return null;
  // The page was deleted, or a remembered page no longer exists.
  if (!page) return <Navigate to="/" replace />;

  const title = (
    <input
      ref={titleInput}
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

  // A row is a page that also shows its database and its properties.
  const { databaseId } = page;

  return (
    <article className="relative pb-32">
      <PageHeader
        page={page}
        pages={pages.data ?? []}
        onRename={() => {
          titleInput.current?.focus();
          titleInput.current?.select();
        }}
      />
      {page.banner !== null ? (
        <img src={page.banner} alt={t('pages.banner')} className="h-40 w-full object-cover" />
      ) : null}
      <div className={cn(column, page.banner === null ? 'pt-16' : 'pt-8')}>
        {databaseId !== null ? <DatabaseLink databaseId={databaseId} /> : null}
        {page.icon !== null ? <PageIcon page={page} size={40} className="mb-4" /> : null}
        {title}
      </div>
      {page.kind === 'database' ? (
        // A database shows its rows where a page has its text. Only the title
        // keeps the reading width; what is below it decides for itself.
        <DatabaseView databaseId={page.id} />
      ) : (
        <div className={column}>
          {databaseId !== null ? (
            // Fresh per row, so an open editor does not carry over to the next one.
            <RowProperties key={`properties-${page.id}`} rowId={page.id} databaseId={databaseId} />
          ) : null}
          <Editor pageId={page.id} ref={editor} />
          <Backlinks pageId={page.id} />
        </div>
      )}
    </article>
  );
}
