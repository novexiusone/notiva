import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  databaseKeys,
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

/**
 * What a database page shows below its title: the tabs of its views and what
 * the active view shows. It sets its own width, so that the table can use the
 * whole main area without a change to the page around it.
 */
export function DatabaseView({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  const database = useDatabase(databaseId);
  const rows = useRows(databaseId);

  if (database.isError || rows.isError) {
    return (
      <p role="alert" className="text-muted-foreground mx-auto w-full max-w-[720px] px-12 text-sm">
        {t('databases.table.loadFailed')}
      </p>
    );
  }
  if (!database.isSuccess || !rows.isSuccess) return null;

  return <DatabaseViews database={database.data} rows={rows.data} />;
}

/**
 * The view that is shown: the one in the address, else the one that was active
 * last on this machine, else the first. A view that no longer exists counts as
 * none.
 */
function activeViewOf(views: View[], databaseId: string, requested: string | undefined) {
  return (
    views.find((view) => view.id === requested) ??
    views.find((view) => view.id === lastActiveView(databaseId)) ??
    views[0] ??
    null
  );
}

/** A name for a new view of a type that no other view of the database has. */
function newViewName(views: View[], base: string) {
  const names = new Set(views.map((view) => view.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function DatabaseViews({ database, rows }: { database: Database; rows: Row[] }) {
  const { t } = useTranslation();
  const databaseId = database.page.id;
  const search: { view?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createView = useCreateView(databaseId);
  const { change: changeView, flush: flushViews } = useUpdateView(databaseId);
  const deleteView = useDeleteView(databaseId);
  const { views } = database;
  const active = activeViewOf(views, databaseId, search.view);
  const activeId = active?.id ?? null;

  const show = (id: string, replace = false) =>
    navigate({ to: '.', search: (previous) => ({ ...previous, view: id }), replace });

  useEffect(() => {
    if (activeId === null) return;
    rememberActiveView(databaseId, activeId);
    // An address that names a view that is gone is corrected, so a reload agrees.
    // A view that was just created is in the cache before this component has seen it.
    const cached = queryClient.getQueryData<Database>(databaseKeys.database(databaseId));
    const known = cached?.views.some((view) => view.id === search.view) ?? false;
    if (search.view !== undefined && search.view !== activeId && !known) {
      void navigate({
        to: '.',
        search: (previous) => ({ ...previous, view: activeId }),
        replace: true,
      });
    }
  }, [activeId, databaseId, search.view, navigate, queryClient]);

  // A change that waits for its pause is sent when another view is shown,
  // when the database is left, and when the page goes away.
  useEffect(() => {
    if (activeId === null) return;
    return () => flushViews(activeId);
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
    void show(id);
  };

  const add = (type: ViewType) =>
    createView.mutate(
      {
        name: newViewName(views, t(`databases.views.types.${type}`)),
        config: emptyViewConfig(type),
      },
      { onSuccess: (view) => select(view.id) },
    );

  const remove = (id: string) => {
    if (id === activeId) {
      const index = views.findIndex((view) => view.id === id);
      const neighbour = views[index + 1] ?? views[index - 1];
      if (neighbour) void show(neighbour.id, true);
    }
    deleteView.mutate(id);
  };

  const setConfig = (config: ViewConfig) => {
    if (activeId !== null) changeView(activeId, { config });
  };

  const definition = active ? viewTypeDefinition(active.config.type) : viewTypeDefinition('table');
  const Renderer = definition?.Renderer;

  return (
    <ViewTabs
      views={views}
      activeId={activeId}
      onSelect={select}
      onAdd={add}
      onRename={(id, name) => changeView(id, { name }, { immediately: true })}
      onDelete={remove}
      toolbar={
        active && definition ? (
          <ViewToolbar
            config={active.config}
            properties={database.properties}
            onChange={setConfig}
            grouping={definition.grouping}
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
