import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select } from '@/features/databases/toolbar/parts';
import type { Property, ViewConfig } from '@/lib/commands';

export type KanbanConfig = Extract<ViewConfig, { type: 'kanban' }>;

export function KanbanGroupSelect({
  config,
  properties,
  readOnly,
  onConfigChange,
}: {
  config: KanbanConfig;
  properties: readonly Property[];
  readOnly: boolean;
  onConfigChange: (config: ViewConfig) => void;
}) {
  const { t } = useTranslation();
  const selects = properties.filter((property) => property.type === 'select');
  const selected = selects.find((property) => property.id === config.groupPropertyId);

  if (readOnly && selected) return <span className="px-1.5 text-sm">{selected.name}</span>;

  return (
    <Select
      label={t('databases.toolbar.groupBy')}
      value={selected?.id ?? ''}
      onValueChange={(groupPropertyId) => {
        if (groupPropertyId) onConfigChange({ ...config, groupPropertyId, hiddenGroups: [] });
      }}
      className="w-44"
    >
      <option value="">{t('databases.kanban.chooseGroup')}</option>
      {selects.map((property) => (
        <option key={property.id} value={property.id}>
          {property.name}
        </option>
      ))}
    </Select>
  );
}

export function KanbanColumnsSetting({
  config,
  property,
  readOnly,
  onConfigChange,
}: {
  config: KanbanConfig;
  property: Property;
  readOnly: boolean;
  onConfigChange: (config: ViewConfig) => void;
}) {
  const { t } = useTranslation();
  const groups = [
    ...property.options.map((option) => ({ key: option.id, name: option.name })),
    { key: '', name: t('databases.group.empty', { name: property.name }) },
  ];
  const hidden = new Set(config.hiddenGroups);

  const setHidden = (key: string, shouldHide: boolean) => {
    const live = new Set(groups.map((group) => group.key));
    const next = new Set(config.hiddenGroups.filter((group) => live.has(group)));
    if (shouldHide) next.add(key);
    else next.delete(key);
    onConfigChange({ ...config, hiddenGroups: [...next] });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={readOnly}>
          <Columns3 aria-hidden />
          {t('databases.kanban.columns')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t('databases.kanban.columns')} className="w-56 p-2">
        <ul className="flex flex-col gap-0.5">
          {groups.map((group) => (
            <li
              key={group.key || 'empty'}
              className="hover:bg-accent flex items-center gap-2 rounded-sm px-1.5 py-1"
            >
              <Checkbox
                id={`kanban-column-${group.key || 'empty'}`}
                checked={!hidden.has(group.key)}
                onCheckedChange={(checked) => setHidden(group.key, checked !== true)}
              />
              <label htmlFor={`kanban-column-${group.key || 'empty'}`} className="flex-1 text-sm">
                {group.name}
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
