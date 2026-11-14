import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** A row with one cell set, or left out when the value is empty. */
function withCell(row: Row, propertyId: string, value: CellValue): Row {
  const cells = { ...row.cells };
  if (value === null) delete cells[propertyId];
  else cells[propertyId] = value;
  return { ...row, cells };
}

/** A database with its properties and views, without its rows. */
export function useDatabase(id: string) {
  return useQuery({
    queryKey: databaseKeys.database(id),
    queryFn: () => commands.loadDatabase(id),
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
    scope: { id: 'update-property' },
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
    scope: { id: 'set-cell' },
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
