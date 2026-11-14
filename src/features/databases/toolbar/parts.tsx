import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A button of the toolbar. `badge` says that the setting is in use, for
 * example the number of filters; it is part of the accessible name.
 */
export function ToolbarButton({
  icon: Icon,
  label,
  badge,
  className,
  ...props
}: ComponentProps<'button'> & { icon: LucideIcon; label: string; badge?: ReactNode }) {
  const active = badge !== undefined && badge !== null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-active={active || undefined}
      className={cn(
        'text-muted-foreground data-[active]:text-primary data-[state=open]:bg-accent',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden />
      {label}
      {active ? (
        <span className="bg-primary/10 text-primary rounded-sm px-1 text-xs tabular-nums">
          {badge}
        </span>
      ) : null}
    </Button>
  );
}

/** A native select: small, and as accessible with the keyboard as anything gets. */
export function NativeSelect({
  label,
  className,
  children,
  ...props
}: ComponentProps<'select'> & { label: string }) {
  return (
    <select
      aria-label={label}
      className={cn(
        'border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-7 min-w-0 rounded-md border px-1.5 text-sm outline-none focus-visible:ring-[3px]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** A line that tells what the menu does while it holds nothing. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground px-1 text-sm">{children}</p>;
}
