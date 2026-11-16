import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterMenu } from './FilterMenu';
import { NewRowButton } from './NewRowButton';
import { SettingsMenu } from './SettingsMenu';
import { SortMenu } from './SortMenu';
import type { ToolbarMenuProps } from './types';

const reveal =
  'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 flex size-7 items-center justify-center rounded-md opacity-0 outline-none group-hover/toolbar:opacity-100 focus-visible:opacity-100 focus-visible:ring-2';

/**
 * The settings of the active view. Minimised, only the settings stay; the
 * button that minimises and expands it shows while the pointer is over it.
 */
export function ViewToolbar({
  grouping,
  onNewRow,
  ...props
}: ToolbarMenuProps & { grouping: boolean; onNewRow: () => void }) {
  const { t } = useTranslation();
  const [minimized, setMinimized] = useState(false);
  const Icon = minimized ? ChevronsLeft : ChevronsRight;
  const label = t(minimized ? 'databases.toolbar.expand' : 'databases.toolbar.minimize');

  return (
    <div
      role="group"
      aria-label={t('databases.toolbar.label')}
      className="group/toolbar flex items-center gap-0.5"
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={!minimized}
        onClick={() => setMinimized(!minimized)}
        className={reveal}
      >
        <Icon size={16} aria-hidden />
      </button>
      {minimized ? null : (
        <>
          <FilterMenu {...props} />
          <SortMenu {...props} />
        </>
      )}
      <SettingsMenu grouping={grouping} {...props} />
      {minimized ? null : <NewRowButton onNewRow={onNewRow} />}
    </div>
  );
}
