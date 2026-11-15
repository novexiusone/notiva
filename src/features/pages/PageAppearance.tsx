import { useTranslation } from 'react-i18next';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { PAGE_ICONS } from '@/features/pages/PageIcon';
import { useUpdateAppearance } from '@/features/pages/api';
import type { Page } from '@/lib/commands';

export function AppearanceMenuItems({
  page,
  onChooseBanner,
}: {
  page: Page;
  onChooseBanner: () => void;
}) {
  const { t } = useTranslation();
  const { change } = useUpdateAppearance();

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {t(page.icon === null ? 'pages.addIcon' : 'pages.changeIcon')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-44">
          {(Object.keys(PAGE_ICONS) as (keyof typeof PAGE_ICONS)[]).map((name) => {
            const Icon = PAGE_ICONS[name];
            return (
              <DropdownMenuItem key={name} onSelect={() => change(page.id, { icon: name })}>
                <Icon aria-hidden />
                {t(`pages.icons.${name}`)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {page.icon !== null ? (
        <DropdownMenuItem onSelect={() => change(page.id, { icon: null })}>
          {t('pages.removeIcon')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={onChooseBanner}>
        {t(page.banner === null ? 'pages.addBanner' : 'pages.changeBanner')}
      </DropdownMenuItem>
      {page.banner !== null ? (
        <DropdownMenuItem onSelect={() => change(page.id, { banner: null })}>
          {t('pages.removeBanner')}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
