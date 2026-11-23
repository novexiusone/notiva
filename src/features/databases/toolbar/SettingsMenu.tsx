import {
  ChevronRight,
  Eye,
  ListFilter,
  ArrowUpDown,
  Rows3,
  SlidersHorizontal,
  Trash2,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialog } from '@/features/databases/table/ConfirmDialog';
import { ViewIcon } from '@/features/databases/ViewIcon';
import { setViewIcon, useViewIcon } from '@/features/databases/viewIcons';
import {
  columnProperties,
  fromConfig,
  readFilters,
  readSorts,
} from '@/features/databases/viewState';
import { viewTypeIcons, viewTypes, type ViewType } from '@/features/databases/viewTypes';
import { IconPickerPanel } from '@/features/pages/IconPicker';
import type { View } from '@/lib/commands';
import { cn } from '@/lib/utils';
import { FilterPanel } from './FilterMenu';
import { GroupSetting } from './GroupSetting';
import { PanelHeader, ToolbarButton } from './parts';
import { PropertiesSetting } from './PropertiesSetting';
import { SortPanel } from './SortMenu';
import type { ToolbarMenuProps } from './types';

type Screen = 'main' | 'layout' | 'properties' | 'filter' | 'sort' | 'group';

type SettingsMenuProps = ToolbarMenuProps & {
  view: View;
  /** The last view of a database cannot be deleted. */
  canDelete: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
};

function MenuRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent focus-visible:bg-accent flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none"
    >
      <Icon size={16} aria-hidden className="text-muted-foreground shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {value === undefined || value === '' ? null : (
        <span className="text-muted-foreground max-w-28 truncate">{value}</span>
      )}
      <ChevronRight size={14} aria-hidden className="text-muted-foreground shrink-0" />
    </button>
  );
}

/** The name and the icon of the view. */
function NameRow({ view, onRename }: { view: View; onRename: (name: string) => void }) {
  const { t } = useTranslation();
  const icon = useViewIcon(view.id);
  const [name, setName] = useState(view.name);
  const [picking, setPicking] = useState(false);

  const commit = () => {
    const trimmed = name.trim();
    // An empty name keeps the old one, like a property's.
    if (trimmed === '') setName(view.name);
    else if (trimmed !== view.name) onRename(trimmed);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('databases.views.icon')}
            className="border-border hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ViewIcon view={view} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[22rem] gap-0 p-0"
          aria-label={t('databases.views.iconPicker')}
        >
          <IconPickerPanel
            current={icon}
            onChoose={(next) => setViewIcon(view.id, next)}
            onClose={() => setPicking(false)}
          />
        </PopoverContent>
      </Popover>
      <Input
        aria-label={t('databases.views.name')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="h-8 min-w-0 flex-1 px-2"
      />
    </div>
  );
}

/**
 * The settings of the active view: its name and icon, its layout, which
 * properties it shows, and its filters, sorts and grouping, each on a screen
 * of its own. Deleting the view is at the end.
 */
export function SettingsMenu({
  grouping,
  view,
  canDelete,
  onRename,
  onDelete,
  ...props
}: SettingsMenuProps & { grouping: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>('main');
  const [deleting, setDeleting] = useState(false);
  const { config, properties } = props;

  const shown = columnProperties(properties).filter(
    (property) => fromConfig(config, properties).columnVisibility[property.id] !== false,
  ).length;
  const filters = readFilters(config, properties).length;
  const sorts = readSorts(config, properties).length;
  const groupedBy = fromConfig(config, properties).grouping[0];
  const groupName = columnProperties(properties).find(
    (property) => property.id === groupedBy,
  )?.name;
  const back = () => setScreen('main');
  const close = () => setOpen(false);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setScreen('main');
        }}
      >
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={SlidersHorizontal}
            label={t('databases.toolbar.settings')}
            disabled={props.readOnly}
          />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label={t('databases.toolbar.settings')}
          className="max-h-[28rem] w-80 gap-2 overflow-y-auto p-2"
        >
          {screen === 'main' ? (
            <>
              <PanelHeader title={t('databases.toolbar.settings')} onClose={close} />
              {/* Fresh when the name changes from outside, so it shows the stored one. */}
              <NameRow key={`${view.id}:${view.name}`} view={view} onRename={onRename} />
              <div className="flex flex-col">
                <MenuRow
                  icon={viewTypeIcons[config.type]}
                  label={t('databases.toolbar.layout')}
                  value={t(`databases.views.types.${config.type}`)}
                  onClick={() => setScreen('layout')}
                />
                <MenuRow
                  icon={Eye}
                  label={t('databases.toolbar.propertyVisibility')}
                  value={shown}
                  onClick={() => setScreen('properties')}
                />
                <MenuRow
                  icon={ListFilter}
                  label={t('databases.toolbar.filter')}
                  value={filters > 0 ? filters : ''}
                  onClick={() => setScreen('filter')}
                />
                <MenuRow
                  icon={ArrowUpDown}
                  label={t('databases.toolbar.sort')}
                  value={sorts > 0 ? sorts : ''}
                  onClick={() => setScreen('sort')}
                />
                {grouping ? (
                  <MenuRow
                    icon={Rows3}
                    label={t('databases.toolbar.group')}
                    value={groupName}
                    onClick={() => setScreen('group')}
                  />
                ) : null}
              </div>
              <div className="border-border border-t pt-1">
                <button
                  type="button"
                  disabled={!canDelete}
                  title={canDelete ? undefined : t('databases.views.lastView')}
                  onClick={() => setDeleting(true)}
                  className="text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 size={16} aria-hidden />
                  {t('databases.views.delete')}
                </button>
              </div>
            </>
          ) : null}
          {screen === 'layout' ? (
            <>
              <PanelHeader title={t('databases.toolbar.layout')} onBack={back} onClose={close} />
              <ul className="flex flex-col">
                {(['table', 'kanban', 'calendar'] as ViewType[]).map((type) => {
                  const Icon = viewTypeIcons[type];
                  const available = viewTypes.includes(type);
                  return (
                    <li key={type}>
                      <button
                        type="button"
                        // Other layouts come with their views; this one is the one in use.
                        disabled={type !== config.type}
                        className={cn(
                          'hover:bg-accent flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none disabled:opacity-50',
                          !available && 'opacity-50',
                        )}
                      >
                        <Icon size={16} aria-hidden className="text-muted-foreground" />
                        <span className="flex-1 text-left">
                          {t(`databases.views.types.${type}`)}
                        </span>
                        {type === config.type ? <Check size={14} aria-hidden /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          {screen === 'properties' ? (
            <>
              <PanelHeader
                title={t('databases.toolbar.propertyVisibility')}
                onBack={back}
                onClose={close}
              />
              <PropertiesSetting {...props} />
            </>
          ) : null}
          {screen === 'filter' ? <FilterPanel {...props} onBack={back} onClose={close} /> : null}
          {screen === 'sort' ? <SortPanel {...props} onBack={back} onClose={close} /> : null}
          {screen === 'group' ? (
            <>
              <PanelHeader title={t('databases.toolbar.group')} onBack={back} onClose={close} />
              <GroupSetting {...props} />
            </>
          ) : null}
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={deleting}
        title={t('databases.views.deleteTitle', { name: view.name })}
        description={t('databases.views.deleteDescription')}
        confirmLabel={t('databases.table.delete')}
        onConfirm={() => {
          setDeleting(false);
          setOpen(false);
          onDelete();
        }}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}
