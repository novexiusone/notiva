import { useTranslation } from 'react-i18next';
import { FilterMenu } from './FilterMenu';
import { GroupMenu } from './GroupMenu';
import { PropertiesMenu } from './PropertiesMenu';
import { SortMenu } from './SortMenu';
import type { ToolbarMenuProps } from './types';

/** The settings of the active view. Grouping is offered where the view type has it. */
export function ViewToolbar({ grouping, ...props }: ToolbarMenuProps & { grouping: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('databases.toolbar.label')}
      className="flex items-center gap-0.5"
    >
      <FilterMenu {...props} />
      <SortMenu {...props} />
      {grouping ? <GroupMenu {...props} /> : null}
      <PropertiesMenu {...props} />
    </div>
  );
}
