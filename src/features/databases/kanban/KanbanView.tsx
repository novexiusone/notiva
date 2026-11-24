import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  databaseKeys,
  useCreateProperty,
  useCreateRow,
  useSetCell,
} from '@/features/databases/api';
import { KanbanDragProvider, type KanbanDrag } from '@/features/databases/dnd/KanbanDnd';
import { TABLE_INSET, TABLE_MAX_HEIGHT } from '@/features/databases/table/layout';
import { useDatabaseTable } from '@/features/databases/useDatabaseTable';
import { emptyViewConfig, readSorts } from '@/features/databases/viewState';
import type { ViewRendererProps } from '@/features/databases/viewTypes';
import { usePages } from '@/features/pages/api';
import { pagesKey } from '@/features/pages/queryKeys';
import { commands, type Row } from '@/lib/commands';
import { KanbanColumn } from './KanbanColumn';
import { KanbanColumnsSetting, KanbanGroupSelect, type KanbanConfig } from './KanbanSettings';
import { moveCard } from './moveCard';

const fallbackConfig = emptyViewConfig('kanban') as KanbanConfig;
const noRowsKept: ReadonlySet<string> = new Set();

export function KanbanView({
  database,
  rows,
  view,
  readOnly = false,
  onConfigChange,
}: ViewRendererProps) {
  const { t } = useTranslation();
  const config = view?.config.type === 'kanban' ? view.config : fallbackConfig;
  const databaseId = database.page.id;
  const groupProperty = database.properties.find(
    (property) => property.type === 'select' && property.id === config.groupPropertyId,
  );
  const [keepRowIds, setKeepRowIds] = useState(noRowsKept);
  const { items, columns } = useDatabaseTable(database.properties, rows, config, { keepRowIds });
  const createRow = useCreateRow(databaseId);
  const createProperty = useCreateProperty(databaseId);
  const setCell = useSetCell(databaseId);
  const pages = usePages();
  const queryClient = useQueryClient();
  const unlockedRowIds = useMemo(
    () => new Set(pages.data?.filter((page) => page.lock === 'none').map((page) => page.id)),
    [pages.data],
  );
  const sorted = readSorts(config, database.properties).length > 0;
  const cardMutation = useMutation({
    mutationFn: async ({
      rowId,
      propertyId,
      value,
      changeValue,
      position,
    }: {
      rowId: string;
      propertyId: string;
      value: string | null;
      changeValue: boolean;
      position: { afterRowId: string | null } | null;
    }) => {
      if (changeValue) await commands.setCell(rowId, propertyId, value);
      if (position) await commands.moveRow(rowId, position.afterRowId);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: databaseKeys.rows(databaseId) }),
        queryClient.invalidateQueries({ queryKey: pagesKey }),
      ]),
  });

  const addRow = (value: string | null) => {
    if (readOnly || !groupProperty) return;
    createRow.mutate(undefined, {
      onSuccess: (row) => {
        setKeepRowIds((kept) => new Set([...kept, row.id]));
        if (value !== null) setCell(row.id, groupProperty.id, value);
      },
    });
  };

  if (!groupProperty) {
    const hasSelect = database.properties.some((property) => property.type === 'select');
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 py-4 text-sm"
        style={{ paddingLeft: TABLE_INSET, paddingRight: TABLE_INSET }}
      >
        <p className="text-muted-foreground">{t('databases.kanban.setup')}</p>
        {hasSelect ? (
          <KanbanGroupSelect
            config={config}
            properties={database.properties}
            readOnly={readOnly}
            onConfigChange={onConfigChange}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={() =>
              createProperty.mutate(
                { name: t('databases.kanban.selectName'), type: 'select' },
                {
                  onSuccess: (property) =>
                    onConfigChange({ ...config, groupPropertyId: property.id, hiddenGroups: [] }),
                },
              )
            }
          >
            {t('databases.kanban.createSelect')}
          </Button>
        )}
      </div>
    );
  }

  const modelRows = items.flatMap((item) => (item.kind === 'row' ? [item.row] : []));
  const properties = columns.filter((column) => column.property !== null);
  const hidden = new Set(config.hiddenGroups);
  const groups = [
    ...groupProperty.options.map((option) => ({
      key: option.id,
      value: option.id,
      name: option.name,
      option,
    })),
    {
      key: '',
      value: null,
      name: t('databases.group.empty', { name: groupProperty.name }),
      option: null,
    },
  ];
  const rowsByGroup = new Map<string, Row[]>(groups.map((group) => [group.key, []]));
  for (const row of modelRows) {
    const value = row.cells[groupProperty.id];
    const key = typeof value === 'string' && rowsByGroup.has(value) ? value : '';
    rowsByGroup.get(key)!.push(row);
  }
  const visibleGroups = groups.filter((group) => !hidden.has(group.key));
  const moveColumns = visibleGroups.map((group) => ({
    key: group.key,
    value: group.value,
    rowIds: rowsByGroup.get(group.key)!.map((row) => row.id),
  }));
  const move = ({ source, target }: KanbanDrag) => {
    const change = moveCard(moveColumns, source, target, { sorted });
    const row = change && rows.find((candidate) => candidate.id === change.rowId);
    if (!change || !row || readOnly || !unlockedRowIds.has(row.id)) return;
    const changeValue = change.value !== (row.cells[groupProperty.id] ?? null);
    if (!changeValue && !change.position) return;
    return cardMutation.mutateAsync({
      rowId: row.id,
      propertyId: groupProperty.id,
      value: change.value,
      changeValue,
      position: change.position,
    });
  };

  return (
    <section
      aria-label={t('databases.kanban.board')}
      className="flex max-w-full flex-col gap-2 pb-4"
      style={{ paddingLeft: TABLE_INSET, paddingRight: TABLE_INSET }}
    >
      <div
        role="group"
        aria-label={t('databases.kanban.settings')}
        className="flex flex-wrap items-center gap-2"
      >
        <KanbanGroupSelect
          config={config}
          properties={database.properties}
          readOnly={readOnly}
          onConfigChange={onConfigChange}
        />
        <KanbanColumnsSetting
          config={config}
          property={groupProperty}
          readOnly={readOnly}
          onConfigChange={onConfigChange}
        />
      </div>
      <KanbanDragProvider onMove={move}>
        <div
          className="overscroll-x-contain flex items-stretch gap-3 overflow-x-auto"
          style={{ maxHeight: TABLE_MAX_HEIGHT }}
        >
          {visibleGroups.map((group) => (
            <KanbanColumn
              key={group.key || 'empty'}
              name={group.name}
              option={group.option}
              rows={rowsByGroup.get(group.key)!}
              properties={properties}
              group={group.key}
              sorted={sorted}
              readOnly={readOnly}
              canDrag={(rowId) => !readOnly && unlockedRowIds.has(rowId)}
              onNew={() => addRow(group.value)}
            />
          ))}
        </div>
      </KanbanDragProvider>
    </section>
  );
}
