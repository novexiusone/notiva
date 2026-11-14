import { Badge } from '@/components/ui/badge';
import type { SelectOption } from '@/lib/commands';
import { cn } from '@/lib/utils';

/** Written out in full so that Tailwind finds every class. */
const colorClasses: Record<string, string> = {
  gray: 'bg-select-gray text-select-gray-foreground',
  brown: 'bg-select-brown text-select-brown-foreground',
  orange: 'bg-select-orange text-select-orange-foreground',
  yellow: 'bg-select-yellow text-select-yellow-foreground',
  green: 'bg-select-green text-select-green-foreground',
  blue: 'bg-select-blue text-select-blue-foreground',
  purple: 'bg-select-purple text-select-purple-foreground',
  red: 'bg-select-red text-select-red-foreground',
};

/** An option of a select in its colour. A colour this version does not know is shown gray. */
export function SelectBadge({ option, className }: { option: SelectOption; className?: string }) {
  return (
    <Badge
      data-color={option.color}
      className={cn(
        'max-w-full justify-start rounded-sm px-1.5 font-normal',
        colorClasses[option.color] ?? colorClasses.gray,
        className,
      )}
    >
      <span className="truncate">{option.name}</span>
    </Badge>
  );
}
