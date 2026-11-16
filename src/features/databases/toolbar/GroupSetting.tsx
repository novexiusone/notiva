import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { columnProperties, fromConfig, withGroupBy } from '@/features/databases/viewState';
import { NativeSelect } from './parts';
import type { ToolbarMenuProps } from './types';

/** Groups the rows of a table by one property, or by none. The title is not offered. */
export function GroupSetting({ config, properties, onChange }: ToolbarMenuProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const groupable = columnProperties(properties);
  const groupedBy = fromConfig(config, properties).grouping[0] ?? '';

  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span id={labelId}>{t('databases.toolbar.groupBy')}</span>
      <NativeSelect
        label={t('databases.toolbar.groupBy')}
        value={groupedBy}
        onChange={(event) => onChange(withGroupBy(config, properties, event.target.value || null))}
        className="w-36"
      >
        <option value="">{t('databases.toolbar.noGrouping')}</option>
        {groupable.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
