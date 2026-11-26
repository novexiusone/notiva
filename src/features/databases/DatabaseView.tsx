import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  databaseKeys,
  useCreateRow,
  useCreateView,
  useDatabase,
  useDeleteView,
  useRows,
  useUpdateView,
} from '@/features/databases/api';
import { ViewToolbar } from '@/features/databases/toolbar/ViewToolbar';
import { TABLE_INSET } from '@/features/databases/table/layout';
import { emptyViewConfig } from '@/features/databases/viewState';
import { ViewTabs } from '@/features/databases/ViewTabs';
import { viewTypeDefinition, type ViewType } from '@/features/databases/viewTypes';
import type { Database, Row, View, ViewConfig } from '@/lib/commands';
import { lastActiveView, rememberActiveView } from '@/lib/localState';
import { cn } from '@/lib/utils';

export type DatabaseViewHandle = { flush: () => Promise<boolean> };

type DatabaseViewProps = {
  databaseId: string;
  ref?: Ref<DatabaseViewHandle>;
  /**
   * Shown inside another page. The address then belongs to that page, so the
   * active view is the one remembered for the database on this machine.
   */
  embedded?: boolean;
};

/**
 * What a database page shows below its title: the tabs of its views and what
 * the active view shows. It sets its own width, so that the table can use the
 * whole main area without a change to the page around it.
 */
export function DatabaseView({ databaseId, embedded = false, ref }: DatabaseViewProps) {
  const { t } = useTranslation();
  const database = useDatabase(databaseId);
  const rows = useRows(databaseId);

  if (database.isError || rows.isError) {
    return (
      <p
        role="alert"
        className={cn(
          'text-muted-foreground text-sm',
          !embedded && 'mx-auto w-full max-w-[720px] px-12',
        )}
      >
        {t('databases.table.loadFailed')}
      </p>
    );
  }
  if (!database.isSuccess || !rows.isSuccess) return null;

  return <DatabaseViews database={database.data} rows={rows.data} embedded={embedded} ref={ref} />;
}

/**
 * The view that is shown: the one in the address, else the one that was active
 * last on this machine, else the first. A view that no longer exists counts as
 * none.
 */
function activeViewOf(views: View[], databaseId: string, requested: string | undefined) {
  const requestedView = views.find((view) => view.id === requested);
  if (requestedView) return requestedView;
  const remembered = lastActiveView(databaseId);
  return views.find((view) => view.id === remembered) ?? views[0] ?? null;
}

/** A name for a new view of a type that no other view of the database has. */
function newViewName(views: View[], base: string) {
  const names = new Set(views.map((view) => view.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function DatabaseViews({
  database,
  rows,
  embedded,
  ref,
}: {
  database: Database;
  rows: Row[];
  embedded: boolean;
  ref?: Ref<DatabaseViewHandle>;
}) {
  const { t } = useTranslation();
  const databaseId = database.page.id;
  const address: { view?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  // Embedded, the view lives in the memory below, which outlasts the block's component
  // (moving the block builds it anew); this state only makes a switch show at once.
  const [embeddedView, setEmbeddedView] = useState(() => lastActiveView(databaseId) ?? undefined);
  const search = embedded ? { view: embeddedView } : address;
  const queryClient = useQueryClient();
  const createView = useCreateView(databaseId);
  const createRow = useCreateRow(databaseId);
  const { change: changeView, flush: flushViews } = useUpdateView(databaseId);
  useImperativeHandle(ref, () => ({ flush: flushViews }), [flushViews]);
  const deleteView = useDeleteView(databaseId);
  const { views } = database;
  const readOnly = database.page.lock === 'all';
  const active = activeViewOf(views, databaseId, search.view);
  const activeId = active?.id ?? null;

  const show = (id: string, replace = false) => {
    if (embedded) {
      rememberActiveView(databaseId, id);
      setEmbeddedView(id);
      return;
    }
    void navigate({ to: '.', search: (previous) => ({ ...previous, view: id }), replace });
  };

  useEffect(() => {
    if (activeId === null) return;
    rememberActiveView(databaseId, activeId);
    // An address that names a view that is gone is corrected, so a reload agrees.
    // A view that was just created is in the cache before this component has seen it.
    const cached = queryClient.getQueryData<Database>(databaseKeys.database(databaseId));
    const known = cached?.views.some((view) => view.id === search.view) ?? false;
    if (!embedded && search.view !== undefined && search.view !== activeId && !known) {
      void navigate({
        to: '.',
        search: (previous) => ({ ...previous, view: activeId }),
        replace: true,
      });
    }
  }, [activeId, databaseId, embedded, search.view, navigate, queryClient]);

  // A change that waits for its pause is sent when another view is shown,
  // when the database is left, and when the page goes away.
  useEffect(() => {
    if (activeId === null) return;
    return () => {
      void flushViews(activeId);
    };
  }, [activeId, flushViews]);
  useEffect(() => {
    const flush = () => flushViews();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flushViews]);

  const select = (id: string) => {
    if (activeId !== null) flushViews(activeId);
    show(id);
  };

  const add = (type: ViewType) => {
    if (readOnly) return;
    const config = emptyViewConfig(type);
    if (config.type === 'calendar') {
      config.datePropertyId =
        database.properties.find((property) => property.type === 'date')?.id ?? null;
    }
    createView.mutate(
      {
        name: newViewName(views, t(`databases.views.types.${type}`)),
        config,
      },
      { onSuccess: (view) => select(view.id) },
    );
  };

  const remove = (id: string) => {
    if (readOnly) return;
    if (id === activeId) {
      const index = views.findIndex((view) => view.id === id);
      const neighbour = views[index + 1] ?? views[index - 1];
      if (neighbour) show(neighbour.id, true);
    }
    deleteView.mutate(id);
  };

  const setConfig = (config: ViewConfig) => {
    if (!readOnly && activeId !== null) changeView(activeId, { config });
  };

  const definition = active ? viewTypeDefinition(active.config.type) : viewTypeDefinition('table');
  const Renderer = definition?.Renderer;

  return (
    <ViewTabs
      views={views}
      activeId={activeId}
      onSelect={select}
      onAdd={add}
      readOnly={readOnly}
      toolbar={
        active && definition ? (
          <ViewToolbar
            config={active.config}
            properties={database.properties}
            onChange={setConfig}
            readOnly={readOnly}
            grouping={definition.grouping}
            onNewRow={() => createRow.mutate()}
            view={active}
            canDelete={views.length > 1}
            onRename={(name) => changeView(active.id, { name }, { immediately: true })}
            onDelete={() => remove(active.id)}
          />
        ) : null
      }
    >
      {Renderer ? (
        // A view of its own each, so nothing of one view's table carries over to another.
        <Renderer
          key={activeId}
          database={database}
          rows={rows}
          view={active}
          readOnly={readOnly}
          onConfigChange={setConfig}
        />
      ) : (
        <p
          role="status"
          className="text-muted-foreground py-4 text-sm"
          style={{ paddingLeft: TABLE_INSET, paddingRight: TABLE_INSET }}
        >
          {t('databases.views.unavailable')}
        </p>
      )}
    </ViewTabs>
  );
}
