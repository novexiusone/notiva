import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FilterMenu } from './FilterMenu';
import { NewRowButton } from './NewRowButton';
import { SettingsMenu } from './SettingsMenu';
import { SortMenu } from './SortMenu';
import type { View } from '@/lib/commands';
import type { ToolbarMenuProps } from './types';

const reveal =
  'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 flex size-7 items-center justify-center rounded-md opacity-0 outline-none transition-opacity duration-200 group-hover/toolbar:opacity-100 focus-visible:opacity-100 focus-visible:ring-2';

/** Slides its content away sideways and back; hidden, it takes no focus. */
function Collapsible({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return (
    <div
      inert={hidden}
      aria-hidden={hidden || undefined}
      className={cn(
        'grid transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none',
        hidden ? 'grid-cols-[0fr] opacity-0' : 'grid-cols-[1fr] opacity-100',
      )}
    >
      <div className="flex items-center gap-0.5 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * The settings of the active view. Minimised, only the settings stay; the
 * button that minimises and expands it shows while the pointer is over it.
 */
export function ViewToolbar({
  grouping,
  onNewRow,
  view,
  canDelete,
  onRename,
  onDelete,
  readOnly = false,
  ...props
}: ToolbarMenuProps & {
  grouping: boolean;
  onNewRow: () => void;
  view: View;
  canDelete: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [minimized, setMinimized] = useState(false);
  const Icon = minimized ? ChevronsLeft : ChevronsRight;
  const label = t(minimized ? 'databases.toolbar.expand' : 'databases.toolbar.minimize');

  return (
    <div
      role="group"
      aria-label={t('databases.toolbar.label')}
      // The padding makes the area that shows the minimize button reach a little past the toolbar.
      className="group/toolbar -my-2 -ml-10 flex items-center gap-0.5 py-2 pl-10"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={!minimized}
            onClick={() => setMinimized(!minimized)}
            className={reveal}
          >
            <Icon size={16} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <Collapsible hidden={minimized}>
        <FilterMenu {...props} readOnly={readOnly} />
        <SortMenu {...props} readOnly={readOnly} />
      </Collapsible>
      <SettingsMenu
        readOnly={readOnly}
        grouping={grouping}
        view={view}
        canDelete={canDelete}
        onRename={onRename}
        onDelete={onDelete}
        {...props}
      />
      <Collapsible hidden={minimized}>
        <NewRowButton onNewRow={onNewRow} readOnly={readOnly} />
      </Collapsible>
    </div>
  );
}
