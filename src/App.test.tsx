import { screen, waitFor, within } from '@testing-library/react';
import { page, renderApp } from '@/test/renderApp';

/** The page tree, once the app has rendered and the pages have loaded. */
function tree() {
  return screen.getByRole('tree');
}

async function loadedTree() {
  return screen.findByRole('tree');
}

describe('sidebar', () => {
  it('shows search, home, settings and the app version', async () => {
    renderApp();

    expect(await screen.findByRole('button', { name: /Search/ })).toHaveTextContent('⌘K');
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByText('v0.0.0-fake')).toBeInTheDocument();
  });

  it('says so when there are no pages', async () => {
    renderApp();

    expect(await screen.findByText('No pages yet')).toBeInTheDocument();
  });
});

describe('pages', () => {
  it('creates a page, opens it and focuses its title', async () => {
    const { user } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'New page' }));

    const title = await screen.findByRole('textbox', { name: 'Page title' });
    expect(title).toHaveFocus();
    expect(within(tree()).getByText('Untitled')).toBeInTheDocument();
  });

  it('shows the title in the tree while it is typed', async () => {
    const { user } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'New page' }));

    await user.type(await screen.findByRole('textbox', { name: 'Page title' }), 'Reading list');

    expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveValue('Reading list');
    expect(await within(tree()).findByText('Reading list')).toBeInTheDocument();
  });

  it('opens a page from the tree', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha'), page('b', 'Beta', null, 1)] });

    await user.click(await within(await loadedTree()).findByText('Beta'));

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Beta');
  });

  it('adds a subpage below its parent and expands the parent', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')] });
    await within(await loadedTree()).findByText('Alpha');

    await user.click(screen.getByRole('button', { name: 'Add a subpage' }));
    await user.type(await screen.findByRole('textbox', { name: 'Page title' }), 'Child');

    const child = (await within(tree()).findByText('Child')).closest('[role="treeitem"]');
    expect(child).toHaveAttribute('aria-level', '2');
  });

  it('renames a page from the tree', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')] });
    await within(await loadedTree()).findByText('Alpha');

    await user.click(screen.getByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await within(tree()).findByRole('textbox', { name: 'Page title' });
    await user.clear(input);
    await user.type(input, 'Omega{Enter}');

    expect(await within(tree()).findByText('Omega')).toBeInTheDocument();
    expect(within(tree()).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('asks before deleting and names the subpages that go with it', async () => {
    const { user } = renderApp({
      pages: [page('a', 'Alpha'), page('a1', 'Child', 'a'), page('b', 'Beta', null, 1)],
    });
    await within(await loadedTree()).findByText('Alpha');

    await user.click(screen.getAllByRole('button', { name: 'Page actions' })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete “Alpha”?');
    expect(dialog).toHaveTextContent('This also deletes 1 subpage.');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(tree()).getByText('Alpha')).toBeInTheDocument();
  });

  it('deletes a page and returns home when the open page is gone', async () => {
    const { user } = renderApp({
      pages: [page('a', 'Alpha'), page('a1', 'Child', 'a'), page('b', 'Beta', null, 1)],
      path: '/page/a1',
    });
    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Child');

    await user.click(screen.getAllByRole('button', { name: 'Page actions' })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    await waitFor(() => expect(within(tree()).queryByText('Alpha')).not.toBeInTheDocument());
    expect(within(tree()).getByText('Beta')).toBeInTheDocument();
  });

  it('goes home when the requested page does not exist', async () => {
    renderApp({ pages: [page('a', 'Alpha')], path: '/page/missing' });

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});
