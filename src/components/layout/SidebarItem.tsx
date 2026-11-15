import type { ComponentProps, ElementType } from 'react';
import { cn } from '@/lib/utils';

type SidebarItemProps = ComponentProps<'button'> & {
  icon: ElementType;
  label: string;
  hint?: string;
};

/** Takes every button prop, so it can also be the trigger of a menu. */
export function SidebarItem({ icon: Icon, label, hint, className, ...props }: SidebarItemProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none focus-visible:ring-2',
        className,
      )}
    >
      <Icon size={16} aria-hidden />
      <span className="truncate">{label}</span>
      {hint ? <kbd className="ml-auto font-sans text-xs opacity-70">{hint}</kbd> : null}
    </button>
  );
}
