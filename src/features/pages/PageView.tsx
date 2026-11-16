import { Navigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { DatabaseLink, RowProperties } from '@/features/databases/RowProperties';
import { Editor, type EditorHandle } from '@/features/editor/Editor';
import { Backlinks } from '@/features/links/Backlinks';
import { PageHeader } from '@/features/pages/PageHeader';
import { AppearanceRow } from '@/features/pages/PageAppearance';
import { PageCover } from '@/features/pages/PageCover';
import { usePages, useRenamePage } from '@/features/pages/api';
import { useBannerChooser } from '@/features/pages/useBannerChooser';
import { useFullWidth } from '@/features/pages/fullWidth';
import { rememberLastPage } from '@/lib/localState';
import { cn } from '@/lib/utils';

const readingColumn = 'mx-auto w-full max-w-[720px] px-12';
const wideColumn = 'w-full px-12';

export function PageView({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const pages = usePages();
  const renamePage = useRenamePage();
  const editor = useRef<EditorHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const page = pages.data?.find((candidate) => candidate.id === pageId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const banner = useBannerChooser(pageId);
  const fullWidth = useFullWidth(pageId);
  const column = fullWidth ? wideColumn : readingColumn;

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
    <article
      className="relative pb-32"
      // A database lines up with the title; the default centres it on the reading column.
      style={fullWidth ? ({ '--table-inset': '2.5rem' } as CSSProperties) : undefined}
    >
      <PageHeader
        page={page}
        pages={pages.data ?? []}
        onChooseIcon={() => setPickerOpen(true)}
        onChooseBanner={() => setCoverPickerOpen(true)}
      />
      {banner.input}
      {page.banner !== null ? (
        <PageCover
          page={page}
          banner={page.banner}
          pickerOpen={coverPickerOpen}
          onPickerOpenChange={setCoverPickerOpen}
          onUpload={banner.choose}
        />
      ) : null}
      <div className={cn(column, 'group/appearance', page.banner === null ? 'pt-12' : 'pt-6')}>
        {databaseId !== null ? <DatabaseLink databaseId={databaseId} /> : null}
        <AppearanceRow
          page={page}
          pickerOpen={pickerOpen}
          onPickerOpenChange={setPickerOpen}
          coverPickerOpen={coverPickerOpen}
          onCoverPickerOpenChange={setCoverPickerOpen}
          onUpload={banner.choose}
        />
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
