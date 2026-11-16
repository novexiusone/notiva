import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InlineInput } from '@/features/databases/properties/InlineInput';
import { ConfirmDialog } from '@/features/databases/table/ConfirmDialog';
import { TABLE_INSET } from '@/features/databases/table/layout';
import { viewTypeIcons, viewTypes, type ViewType } from '@/features/databases/viewTypes';
import type { View } from '@/lib/commands';

type ViewTabsProps = {
  views: View[];
  /** The view that is shown; `null` while a database has none. */
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (type: ViewType) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** The settings of the active view, at the end of the line of tabs. */
  toolbar?: ReactNode;
  /** What the active view shows. */
  children: ReactNode;
};

const iconButton =
  'text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent focus-visible:ring-ring/60 flex size-7 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2';

/**
 * The views of a database as tabs above what the active one shows. `+` adds a
 * view of a type this version can show; the menu beside the active tab renames
 * and deletes it. The last view cannot be deleted.
 */
export function ViewTabs({
  views,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  toolbar,
  children,
}: ViewTabsProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<View | null>(null);
  // Renaming swaps the tab for an input, so the menu must not take the focus back on close.
  const renameChosen = useRef(false);
  const active = views.find((view) => view.id === activeId) ?? null;

  return (
    <Tabs value={activeId ?? ''} onValueChange={onSelect} className="gap-0">
      <div
        className="flex min-h-10 flex-wrap items-center gap-x-2"
        style={{ paddingLeft: TABLE_INSET, paddingRight: TABLE_INSET }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <TabsList variant="line" aria-label={t('databases.views.label')} className="h-9">
            {views.map((view) => {
              const Icon = viewTypeIcons[view.config.type];
              if (view.id === renaming) {
                return (
                  <div key={view.id} className="flex h-7 w-40 items-center">
                    <InlineInput
                      initialText={view.name}
                      label={t('databases.views.name')}
                      onSubmit={(text) => {
                        const name = text.trim();
                        // An empty name keeps the old one, like a property's.
                        if (name !== '' && name !== view.name) onRename(view.id, name);
                        setRenaming(null);
                        return true;
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  </div>
                );
              }
              return (
                <TabsTrigger key={view.id} value={view.id} className="px-2">
                  <Icon aria-hidden />
                  <span className="max-w-48 truncate">{view.name}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          {active && renaming === null ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={iconButton}
                aria-label={t('databases.views.actions', { name: active.name })}
              >
                <ChevronDown size={16} aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-max min-w-44"
                onCloseAutoFocus={(event) => {
                  if (renameChosen.current) event.preventDefault();
                  renameChosen.current = false;
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    renameChosen.current = true;
                    setRenaming(active.id);
                  }}
                >
                  <Pencil aria-hidden />
                  {t('databases.views.rename')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={views.length <= 1}
                  onSelect={() => setDeleting(active)}
                >
                  <Trash2 aria-hidden />
                  {t('databases.views.delete')}
                </DropdownMenuItem>
                {views.length <= 1 ? (
                  <p className="text-muted-foreground max-w-56 px-2 py-1 text-xs">
                    {t('databases.views.lastView')}
                  </p>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className={iconButton} aria-label={t('databases.views.add')}>
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

      <ConfirmDialog
        open={deleting !== null}
        title={t('databases.views.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('databases.views.deleteDescription')}
        confirmLabel={t('databases.table.delete')}
        onConfirm={() => {
          if (deleting) onDelete(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </Tabs>
  );
}
