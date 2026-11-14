import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockIPC } from '@tauri-apps/api/mocks';
import { render, screen, waitFor, within } from '@testing-library/react';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { commands, type Property, type PropertyType, type SelectOption } from '@/lib/commands';
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
