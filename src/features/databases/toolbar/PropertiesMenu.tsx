import { Columns3 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  columnProperties,
  fromConfig,
  TITLE_PROPERTY_ID,
  withVisibility,
} from '@/features/databases/viewState';
import { ToolbarButton } from './parts';
import type { ToolbarMenuProps } from './types';

/** Shows and hides the properties of a view, in the order the view shows them. */
export function PropertiesMenu({ config, properties, onChange }: ToolbarMenuProps) {
  const { t } = useTranslation();
  const id = useId();
  const state = fromConfig(config, properties);
  const byId = new Map(columnProperties(properties).map((property) => [property.id, property]));
  const listed = state.columnOrder
    .filter((columnId) => columnId !== TITLE_PROPERTY_ID)
    .flatMap((columnId) => byId.get(columnId) ?? []);
  const hidden = listed.filter((property) => state.columnVisibility[property.id] === false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton
          icon={Columns3}
          label={t('databases.toolbar.properties')}
          badge={
            hidden.length > 0
              ? t('databases.toolbar.hiddenCount', { count: hidden.length })
              : undefined
          }
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('databases.toolbar.shownProperties')}
        className="max-h-80 w-60 overflow-y-auto"
      >
        <ul className="flex flex-col gap-0.5">
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
      </PopoverContent>
    </Popover>
  );
}
