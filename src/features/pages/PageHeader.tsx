import { useNavigate } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import { de as dateFnsDe, enUS as dateFnsEn } from 'date-fns/locale';
import { MoreHorizontal, Star } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCreateDatabase } from '@/features/databases/api';
import { useExport } from '@/features/export/useExport';
import { AppearanceMenuItems } from '@/features/pages/PageAppearance';
import { DeletePageDialog } from '@/features/pages/DeletePageDialog';
import { useDeletePage, useSetFavorite, useUpdateAppearance } from '@/features/pages/api';
import { countDescendants } from '@/features/pages/tree';
import type { CommandError, Page } from '@/lib/commands';

export function PageHeader({
  page,
  pages,
  onRename,
}: {
  page: Page;
  pages: Page[];
  onRename: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const setFavorite = useSetFavorite();
  const { saveBanner } = useUpdateAppearance();
  const createDatabase = useCreateDatabase();
  const deletePage = useDeletePage();
  const exportMarkdown = useExport();
  const bannerInput = useRef<HTMLInputElement>(null);
  const focusAction = useRef<'rename' | 'create' | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  const edited = new Date(page.updatedAt);
  const relativeTime = formatDistanceToNow(edited, {
    addSuffix: true,
    locale: i18n.language.startsWith('de') ? dateFnsDe : dateFnsEn,
  });

  const addDatabase = async () => {
    const database = await createDatabase.mutateAsync(page.id);
    await navigate({ to: '/page/$pageId', params: { pageId: database.page.id } });
  };

  const chooseBanner = async (file: File | undefined) => {
    if (!file) return;
    try {
      await saveBanner(page.id, file);
    } catch (error) {
      const refused = (error as Partial<CommandError>).kind === 'invalid';
      toast.error(t(refused ? 'editor.imageRefused' : 'pages.bannerFailed'));
    }
  };

  return (
    <div className="bg-background/80 absolute top-3 right-4 z-10 flex items-center gap-1 rounded-sm backdrop-blur-sm">
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
        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
        onClick={() => setFavorite(page.id, !page.isFavorite)}
      >
        <Star size={18} className={page.isFavorite ? 'fill-current' : undefined} aria-hidden />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('pages.actions')}
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
          >
            <MoreHorizontal size={18} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-max min-w-44"
          onCloseAutoFocus={(event) => {
            const action = focusAction.current;
            focusAction.current = null;
            if (action) event.preventDefault();
            if (action === 'rename') onRename();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              focusAction.current = 'rename';
            }}
          >
            {t('pages.rename')}
          </DropdownMenuItem>
          {page.kind === 'database' ? null : (
            <DropdownMenuItem
              onSelect={() => {
                focusAction.current = 'create';
                void addDatabase();
              }}
            >
              {t('databases.add')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <AppearanceMenuItems page={page} onChooseBanner={() => bannerInput.current?.click()} />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void exportMarkdown(page.id)}>
            {t('export.page')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(true)}>
            {t('pages.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={bannerInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label={t('pages.chooseBanner')}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void chooseBanner(file);
        }}
      />
      <DeletePageDialog
        page={pendingDelete ? { title: page.title, ...countDescendants(pages, page.id) } : null}
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => {
          setPendingDelete(false);
          void deletePage.mutateAsync(page.id).then(() => navigate({ to: '/' }));
        }}
      />
    </div>
  );
}
