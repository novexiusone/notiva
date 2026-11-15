import { useNavigate, useParams } from '@tanstack/react-router';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarItem } from '@/components/layout/SidebarItem';
import { usePages } from '@/features/pages/api';

export function Favourites() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pageId: openPageId } = useParams({ strict: false });
  const pages = usePages();
  const favourites = (pages.data ?? []).filter((page) => page.isFavorite);

  return (
    <nav aria-label={t('sidebar.favourites')} className="mt-5 shrink-0 px-2">
      <h2 className="text-muted-foreground flex h-7 items-center px-2 text-xs font-medium">
        {t('sidebar.favourites')}
      </h2>
      {favourites.length === 0 ? (
        <p className="text-muted-foreground px-2 py-1 text-xs opacity-70">
          {t('sidebar.noFavourites')}
        </p>
      ) : (
        <div className="flex max-h-40 flex-col gap-px overflow-y-auto">
          {favourites.map((page) => (
            <SidebarItem
              key={page.id}
              icon={Star}
              label={page.title || t('pages.untitled')}
              aria-current={openPageId === page.id ? 'page' : undefined}
              className={openPageId === page.id ? 'bg-accent text-foreground' : undefined}
              onClick={() => navigate({ to: '/page/$pageId', params: { pageId: page.id } })}
            />
          ))}
        </div>
      )}
    </nav>
  );
}
