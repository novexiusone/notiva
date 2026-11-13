import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  databaseKeys,
  useChangePropertyType,
  useCreateDatabase,
  useCreateProperty,
  useCreateRow,
  useDatabase,
  useDeleteProperty,
  useDeleteSelectOption,
  useIncomingRelations,
  useRows,
  useSetCell,
  useUpdateProperty,
} from '@/features/databases/api';
import { useDeletePage, usePages, useRenamePage } from '@/features/pages/api';
import { pagesKey } from '@/features/pages/queryKeys';
import {
  commands,
  type Database,
  type Page,
  type Property,
  type PropertyType,
  type Row,
} from '@/lib/commands';
import { installFakeBackend } from '@/test/fakeBackend';
import { database, row } from '@/test/renderApp';

function property(id: string, type: PropertyType, more: Partial<Property> = {}): Property {
  return {
    id,
    databaseId: 'db',
    name: id,
    type,
    position: 0,
    options: [],
    targetId: null,
    ...more,
  };
}

const open = { id: 'open', name: 'Open', color: 'green' };
const done = { id: 'done', name: 'Done', color: 'gray' };

/** A database "db" with two rows, a text, a number and a select, and "projects" it links to. */
function seed() {
  installFakeBackend({
    pages: [
      database('db', 'Tasks'),
      row('r1', 'One', 'db', 0),
      row('r2', 'Two', 'db', 1),
      database('projects', 'Projects', null, 1),
      row('p1', 'Notiva', 'projects', 0),
    ],
    properties: [
      property('notes', 'text', { position: 0 }),
      property('amount', 'number', { position: 1 }),
      property('status', 'select', { position: 2, options: [open, done] }),
      property('project', 'relation', { position: 3, targetId: 'projects' }),
    ],
    cells: {
      r1: { notes: '12', status: 'open', project: ['p1'] },
      r2: { notes: 'later', status: 'done' },
    },
  });
}

/**
 * Renders hooks that share one query client, and waits until the database has
 * loaded. `rows`, `properties` and `pages` read the cache, which is what the
 * hooks change at once; components follow with their next render.
 */
async function renderDatabase<T>(hooks: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(
    () => ({ database: useDatabase('db'), rows: useRows('db'), pages: usePages(), ...hooks() }),
    { wrapper },
  );
  await waitFor(() => {
    expect(rendered.result.current.database.isSuccess).toBe(true);
    expect(rendered.result.current.rows.isSuccess).toBe(true);
    expect(rendered.result.current.pages.isSuccess).toBe(true);
  });

  const rows = () => queryClient.getQueryData<Row[]>(databaseKeys.rows('db'))!;
  return {
    queryClient,
    current: () => rendered.result.current,
    rows,
    cells: () => rows().map((entry) => entry.cells),
    loaded: () => queryClient.getQueryData<Database>(databaseKeys.database('db'))!,
    properties: () => queryClient.getQueryData<Database>(databaseKeys.database('db'))!.properties,
    pages: () => queryClient.getQueryData<Page[]>(pagesKey)!,
  };
}

beforeEach(seed);

describe('useSetCell', () => {
  it('shows the value at once and stores it', async () => {
    const { current, cells } = await renderDatabase(() => ({ setCell: useSetCell('db') }));

    act(() => current().setCell('r2', 'amount', 7));

    expect(cells()[1]).toEqual({ notes: 'later', status: 'done', amount: 7 });
    await waitFor(async () => expect((await commands.listRows('db'))[1]!.cells.amount).toBe(7));
  });

  it('empties a cell with null', async () => {
    const { current, cells } = await renderDatabase(() => ({ setCell: useSetCell('db') }));

    act(() => current().setCell('r2', 'notes', null));

    expect(cells()[1]).toEqual({ status: 'done' });
    await waitFor(async () =>
      expect((await commands.listRows('db'))[1]!.cells).toEqual({ status: 'done' }),
    );
  });

  it('takes back a value the backend refuses', async () => {
    const { current, cells } = await renderDatabase(() => ({ setCell: useSetCell('db') }));

    act(() => current().setCell('r2', 'amount', 'seven'));

    expect(cells()[1]!.amount).toBe('seven');
    await waitFor(() => expect(cells()[1]).toEqual({ notes: 'later', status: 'done' }));
  });

  it('keeps the last of several quick changes', async () => {
    const { current, cells } = await renderDatabase(() => ({ setCell: useSetCell('db') }));

    act(() => {
      current().setCell('r1', 'notes', 'a');
      current().setCell('r1', 'notes', 'ab');
      current().setCell('r1', 'notes', 'abc');
    });

    expect(cells()[0]!.notes).toBe('abc');
    await waitFor(async () => expect((await commands.listRows('db'))[0]!.cells.notes).toBe('abc'));
    await waitFor(() => expect(current().rows.isFetching).toBe(false));
    expect(cells()[0]!.notes).toBe('abc');
  });
});

describe('properties', () => {
  it('adds a new property to the loaded database', async () => {
    const { current, properties } = await renderDatabase(() => ({
      createProperty: useCreateProperty('db'),
    }));

    await act(() => current().createProperty.mutateAsync({ name: 'Due', type: 'date' }));

    expect(properties().map((entry) => entry.name)).toEqual([
      'notes',
      'amount',
      'status',
      'project',
      'Due',
    ]);
    expect(properties()[4]).toMatchObject({ type: 'date', targetId: null });
  });

  it('renames a property at once and stores the name', async () => {
    const { current, properties } = await renderDatabase(() => ({
      updateProperty: useUpdateProperty('db'),
    }));

    act(() => current().updateProperty('notes', { name: 'Remarks' }));

    expect(properties()[0]).toMatchObject({ id: 'notes', name: 'Remarks' });
    await waitFor(async () =>
      expect((await commands.loadDatabase('db')).properties[0]!.name).toBe('Remarks'),
    );
  });

  it('replaces the options of a select and leaves its name alone', async () => {
    const { current, properties } = await renderDatabase(() => ({
      updateProperty: useUpdateProperty('db'),
    }));
    const later = { id: 'later', name: 'Later', color: 'yellow' };

    act(() => current().updateProperty('status', { options: [done, open, later] }));

    expect(properties()[2]).toMatchObject({ name: 'status', options: [done, open, later] });
    await waitFor(async () =>
      expect((await commands.loadDatabase('db')).properties[2]).toMatchObject({
        name: 'status',
        options: [done, open, later],
      }),
    );
  });

  it('removes a deleted property and its cells', async () => {
    const { current, properties, cells } = await renderDatabase(() => ({
      deleteProperty: useDeleteProperty('db'),
    }));

    await act(() => current().deleteProperty.mutateAsync('notes'));

    expect(properties().map((entry) => entry.id)).toEqual(['amount', 'status', 'project']);
    expect(cells()).toEqual([{ status: 'open', project: ['p1'] }, { status: 'done' }]);
  });

  it('empties the cells that held a deleted option', async () => {
    const { current, properties, cells } = await renderDatabase(() => ({
      deleteOption: useDeleteSelectOption('db'),
    }));

    await act(() => current().deleteOption.mutateAsync({ propertyId: 'status', optionId: 'open' }));

    expect(properties()[2]!.options).toEqual([done]);
    expect(cells()).toEqual([
      { notes: '12', project: ['p1'] },
      { notes: 'later', status: 'done' },
    ]);
  });

  it('loads the converted cells after a change of type', async () => {
    const { current, properties, cells } = await renderDatabase(() => ({
      changeType: useChangePropertyType('db'),
    }));

    await act(() => current().changeType.mutateAsync({ id: 'notes', type: 'number' }));

    expect(properties()[0]).toMatchObject({ id: 'notes', type: 'number' });
    await waitFor(() =>
      expect(cells()).toEqual([{ notes: 12, status: 'open', project: ['p1'] }, { status: 'done' }]),
    );
  });
});

describe('databases and rows as pages', () => {
  it('puts a new database into the page list and keeps what was returned', async () => {
    const { current, pages, queryClient } = await renderDatabase(() => ({
      createDatabase: useCreateDatabase(),
    }));

    const created = await act(() => current().createDatabase.mutateAsync(null));

    expect(pages()).toContainEqual(created.page);
    expect(created.page).toMatchObject({ kind: 'database', parentId: null });
    expect(queryClient.getQueryData(databaseKeys.database(created.page.id))).toEqual(created);
    await waitFor(async () => expect(current().pages.data).toEqual(await commands.listPages()));
  });

  it('puts a new row into the rows and into the page list', async () => {
    const { current, rows, pages } = await renderDatabase(() => ({
      createRow: useCreateRow('db'),
    }));

    const created = await act(() => current().createRow.mutateAsync());

    expect(rows().map((entry) => entry.id)).toEqual(['r1', 'r2', created.id]);
    expect(pages()).toContainEqual({
      id: created.id,
      title: '',
      parentId: 'db',
      position: created.position,
      kind: 'page',
      databaseId: 'db',
    });
    await waitFor(async () => expect(current().pages.data).toEqual(await commands.listPages()));
  });

  it('renames a row in the loaded rows and a database in what was loaded about it', async () => {
    const { current, rows, loaded, pages } = await renderDatabase(() => ({
      renamePage: useRenamePage(),
    }));

    act(() => {
      current().renamePage('r2', 'Second');
      current().renamePage('db', 'Chores');
    });

    expect(rows().map((entry) => entry.title)).toEqual(['One', 'Second']);
    expect(loaded().page.title).toBe('Chores');
    expect(pages().find((entry) => entry.id === 'r2')!.title).toBe('Second');
    await waitFor(() => expect(current().database.data!.page.title).toBe('Chores'));
    await waitFor(async () =>
      expect((await commands.listRows('db')).map((entry) => entry.title)).toEqual([
        'One',
        'Second',
      ]),
    );
  });

  it('takes a deleted row out of the loaded rows', async () => {
    const { current, rows, pages } = await renderDatabase(() => ({
      deletePage: useDeletePage(),
    }));

    await act(() => current().deletePage.mutateAsync('r1'));

    expect(rows().map((entry) => entry.id)).toEqual(['r2']);
    expect(pages().some((entry) => entry.id === 'r1')).toBe(false);
    await waitFor(() => expect(current().rows.data!.map((entry) => entry.id)).toEqual(['r2']));
  });

  it('refreshes a database after the database its relation points at was deleted', async () => {
    const { current, properties, cells } = await renderDatabase(() => ({
      deletePage: useDeletePage(),
    }));

    await act(() => current().deletePage.mutateAsync('projects'));

    await waitFor(() =>
      expect(properties().map((entry) => entry.id)).toEqual(['notes', 'amount', 'status']),
    );
    await waitFor(() =>
      expect(cells()).toEqual([
        { notes: '12', status: 'open' },
        { notes: 'later', status: 'done' },
      ]),
    );
  });

  it('lists the rows that point at a row and follows a changed relation', async () => {
    const { current } = await renderDatabase(() => ({
      incoming: useIncomingRelations('p1'),
      setCell: useSetCell('db'),
    }));
    await waitFor(() =>
      expect(current().incoming.data).toEqual([
        {
          property: expect.objectContaining({ id: 'project' }),
          rows: [{ id: 'r1', title: 'One' }],
        },
      ]),
    );

    act(() => current().setCell('r1', 'project', null));

    await waitFor(() => expect(current().incoming.data).toEqual([]));
  });
});
