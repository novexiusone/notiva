import { useNavigate } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import { de as dateFnsDe, enUS as dateFnsEn } from 'date-fns/locale';
import { Download, MoreHorizontal, MoveHorizontal, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { setFullWidth, useFullWidth } from '@/features/pages/fullWidth';
import { useTranslation } from 'react-i18next';
import { TopBar } from '@/components/layout/TopBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExportPanel } from '@/features/export/ExportPanel';
import { Breadcrumbs } from '@/features/pages/Breadcrumbs';
import { AppearanceMenuItems } from '@/features/pages/PageAppearance';
import { DeletePageDialog } from '@/features/pages/DeletePageDialog';
import { useDeletePage, useSetFavorite } from '@/features/pages/api';
import { countDescendants } from '@/features/pages/tree';
import type { Page } from '@/lib/commands';

const barButton =
  'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 pointer-events-auto flex size-8 items-center justify-center rounded-sm outline-none focus-visible:ring-2';

/** The top bar of an open page: its path on the left, its actions on the right. */
export function PageHeader({
  page,
  pages,
  onChooseIcon,
  onChooseBanner,
}: {
  page: Page;
  pages: Page[];
  onChooseIcon: () => void;
  onChooseBanner: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const setFavorite = useSetFavorite();
  const deletePage = useDeletePage();
  // What to do once the menu has closed and given focus back, so that the
  // picker can take the focus instead.
  const [afterClose, setAfterClose] = useState<(() => void) | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fullWidth = useFullWidth(page.id);

  const edited = new Date(page.updatedAt);
  const relativeTime = formatDistanceToNow(edited, {
    addSuffix: true,
    locale: i18n.language.startsWith('de') ? dateFnsDe : dateFnsEn,
  });

  const later = (action: () => void) => () => setAfterClose(() => action);

  return (
    <TopBar>
      {/* The bar itself drags the window; only what is inside it takes the pointer. */}
      <div className="pointer-events-none flex min-w-0 flex-1 items-center justify-between gap-4 px-4">
        <div className="pointer-events-auto min-w-0">
          <Breadcrumbs page={page} pages={pages} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <time
            dateTime={page.updatedAt}
            title={edited.toLocaleString(i18n.language)}
            className="text-muted-foreground mr-1 text-xs whitespace-nowrap"
          >
            {t('pages.lastEdited', { time: relativeTime })}
          </time>
          <button
            type="button"
            aria-label={t(page.isFavorite ? 'pages.removeFavorite' : 'pages.addFavorite')}
            aria-pressed={page.isFavorite}
            className={barButton}
            onClick={() => setFavorite(page.id, !page.isFavorite)}
          >
            <Star size={18} className={page.isFavorite ? 'fill-current' : undefined} aria-hidden />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t('pages.actions')} className={barButton}>
                <MoreHorizontal size={18} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-max min-w-44"
              onCloseAutoFocus={(event) => {
                if (!afterClose) return;
                event.preventDefault();
                afterClose();
                setAfterClose(null);
              }}
            >
              <AppearanceMenuItems
                page={page}
                onChooseIcon={later(onChooseIcon)}
                onChooseBanner={later(onChooseBanner)}
              />
              <DropdownMenuCheckboxItem
                checked={fullWidth}
                onCheckedChange={(checked) => setFullWidth(page.id, checked === true)}
              >
                <MoveHorizontal aria-hidden />
                {t('pages.fullWidth')}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={later(() => setExporting(true))}>
                <Download aria-hidden />
                {t('export.menu')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(true)}>
                <Trash2 aria-hidden />
                {t('pages.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ExportPanel
        open={exporting}
        onOpenChange={setExporting}
        pageId={page.id}
        title={page.title}
      />
      <DeletePageDialog
        page={pendingDelete ? { title: page.title, ...countDescendants(pages, page.id) } : null}
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => {
          setPendingDelete(false);
          void deletePage.mutateAsync(page.id).then(() => navigate({ to: '/' }));
        }}
      />
    </TopBar>
  );
}
