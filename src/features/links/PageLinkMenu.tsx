import type { SuggestionMenuProps } from '@blocknote/react';
import { FileText } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PageLinkItem } from '@/features/links/pageLinkItems';
import { cn } from '@/lib/utils';

/** The picker that opens when `[[` is typed. */
export function PageLinkMenu({
  items,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<PageLinkItem>) {
  const { t } = useTranslation();
  const selected = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="bg-popover text-popover-foreground flex w-72 flex-col overflow-hidden rounded-lg border text-sm select-none">
      <div className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium">
        {t('links.pick')}
      </div>
      <div role="listbox" aria-label={t('links.pick')} className="max-h-72 overflow-y-auto p-1">
        {items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5">{t('links.noPages')}</p>
        ) : null}
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;

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
              // Keeps the cursor in the editor, where the link is inserted.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onItemClick?.(item)}
            >
              <FileText size={16} aria-hidden className="text-muted-foreground shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.title || t('pages.untitled')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
