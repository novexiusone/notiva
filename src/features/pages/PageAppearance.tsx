import { ImagePlus, ImageOff, Smile, SmilePlus, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { CoverPicker } from '@/features/pages/CoverPicker';
import { IconPicker } from '@/features/pages/IconPicker';
import { PageIcon } from '@/features/pages/PageIcon';
import { useUpdateAppearance } from '@/features/pages/api';
import type { Page } from '@/lib/commands';
import { cn } from '@/lib/utils';

export function AppearanceMenuItems({
  page,
  readOnly = false,
  onChooseIcon,
  onChooseBanner,
}: {
  page: Page;
  readOnly?: boolean;
  onChooseIcon: () => void;
  onChooseBanner: () => void;
}) {
  const { t } = useTranslation();
  const { change } = useUpdateAppearance();

  if (readOnly) return null;

  return (
    <>
      <DropdownMenuItem onSelect={onChooseIcon}>
        {page.icon === null ? <SmilePlus aria-hidden /> : <Smile aria-hidden />}
        {t(page.icon === null ? 'pages.addIcon' : 'pages.changeIcon')}
      </DropdownMenuItem>
      {page.icon !== null ? (
        <DropdownMenuItem onSelect={() => change(page.id, { icon: null })}>
          <X aria-hidden />
          {t('pages.removeIcon')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={onChooseBanner}>
        <ImagePlus aria-hidden />
        {t(page.banner === null ? 'pages.addBanner' : 'pages.changeBanner')}
      </DropdownMenuItem>
      {page.banner !== null ? (
        <DropdownMenuItem onSelect={() => change(page.id, { banner: null })}>
          <ImageOff aria-hidden />
          {t('pages.removeBanner')}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function AddButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex h-7 items-center gap-1.5 rounded-sm px-2 text-sm outline-none focus-visible:ring-2"
    >
      <Icon size={15} aria-hidden />
      {label}
    </button>
  );
}

/**
 * The row above the title: the page's icon, or "Add icon" and "Add cover"
 * while the pointer is over the header or focus is inside it. The parent
 * provides the `group/appearance` that decides what counts as hovering.
 */
export function AppearanceRow({
  page,
  readOnly = false,
  pickerOpen,
  onPickerOpenChange,
  coverPickerOpen,
  onCoverPickerOpenChange,
  onUpload,
}: {
  page: Page;
  readOnly?: boolean;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  coverPickerOpen: boolean;
  onCoverPickerOpenChange: (open: boolean) => void;
  onUpload: () => void;
}) {
  const { t } = useTranslation();

  if (readOnly) {
    return (
      <div className="flex flex-col items-start">
        {page.icon !== null ? (
          <div className={cn('relative -ml-1 p-1', page.banner !== null && '-mt-12 p-2')}>
            <PageIcon
              page={page}
              size={80}
              className={
                page.banner !== null ? 'drop-shadow-[0_2px_12px_rgb(0_0_0/0.55)]' : undefined
              }
            />
          </div>
        ) : null}
        <div className="mb-2 min-h-7" />
      </div>
    );
  }

  return (
    <IconPicker page={page} open={pickerOpen} onOpenChange={onPickerOpenChange}>
      <div className="flex flex-col items-start">
        {page.icon !== null ? (
          <button
            type="button"
            aria-label={t('pages.changeIcon')}
            onClick={() => onPickerOpenChange(true)}
            // Over a cover, the icon sits across its lower edge, half on it and half below.
            className={cn(
              'focus-visible:ring-ring/50 relative -ml-1 rounded-md p-1 transition-transform outline-none hover:scale-105 focus-visible:ring-2 motion-reduce:transition-none',
              page.banner !== null && '-mt-12 rounded-xl p-2',
            )}
          >
            <PageIcon
              page={page}
              size={80}
              // A soft shadow behind the glyph keeps it readable on any cover.
              className={
                page.banner !== null ? 'drop-shadow-[0_2px_12px_rgb(0_0_0/0.55)]' : undefined
              }
            />
          </button>
        ) : null}
        <div
          className={cn(
            'mb-2 flex min-h-7 gap-1 opacity-0 transition-opacity group-focus-within/appearance:opacity-100 group-hover/appearance:opacity-100',
            page.icon !== null && 'mt-3',
          )}
        >
          {page.icon === null ? (
            <AddButton
              icon={SmilePlus}
              label={t('pages.addIcon')}
              onClick={() => onPickerOpenChange(true)}
            />
          ) : null}
          {page.banner === null ? (
            <CoverPicker
              page={page}
              open={coverPickerOpen}
              onOpenChange={onCoverPickerOpenChange}
              onUpload={onUpload}
              align="start"
            >
              <span>
                <AddButton
                  icon={ImagePlus}
                  label={t('pages.addCover')}
                  onClick={() => onCoverPickerOpenChange(true)}
                />
              </span>
            </CoverPicker>
          ) : null}
        </div>
      </div>
    </IconPicker>
  );
}
