import type { SuggestionMenuProps } from '@blocknote/react';
import { Search } from 'lucide-react';
import { useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlashMenuGroup, SlashMenuItem } from '@/features/editor/slashMenuItems';
import { SlashMenuQueryContext } from '@/features/editor/slashMenuQuery';
import { cn } from '@/lib/utils';

const groups: SlashMenuGroup[] = ['suggested', 'basic', 'spike'];

export function SlashMenu({
  items,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<SlashMenuItem>) {
  const { t } = useTranslation();
  const query = useContext(SlashMenuQueryContext);
  const selected = useRef<HTMLDivElement>(null);

  // Keyboard navigation can move the selection out of view.
  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="bg-popover text-popover-foreground flex w-72 flex-col overflow-hidden rounded-lg border text-sm select-none">
      <div className="text-muted-foreground flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Search size={16} aria-hidden />
        {query === '' ? (
          <span className="opacity-70">{t('slashMenu.filter')}</span>
        ) : (
          <span className="text-foreground truncate">{query}</span>
        )}
      </div>

      <div
        role="listbox"
        aria-label={t('slashMenu.basic')}
        className="max-h-80 overflow-y-auto p-1"
      >
        {items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5">{t('slashMenu.empty')}</p>
        ) : null}

        {groups.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          return (
            <div key={group} role="group" aria-label={t(`slashMenu.${group}`)}>
              <div className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
                {t(`slashMenu.${group}`)}
              </div>
              {groupItems.map((item) => {
                const isSelected = items.indexOf(item) === selectedIndex;
                const Icon = item.icon;

                return (
                  <div
                    key={item.id}
                    ref={isSelected ? selected : undefined}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'flex h-8 cursor-default items-center gap-2 rounded-sm px-2',
                      isSelected ? 'bg-accent' : 'hover:bg-accent/50',
                    )}
                    // Keeps the cursor in the editor, where the block is inserted.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onItemClick?.(item)}
                  >
                    <Icon size={16} aria-hidden className="text-muted-foreground shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.shortcut ? (
                      <kbd className="text-muted-foreground font-mono text-xs">{item.shortcut}</kbd>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="text-muted-foreground flex h-8 shrink-0 items-center justify-between border-t px-3 text-xs">
        <span>{t('slashMenu.close')}</span>
        <kbd className="font-sans">esc</kbd>
      </div>
    </div>
  );
}
