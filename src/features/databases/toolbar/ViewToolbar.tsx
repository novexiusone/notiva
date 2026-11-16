import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FilterMenu } from './FilterMenu';
import { GroupMenu } from './GroupMenu';
import { PropertiesMenu } from './PropertiesMenu';
import { SortMenu } from './SortMenu';
import type { ToolbarMenuProps } from './types';

/** The settings of the active view. Grouping is offered where the view type has it. */
export function ViewToolbar({
  grouping,
  onNewRow,
  ...props
}: ToolbarMenuProps & { grouping: boolean; onNewRow: () => void }) {
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
      <Button type="button" size="sm" className="ml-1" onClick={onNewRow}>
        <Plus aria-hidden />
        <span className="max-lg:sr-only">{t('databases.toolbar.newRow')}</span>
      </Button>
    </div>
  );
}
