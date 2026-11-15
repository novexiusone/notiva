import { createElement } from 'react';
import { FileText, Table, type LucideProps } from 'lucide-react';
import { ICONS_BY_NAME, iconName } from '@/features/pages/pageIcons';
import { cn } from '@/lib/utils';
import type { Page } from '@/lib/commands';

export function PageIcon({
  page,
  size = 16,
  className,
  ...props
}: LucideProps & { page: Pick<Page, 'icon' | 'kind'> }) {
  const named = page.icon === null ? undefined : ICONS_BY_NAME[iconName(page.icon)];
  if (page.icon !== null && !named) {
    // Not a Lucide icon, so it is an emoji.
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}
        style={{ width: size, height: size, fontSize: Number(size) * 0.9 }}
      >
        {page.icon}
      </span>
    );
  }
  if (named) return createElement(named, { 'aria-hidden': true, size, className, ...props });
  const Fallback = page.kind === 'database' ? Table : FileText;
  return <Fallback aria-hidden size={size} className={className} {...props} />;
}
