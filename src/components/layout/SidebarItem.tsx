import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

type SidebarItemProps = ComponentProps<'button'> & {
  icon: LucideIcon;
  label: string;
  hint?: string;
};

/** Takes every button prop, so it can also be the trigger of a menu. */
export function SidebarItem({ icon: Icon, label, hint, ...props }: SidebarItemProps) {
  return (
    <button
      type="button"
      {...props}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none focus-visible:ring-2"
    >
      <Icon size={16} aria-hidden />
      <span className="truncate">{label}</span>
      {hint ? <kbd className="ml-auto font-sans text-xs opacity-70">{hint}</kbd> : null}
    </button>
  );
}
