import {
  Apple,
  Flag,
  Hash,
  Lightbulb,
  Leaf,
  Plane,
  Search,
  Shuffle,
  Smile,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ICON_NAMES, iconLabel, lucideIcon } from '@/features/pages/pageIcons';
import { useUpdateAppearance } from '@/features/pages/api';
import type { Page } from '@/lib/commands';
import { cn } from '@/lib/utils';

type Emoji = { unicode: string; label: string; group: number; tags?: string[] };

/** Emoji groups of emojibase in the order shown, with the icon of their button. */
const GROUPS: { group: number; icon: LucideIcon }[] = [
  { group: 0, icon: Smile },
  { group: 1, icon: Users },
  { group: 3, icon: Leaf },
  { group: 4, icon: Apple },
  { group: 5, icon: Plane },
  { group: 6, icon: Trophy },
  { group: 7, icon: Lightbulb },
  { group: 8, icon: Hash },
  { group: 9, icon: Flag },
];

const GROUP_KEYS: Record<number, string> = {
  0: 'smileys',
  1: 'people',
  3: 'animals',
  4: 'food',
  5: 'travel',
  6: 'activities',
  7: 'objects',
  8: 'symbols',
  9: 'flags',
};

/** Emoji are large; they are only loaded when the picker is first opened. */
function useEmoji(language: string) {
  const [emoji, setEmoji] = useState<Emoji[]>([]);

  useEffect(() => {
    let current = true;
    const load = language.startsWith('de')
      ? import('emojibase-data/de/compact.json')
      : import('emojibase-data/en/compact.json');
    void load.then((module) => {
      if (current)
        setEmoji((module.default as Emoji[]).filter((entry) => entry.group !== undefined));
    });
    return () => {
      current = false;
    };
  }, [language]);

  return emoji.filter((entry) => entry.group !== 2);
}

const cell =
  'hover:bg-accent focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-sm outline-none focus-visible:ring-2';

/** Mounted while the popover is open, so every opening starts with a fresh filter. */
function PickerContent({ page, onClose }: { page: Page; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { change } = useUpdateAppearance();
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState('emoji');
  const emoji = useEmoji(i18n.language);
  const scroller = useRef<HTMLDivElement>(null);
  const query = filter.trim().toLowerCase();

  const choose = (icon: string | null) => {
    change(page.id, { icon });
    onClose();
  };

  const matching = useMemo(
    () =>
      query === ''
        ? emoji
        : emoji.filter(
            (entry) =>
              entry.label.toLowerCase().includes(query) ||
              entry.tags?.some((tag) => tag.toLowerCase().includes(query)),
          ),
    [emoji, query],
  );

  const iconQuery = query.replace(/[\s-]/g, '');
  const icons = useMemo(
    () => ICON_NAMES.filter((name) => name.toLowerCase().includes(iconQuery)),
    [iconQuery],
  );

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-0">
      <div className="flex items-center justify-between border-b px-3 pt-2">
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="emoji">{t('pages.picker.emoji')}</TabsTrigger>
          <TabsTrigger value="icons">{t('pages.picker.icons')}</TabsTrigger>
        </TabsList>
        {page.icon !== null ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm px-1 text-sm outline-none focus-visible:ring-2"
            onClick={() => choose(null)}
          >
            {t('pages.picker.remove')}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 p-2">
        <div className="relative flex-1">
          <Search
            size={14}
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
          />
          <Input
            autoFocus
            value={filter}
            placeholder={t('pages.picker.filter')}
            aria-label={t('pages.picker.filter')}
            className="h-8 pl-8"
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
        </div>
        <button
          type="button"
          aria-label={t('pages.picker.random')}
          title={t('pages.picker.random')}
          disabled={emoji.length === 0}
          className={cn(cell, 'text-muted-foreground size-8 border')}
          onClick={() => {
            const pick = emoji[Math.floor(Math.random() * emoji.length)];
            if (pick) choose(pick.unicode);
          }}
        >
          <Shuffle size={15} aria-hidden />
        </button>
      </div>

      <TabsContent value="emoji" className="m-0">
        <div ref={scroller} className="h-64 overflow-y-auto px-2 pb-2">
          {GROUPS.map(({ group }) => {
            const entries = matching.filter((entry) => entry.group === group);
            if (entries.length === 0) return null;
            return (
              <section key={group} data-group={group}>
                <h3 className="text-muted-foreground px-1 pt-2 pb-1 text-xs font-medium">
                  {t(`pages.picker.groups.${GROUP_KEYS[group]}` as 'pages.picker.groups.smileys')}
                </h3>
                <div className="grid grid-cols-10">
                  {entries.map((entry) => (
                    <button
                      key={entry.unicode}
                      type="button"
                      title={entry.label}
                      aria-label={entry.label}
                      className={cn(cell, 'text-lg')}
                      onClick={() => choose(entry.unicode)}
                    >
                      {entry.unicode}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          {emoji.length > 0 && matching.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">
              {t('pages.picker.none')}
            </p>
          ) : null}
        </div>
        <div className="text-muted-foreground flex justify-between border-t px-2 py-1">
          {GROUPS.map(({ group, icon: Icon }) => (
            <button
              key={group}
              type="button"
              aria-label={t(
                `pages.picker.groups.${GROUP_KEYS[group]}` as 'pages.picker.groups.smileys',
              )}
              className={cn(cell, 'size-7')}
              onClick={() => {
                setFilter('');
                scroller.current
                  ?.querySelector(`[data-group="${group}"]`)
                  ?.scrollIntoView?.({ block: 'start' });
              }}
            >
              <Icon size={16} aria-hidden />
            </button>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="icons" className="m-0">
        <div className="h-72 overflow-y-auto px-2 pb-2">
          <div className="grid grid-cols-10">
            {icons.map((name) => {
              const Icon = lucideIcon(name);
              if (!Icon) return null;
              return (
                <button
                  key={name}
                  type="button"
                  title={iconLabel(name)}
                  aria-label={iconLabel(name)}
                  className={cn(cell, page.icon === name && 'bg-accent')}
                  onClick={() => choose(name)}
                >
                  <Icon size={18} aria-hidden />
                </button>
              );
            })}
          </div>
          {icons.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">
              {t('pages.picker.none')}
            </p>
          ) : null}
        </div>
      </TabsContent>
    </Tabs>
  );
}

/**
 * Wraps the element the picker opens from. The picker sits below it and
 * chooses an emoji or one of the curated icons.
 */
export function IconPicker({
  page,
  open,
  onOpenChange,
  children,
}: {
  page: Page;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[22rem] gap-0 p-0"
        aria-label={t('pages.iconPicker')}
      >
        <PickerContent page={page} onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}
