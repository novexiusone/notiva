import { ArrowUpDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { readSorts, viewFields, withSorts } from '@/features/databases/viewState';
import type { ViewSort } from '@/lib/commands';
import { Select, PanelHeader, ToolbarButton } from './parts';
import type { ToolbarMenuProps } from './types';

/**
 * Properties to sort by, each ascending or descending, applied in order. "Add
 * sort" first asks for the property; one is offered once.
 */
export function SortPanel({
  config,
  properties,
  onChange,
  onBack,
  onClose,
}: ToolbarMenuProps & { onBack?: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const fields = viewFields(properties, t('databases.table.titleColumn'));
  const sorts = readSorts(config, properties);
  const unused = fields.filter((field) => !sorts.some((sort) => sort.propertyId === field.id));
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');

  const write = (next: ViewSort[]) => onChange(withSorts(config, properties, next));
  const replace = (index: number, sort: ViewSort) =>
    write(sorts.map((current, at) => (at === index ? sort : current)));
  const stopAdding = () => {
    setAdding(false);
    setSearch('');
  };
  const offered = unused.filter((field) =>
    field.property.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  if (adding) {
    return (
      <>
        <PanelHeader
          title={t('databases.toolbar.addSortTitle')}
          onBack={stopAdding}
          onClose={onClose}
        />
        <Input
          autoFocus
          aria-label={t('databases.toolbar.sortBy')}
          placeholder={t('databases.toolbar.sortBy')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-7 px-2"
        />
        <ul aria-label={t('databases.toolbar.property')} className="flex flex-col">
          {offered.map((field) => {
            const Icon = field.definition.icon;
            return (
              <li key={field.id}>
                <button
                  type="button"
                  className="hover:bg-accent focus-visible:bg-accent flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none"
                  onClick={() => {
                    write([...sorts, { propertyId: field.id, direction: 'asc' }]);
                    stopAdding();
                  }}
                >
                  <Icon size={16} aria-hidden className="text-muted-foreground" />
                  <span className="truncate">{field.property.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <>
      <PanelHeader title={t('databases.toolbar.sorts')} onBack={onBack} onClose={onClose} />
      {sorts.length === 0 ? null : (
        <ol className="flex flex-col gap-2">
          {sorts.map((sort, index) => {
            const field = fields.find((candidate) => candidate.id === sort.propertyId)!;
            const Icon = field.definition.icon;
            return (
              <li
                key={sort.propertyId}
                role="group"
                aria-label={`${t('databases.toolbar.sort')} ${index + 1}`}
                className="flex flex-col gap-1"
              >
                <div className="flex items-center gap-1">
                  <GripVertical size={14} aria-hidden className="text-muted-foreground/50" />
                  <Icon size={16} aria-hidden className="text-muted-foreground" />
                  <Select
                    label={t('databases.toolbar.property')}
                    value={sort.propertyId}
                    onValueChange={(propertyId) => replace(index, { ...sort, propertyId })}
                  >
                    {fields
                      .filter(
                        (candidate) =>
                          candidate.id === sort.propertyId || unused.includes(candidate),
                      )
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.property.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <div className="border-border ml-5 flex items-center justify-between gap-1 rounded-md border p-1.5">
                  <Select
                    label={t('databases.toolbar.direction')}
                    value={sort.direction}
                    onValueChange={(direction) =>
                      replace(index, { ...sort, direction: direction as ViewSort['direction'] })
                    }
                  >
                    <option value="asc">{t('databases.toolbar.ascending')}</option>
                    <option value="desc">{t('databases.toolbar.descending')}</option>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('databases.toolbar.removeSort')}
                    onClick={() => write(sorts.filter((_, at) => at !== index))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={unused.length === 0}
        onClick={() => setAdding(true)}
      >
        <Plus aria-hidden />
        {t('databases.toolbar.addSort')}
      </Button>
    </>
  );
}

/** The sorts of a view, from the toolbar. */
export function SortMenu(props: ToolbarMenuProps) {
  const { t } = useTranslation();
  const sorts = readSorts(props.config, props.properties);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        className="w-80 gap-2 p-2"
      >
        <SortPanel {...props} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
