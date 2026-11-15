import { FileText, Table, type LucideProps } from 'lucide-react';
import { isPageIconName, PAGE_ICONS, type PageIconName } from '@/features/pages/pageIcons';
import { cn } from '@/lib/utils';
import type { Page } from '@/lib/commands';

export function PageIcon({
  page,
  size = 16,
  className,
  ...props
}: LucideProps & { page: Pick<Page, 'icon' | 'kind'> }) {
  if (page.icon !== null && !isPageIconName(page.icon)) {
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
  const Icon =
    (page.icon !== null ? PAGE_ICONS[page.icon as PageIconName] : undefined) ??
    (page.kind === 'database' ? Table : FileText);
  return <Icon aria-hidden size={size} className={className} {...props} />;
}
