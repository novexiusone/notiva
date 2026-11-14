import { screen, waitFor, within } from '@testing-library/react';
import { database, page, renderApp, row } from '@/test/renderApp';

function tree() {
  return screen.getByRole('tree');
}

/** The row of the page tree that shows `title`. */
async function treeRow(title: string) {
  const label = await within(await screen.findByRole('tree')).findByText(title);
  return label.closest<HTMLElement>('[role="treeitem"]')!;
}

const tasks = [
  page('a', 'Alpha'),
  database('db', 'Tasks', 'a'),
  row('r1', 'Write spec', 'db', 0),
  row('r2', 'Build it', 'db', 1),
  page('r1x', 'Notes below a row', 'r1'),
];

describe('databases in the page tree', () => {
  it('creates a database from the menu of the header, opens it and focuses its title', async () => {
    const { user } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'More to create' }));
    await user.click(await screen.findByRole('menuitem', { name: 'New database' }));

    const title = await screen.findByRole('textbox', { name: 'Page title' });
    await waitFor(() => expect(title).toHaveFocus());
    expect(await screen.findByRole('region', { name: 'Rows' })).toBeInTheDocument();
    const created = await treeRow('Untitled');
    expect(created).toHaveAttribute('aria-level', '1');
    expect(created.querySelector('.lucide-table')).toBeInTheDocument();
  });

  it('adds a database below a page from the menu of its row and expands the row', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')] });
    const parent = await treeRow('Alpha');

    await user.click(within(parent).getByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add database' }));
    const title = await screen.findByRole('textbox', { name: 'Page title' });
    await waitFor(() => expect(title).toHaveFocus());
    await user.type(title, 'Tasks');

    const created = await treeRow('Tasks');
    expect(created).toHaveAttribute('aria-level', '2');
    expect(created.querySelector('.lucide-table')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Rows' })).toBeInTheDocument();
  });

  it('gives a database a table icon and neither a + nor a database of its own', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha'), database('db', 'Tasks', null, 1)] });
    const ordinary = await treeRow('Alpha');
    const tasksRow = await treeRow('Tasks');

    expect(ordinary.querySelector('.lucide-table')).not.toBeInTheDocument();
    expect(within(ordinary).getByRole('button', { name: 'Add a subpage' })).toBeInTheDocument();
    expect(tasksRow.querySelector('.lucide-table')).toBeInTheDocument();
    expect(within(tasksRow).queryByRole('button', { name: 'Add a subpage' })).toBeNull();

    await user.click(within(tasksRow).getByRole('button', { name: 'Page actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Add database' })).toBeNull();
  });

  it('hides the rows of a database and everything below them', async () => {
    const { user } = renderApp({ pages: tasks });
    await user.click(within(await treeRow('Alpha')).getByRole('button', { name: 'Expand' }));
    const tasksRow = await treeRow('Tasks');

    expect(within(tree()).getAllByRole('treeitem')).toHaveLength(2);
    expect(within(tasksRow).queryByRole('button', { name: /Expand|Collapse/ })).toBeNull();
    expect(within(tree()).queryByText('Write spec')).toBeNull();
    expect(within(tree()).queryByText('Notes below a row')).toBeNull();
  });

  it('says there are no pages when there is nothing to show', async () => {
    renderApp();

    expect(await screen.findByText('No pages yet')).toBeInTheDocument();
  });

  it('names the rows that go with a deleted database', async () => {
    const { user } = renderApp({
      pages: [database('db', 'Tasks'), row('r1', 'One', 'db', 0), row('r2', 'Two', 'db', 1)],
      path: '/page/r2',
    });

    await user.click(within(await treeRow('Tasks')).getByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete “Tasks”?');
    expect(dialog).toHaveTextContent('This also deletes 2 rows. This cannot be undone.');

    // The open page is one of the rows, so it goes too.
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(await screen.findByText('No pages yet')).toBeInTheDocument();
  });

  it('names one row in the singular and no rows not at all', async () => {
    const { user } = renderApp({
      pages: [database('db', 'Tasks'), row('r1', 'One', 'db'), database('empty', 'Empty', null, 1)],
    });

    await user.click(within(await treeRow('Tasks')).getByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('This also deletes 1 row. This cannot be undone.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await user.click(within(await treeRow('Empty')).getByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete “Empty”?This cannot be undone.');
  });

  it('names subpages and rows when a page with a database is deleted', async () => {
    const { user } = renderApp({ pages: tasks });

    await user.click(within(await treeRow('Alpha')).getByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    // The database and the page below a row are subpages; the rows are counted as rows.
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'This also deletes 2 subpages and 2 rows. This cannot be undone.',
    );
  });
});
