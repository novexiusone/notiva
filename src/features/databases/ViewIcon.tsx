import { createElement } from 'react';
import { useViewIcon } from '@/features/databases/viewIcons';
import { viewTypeIcons } from '@/features/databases/viewTypes';
import { ICONS_BY_NAME, iconName } from '@/features/pages/pageIcons';
import type { View } from '@/lib/commands';
import { cn } from '@/lib/utils';

/** The icon of a view: the one chosen for it, else the one of its type. */
export function ViewIcon({
  view,
  size = 16,
  className,
}: {
  view: Pick<View, 'id' | 'config'>;
  size?: number;
  className?: string;
}) {
  const chosen = useViewIcon(view.id);
  const named = chosen === null ? undefined : ICONS_BY_NAME[iconName(chosen)];
  if (chosen !== null && !named) {
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}
        style={{ width: size, height: size, fontSize: size * 0.9 }}
      >
        {chosen}
      </span>
    );
  }
  return createElement(named ?? viewTypeIcons[view.config.type], {
    'aria-hidden': true,
    size,
    className,
  });
}
