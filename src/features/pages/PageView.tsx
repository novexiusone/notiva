import { Navigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { Editor, type EditorHandle } from '@/features/editor/Editor';
import { Backlinks } from '@/features/links/Backlinks';
import { PageHeader } from '@/features/pages/PageHeader';
import { AppearanceRow } from '@/features/pages/PageAppearance';
import { usePages, useRenamePage } from '@/features/pages/api';
import { useBannerChooser } from '@/features/pages/useBannerChooser';
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const banner = useBannerChooser(pageId);

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

  return (
    <article className="relative pb-32">
      <PageHeader
        page={page}
        pages={pages.data ?? []}
        onChooseIcon={() => setPickerOpen(true)}
        onChooseBanner={banner.choose}
      />
      {banner.input}
      {page.banner !== null ? (
        <img src={page.banner} alt={t('pages.banner')} className="h-40 w-full object-cover" />
      ) : null}
      <div className={cn(column, 'group/appearance', page.banner === null ? 'pt-12' : 'pt-6')}>
        <AppearanceRow
          page={page}
          pickerOpen={pickerOpen}
          onPickerOpenChange={setPickerOpen}
          onChooseBanner={banner.choose}
        />
        {title}
      </div>
      {page.kind === 'database' ? (
        <DatabaseView databaseId={page.id} />
      ) : (
        <div className={column}>
          <Editor pageId={page.id} ref={editor} />
          <Backlinks pageId={page.id} />
        </div>
      )}
    </article>
  );
}
