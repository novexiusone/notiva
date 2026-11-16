import { ArrowLeft, ChevronDown, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-active={active || undefined}
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent data-[active]:text-primary relative size-7 [&_svg:not([class*=size-])]:size-3.5 data-[state=open]:bg-accent',
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
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A drop-down of the app's own: a button that opens a menu with one entry per
 * `<option>` child. Not the system's list, which looks different on every platform.
 */
export function Select({
  label,
  value,
  onValueChange,
  className,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const options = Children.toArray(children).flatMap((child) =>
    isValidElement<{ value: string; children: ReactNode }>(child)
      ? [{ value: String(child.props.value), label: child.props.children }]
      : [],
  );
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          'hover:bg-accent data-[state=open]:bg-accent focus-visible:ring-ring/50 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-sm outline-none focus-visible:ring-[3px]',
          className,
        )}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown size={14} aria-hidden className="text-muted-foreground shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 w-max min-w-36 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A line that tells what the menu does while it holds nothing. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground px-1 text-sm">{children}</p>;
}

/** The title of a panel, with a way back to the one it was opened from and a way to close it. */
export function PanelHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('databases.toolbar.back')}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden />
        </Button>
      ) : null}
      <h3 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{title}</h3>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t('databases.toolbar.close')}
        onClick={onClose}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
