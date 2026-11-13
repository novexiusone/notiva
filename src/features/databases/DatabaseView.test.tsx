import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockIPC } from '@tauri-apps/api/mocks';
import { render, screen, waitFor, within } from '@testing-library/react';
import { DatabaseView } from '@/features/databases/DatabaseView';
import { commands } from '@/lib/commands';
import { database, page, renderApp, row } from '@/test/renderApp';

const tasks = [
  database('db', 'Tasks'),
  row('r1', 'Write spec', 'db', 0),
  row('r2', 'Build it', 'db', 1),
  page('other', 'Other', null, 1),
];

function rows() {
  return screen.findByRole('region', { name: 'Rows' });
}

async function rowTitles() {
  return within(await rows())
    .queryAllByRole('link')
    .map((link) => link.textContent);
}

describe('a database page', () => {
  it('shows its title and its rows instead of the editor and the backlinks', async () => {
    renderApp({ pages: tasks, path: '/page/db' });

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Tasks');
    await waitFor(async () => expect(await rowTitles()).toEqual(['Write spec', 'Build it']));
    expect(document.querySelector('.bn-editor')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Backlinks' })).toBeNull();
  });

  it('keeps the editor for an ordinary page and for a row', async () => {
    renderApp({ pages: tasks, path: '/page/r1' });

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Write spec');
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull());
    expect(screen.queryByRole('region', { name: 'Rows' })).toBeNull();
  });

  it('says so when there are no rows, also without any view', async () => {
    // Seeded without views: the shell must not rely on one.
    renderApp({ pages: [database('db', 'Tasks')], path: '/page/db' });

    expect(await within(await rows()).findByText('No rows yet')).toBeInTheDocument();
    expect((await commands.loadDatabase('db')).views).toEqual([]);
  });

  it('adds a row with "New", in the list but not in the page tree', async () => {
    const { user } = renderApp({ pages: tasks, path: '/page/db' });
    await waitFor(async () => expect(await rowTitles()).toHaveLength(2));

    await user.click(within(await rows()).getByRole('button', { name: 'New' }));

    await waitFor(async () =>
      expect(await rowTitles()).toEqual(['Write spec', 'Build it', 'Untitled']),
    );
    expect((await commands.listRows('db')).map((entry) => entry.title)).toEqual([
      'Write spec',
      'Build it',
      '',
    ]);
    expect(within(screen.getByRole('tree')).getAllByRole('treeitem')).toHaveLength(2);
    expect(within(screen.getByRole('tree')).queryByText('Untitled')).toBeNull();
  });

  it('opens a row as a page, and the list follows when the row is renamed', async () => {
    const { user } = renderApp({ pages: tasks, path: '/page/db' });

    await user.click(await within(await rows()).findByRole('link', { name: 'Build it' }));
    const title = await screen.findByRole('textbox', { name: 'Page title' });
    expect(title).toHaveValue('Build it');
    await user.clear(title);
    await user.type(title, 'Ship it');

    await user.click(within(screen.getByRole('tree')).getByText('Tasks'));
    // Straight from the cache: the list is right before the rows have been fetched again.
    expect(await rowTitles()).toEqual(['Write spec', 'Ship it']);
    await waitFor(async () =>
      expect((await commands.listRows('db')).map((entry) => entry.title)).toEqual([
        'Write spec',
        'Ship it',
      ]),
    );
  });

  it('follows its title in the page tree while it is typed', async () => {
    const { user } = renderApp({ pages: tasks, path: '/page/db' });

    await user.type(await screen.findByRole('textbox', { name: 'Page title' }), ' 2026');

    expect(await within(screen.getByRole('tree')).findByText('Tasks 2026')).toBeInTheDocument();
    await waitFor(async () =>
      expect((await commands.loadDatabase('db')).page.title).toBe('Tasks 2026'),
    );
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
