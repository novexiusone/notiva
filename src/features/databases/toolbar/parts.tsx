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
      size="icon-xs"
      data-active={active || undefined}
      className={cn(
        'text-muted-foreground data-[active]:text-primary relative size-6 [&_svg:not([class*=size-])]:size-3.5 data-[state=open]:bg-accent',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden />
      {/* Icon only; the name and what is set are for screen readers. */}
      <span className="sr-only">{label}</span>
      {active ? <span className="sr-only">{badge}</span> : null}
      {active ? (
        <span aria-hidden className="bg-primary absolute top-1 right-1 size-1.5 rounded-full" />
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
