import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { pagesKey } from '@/features/pages/queryKeys';
import {
  commands,
  type CellValue,
  type Database,
  type Page,
  type Property,
  type PropertyType,
  type Row,
  type SelectOption,
  type View,
  type ViewConfig,
} from '@/lib/commands';

export const databaseKeys = {
  /** Everything that has been loaded about any database. */
  all: ['databases'] as const,
  database: (id: string) => ['databases', 'database', id] as const,
  rows: (databaseId: string) => ['databases', 'rows', databaseId] as const,
  allIncomingRelations: ['databases', 'incoming-relations'] as const,
  incomingRelations: (rowId: string) => ['databases', 'incoming-relations', rowId] as const,
};

const updatePropertyKey = ['update-property'] as const;
const setCellKey = ['set-cell'] as const;

/**
 * Option and cell writes share one queue: a cell that names a new select
 * option must not reach the backend before the option does.
 */
const propertyAndCellScope = { id: 'database-property-and-cell' };

/** A row with one cell set, or left out when the value is empty. */
function withCell(row: Row, propertyId: string, value: CellValue): Row {
  const cells = { ...row.cells };
  if (value === null) delete cells[propertyId];
  else cells[propertyId] = value;
  return { ...row, cells };
}

/** A database with its properties and views, without its rows. */
export function useDatabase(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: databaseKeys.database(id),
    // A refetch must not bring back a view as it was before a change that is still being saved.
    queryFn: async () => withPendingViews(queryClient, await commands.loadDatabase(id)),
  });
}

/** The rows of a database in their manual order. */
export function useRows(databaseId: string) {
  return useQuery({
    queryKey: databaseKeys.rows(databaseId),
    queryFn: () => commands.listRows(databaseId),
  });
}

/** The rows that point at a row through a relation, grouped by property. */
export function useIncomingRelations(rowId: string) {
  return useQuery({
    queryKey: databaseKeys.incomingRelations(rowId),
    queryFn: () => commands.listIncomingRelations(rowId),
  });
}

/** Changes the cached properties of a database, once the database has been loaded. */
function useSetProperties(databaseId: string) {
  const queryClient = useQueryClient();
  return (update: (properties: Property[]) => Property[]) =>
    queryClient.setQueryData<Database>(
      databaseKeys.database(databaseId),
      (database) => database && { ...database, properties: update(database.properties) },
    );
}

/** Changes the cached rows of a database, once they have been loaded. */
function useSetRows(databaseId: string) {
  const queryClient = useQueryClient();
  return (update: (rows: Row[]) => Row[]) =>
    queryClient.setQueryData<Row[]>(databaseKeys.rows(databaseId), (rows) => rows && update(rows));
}

/** Refetches what a change to properties can touch: the database and the cells of its rows. */
function useInvalidateDatabase(databaseId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: databaseKeys.database(databaseId) }),
      queryClient.invalidateQueries({ queryKey: databaseKeys.rows(databaseId) }),
    ]);
}

/** Creates a database below `parentId`, or at the top level for `null`. */
export function useCreateDatabase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (parentId: string | null) => commands.createDatabase(parentId),
    onSuccess: (database) => {
      // A database is a page, so the sidebar shows it without waiting for the list.
      queryClient.setQueryData<Page[]>(pagesKey, (pages) => [...(pages ?? []), database.page]);
      queryClient.setQueryData(databaseKeys.database(database.page.id), database);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: pagesKey }),
  });
}

/** Appends a row to a database. A row is renamed and deleted like the page it is. */
export function useCreateRow(databaseId: string) {
  const queryClient = useQueryClient();
  const setRows = useSetRows(databaseId);

  return useMutation({
    mutationFn: () => commands.createRow(databaseId),
    onSuccess: (row) => {
      setRows((rows) => [...rows, row]);
      // Links and the page view find a row in the page list.
      queryClient.setQueryData<Page[]>(pagesKey, (pages) => [
        ...(pages ?? []),
        {
          id: row.id,
          title: row.title,
          parentId: databaseId,
          position: row.position,
          kind: 'page',
          databaseId,
          isFavorite: false,
          icon: null,
          banner: null,
          bannerPosition: 50,
          updatedAt: new Date().toISOString(),
        },
      ]);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pagesKey }),
        queryClient.invalidateQueries({ queryKey: databaseKeys.rows(databaseId) }),
      ]),
  });
}

export function useCreateProperty(databaseId: string) {
  const queryClient = useQueryClient();
  const setProperties = useSetProperties(databaseId);

  return useMutation({
    mutationFn: ({
      name,
      type,
      targetId = null,
    }: {
      name: string;
      type: PropertyType;
      /** The database a relation points at. */
      targetId?: string | null;
    }) => commands.createProperty(databaseId, name, type, targetId),
    onSuccess: (property) => setProperties((properties) => [...properties, property]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: databaseKeys.database(databaseId) }),
  });
}

/**
 * Renames a property or replaces its options. Like a page title, the cache is
 * updated right away and the saves run one after another so the last one wins.
 */
export function useUpdateProperty(databaseId: string) {
  const queryClient = useQueryClient();
  const setProperties = useSetProperties(databaseId);

  const mutation = useMutation({
    mutationKey: updatePropertyKey,
    scope: propertyAndCellScope,
    mutationFn: ({
      id,
      name = null,
      options = null,
    }: {
      id: string;
      name?: string | null;
      options?: SelectOption[] | null;
    }) => commands.updateProperty(id, name, options),
    onSettled: () => {
      // Refetching while another save is queued would bring back an older state.
      if (queryClient.isMutating({ mutationKey: updatePropertyKey }) <= 1) {
        return queryClient.invalidateQueries({ queryKey: databaseKeys.database(databaseId) });
      }
    },
  });

  return (id: string, changes: { name?: string; options?: SelectOption[] }) => {
    setProperties((properties) =>
      properties.map((property) => (property.id === id ? { ...property, ...changes } : property)),
    );
    mutation.mutate({ id, ...changes });
  };
}

/** Removes a property and its value in every row. */
export function useDeleteProperty(databaseId: string) {
  const setProperties = useSetProperties(databaseId);
  const setRows = useSetRows(databaseId);
  const invalidate = useInvalidateDatabase(databaseId);

  return useMutation({
    mutationFn: (id: string) => commands.deleteProperty(id),
    onSuccess: (_, id) => {
      setProperties((properties) => properties.filter((property) => property.id !== id));
      setRows((rows) => rows.map((row) => withCell(row, id, null)));
    },
    onSettled: invalidate,
  });
}

/** Removes an option of a select; cells that held it become empty. */
export function useDeleteSelectOption(databaseId: string) {
  const setProperties = useSetProperties(databaseId);
  const setRows = useSetRows(databaseId);
  const invalidate = useInvalidateDatabase(databaseId);

  return useMutation({
    mutationFn: ({ propertyId, optionId }: { propertyId: string; optionId: string }) =>
      commands.deleteSelectOption(propertyId, optionId),
    onSuccess: (_, { propertyId, optionId }) => {
      setProperties((properties) =>
        properties.map((property) =>
          property.id === propertyId
            ? { ...property, options: property.options.filter((option) => option.id !== optionId) }
            : property,
        ),
      );
      setRows((rows) =>
        rows.map((row) =>
          row.cells[propertyId] === optionId ? withCell(row, propertyId, null) : row,
        ),
      );
    },
    onSettled: invalidate,
  });
}

/** Changes the type of a property. The backend converts every cell, so the rows are refetched. */
export function useChangePropertyType(databaseId: string) {
  const setProperties = useSetProperties(databaseId);
  const invalidate = useInvalidateDatabase(databaseId);

  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: PropertyType }) =>
      commands.changePropertyType(id, type),
    onSuccess: (changed) =>
      setProperties((properties) =>
        properties.map((property) => (property.id === changed.id ? changed : property)),
      ),
    onSettled: invalidate,
  });
}

/**
 * Sets a cell; `null` empties it. The cache is updated right away. A value the
 * backend refuses is gone again as soon as the rows have been refetched.
 */
export function useSetCell(databaseId: string) {
  const queryClient = useQueryClient();
  const setRows = useSetRows(databaseId);

  const mutation = useMutation({
    mutationKey: setCellKey,
    scope: propertyAndCellScope,
    mutationFn: ({
      rowId,
      propertyId,
      value,
    }: {
      rowId: string;
      propertyId: string;
      value: CellValue;
    }) => commands.setCell(rowId, propertyId, value),
    onSettled: () => {
      // Refetching while another save is queued would bring back an older value.
      if (queryClient.isMutating({ mutationKey: setCellKey }) <= 1) {
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: databaseKeys.rows(databaseId) }),
          queryClient.invalidateQueries({ queryKey: pagesKey }),
          // A relation cell changes what the rows it names are linked from.
          queryClient.invalidateQueries({ queryKey: databaseKeys.allIncomingRelations }),
        ]);
      }
    },
  });

  return (rowId: string, propertyId: string, value: CellValue) => {
    setRows((rows) =>
      rows.map((row) => (row.id === rowId ? withCell(row, propertyId, value) : row)),
    );
    mutation.mutate({ rowId, propertyId, value });
  };
}

/** How long a view waits after the last change before it is saved. */
export const VIEW_SAVE_DELAY = 500;

type ViewChanges = { name: string | null; config: ViewConfig | null };

/**
 * A change to a view that the backend has not confirmed yet. `version` counts
 * the changes, so that a save that comes back knows whether a newer change
 * arrived meanwhile.
 */
type PendingView = ViewChanges & {
  databaseId: string;
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
};

/** Pending view changes per query client, so that tests with their own client do not meet. */
const pendingViews = new WeakMap<QueryClient, Map<string, PendingView>>();

function pendingOf(queryClient: QueryClient) {
  let pending = pendingViews.get(queryClient);
  if (!pending) {
    pending = new Map();
    pendingViews.set(queryClient, pending);
  }
  return pending;
}

function withChanges(view: View, changes: ViewChanges): View {
  return {
    ...view,
    name: changes.name ?? view.name,
    config: changes.config ?? view.config,
  };
}

/** A loaded database with the view changes that are still on their way to the backend. */
function withPendingViews(queryClient: QueryClient, database: Database): Database {
  const pending = pendingOf(queryClient);
  if (pending.size === 0) return database;
  return {
    ...database,
    views: database.views.map((view) => {
      const changes = pending.get(view.id);
      return changes ? withChanges(view, changes) : view;
    }),
  };
}

/** Changes the cached views of a database, once the database has been loaded. */
function useSetViews(databaseId: string) {
  const queryClient = useQueryClient();
  return (update: (views: View[]) => View[]) =>
    queryClient.setQueryData<Database>(
      databaseKeys.database(databaseId),
      (database) => database && { ...database, views: update(database.views) },
    );
}

/** Adds a view after the last one. It is in the cache once the backend has created it. */
export function useCreateView(databaseId: string) {
  const setViews = useSetViews(databaseId);

  return useMutation({
    mutationFn: ({ name, config }: { name: string; config: ViewConfig }) =>
      commands.createView(databaseId, name, config),
    onSuccess: (view) => setViews((views) => [...views, view]),
  });
}

/**
 * Renames a view or changes its configuration. The cache changes at once; the
 * backend hears of it after `VIEW_SAVE_DELAY` without a further change, or
 * when `flush` asks for it. Saves of one view reach the backend in order.
 */
export function useUpdateView(databaseId: string) {
  const queryClient = useQueryClient();
  const setViews = useSetViews(databaseId);
  const invalidate = useInvalidateDatabase(databaseId);

  const mutation = useMutation({
    mutationFn: ({ id, name, config }: ViewChanges & { id: string; version: number }) =>
      commands.updateView(id, name, config),
    // One queue for the views of a database, so that an older configuration never
    // overwrites a newer one.
    scope: { id: `database-view-${databaseId}` },
    onSuccess: (saved, { id, version }) => {
      const pending = pendingOf(queryClient);
      const entry = pending.get(id);
      if (entry && entry.version !== version) return;
      pending.delete(id);
      setViews((views) => views.map((view) => (view.id === id ? saved : view)));
    },
    onError: (_, { id, version }) => {
      // The backend refused the change; what it has is the truth.
      const pending = pendingOf(queryClient);
      if (pending.get(id)?.version === version) pending.delete(id);
      return invalidate();
    },
  });

  // Timers outlive a render, so they call the mutation of the latest one.
  const latest = useRef(mutation.mutate);
  useLayoutEffect(() => {
    latest.current = mutation.mutate;
  });

  return useMemo(() => {
    const pending = pendingOf(queryClient);

    const sendNow = (id: string) => {
      const entry = pending.get(id);
      if (!entry || entry.timer === null) return;
      clearTimeout(entry.timer);
      entry.timer = null;
      const { name, config, version } = entry;
      latest.current({ id, name, config, version });
    };

    const flush = (id?: string) => {
      for (const [viewId, entry] of pending) {
        if (entry.databaseId === databaseId && (id === undefined || id === viewId)) sendNow(viewId);
      }
    };

    const change = (
      id: string,
      changes: Partial<ViewChanges>,
      { immediately = false }: { immediately?: boolean } = {},
    ) => {
      const previous = pending.get(id);
      if (previous?.timer) clearTimeout(previous.timer);
      const entry: PendingView = {
        databaseId,
        name: changes.name ?? previous?.name ?? null,
        config: changes.config ?? previous?.config ?? null,
        version: (previous?.version ?? 0) + 1,
        timer: null,
      };
      entry.timer = setTimeout(() => sendNow(id), VIEW_SAVE_DELAY);
      pending.set(id, entry);
      queryClient.setQueryData<Database>(
        databaseKeys.database(databaseId),
        (database) =>
          database && {
            ...database,
            views: database.views.map((view) =>
              view.id === id
                ? withChanges(view, { name: changes.name ?? null, config: changes.config ?? null })
                : view,
            ),
          },
      );
      if (immediately) sendNow(id);
    };

    return { change, flush };
  }, [databaseId, queryClient]);
}

/** Deletes a view; the backend refuses the last one of a database. */
export function useDeleteView(databaseId: string) {
  const queryClient = useQueryClient();
  const setViews = useSetViews(databaseId);
  const invalidate = useInvalidateDatabase(databaseId);

  return useMutation({
    mutationFn: (id: string) => commands.deleteView(id),
    onMutate: (id) => {
      // A change that has not been sent yet is not worth sending any more.
      const pending = pendingOf(queryClient);
      const entry = pending.get(id);
      if (entry?.timer) clearTimeout(entry.timer);
      pending.delete(id);
      setViews((views) => views.filter((view) => view.id !== id));
    },
    onError: invalidate,
  });
}
