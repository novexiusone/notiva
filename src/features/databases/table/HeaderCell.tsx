import { ArrowLeftRight, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useChangePropertyType,
  useDeleteProperty,
  useUpdateProperty,
} from '@/features/databases/api';
import { InlineInput } from '@/features/databases/properties/InlineInput';
import { useTableSortable } from '@/features/databases/dnd/useTableSortable';
import {
  propertyTypeDefinition,
  propertyTypes,
  type PropertyTypeDefinition,
} from '@/features/databases/properties/registry';
import type { Property, PropertyType } from '@/lib/commands';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './ConfirmDialog';
import { ColumnResizeHandle } from './ColumnResize';

const headerCell =
  'border-border text-muted-foreground relative flex h-full shrink-0 items-center border-r text-sm';
const headerContent = 'flex h-full w-full min-w-0 items-center gap-1.5 px-2';

type WidthChange = (width: number, done: boolean) => void;

/** The header of the title column. The title cannot be renamed, retyped, deleted or moved. */
export function TitleHeaderCell({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange?: WidthChange;
}) {
  const { t } = useTranslation();
  const name = t('databases.table.titleColumn');
  return (
    <div role="columnheader" aria-colindex={1} style={{ width }} className={headerCell}>
      <span className={headerContent}>
        <span className="truncate">{name}</span>
      </span>
      {onWidthChange ? (
        <ColumnResizeHandle name={name} width={width} onChange={onWidthChange} />
      ) : null}
    </div>
  );
}

type PropertyHeaderCellProps = {
  property: Property;
  definition: PropertyTypeDefinition;
  columnIndex: number;
  width: number;
  sortIndex: number;
  sortingDisabled: boolean;
  onKeyboardMove: (by: number) => void;
  onWidthChange?: WidthChange;
  readOnly?: boolean;
};

/** The name of a property with its type's icon, and a menu to rename, retype or delete it. */
export function PropertyHeaderCell({
  property,
  definition,
  columnIndex,
  width,
  sortIndex,
  sortingDisabled,
  onKeyboardMove,
  onWidthChange,
  readOnly = false,
}: PropertyHeaderCellProps) {
  const { t } = useTranslation();
  const { ref, handleRef, isDragging } = useTableSortable({
    id: property.id,
    index: sortIndex,
    kind: 'column',
    group: 'columns',
    disabled: sortingDisabled,
  });
  const updateProperty = useUpdateProperty(property.databaseId);
  const changeType = useChangePropertyType(property.databaseId);
  const deleteProperty = useDeleteProperty(property.databaseId);
  const [renaming, setRenaming] = useState(false);
  const [newType, setNewType] = useState<PropertyType | null>(null);
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Renaming swaps the trigger for an input, so the menu must not focus the trigger on close.
  const renameChosen = useRef(false);
  const refocus = useRef(false);
  const Icon = definition.icon;

  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    // Back to the header after Enter or Escape, but not when the user clicked elsewhere.
    if (document.activeElement === null || document.activeElement === document.body) {
      trigger.current?.focus();
    }
  }, [renaming]);

  const stopRenaming = () => {
    refocus.current = true;
    setRenaming(false);
  };

  return (
    <div
      ref={ref}
      role="columnheader"
      aria-colindex={columnIndex + 1}
      style={{ width }}
      className={cn(headerCell, isDragging && 'opacity-50')}
    >
      {renaming && !readOnly ? (
        <div className="flex h-full w-full min-w-0 items-center px-1">
          <InlineInput
            initialText={property.name}
            label={t('databases.table.propertyName')}
            onSubmit={(text) => {
              const name = text.trim();
              if (name !== '' && name !== property.name) updateProperty(property.id, { name });
              stopRenaming();
              return true;
            }}
            onCancel={stopRenaming}
          />
        </div>
      ) : (
        <>
          {!sortingDisabled ? (
            <button
              ref={handleRef}
              type="button"
              disabled={readOnly}
              aria-label={t('databases.table.dragColumn', { name: property.name })}
              onKeyDown={(event) => {
                const by = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                if (by !== 0) {
                  event.preventDefault();
                  event.stopPropagation();
                  onKeyboardMove(by);
                }
              }}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-full w-6 shrink-0 cursor-grab items-center justify-center rounded-sm active:cursor-grabbing"
            >
              <GripVertical size={14} aria-hidden />
            </button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={trigger}
                type="button"
                disabled={readOnly}
                className={cn(
                  headerContent,
                  'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent focus-visible:ring-ring/60 outline-none focus-visible:ring-2 focus-visible:ring-inset',
                )}
              >
                <Icon size={16} aria-hidden className="shrink-0" />
                <span className="truncate">{property.name}</span>
              </button>
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
                  setRenaming(true);
                }}
              >
                <Pencil aria-hidden />
                {t('databases.table.rename')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowLeftRight aria-hidden />
                  {t('databases.table.changeType')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-max min-w-36">
                  {propertyTypes
                    .filter((type) => type !== property.type)
                    .map((type) => {
                      const TypeIcon = propertyTypeDefinition(type)?.icon;
                      return (
                        <DropdownMenuItem key={type} onSelect={() => setNewType(type)}>
                          {TypeIcon ? <TypeIcon aria-hidden /> : null}
                          {t(`databases.table.types.${type}`)}
                        </DropdownMenuItem>
                      );
                    })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 aria-hidden />
                {t('databases.table.deleteProperty')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <ConfirmDialog
        open={newType !== null}
        title={t('databases.table.changeTypeTitle', {
          name: property.name,
          type: newType ? t(`databases.table.types.${newType}`) : '',
        })}
        description={t('databases.table.changeTypeDescription')}
        confirmLabel={t('databases.table.changeType')}
        onConfirm={() => {
          if (newType) changeType.mutate({ id: property.id, type: newType });
          setNewType(null);
        }}
        onCancel={() => setNewType(null)}
      />
      <ConfirmDialog
        open={deleting}
        title={t('databases.table.deletePropertyTitle', { name: property.name })}
        description={t('databases.table.deletePropertyDescription')}
        confirmLabel={t('databases.table.delete')}
        onConfirm={() => {
          deleteProperty.mutate(property.id);
          setDeleting(false);
        }}
        onCancel={() => setDeleting(false)}
      />
      {onWidthChange ? (
        <ColumnResizeHandle name={property.name} width={width} onChange={onWidthChange} />
      ) : null}
    </div>
  );
}
