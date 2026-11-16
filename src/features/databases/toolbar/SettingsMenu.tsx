import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GroupSetting } from './GroupSetting';
import { ToolbarButton } from './parts';
import { PropertiesSetting } from './PropertiesSetting';
import type { ToolbarMenuProps } from './types';

/**
 * The settings of the active view that do not need a button of their own: how
 * its rows are grouped and which properties it shows. Grouping is offered
 * where the view type has it.
 */
export function SettingsMenu({ grouping, ...props }: ToolbarMenuProps & { grouping: boolean }) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton icon={SlidersHorizontal} label={t('databases.toolbar.settings')} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('databases.toolbar.settings')}
        className="max-h-96 w-72 overflow-y-auto"
      >
        <h3 className="text-muted-foreground mb-2 px-1 text-xs font-medium">
          {t('databases.toolbar.settings')}
        </h3>
        {grouping ? (
          <div className="border-border mb-2 border-b px-1 pb-2">
            <GroupSetting {...props} />
          </div>
        ) : null}
        <h4 className="text-muted-foreground mb-1 px-1 text-xs font-medium">
          {t('databases.toolbar.properties')}
        </h4>
        <PropertiesSetting {...props} />
      </PopoverContent>
    </Popover>
  );
}
