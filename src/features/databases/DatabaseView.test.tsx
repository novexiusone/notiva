import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockIPC } from '@tauri-apps/api/mocks';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VIEW_SAVE_DELAY } from '@/features/databases/api';
import { DatabaseView } from '@/features/databases/DatabaseView';
import {
  commands,
  type Property,
  type PropertyType,
  type SelectOption,
  type View,
  type ViewConfig,
} from '@/lib/commands';
import { database, page, renderApp, row } from '@/test/renderApp';

function property(id: string, name: string, type: PropertyType, position: number): Property {
  return { id, databaseId: 'db', name, type, position, options: [], targetId: null };
}

const todo: SelectOption = { id: 'todo', name: 'Todo', color: 'gray' };
const done: SelectOption = { id: 'done', name: 'Done', color: 'green' };

const tasks = {
  pages: [
    database('db', 'Tasks'),
    row('r1', 'Write spec', 'db', 0),
    row('r2', 'Build it', 'db', 1),
    page('other', 'Other', null, 1),
  ],
  // Out of order on purpose: the table follows `position`.
  properties: [
    { ...property('status', 'Status', 'select', 3), options: [todo, done] },
    property('notes', 'Notes', 'text', 0),
    property('due', 'Due', 'date', 2),
    property('hours', 'Hours', 'number', 1),
  ],
  cells: {
    r1: { notes: 'First draft', hours: 3, due: '2026-11-14', status: 'done' },
    r2: { hours: 8, status: 'todo' },
  },
  path: '/page/db',
};

const grid = () => screen.findByRole('grid', { name: 'Tasks' });

async function headerNames() {
  return within(await grid())
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
}

async function rowTitles() {
  return within(await grid())
    .queryAllByRole('row')
    .slice(1)
    .map((line) => line.getAttribute('aria-label'));
}

/** The cell of a row (by its title) in a column (by its header). */
async function cell(rowName: string, columnName: string) {
  const table = await grid();
  const columnIndex = within(table)
    .getAllByRole('columnheader')
    .findIndex((header) => header.textContent === columnName);
  const line = await within(table).findByRole('row', { name: rowName });
  return within(line).getAllByRole('gridcell')[columnIndex];
}

afterEach(() => vi.restoreAllMocks());

describe('a database page', () => {
  it('shows the title column, the properties in their order and the rows', async () => {
    renderApp(tasks);

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Tasks');
    await waitFor(async () =>
      expect(await headerNames()).toEqual(['Name', 'Notes', 'Hours', 'Due', 'Status', '']),
    );
    expect(await rowTitles()).toEqual(['Write spec', 'Build it']);
    expect(await cell('Write spec', 'Notes')).toHaveTextContent('First draft');
    expect(await cell('Write spec', 'Hours')).toHaveTextContent('3');
    expect(await cell('Write spec', 'Due')).toHaveTextContent('Nov 14, 2026');
    expect(await cell('Write spec', 'Status')).toHaveTextContent('Done');
    expect(await cell('Build it', 'Notes')).toHaveTextContent('');
    // Each property shows the icon of its type.
    const hours = within(await grid()).getByRole('columnheader', { name: 'Hours' });
    expect(hours.querySelector('.lucide-hash')).toBeInTheDocument();
    expect(document.querySelector('.bn-editor')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Backlinks' })).toBeNull();
  });

  it('keeps the editor for an ordinary page and for a row', async () => {
    renderApp({ ...tasks, path: '/page/r1' });

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Write spec');
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull());
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('gives a relation property no column, because there is no editor for it yet', async () => {
    renderApp({
      ...tasks,
      properties: [
        ...tasks.properties,
        { ...property('link', 'Linked', 'relation', 1.5), targetId: 'db' },
      ],
    });

    await waitFor(async () =>
      expect(await headerNames()).toEqual(['Name', 'Notes', 'Hours', 'Due', 'Status', '']),
    );
    expect(within(await grid()).getByRole('row', { name: 'Write spec' }).children).toHaveLength(5);
  });

  it('says so when there are no rows, also without any view', async () => {
    // Seeded without views: the table must not rely on one.
    renderApp({ pages: [database('db', 'Tasks')], path: '/page/db' });

    expect(await screen.findByText('No rows yet')).toBeInTheDocument();
    expect(await headerNames()).toEqual(['Name', '']);
    expect((await commands.loadDatabase('db')).views).toEqual([]);
  });

  it('edits a text cell in place and saves it on Enter', async () => {
    const { user } = renderApp(tasks);

    await user.click(await cell('Build it', 'Notes'));
    const input = await screen.findByRole('textbox', { name: 'Notes' });
    await user.type(input, 'Ship it{Enter}');

    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(await cell('Build it', 'Notes')).toHaveTextContent('Ship it');
    await waitFor(async () =>
      expect((await commands.listRows('db'))[1].cells.notes).toBe('Ship it'),
    );
    // The cell keeps the focus, so the keyboard can go on from there.
    expect(await cell('Build it', 'Notes')).toHaveFocus();
  });

  it('leaves a cell as it was on Escape', async () => {
    const setCell = vi.spyOn(commands, 'setCell');
    const { user } = renderApp(tasks);

    await user.click(await cell('Write spec', 'Notes'));
    await user.type(await screen.findByRole('textbox', { name: 'Notes' }), ' and more{Escape}');

    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(await cell('Write spec', 'Notes')).toHaveTextContent(/^First draft$/);
    expect(setCell).not.toHaveBeenCalled();
  });

  it('saves nothing when the value did not change', async () => {
    const setCell = vi.spyOn(commands, 'setCell');
    const renamePage = vi.spyOn(commands, 'renamePage');
    const { user } = renderApp(tasks);

    await user.click(await cell('Write spec', 'Notes'));
    await user.keyboard('{Enter}');
    await user.click(await cell('Write spec', 'Hours'));
    await user.keyboard('{Enter}');
    // An empty text cell stays empty.
    await user.click(await cell('Build it', 'Notes'));
    await user.keyboard('{Enter}');
    await user.click(await cell('Write spec', 'Name'));
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(setCell).not.toHaveBeenCalled();
    expect(renamePage).not.toHaveBeenCalled();
  });

  it('starts editing the focused cell with Enter and moves with the arrow keys', async () => {
    const { user } = renderApp(tasks);

    (await cell('Write spec', 'Notes')).focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(await cell('Build it', 'Hours')).toHaveFocus();

    await user.keyboard('{Enter}');
    const input = await screen.findByRole('textbox', { name: 'Hours' });
    expect(input).toHaveValue('8');
    await user.keyboard('{Escape}');
    expect(await cell('Build it', 'Hours')).toHaveFocus();
  });

  it('keeps a refused number open until another cell is clicked', async () => {
    const setCell = vi.spyOn(commands, 'setCell');
    const { user } = renderApp(tasks);

    await user.click(await cell('Write spec', 'Hours'));
    const input = await screen.findByRole('textbox', { name: 'Hours' });
    await user.clear(input);
    await user.type(input, 'many{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.click(await cell('Build it', 'Notes'));

    expect(screen.queryByRole('textbox', { name: 'Hours' })).toBeNull();
    expect(await screen.findByRole('textbox', { name: 'Notes' })).toHaveFocus();
    expect(await cell('Write spec', 'Hours')).toHaveTextContent('3');
    expect(setCell).not.toHaveBeenCalled();
  });

  it('writes a new select option before the cell that uses it, even when the option is slow', async () => {
    const calls: string[] = [];
    const updateProperty = commands.updateProperty;
    const setCell = commands.setCell;
    vi.spyOn(commands, 'updateProperty').mockImplementation(async (...args) => {
      calls.push('update_property started');
      // The real backend may take its time; the cell must wait for it.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await updateProperty(...args);
      calls.push('update_property done');
      return result;
    });
    vi.spyOn(commands, 'setCell').mockImplementation(async (...args) => {
      calls.push('set_cell started');
      await setCell(...args);
      calls.push('set_cell done');
    });
    const { user } = renderApp(tasks);

    await user.click(await cell('Build it', 'Status'));
    const popover = await screen.findByRole('dialog', { name: 'Status' });
    await user.type(within(popover).getByRole('combobox'), 'Blocked');
    await user.click(within(popover).getByRole('option', { name: 'Create “Blocked”' }));

    expect(await cell('Build it', 'Status')).toHaveTextContent('Blocked');
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls).toEqual([
      'update_property started',
      'update_property done',
      'set_cell started',
      'set_cell done',
    ]);
    const [, , , status] = (await commands.loadDatabase('db')).properties.sort(
      (a, b) => a.position - b.position,
    );
    const blocked = status.options.find((option) => option.name === 'Blocked');
    expect((await commands.listRows('db'))[1].cells.status).toBe(blocked?.id);
    // Refetched from the backend, the cell still holds the new option.
    await waitFor(async () =>
      expect(await cell('Build it', 'Status')).toHaveTextContent('Blocked'),
    );
  });

  it('renames a row from its title cell', async () => {
    const { user } = renderApp(tasks);

    await user.click(await cell('Build it', 'Name'));
    const input = await screen.findByRole('textbox', { name: 'Name' });
    expect(input).toHaveValue('Build it');
    await user.clear(input);
    await user.type(input, 'Ship it{Enter}');

    expect(await rowTitles()).toEqual(['Write spec', 'Ship it']);
    await waitFor(async () =>
      expect((await commands.listRows('db')).map((entry) => entry.title)).toEqual([
        'Write spec',
        'Ship it',
      ]),
    );
  });

  it('adds a row with "New", puts the cursor in its title and keeps it out of the page tree', async () => {
    const { user } = renderApp(tasks);
    await waitFor(async () => expect(await rowTitles()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'New' }));

    const input = await screen.findByRole('textbox', { name: 'Name' });
    expect(input).toHaveFocus();
    await user.type(input, 'Test it{Enter}');
    expect(await rowTitles()).toEqual(['Write spec', 'Build it', 'Test it']);
    await waitFor(async () =>
      expect((await commands.listRows('db')).map((entry) => entry.title)).toEqual([
        'Write spec',
        'Build it',
        'Test it',
      ]),
    );
    expect(within(screen.getByRole('tree')).getAllByRole('treeitem')).toHaveLength(2);
  });

  it('opens a row as a page, and the table follows when the row is renamed', async () => {
    const { user } = renderApp(tasks);

    const line = await within(await grid()).findByRole('row', { name: 'Build it' });
    await user.click(within(line).getByRole('link', { name: 'Open' }));
    const title = await screen.findByRole('textbox', { name: 'Page title' });
    expect(title).toHaveValue('Build it');
    await user.clear(title);
    await user.type(title, 'Ship it');

    await user.click(within(screen.getByRole('tree')).getByText('Tasks'));
    // Straight from the cache: the table is right before the rows have been fetched again.
    expect(await rowTitles()).toEqual(['Write spec', 'Ship it']);
  });

  it('deletes a row after asking', async () => {
    const { user } = renderApp(tasks);

    const line = await within(await grid()).findByRole('row', { name: 'Write spec' });
    await user.click(within(line).getByRole('button', { name: 'Row actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete “Write spec”?');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect(await rowTitles()).toEqual(['Build it']));
    expect((await commands.listRows('db')).map((entry) => entry.title)).toEqual(['Build it']);
  });

  it('adds, renames, retypes and deletes properties from the header', async () => {
    const { user } = renderApp(tasks);
    await waitFor(async () => expect(await headerNames()).toHaveLength(6));

    await user.click(screen.getByRole('button', { name: 'Add a property' }));
    await user.click(await screen.findByRole('button', { name: 'Number' }));
    const name = await screen.findByRole('textbox', { name: 'Property name' });
    await user.clear(name);
    await user.type(name, 'Cost{Enter}');
    await waitFor(async () => expect((await headerNames()).at(-2)).toBe('Cost'));

    await user.click(within(await grid()).getByRole('button', { name: 'Notes' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const rename = await screen.findByRole('textbox', { name: 'Property name' });
    await user.clear(rename);
    await user.type(rename, 'Comments{Enter}');
    await waitFor(async () => expect((await headerNames())[1]).toBe('Comments'));

    // Hours to text: every number is written out.
    await user.click(within(await grid()).getByRole('button', { name: 'Hours' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change type' }));
    // jsdom has no layout for the pointer to travel into the submenu; the keyboard does.
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menuitem', { name: 'Text' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const retype = await screen.findByRole('alertdialog');
    expect(retype).toHaveTextContent('Change “Hours” to Text?');
    expect(retype).toHaveTextContent('Values that cannot be converted are dropped.');
    await user.click(within(retype).getByRole('button', { name: 'Change type' }));
    await waitFor(async () =>
      expect(
        within(await grid())
          .getByRole('columnheader', { name: 'Hours' })
          .querySelector('.lucide-type'),
      ).toBeInTheDocument(),
    );
    expect(await cell('Write spec', 'Hours')).toHaveTextContent('3');

    await user.click(within(await grid()).getByRole('button', { name: 'Due' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete property' }));
    const remove = await screen.findByRole('alertdialog');
    expect(remove).toHaveTextContent('Delete “Due”?');
    await user.click(within(remove).getByRole('button', { name: 'Delete' }));
    await waitFor(async () =>
      expect(await headerNames()).toEqual(['Name', 'Comments', 'Hours', 'Status', 'Cost', '']),
    );
    expect((await commands.listRows('db'))[0].cells.due).toBeUndefined();
  });

  it('renders only the visible rows of a large database and finds the last one', async () => {
    const pages = [database('db', 'Tasks')];
    for (let index = 0; index < 10_000; index += 1) {
      pages.push(row(`r${index}`, `Row ${index + 1}`, 'db', index));
    }
    renderApp({ pages, path: '/page/db' });

    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1));
    expect(within(table).getAllByRole('row').length).toBeLessThan(100);
    expect(table).toHaveAttribute('aria-rowcount', '10001');
  });

  it('shows nothing while the database is loading', async () => {
    // A backend that never answers.
    mockIPC(() => new Promise(() => {}));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <DatabaseView databaseId="db" />
      </QueryClientProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when the rows cannot be loaded', async () => {
    // A backend that does not know the command yet.
    mockIPC(() => {
      throw { kind: 'internal', message: 'unknown command' };
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <DatabaseView databaseId="db" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('The rows could not be loaded.');
  });
});

describe('the views of a database', () => {
  const emptyTable: ViewConfig = {
    version: 1,
    type: 'table',
    filters: [],
    sorts: [],
    properties: [],
    groupBy: null,
  };

  function view(id: string, name: string, position: number, config: ViewConfig = emptyTable): View {
    return { id, databaseId: 'db', name, position, config };
  }

  const withViews = {
    ...tasks,
    pages: [...tasks.pages, row('r3', 'Test it', 'db', 2)],
    cells: { ...tasks.cells, r3: { hours: 2, status: 'todo' } },
    views: [view('v1', 'All', 0), view('v2', 'Board', 1)],
  };

  const tabs = () => screen.findByRole('tablist', { name: 'Views' });
  const tab = async (name: string) => within(await tabs()).findByRole('tab', { name });
  const storedView = async (id: string) =>
    (await commands.loadDatabase('db')).views.find((entry) => entry.id === id);

  /** Opens a menu of the toolbar and returns its panel. */
  async function openMenu(
    user: ReturnType<typeof renderApp>['user'],
    button: RegExp,
    panel: string,
  ) {
    await user.click(await screen.findByRole('button', { name: button }));
    return screen.findByRole('dialog', { name: panel });
  }

  it('shows a tab per view, the first one active, and switching changes the address', async () => {
    const { user, router } = renderApp(withViews);

    expect(await tab('All')).toHaveAttribute('aria-selected', 'true');
    expect(await tab('Board')).toHaveAttribute('aria-selected', 'false');

    await user.click(await tab('Board'));

    expect(await tab('Board')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'v2' }));
    expect(await rowTitles()).toEqual(['Write spec', 'Build it', 'Test it']);
  });

  it('opens the view the address names, else the remembered one, else the first', async () => {
    renderApp({ ...withViews, path: '/page/db?view=v2' });
    expect(await tab('Board')).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem('notiva.activeViews')).toBe(JSON.stringify({ db: 'v2' }));
  });

  it('falls back to the remembered view when the address names one that is gone', async () => {
    window.localStorage.setItem('notiva.activeViews', JSON.stringify({ db: 'v2' }));
    const { router } = renderApp({ ...withViews, path: '/page/db?view=gone' });

    expect(await tab('Board')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'v2' }));
  });

  it('falls back to the first view when the remembered one is gone', async () => {
    window.localStorage.setItem('notiva.activeViews', JSON.stringify({ db: 'gone' }));
    renderApp(withViews);

    expect(await tab('All')).toHaveAttribute('aria-selected', 'true');
  });

  it('filters the table through the filter menu', async () => {
    const { user } = renderApp(withViews);
    await waitFor(async () => expect(await rowTitles()).toHaveLength(3));

    const panel = await openMenu(user, /^Filter/, 'Filters');
    await user.click(within(panel).getByRole('button', { name: 'Add a filter' }));
    await user.click(within(panel).getByRole('button', { name: 'Name' }));
    // The line of a condition is drawn anew when its property changes.
    const condition = () => within(panel).getByRole('group', { name: 'Filter 1' });
    await user.selectOptions(
      within(condition()).getByRole('combobox', { name: 'Property' }),
      'Hours',
    );
    await user.selectOptions(
      within(condition()).getByRole('combobox', { name: 'Condition' }),
      'greaterThan',
    );
    await user.type(within(condition()).getByRole('textbox', { name: 'Value' }), '2.5');

    expect(await rowTitles()).toEqual(['Write spec', 'Build it']);
    expect(screen.getByRole('button', { name: /^Filter/ })).toHaveTextContent('Filter1');

    // A condition that tests for a value needs none.
    await user.selectOptions(
      within(condition()).getByRole('combobox', { name: 'Condition' }),
      'is empty',
    );
    expect(within(condition()).queryByRole('textbox', { name: 'Value' })).toBeNull();
    expect(await rowTitles()).toEqual([]);
    expect(screen.getByText('No rows match the filters')).toBeInTheDocument();

    // A select is filtered by one of its options.
    await user.selectOptions(
      within(condition()).getByRole('combobox', { name: 'Property' }),
      'Status',
    );
    await user.selectOptions(within(condition()).getByRole('combobox', { name: 'Value' }), 'Todo');
    expect(await rowTitles()).toEqual(['Build it', 'Test it']);

    await user.click(within(condition()).getByRole('button', { name: 'Remove filter' }));
    expect(await rowTitles()).toEqual(['Write spec', 'Build it', 'Test it']);
  });

  it('sorts the table through the sort menu, by several properties in order', async () => {
    const { user } = renderApp(withViews);
    await waitFor(async () => expect(await rowTitles()).toHaveLength(3));

    const panel = await openMenu(user, /^Sort/, 'Sorts');
    await user.click(within(panel).getByRole('button', { name: 'Add a sort' }));
    const first = () => within(panel).getByRole('group', { name: 'Sort 1' });
    await user.selectOptions(within(first()).getByRole('combobox', { name: 'Property' }), 'Status');
    expect(await rowTitles()).toEqual(['Build it', 'Test it', 'Write spec']);

    await user.click(within(panel).getByRole('button', { name: 'Add a sort' }));
    const second = () => within(panel).getByRole('group', { name: 'Sort 2' });
    await user.selectOptions(within(second()).getByRole('combobox', { name: 'Property' }), 'Hours');
    expect(await rowTitles()).toEqual(['Test it', 'Build it', 'Write spec']);

    await user.selectOptions(
      within(second()).getByRole('combobox', { name: 'Direction' }),
      'Descending',
    );
    expect(await rowTitles()).toEqual(['Build it', 'Test it', 'Write spec']);

    await user.click(within(first()).getByRole('button', { name: 'Remove sort' }));
    expect(await rowTitles()).toEqual(['Build it', 'Write spec', 'Test it']);
  });

  it('groups the table, counts the rows of each group and collapses one', async () => {
    const { user } = renderApp({
      ...withViews,
      pages: [...withViews.pages, row('r4', 'Plan it', 'db', 3)],
    });
    await waitFor(async () => expect(await rowTitles()).toHaveLength(4));

    const panel = await openMenu(user, /^View settings/, 'View settings');
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Group by' }), 'Status');
    await user.keyboard('{Escape}');

    expect(await rowTitles()).toEqual([
      'Todo',
      'Build it',
      'Test it',
      'Done',
      'Write spec',
      'No Status',
      'Plan it',
    ]);
    expect(await grid()).toHaveAttribute('aria-rowcount', '8');
    // The table keeps one Tab stop, on the first row below the first group's header.
    const tabStops = async () =>
      within(await grid())
        .getAllByRole('gridcell')
        .filter((cell) => cell.getAttribute('tabindex') === '0')
        .map((cell) => cell.textContent);
    expect(await tabStops()).toEqual([expect.stringMatching(/^Build it/)]);

    await user.click(screen.getByRole('button', { name: 'Todo, 2 rows' }));
    expect(await tabStops()).toEqual([expect.stringMatching(/^Write spec/)]);

    expect(screen.getByRole('button', { name: 'Todo, 2 rows' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(await rowTitles()).toEqual(['Todo', 'Done', 'Write spec', 'No Status', 'Plan it']);
    await waitFor(async () =>
      expect((await storedView('v1'))?.config).toMatchObject({
        groupBy: { propertyId: 'status', collapsed: ['todo'] },
      }),
    );
  });

  it('hides a property through the properties menu', async () => {
    const { user } = renderApp(withViews);
    await waitFor(async () =>
      expect(await headerNames()).toEqual(['Name', 'Notes', 'Hours', 'Due', 'Status', '']),
    );

    const panel = await openMenu(user, /^View settings/, 'View settings');
    await user.click(within(panel).getByRole('checkbox', { name: 'Hours' }));

    expect(await headerNames()).toEqual(['Name', 'Notes', 'Due', 'Status', '']);
    expect(within(panel).getByRole('checkbox', { name: 'Hours' })).not.toBeChecked();
    expect(within(panel).queryByRole('checkbox', { name: 'Name' })).toBeNull();

    await user.click(within(panel).getByRole('checkbox', { name: 'Hours' }));
    expect(await headerNames()).toEqual(['Name', 'Notes', 'Hours', 'Due', 'Status', '']);
  });

  it('keeps its own settings per view', async () => {
    const { user } = renderApp(withViews);
    await waitFor(async () => expect(await rowTitles()).toHaveLength(3));

    const panel = await openMenu(user, /^Sort/, 'Sorts');
    await user.click(within(panel).getByRole('button', { name: 'Add a sort' }));
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Property' }), 'Hours');
    await user.keyboard('{Escape}');
    expect(await rowTitles()).toEqual(['Test it', 'Write spec', 'Build it']);

    await user.click(await tab('Board'));
    expect(await rowTitles()).toEqual(['Write spec', 'Build it', 'Test it']);
    await user.click(await tab('All'));
    expect(await rowTitles()).toEqual(['Test it', 'Write spec', 'Build it']);
  });

  it('saves a change after the pause, and at once when another view is shown', async () => {
    const updateView = vi.spyOn(commands, 'updateView');
    renderApp(withViews);
    await waitFor(async () => expect(await rowTitles()).toHaveLength(3));
    const panel = await openMenu(userEvent.setup(), /^Sort/, 'Sorts');
    // From here on, only queries that do not wait: waiting runs on the timers too.
    vi.useFakeTimers();
    // Testing Library lets its own pauses pass on fake timers it recognises as Jest's.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    const user = userEvent.setup({ delay: null });
    const titles = () =>
      within(screen.getByRole('grid'))
        .getAllByRole('row')
        .slice(1)
        .map((line) => line.getAttribute('aria-label'));
    const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
    try {
      await user.click(within(panel).getByRole('button', { name: 'Add a sort' }));
      await settle();
      expect(titles()).toEqual(['Build it', 'Test it', 'Write spec']);
      expect(updateView).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(VIEW_SAVE_DELAY - 10));
      expect(updateView).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(10));
      expect(updateView).toHaveBeenCalledTimes(1);
      expect(updateView).toHaveBeenLastCalledWith('v1', null, {
        ...emptyTable,
        sorts: [{ propertyId: 'title', direction: 'asc' }],
      });

      await user.selectOptions(within(panel).getByRole('combobox', { name: 'Direction' }), 'desc');
      await user.keyboard('{Escape}');
      await settle();
      expect(updateView).toHaveBeenCalledTimes(1);
      await user.click(within(screen.getByRole('tablist')).getByRole('tab', { name: 'Board' }));
      await settle();
      // No pause: the change is on its way as soon as the other view shows.
      expect(updateView).toHaveBeenCalledTimes(2);
      expect(updateView).toHaveBeenLastCalledWith('v1', null, {
        ...emptyTable,
        sorts: [{ propertyId: 'title', direction: 'desc' }],
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
    await waitFor(async () =>
      expect((await storedView('v1'))?.config.sorts).toEqual([
        { propertyId: 'title', direction: 'desc' },
      ]),
    );
  });

  it('adds, renames and deletes views through the tabs', async () => {
    const { user, router } = renderApp(withViews);
    await tab('All');

    await user.click(screen.getByRole('button', { name: 'Add a view' }));
    // Only the types this version can show are offered.
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Table']);
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    await waitFor(async () => expect(await tab('Table')).toHaveAttribute('aria-selected', 'true'));
    const created = (await commands.loadDatabase('db')).views[2]!;
    expect(created).toMatchObject({ name: 'Table', config: emptyTable });
    await waitFor(() => expect(router.state.location.search).toEqual({ view: created.id }));

    await user.click(screen.getByRole('button', { name: 'Actions for “Table”' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'View name' });
    await user.clear(input);
    await user.type(input, 'Open tasks{Enter}');
    expect(await tab('Open tasks')).toBeInTheDocument();
    await waitFor(async () => expect((await storedView(created.id))?.name).toBe('Open tasks'));

    await user.click(screen.getByRole('button', { name: 'Actions for “Open tasks”' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete view' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete the view “Open tasks”?');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(async () =>
      expect(
        within(await tabs())
          .getAllByRole('tab')
          .map((entry) => entry.textContent),
      ).toEqual(['All', 'Board']),
    );
    expect(await tab('Board')).toHaveAttribute('aria-selected', 'true');
    expect((await commands.loadDatabase('db')).views.map((entry) => entry.id)).toEqual([
      'v1',
      'v2',
    ]);
  });

  it('cannot delete the last view', async () => {
    const { user } = renderApp({ ...withViews, views: [view('v1', 'All', 0)] });

    await user.click(await screen.findByRole('button', { name: 'Actions for “All”' }));

    expect(await screen.findByRole('menuitem', { name: 'Delete view' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('A database keeps at least one view.')).toBeInTheDocument();
  });

  it('shows a notice for a view type this version cannot show yet', async () => {
    const kanban: ViewConfig = {
      version: 1,
      type: 'kanban',
      filters: [],
      sorts: [],
      properties: [],
      groupPropertyId: 'status',
      hiddenGroups: [],
    };
    renderApp({
      ...withViews,
      views: [view('v1', 'All', 0), view('k', 'Board', 1, kanban)],
      path: '/page/db?view=k',
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'This kind of view cannot be shown in this version yet.',
    );
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('group', { name: 'View toolbar' })).toBeNull();
  });

  it('keeps a row added with "New" in sight although it does not pass the filters', async () => {
    const config: ViewConfig = {
      ...emptyTable,
      filters: [{ propertyId: 'hours', operator: 'greaterThan', value: 1 }],
    };
    const { user } = renderApp({ ...withViews, views: [view('v1', 'All', 0, config)] });
    await waitFor(async () => expect(await rowTitles()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Fresh{Enter}');

    expect(await rowTitles()).toEqual(['Write spec', 'Build it', 'Test it', 'Fresh']);
  });
});
