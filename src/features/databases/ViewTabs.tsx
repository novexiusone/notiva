import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TABLE_INSET } from '@/features/databases/table/layout';
import { ViewIcon } from '@/features/databases/ViewIcon';
import { viewTypeIcons, viewTypes, type ViewType } from '@/features/databases/viewTypes';
import type { View } from '@/lib/commands';

type ViewTabsProps = {
  views: View[];
  /** The view that is shown; `null` while a database has none. */
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (type: ViewType) => void;
  readOnly?: boolean;
  /** The settings of the active view, at the end of the line of tabs. */
  toolbar?: ReactNode;
  /** What the active view shows. */
  children: ReactNode;
};

const iconButton =
  'text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent focus-visible:ring-ring/60 flex size-7 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2';

/**
 * The views of a database as tabs above what the active one shows. `+` adds a
 * view of a type this version can show. Renaming and deleting a view are in
 * its settings.
 */
export function ViewTabs({
  views,
  activeId,
  onSelect,
  onAdd,
  readOnly = false,
  toolbar,
  children,
}: ViewTabsProps) {
  const { t } = useTranslation();
  return (
    <Tabs value={activeId ?? ''} onValueChange={onSelect} className="gap-0">
      <div
        className="flex min-h-10 flex-wrap items-center gap-x-2"
        style={{ paddingLeft: TABLE_INSET, paddingRight: TABLE_INSET }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <TabsList variant="line" aria-label={t('databases.views.label')} className="h-9">
            {views.map((view) => (
              <TabsTrigger key={view.id} value={view.id} className="px-2">
                <ViewIcon view={view} />
                <span className="max-w-48 truncate">{view.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={iconButton}
              aria-label={t('databases.views.add')}
              disabled={readOnly}
            >
              <Plus size={16} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-max min-w-40">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {t('databases.views.chooseType')}
              </DropdownMenuLabel>
              {viewTypes.map((type) => {
                const Icon = viewTypeIcons[type];
                return (
                  <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
                    <Icon aria-hidden />
                    {t(`databases.views.types.${type}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="ml-auto">{toolbar}</div>
      </div>
      {activeId === null ? (
        children
      ) : (
        <TabsContent value={activeId} className="pt-2">
          {children}
        </TabsContent>
      )}
    </Tabs>
  );
}
