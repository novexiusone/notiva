import { save } from '@tauri-apps/plugin-dialog';
import { Download } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CoverPicker } from '@/features/pages/CoverPicker';
import { galleryBackground, isGalleryCover } from '@/features/pages/covers';
import { useUpdateAppearance } from '@/features/pages/api';
import { commands, type Page } from '@/lib/commands';
import { displayImageUrl } from '@/lib/imageUrl';
import { cn } from '@/lib/utils';

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

const bar =
  'bg-popover/90 text-popover-foreground flex items-center overflow-hidden rounded-md text-xs shadow-sm ring-1 ring-foreground/10 backdrop-blur-sm';
const barButton =
  'hover:bg-accent focus-visible:ring-ring/50 h-6 px-2 outline-none focus-visible:ring-2 focus-visible:ring-inset';

/** The extension a downloaded cover gets: the one of its file, or the one of its media type. */
function extensionOf(url: string): string {
  const media = /^data:image\/([a-z]+)/.exec(url)?.[1];
  const named = /\.([a-z]+)$/.exec(url)?.[1];
  return (media ?? named ?? 'png').replace('jpeg', 'jpg');
}

/**
 * The cover at the top of a page. While the pointer is over it, "Change",
 * "Reposition" and "Download" sit at its top right.
 */
export function PageCover({
  page,
  banner,
  readOnly = false,
  pickerOpen,
  onPickerOpenChange,
  onUpload,
}: {
  page: Page;
  banner: string;
  readOnly?: boolean;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onUpload: () => void;
}) {
  const { t } = useTranslation();
  const { setBannerPosition } = useUpdateAppearance();
  const cover = useRef<HTMLDivElement>(null);
  // The size ratio of the image, known once it has loaded.
  const [ratio, setRatio] = useState<number | null>(null);
  // While repositioning: the position being tried out.
  const [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<{ y: number; position: number } | null>(null);

  const background = isGalleryCover(banner) ? galleryBackground(banner) : undefined;
  const isImage = !isGalleryCover(banner);
  const position = draft ?? page.bannerPosition;

  const download = async () => {
    try {
      const destination = await save({ defaultPath: `cover.${extensionOf(banner)}` });
      if (typeof destination !== 'string') return;
      await commands.downloadImage(banner, destination);
      toast.success(t('pages.cover.downloaded', { path: destination }));
    } catch {
      toast.error(t('pages.cover.downloadFailed'));
    }
  };

  // How far the image can move: what is left of it beyond the cover, in pixels.
  const travel = () => {
    const box = cover.current;
    if (!box || ratio === null) return 0;
    return Math.max(0, box.clientWidth * ratio - box.clientHeight);
  };

  const onPointerDown = (event: PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, position };
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = drag.current;
    const range = travel();
    if (!start || range === 0) return;
    // Dragging the image down shows more of its top.
    setDraft(clamp(start.position - ((event.clientY - start.y) / range) * 100));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowUp: 5, ArrowDown: -5 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setDraft(clamp(position + step));
  };

  const finish = (saveIt: boolean) => {
    if (saveIt && draft !== null && draft !== page.bannerPosition) {
      setBannerPosition(page.id, draft);
    }
    setDraft(null);
    drag.current = null;
  };

  const repositioning = draft !== null;

  return (
    <div ref={cover} className="group/cover relative h-70 w-full overflow-hidden">
      {isImage ? (
        <img
          src={displayImageUrl(banner)}
          alt={t('pages.banner')}
          draggable={false}
          className="h-full w-full object-cover"
          style={{ objectPosition: `50% ${position}%` }}
          onLoad={(event) =>
            setRatio(event.currentTarget.naturalHeight / event.currentTarget.naturalWidth)
          }
        />
      ) : (
        <div
          role="img"
          aria-label={t('pages.banner')}
          className="h-full w-full"
          style={{ background }}
        />
      )}

      {repositioning ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('pages.cover.position')}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={position}
          className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={onKeyDown}
          ref={(element) => element?.focus()}
        />
      ) : null}

      {/* Only the top right corner of the cover reveals the controls. */}
      <div
        data-testid="cover-controls-zone"
        className={cn(
          'group/zone absolute top-0 right-0 flex h-20 w-65 items-start justify-end gap-2 pt-3 pr-4',
          repositioning && 'pointer-events-none',
        )}
      >
        <div
          className={cn(
            'pointer-events-auto flex items-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none',
            repositioning || pickerOpen
              ? 'opacity-100'
              : 'opacity-0 group-focus-within/zone:opacity-100 group-hover/zone:opacity-100',
          )}
        >
          {repositioning ? (
            <>
              <span className={cn(bar, 'text-muted-foreground flex h-6 items-center px-2')}>
                {t('pages.cover.repositionHint')}
              </span>
              <Button size="xs" variant="secondary" onClick={() => finish(false)}>
                {t('pages.cover.cancel')}
              </Button>
              <Button size="xs" onClick={() => finish(true)}>
                {t('pages.cover.savePosition')}
              </Button>
            </>
          ) : (
            <div role="toolbar" aria-label={t('pages.cover.controls')} className={bar}>
              {!readOnly ? (
                <CoverPicker
                  page={page}
                  open={pickerOpen}
                  onOpenChange={onPickerOpenChange}
                  onUpload={onUpload}
                >
                  <button
                    type="button"
                    className={barButton}
                    onClick={() => onPickerOpenChange(true)}
                  >
                    {t('pages.cover.change')}
                  </button>
                </CoverPicker>
              ) : null}
              {isImage ? (
                <>
                  {!readOnly ? (
                    <>
                      <span aria-hidden className="bg-border h-3 w-px" />
                      <button
                        type="button"
                        className={barButton}
                        onClick={() => setDraft(page.bannerPosition)}
                      >
                        {t('pages.cover.reposition')}
                      </button>
                      <span aria-hidden className="bg-border h-3 w-px" />
                    </>
                  ) : null}
                  <button
                    type="button"
                    aria-label={t('pages.cover.download')}
                    title={t('pages.cover.download')}
                    className={cn(barButton, 'px-1.5')}
                    onClick={() => void download()}
                  >
                    <Download size={14} aria-hidden />
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
