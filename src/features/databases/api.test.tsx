import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  databaseKeys,
  useChangePropertyType,
  useCreateDatabase,
  useCreateProperty,
  useCreateRow,
  useCreateView,
  useDatabase,
  useDeleteProperty,
  useDeleteSelectOption,
  useDeleteView,
  useIncomingRelations,
  useRows,
  useSetCell,
  useUpdateProperty,
  useUpdateView,
  VIEW_SAVE_DELAY,
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
  type ViewConfig,
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

  it('updates the row page edit timestamp after a cell is saved', async () => {
    const { current, pages } = await renderDatabase(() => ({ setCell: useSetCell('db') }));
    const before = pages().find((page) => page.id === 'r2')!.updatedAt;

    act(() => current().setCell('r2', 'amount', 7));

    await waitFor(() =>
      expect(pages().find((page) => page.id === 'r2')!.updatedAt).not.toBe(before),
    );
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
      isFavorite: false,
      icon: null,
      banner: null,
      updatedAt: expect.any(String),
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

describe('the view hooks', () => {
  const tableConfig: ViewConfig = {
    version: 1,
    type: 'table',
    filters: [],
    sorts: [],
    properties: [],
    groupBy: null,
  };
  const sorted = (direction: 'asc' | 'desc'): ViewConfig => ({
    ...tableConfig,
    sorts: [{ propertyId: 'notes', direction }],
  });

  beforeEach(() =>
    installFakeBackend({
      pages: [database('db', 'Tasks')],
      views: [
        { id: 'v1', databaseId: 'db', name: 'Table', position: 0, config: tableConfig },
        { id: 'v2', databaseId: 'db', name: 'Second', position: 1, config: tableConfig },
      ],
    }),
  );
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const views = (loaded: () => Database) => loaded().views;
  const stored = async () => (await commands.loadDatabase('db')).views;

  it('adds a created view after the others', async () => {
    const { current, loaded } = await renderDatabase(() => ({ create: useCreateView('db') }));

    await act(() => current().create.mutateAsync({ name: 'Third', config: sorted('asc') }));

    expect(views(loaded).map((view) => view.name)).toEqual(['Table', 'Second', 'Third']);
    expect((await stored()).map((view) => view.name)).toEqual(['Table', 'Second', 'Third']);
  });

  it('changes a view at once and saves it after the pause, the last change only', async () => {
    const updateView = vi.spyOn(commands, 'updateView');
    const { current, loaded } = await renderDatabase(() => ({ update: useUpdateView('db') }));
    vi.useFakeTimers();

    act(() => current().update.change('v1', { config: sorted('asc') }));
    act(() => current().update.change('v1', { config: sorted('desc') }));

    expect(views(loaded)[0]!.config).toEqual(sorted('desc'));
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DELAY - 1));
    expect(updateView).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();

    await waitFor(() => expect(updateView).toHaveBeenCalledTimes(1));
    expect(updateView).toHaveBeenCalledWith('v1', null, sorted('desc'));
    await waitFor(async () => expect((await stored())[0]!.config).toEqual(sorted('desc')));
  });

  it('sends a pending change at once on flush, and saves the views of a database in order', async () => {
    const calls: string[] = [];
    const updateView = commands.updateView;
    vi.spyOn(commands, 'updateView').mockImplementation(async (id, name, config) => {
      calls.push(`start ${id} ${config?.sorts[0]?.direction ?? name}`);
      // A slow first save must not be overtaken by the second.
      await new Promise((resolve) => setTimeout(resolve, calls.length === 1 ? 50 : 0));
      const view = await updateView(id, name, config);
      calls.push(`done ${id}`);
      return view;
    });
    const { current } = await renderDatabase(() => ({ update: useUpdateView('db') }));

    act(() => {
      current().update.change('v1', { config: sorted('asc') });
      current().update.flush('v1');
      current().update.change('v1', { config: sorted('desc') });
      current().update.change('v2', { name: 'Renamed' }, { immediately: true });
      current().update.flush();
    });

    await waitFor(() => expect(calls).toHaveLength(6));
    expect(calls).toEqual([
      'start v1 asc',
      'done v1',
      'start v2 Renamed',
      'done v2',
      'start v1 desc',
      'done v1',
    ]);
    expect((await stored()).map((view) => [view.name, view.config])).toEqual([
      ['Table', sorted('desc')],
      ['Renamed', tableConfig],
    ]);
  });

  it('keeps a change that is still being saved when the database is fetched again', async () => {
    const { current, loaded, queryClient } = await renderDatabase(() => ({
      update: useUpdateView('db'),
    }));

    act(() => current().update.change('v2', { config: sorted('asc') }));
    await act(() => queryClient.refetchQueries({ queryKey: databaseKeys.database('db') }));

    expect(views(loaded)[1]!.config).toEqual(sorted('asc'));
    act(() => current().update.flush());
    await waitFor(async () => expect((await stored())[1]!.config).toEqual(sorted('asc')));
  });

  it('takes back a change the backend refuses', async () => {
    const { current, loaded } = await renderDatabase(() => ({ update: useUpdateView('db') }));
    const broken = { ...tableConfig, version: 2 } as unknown as ViewConfig;

    act(() => current().update.change('v1', { config: broken }, { immediately: true }));

    expect(views(loaded)[0]!.config).toEqual(broken);
    await waitFor(() => expect(views(loaded)[0]!.config).toEqual(tableConfig));
  });

  it('deletes a view at once, and brings the last one back when the backend refuses', async () => {
    const { current, loaded } = await renderDatabase(() => ({ remove: useDeleteView('db') }));

    await act(() => current().remove.mutateAsync('v1'));
    expect(views(loaded).map((view) => view.id)).toEqual(['v2']);

    act(() => current().remove.mutate('v2'));
    expect(views(loaded)).toEqual([]);
    await waitFor(() => expect(views(loaded).map((view) => view.id)).toEqual(['v2']));
  });
});
