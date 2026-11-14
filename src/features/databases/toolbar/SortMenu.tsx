import { ArrowUpDown, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { readSorts, viewFields, withSorts } from '@/features/databases/viewState';
import type { ViewSort } from '@/lib/commands';
import { EmptyNote, NativeSelect, ToolbarButton } from './parts';
import type { ToolbarMenuProps } from './types';

/**
 * Properties to sort by, each ascending or descending, applied in order. A
 * property is offered once; a new sort takes the first one not in use.
 */
export function SortMenu({ config, properties, onChange }: ToolbarMenuProps) {
  const { t } = useTranslation();
  const fields = viewFields(properties, t('databases.table.titleColumn'));
  const sorts = readSorts(config, properties);
  const unused = fields.filter((field) => !sorts.some((sort) => sort.propertyId === field.id));

  const write = (next: ViewSort[]) => onChange(withSorts(config, properties, next));
  const replace = (index: number, sort: ViewSort) =>
    write(sorts.map((current, at) => (at === index ? sort : current)));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton
          icon={ArrowUpDown}
          label={t('databases.toolbar.sort')}
          badge={sorts.length > 0 ? sorts.length : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('databases.toolbar.sorts')}
        className="w-[min(26rem,calc(100vw-2rem))]"
      >
        {sorts.length === 0 ? (
          <EmptyNote>{t('databases.toolbar.noSorts')}</EmptyNote>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {sorts.map((sort, index) => (
              <li
                key={sort.propertyId}
                role="group"
                aria-label={`${t('databases.toolbar.sort')} ${index + 1}`}
                className="flex items-center gap-1.5"
              >
                <NativeSelect
                  label={t('databases.toolbar.property')}
                  value={sort.propertyId}
                  onChange={(event) => replace(index, { ...sort, propertyId: event.target.value })}
                  className="min-w-0 flex-1"
                >
                  {fields
                    .filter((field) => field.id === sort.propertyId || unused.includes(field))
                    .map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.property.name}
                      </option>
                    ))}
                </NativeSelect>
                <NativeSelect
                  label={t('databases.toolbar.direction')}
                  value={sort.direction}
                  onChange={(event) =>
                    replace(index, {
                      ...sort,
                      direction: event.target.value as ViewSort['direction'],
                    })
                  }
                  className="w-32"
                >
                  <option value="asc">{t('databases.toolbar.ascending')}</option>
                  <option value="desc">{t('databases.toolbar.descending')}</option>
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('databases.toolbar.removeSort')}
                  onClick={() => write(sorts.filter((_, at) => at !== index))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={unused.length === 0}
          onClick={() => write([...sorts, { propertyId: unused[0]!.id, direction: 'asc' }])}
        >
          <Plus aria-hidden />
          {t('databases.toolbar.addSort')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
