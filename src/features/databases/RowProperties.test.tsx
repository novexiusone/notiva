import { screen, waitFor, within } from '@testing-library/react';
import { commands, type Property, type PropertyType, type SelectOption } from '@/lib/commands';
import { database, page, renderApp, row } from '@/test/renderApp';

// The path in the top bar links the database as well; this is the link above the title.
const inArticle = () => within(screen.getByRole('article'));

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
  // Out of order on purpose: the list follows `position`.
  properties: [
    { ...property('status', 'Status', 'select', 3), options: [todo, done] },
    property('notes', 'Notes', 'text', 0),
    property('due', 'Due', 'date', 2),
    property('hours', 'Hours', 'number', 1),
  ],
  cells: {
    r1: { notes: 'First draft', hours: 3, due: '2026-11-14', status: 'done' },
    r2: { hours: 8 },
  },
  path: '/page/r1',
};

const list = () => screen.findByRole('group', { name: 'Properties' });

/** The value of a property, by the property's name. */
async function value(name: string) {
  return within(await list()).findByRole('button', { name: new RegExp(`^${name}( |$)`) });
}

/** The property names and their values as they are shown, in order. */
async function lines() {
  const terms = within(await list()).getAllByRole('term');
  return terms.map((term) => [term.textContent, term.nextElementSibling?.textContent]);
}

async function storedCells(rowId: string) {
  return (await commands.listRows('db')).find((entry) => entry.id === rowId)?.cells;
}

afterEach(() => vi.restoreAllMocks());

describe('the page of a row', () => {
  it('lists every property in order with its value, between the title and the content', async () => {
    renderApp(tasks);

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Write spec');
    await waitFor(async () =>
      expect(await lines()).toEqual([
        ['Notes', 'First draft'],
        ['Hours', '3'],
        ['Due', 'Nov 14, 2026'],
        ['Status', 'Done'],
      ]),
    );
    expect(await value('Status')).toHaveAccessibleName('Status Done');
    // Title, then the properties, then the content.
    const title = screen.getByRole('textbox', { name: 'Page title' });
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull());
    const editor = document.querySelector('.bn-editor')!;
    const group = await list();
    expect(title.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a quiet placeholder for an empty value', async () => {
    renderApp({ ...tasks, path: '/page/r2' });

    await waitFor(async () =>
      expect(await lines()).toEqual([
        ['Notes', 'Empty'],
        ['Hours', '8'],
        ['Due', 'Empty'],
        ['Status', 'Empty'],
      ]),
    );
    expect(await value('Notes')).toHaveAccessibleName('Notes Empty');
  });

  it('leaves out a property whose type has no editor yet, without breaking the page', async () => {
    renderApp({
      ...tasks,
      properties: [
        ...tasks.properties,
        { ...property('link', 'Linked', 'relation', 1.5), targetId: 'db' },
      ],
      cells: { ...tasks.cells, r1: { ...tasks.cells.r1, link: ['r2'] } },
    });

    await waitFor(async () =>
      expect((await lines()).map(([name]) => name)).toEqual(['Notes', 'Hours', 'Due', 'Status']),
    );
  });

  it('links back to its database by name, without a view of its own', async () => {
    const { user, router } = renderApp(tasks);

    const link = await within(await screen.findByRole('article')).findByRole('link', {
      name: 'Tasks',
    });
    expect(link).toHaveAttribute('href', '/page/db');
    expect(link.querySelector('.lucide-table')).toBeInTheDocument();

    await user.click(link);
    expect(await screen.findByRole('grid', { name: 'Tasks' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/page/db');
  });

  it('names an untitled database "Untitled" in the link', async () => {
    renderApp({ ...tasks, pages: [database('db', ''), row('r1', 'Write spec', 'db')] });

    expect(
      await within(await screen.findByRole('article')).findByRole('link', { name: 'Untitled' }),
    ).toHaveAttribute('href', '/page/db');
  });

  it('keeps cells editable when only the row content is locked', async () => {
    const { user } = renderApp({
      ...tasks,
      pages: tasks.pages.map((entry) =>
        entry.id === 'r1' ? { ...entry, lock: 'content' as const } : entry,
      ),
    });

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveAttribute('readonly');
    await waitFor(() =>
      expect(document.querySelector('.bn-editor')).toHaveAttribute('contenteditable', 'false'),
    );
    await user.click(await value('Notes'));
    const input = await screen.findByRole('textbox', { name: 'Notes' });
    await user.clear(input);
    await user.type(input, 'Still editable{Enter}');

    await waitFor(async () => expect((await storedCells('r1'))?.notes).toBe('Still editable'));
  });

  it('makes row properties read-only when the row is locked at everything', async () => {
    renderApp({
      ...tasks,
      pages: tasks.pages.map((entry) =>
        entry.id === 'r1' ? { ...entry, lock: 'all' as const } : entry,
      ),
    });

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveAttribute('readonly');
    const properties = await list();
    await waitFor(() => expect(within(properties).getByText('First draft')).toBeInTheDocument());
    expect(within(properties).queryByRole('button', { name: /^Notes/ })).toBeNull();
  });

  it('makes row content and properties read-only when its database is locked at everything', async () => {
    renderApp({
      ...tasks,
      pages: tasks.pages.map((entry) =>
        entry.id === 'db' ? { ...entry, lock: 'all' as const } : entry,
      ),
    });

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveAttribute('readonly');
    await waitFor(() =>
      expect(document.querySelector('.bn-editor')).toHaveAttribute('contenteditable', 'false'),
    );
    const properties = await list();
    await waitFor(() => expect(within(properties).getByText('First draft')).toBeInTheDocument());
    expect(within(properties).queryByRole('button', { name: /^Notes/ })).toBeNull();
  });

  it('edits a text value in place and saves it on Enter', async () => {
    const { user } = renderApp(tasks);

    await user.click(await value('Notes'));
    const input = await screen.findByRole('textbox', { name: 'Notes' });
    expect(input).toHaveValue('First draft');
    await user.clear(input);
    await user.type(input, 'Second draft{Enter}');

    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(await value('Notes')).toHaveTextContent('Second draft');
    await waitFor(async () => expect((await storedCells('r1'))?.notes).toBe('Second draft'));
  });

  it('saves a text value when the field is left, and empties it when the text is cleared', async () => {
    const { user } = renderApp(tasks);

    await user.click(await value('Notes'));
    await user.clear(await screen.findByRole('textbox', { name: 'Notes' }));
    await user.click(screen.getByRole('textbox', { name: 'Page title' }));

    expect(await value('Notes')).toHaveAccessibleName('Notes Empty');
    await waitFor(async () => expect((await storedCells('r1'))?.notes).toBeUndefined());
  });

  it('edits a number and refuses what is not one', async () => {
    const setCell = vi.spyOn(commands, 'setCell');
    const { user } = renderApp(tasks);

    await user.click(await value('Hours'));
    const input = await screen.findByRole('textbox', { name: 'Hours' });
    await user.clear(input);
    await user.type(input, 'many{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(setCell).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '4.5{Enter}');
    expect(await value('Hours')).toHaveTextContent('4.5');
    await waitFor(async () => expect((await storedCells('r1'))?.hours).toBe(4.5));
  });

  it('picks a date in the calendar and clears it', async () => {
    const { user } = renderApp(tasks);

    await user.click(await value('Due'));
    let calendar = await screen.findByRole('dialog', { name: 'Due' });
    await user.click(within(calendar).getByRole('button', { name: /November 20th, 2026/ }));
    expect(await value('Due')).toHaveTextContent('Nov 20, 2026');
    await waitFor(async () => expect((await storedCells('r1'))?.due).toBe('2026-11-20'));

    await user.click(await value('Due'));
    calendar = await screen.findByRole('dialog', { name: 'Due' });
    await user.click(within(calendar).getByRole('button', { name: 'Clear' }));
    expect(await value('Due')).toHaveAccessibleName('Due Empty');
    await waitFor(async () => expect((await storedCells('r1'))?.due).toBeUndefined());
  });

  it('sets a date on an empty value', async () => {
    const { user } = renderApp({ ...tasks, path: '/page/r2' });

    await user.click(await value('Due'));
    const calendar = await screen.findByRole('dialog', { name: 'Due' });
    await user.click(within(calendar).getByRole('button', { name: /^Today/ }));
    await waitFor(async () => expect((await storedCells('r2'))?.due).toMatch(/^\d{4}-\d\d-\d\d$/));
  });

  it('chooses, creates and clears a select option', async () => {
    const { user } = renderApp(tasks);

    await user.click(await value('Status'));
    let popover = await screen.findByRole('dialog', { name: 'Status' });
    await user.click(within(popover).getByRole('option', { name: 'Todo' }));
    expect(await value('Status')).toHaveAccessibleName('Status Todo');
    await waitFor(async () => expect((await storedCells('r1'))?.status).toBe('todo'));

    await user.click(await value('Status'));
    popover = await screen.findByRole('dialog', { name: 'Status' });
    await user.type(within(popover).getByRole('combobox'), 'Blocked');
    await user.click(within(popover).getByRole('option', { name: 'Create “Blocked”' }));
    expect(await value('Status')).toHaveAccessibleName('Status Blocked');
    await waitFor(async () => {
      const status = (await commands.loadDatabase('db')).properties.find(
        (entry) => entry.id === 'status',
      );
      const blocked = status?.options.find((option) => option.name === 'Blocked');
      expect(blocked).toBeDefined();
      expect((await storedCells('r1'))?.status).toBe(blocked?.id);
    });

    await user.click(await value('Status'));
    popover = await screen.findByRole('dialog', { name: 'Status' });
    await user.click(within(popover).getByRole('option', { name: 'Clear' }));
    expect(await value('Status')).toHaveAccessibleName('Status Empty');
    await waitFor(async () => expect((await storedCells('r1'))?.status).toBeUndefined());
  });

  it('leaves a value as it was on Escape', async () => {
    const setCell = vi.spyOn(commands, 'setCell');
    const { user } = renderApp(tasks);

    await user.click(await value('Notes'));
    await user.type(await screen.findByRole('textbox', { name: 'Notes' }), ' and more{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(await value('Notes')).toHaveAccessibleName('Notes First draft');

    await user.click(await value('Status'));
    await screen.findByRole('dialog', { name: 'Status' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status' })).toBeNull());
    expect(await value('Status')).toHaveAccessibleName('Status Done');

    expect(setCell).not.toHaveBeenCalled();
  });

  it('saves nothing when the value did not change', async () => {
    const setCell = vi.spyOn(commands, 'setCell');
    const { user } = renderApp(tasks);

    await user.click(await value('Notes'));
    await user.keyboard('{Enter}');
    await user.click(await value('Hours'));
    await user.keyboard('{Enter}');
    await user.click(await value('Due'));
    const calendar = await screen.findByRole('dialog', { name: 'Due' });
    await user.click(within(calendar).getByRole('button', { name: /November 14th, 2026/ }));

    expect(await value('Due')).toHaveAccessibleName('Due Nov 14, 2026');
    expect(setCell).not.toHaveBeenCalled();
  });

  it('is reached and edited with the keyboard, and gives the focus back to the value', async () => {
    const { user } = renderApp(tasks);

    const title = await screen.findByRole('textbox', { name: 'Page title' });
    await list();
    title.focus();
    await user.tab();
    expect(await value('Notes')).toHaveFocus();
    await user.tab();
    expect(await value('Hours')).toHaveFocus();

    await user.keyboard('{Enter}');
    const input = await screen.findByRole('textbox', { name: 'Hours' });
    expect(input).toHaveFocus();
    await user.keyboard('{Control>}a{/Control}12{Enter}');
    expect(await value('Hours')).toHaveAccessibleName('Hours 12');
    expect(await value('Hours')).toHaveFocus();

    // A popover editor gives the focus back as well.
    await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Due' });
    await user.keyboard('{Escape}');
    await waitFor(async () => expect(await value('Due')).toHaveFocus());
    await waitFor(async () => expect((await storedCells('r1'))?.hours).toBe(12));
  });

  it('shares its values with the table, both ways, without a reload', async () => {
    const listRows = vi.spyOn(commands, 'listRows');
    const { user } = renderApp(tasks);

    await user.click(await value('Notes'));
    const input = await screen.findByRole('textbox', { name: 'Notes' });
    await user.clear(input);
    await user.type(input, 'From the page{Enter}');

    await user.click(inArticle().getByRole('link', { name: 'Tasks' }));
    const grid = await screen.findByRole('grid', { name: 'Tasks' });
    const line = await within(grid).findByRole('row', { name: 'Write spec' });
    expect(line).toHaveTextContent('From the page');

    // And back: a value changed in the table is on the row's page.
    const notes = within(line).getAllByRole('gridcell')[1];
    await user.click(notes);
    const cellInput = await within(grid).findByRole('textbox', { name: 'Notes' });
    await user.clear(cellInput);
    await user.type(cellInput, 'From the table{Enter}');
    await user.click(within(line).getByRole('link', { name: 'Open' }));
    expect(await value('Notes')).toHaveAccessibleName('Notes From the table');
    // One query for the rows of the database, never one for a single row.
    expect(listRows.mock.calls.every(([id]) => id === 'db')).toBe(true);
  });

  it('follows a property that was renamed or deleted elsewhere', async () => {
    const { user } = renderApp(tasks);
    await value('Notes');

    await user.click(inArticle().getByRole('link', { name: 'Tasks' }));
    const grid = await screen.findByRole('grid', { name: 'Tasks' });
    await user.click(within(grid).getByRole('button', { name: 'Notes' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const rename = await screen.findByRole('textbox', { name: 'Property name' });
    await user.clear(rename);
    await user.type(rename, 'Comments{Enter}');
    await user.click(within(grid).getByRole('button', { name: 'Due' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete property' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(within(grid).queryByRole('button', { name: 'Due' })).not.toBeInTheDocument(),
    );

    const line = await within(grid).findByRole('row', { name: 'Write spec' });
    await user.click(within(line).getByRole('link', { name: 'Open' }));
    await waitFor(async () =>
      expect(await lines()).toEqual([
        ['Comments', 'First draft'],
        ['Hours', '3'],
        ['Status', 'Done'],
      ]),
    );
  });

  it('shows a notice when the properties cannot be loaded, and the page still works', async () => {
    vi.spyOn(commands, 'listRows').mockRejectedValue({ kind: 'internal', message: 'broken' });
    const { user } = renderApp(tasks);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The properties could not be loaded.',
    );
    expect(screen.queryByRole('group', { name: 'Properties' })).toBeNull();
    expect(inArticle().getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull());
    const title = screen.getByRole('textbox', { name: 'Page title' });
    await user.type(title, ' now');
    await waitFor(async () =>
      expect((await commands.listPages()).find((entry) => entry.id === 'r1')?.title).toBe(
        'Write spec now',
      ),
    );
  });

  it('shows the names while the rows load and the values once they are there', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const listRows = commands.listRows;
    vi.spyOn(commands, 'listRows').mockImplementation(async (...args) => {
      await gate;
      return listRows(...args);
    });
    renderApp(tasks);

    const group = await list();
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(
      within(group)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Notes', 'Hours', 'Due', 'Status']);
    expect(within(group).queryByRole('button')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveValue('Write spec');

    release();
    expect(await value('Notes')).toHaveAccessibleName('Notes First draft');
    expect(group).not.toHaveAttribute('aria-busy');
  });

  it('does not break when the row is not among the loaded rows', async () => {
    vi.spyOn(commands, 'listRows').mockResolvedValue([]);
    renderApp(tasks);

    expect(
      await within(await screen.findByRole('article')).findByRole('link', { name: 'Tasks' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull());
    expect(screen.queryByRole('group', { name: 'Properties' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('pages that are not rows', () => {
  it('shows no properties and no link on an ordinary page, and asks for no rows', async () => {
    const listRows = vi.spyOn(commands, 'listRows');
    const loadDatabase = vi.spyOn(commands, 'loadDatabase');
    renderApp({ ...tasks, path: '/page/other' });

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Other');
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull());
    expect(screen.queryByRole('group', { name: 'Properties' })).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('link')).toBeNull();
    expect(listRows).not.toHaveBeenCalled();
    expect(loadDatabase).not.toHaveBeenCalled();
  });

  it('shows no properties and no link on a database page', async () => {
    const listRows = vi.spyOn(commands, 'listRows');
    renderApp({ ...tasks, path: '/page/db' });

    await screen.findByRole('grid', { name: 'Tasks' });
    expect(screen.queryByRole('group', { name: 'Properties' })).toBeNull();
    expect(inArticle().queryByRole('link', { name: 'Tasks' })).toBeNull();
    // The table's own query, and nothing more.
    expect(listRows).toHaveBeenCalledTimes(1);
  });
});
