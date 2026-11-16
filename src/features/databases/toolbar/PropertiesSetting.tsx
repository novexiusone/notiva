import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import {
  columnProperties,
  fromConfig,
  TITLE_PROPERTY_ID,
  withVisibility,
} from '@/features/databases/viewState';
import type { ToolbarMenuProps } from './types';

/** Shows and hides the properties of a view, in the order the view shows them. */
export function PropertiesSetting({ config, properties, onChange }: ToolbarMenuProps) {
  const { t } = useTranslation();
  const id = useId();
  const state = fromConfig(config, properties);
  const byId = new Map(columnProperties(properties).map((property) => [property.id, property]));
  const listed = state.columnOrder
    .filter((columnId) => columnId !== TITLE_PROPERTY_ID)
    .flatMap((columnId) => byId.get(columnId) ?? []);

  return (
    <ul aria-label={t('databases.toolbar.shownProperties')} className="flex flex-col gap-0.5">
      {listed.map((property) => {
        const checkboxId = `${id}-${property.id}`;
        return (
          <li
            key={property.id}
            className="hover:bg-accent flex items-center gap-2 rounded-sm px-1.5 py-1"
          >
            <Checkbox
              id={checkboxId}
              checked={state.columnVisibility[property.id] !== false}
              onCheckedChange={(checked) =>
                onChange(withVisibility(config, properties, property.id, checked === true))
              }
            />
            <label htmlFor={checkboxId} className="min-w-0 flex-1 truncate text-sm">
              {property.name}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
