import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatNumber } from '@/features/databases/properties/format';
import { propertyTypeDefinition } from '@/features/databases/properties/registry';
import type { CellValue, Property } from '@/lib/commands';
import { cn } from '@/lib/utils';
import { ROW_HEIGHT } from './layout';

type GroupRowProps = {
  id: string;
  value: CellValue;
  property: Property;
  count: number;
  expanded: boolean;
  rowIndex: number;
  columnCount: number;
  /** Where the virtualiser puts the row, from the top of the body. */
  top: number;
  width: number;
  onToggle: (id: string, expanded: boolean) => void;
};

/** The value of a group as text, for its accessible name. */
function groupLabel(value: CellValue, property: Property, language: string) {
  if (typeof value === 'number') return formatNumber(value, language);
  if (typeof value !== 'string') return '';
  if (property.type === 'select') {
    return property.options.find((option) => option.id === value)?.name ?? '';
  }
  if (property.type === 'date') return formatDate(value, language);
  return value;
}

/**
 * The header of a group of rows: its value, how many rows it has, and a
 * button that folds the rows away. It is one line of the virtualised body and
 * as tall as a row.
 */
export const GroupRow = memo(function GroupRow({
  id,
  value,
  property,
  count,
  expanded,
  rowIndex,
  columnCount,
  top,
  width,
  onToggle,
}: GroupRowProps) {
  const { t, i18n } = useTranslation();
  const Display = propertyTypeDefinition(property.type)?.Display;
  const label =
    value === null
      ? t('databases.group.empty', { name: property.name })
      : groupLabel(value, property, i18n.language);

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-label={label}
      style={{
        width: '100%',
        minWidth: width,
        height: ROW_HEIGHT,
        transform: `translateY(${top}px)`,
      }}
      className="border-border bg-muted/30 absolute top-0 left-0 flex border-b"
    >
      <div role="gridcell" aria-colspan={columnCount} className="sticky left-0 flex min-w-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${label}, ${t('databases.rowCount', { count })}`}
          title={expanded ? t('databases.group.collapse') : t('databases.group.expand')}
          onClick={() => onToggle(id, !expanded)}
          className="hover:bg-accent focus-visible:ring-ring/60 flex h-full min-w-0 items-center gap-1.5 rounded-sm px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <ChevronRight
            size={16}
            aria-hidden
            className={cn('text-muted-foreground shrink-0 transition-transform', {
              'rotate-90': expanded,
            })}
          />
          <span aria-hidden className="flex min-w-0 items-center">
            {value === null || !Display ? (
              <span className="text-muted-foreground truncate">{label}</span>
            ) : (
              <Display value={value} property={property} />
            )}
          </span>
          <span aria-hidden className="text-muted-foreground shrink-0 tabular-nums">
            {count}
          </span>
        </button>
      </div>
    </div>
  );
});
