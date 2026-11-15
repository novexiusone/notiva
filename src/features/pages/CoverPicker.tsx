import { Upload } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COLOURS, GALLERY_PREFIX, GRADIENTS } from '@/features/pages/covers';
import { useUpdateAppearance } from '@/features/pages/api';
import type { Page } from '@/lib/commands';
import { cn } from '@/lib/utils';

function Swatches({
  title,
  covers,
  current,
  onChoose,
}: {
  title: string;
  covers: { id: string; background: string }[];
  current: string | null;
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <h3 className="text-muted-foreground px-1 pt-3 pb-2 text-xs font-medium">{title}</h3>
      <div className="grid grid-cols-4 gap-2">
        {covers.map(({ id, background }) => (
          <button
            key={id}
            type="button"
            aria-label={t(`pages.cover.gallery.${id}` as 'pages.cover.gallery.coral')}
            aria-pressed={current === `${GALLERY_PREFIX}${id}`}
            className={cn(
              'focus-visible:ring-ring/50 h-12 rounded-md outline-none ring-1 ring-foreground/10 focus-visible:ring-2',
              current === `${GALLERY_PREFIX}${id}` && 'ring-foreground/60 ring-2',
            )}
            style={{ background }}
            onClick={() => onChoose(id)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Wraps the element the picker opens from. The picker offers the gallery of
 * colours and gradients and an upload, and removes the cover.
 */
export function CoverPicker({
  page,
  open,
  onOpenChange,
  onUpload,
  align = 'end',
  children,
}: {
  page: Page;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: () => void;
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { change } = useUpdateAppearance();

  const choose = (banner: string | null) => {
    change(page.id, { banner });
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align={align}
        className="w-[22rem] gap-0 p-0"
        aria-label={t('pages.cover.picker')}
      >
        <Tabs defaultValue="gallery" className="gap-0">
          <div className="flex items-center justify-between border-b px-3 pt-2">
            <TabsList variant="line" className="h-9">
              <TabsTrigger value="gallery">{t('pages.cover.galleryTab')}</TabsTrigger>
              <TabsTrigger value="upload">{t('pages.cover.uploadTab')}</TabsTrigger>
            </TabsList>
            {page.banner !== null ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm px-1 text-sm outline-none focus-visible:ring-2"
                onClick={() => choose(null)}
              >
                {t('pages.cover.remove')}
              </button>
            ) : null}
          </div>
          <TabsContent value="gallery" className="m-0">
            <div className="max-h-80 overflow-y-auto px-3 pb-3">
              <Swatches
                title={t('pages.cover.colourAndGradient')}
                covers={[...COLOURS, ...GRADIENTS]}
                current={page.banner}
                onChoose={(id) => choose(`${GALLERY_PREFIX}${id}`)}
              />
            </div>
          </TabsContent>
          <TabsContent value="upload" className="m-0">
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onUpload();
                }}
              >
                <Upload aria-hidden />
                {t('pages.cover.chooseFile')}
              </Button>
              <p className="text-muted-foreground text-xs">{t('pages.cover.uploadHint')}</p>
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
