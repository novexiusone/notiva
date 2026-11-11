import type { LucideIcon } from 'lucide-react';

type SidebarItemProps = {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onClick?: () => void;
};

export function SidebarItem({ icon: Icon, label, hint, onClick }: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm"
    >
      <Icon size={16} aria-hidden />
      <span className="truncate">{label}</span>
      {hint ? <kbd className="ml-auto font-sans text-xs opacity-70">{hint}</kbd> : null}
    </button>
  );
}
