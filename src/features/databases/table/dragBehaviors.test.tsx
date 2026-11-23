import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { commands, type PageLock, type ViewConfig } from '@/lib/commands';
import { database, page, renderApp, row } from '@/test/renderApp';

const emptyTable: ViewConfig = {
  version: 1,
  type: 'table',
  filters: [],
  sorts: [],
  properties: [],
  groupBy: null,
};

function seed({
  config = emptyTable,
  databaseLock = 'none',
  rowLock = 'none',
}: { config?: ViewConfig; databaseLock?: PageLock; rowLock?: PageLock } = {}) {
  return {
    pages: [
      { ...database('db', 'Tasks'), lock: databaseLock },
      { ...row('one', 'Write spec', 'db', 0), lock: rowLock },
      row('two', 'Build it', 'db', 1),
      page('other', 'Other', null, 1),
    ],
    properties: [
      {
        id: 'notes',
        databaseId: 'db',
        name: 'Notes',
        type: 'text' as const,
        position: 0,
        options: [],
        targetId: null,
      },
    ],
    views: [{ id: 'view', databaseId: 'db', name: 'Table', position: 0, config }],
    path: '/page/db',
  };
}

describe('table drag affordances', () => {
  it('offers row handles only without a sort', async () => {
    renderApp(seed());
    expect(await screen.findByRole('button', { name: 'Drag Write spec' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag Build it' })).toBeInTheDocument();
    cleanup();

    renderApp(
      seed({
        config: { ...emptyTable, sorts: [{ propertyId: 'title', direction: 'asc' }] },
      }),
    );
    await screen.findByRole('grid', { name: 'Tasks' });
    expect(
      screen.queryByRole('button', { name: /^Drag (Write spec|Build it)$/ }),
    ).not.toBeInTheDocument();
  });

  it('offers no row move for a locked row or database', async () => {
    renderApp(seed({ rowLock: 'content' }));
    await screen.findByRole('grid', { name: 'Tasks' });
    expect(screen.queryByRole('button', { name: 'Drag Write spec' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag Build it' })).toBeInTheDocument();
    cleanup();

    renderApp(seed({ databaseLock: 'all' }));
    await screen.findByRole('grid', { name: 'Tasks' });
    expect(screen.queryByRole('button', { name: /^Drag / })).not.toBeInTheDocument();
  });

  it('resizes a column with the keyboard and stores its width in the view', async () => {
    renderApp(seed());
    const user = userEvent.setup();
    const resize = await screen.findByRole('separator', { name: 'Resize Notes column' });

    resize.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(async () => {
      const stored = (await commands.loadDatabase('db')).views[0]!.config;
      expect(stored.properties).toContainEqual({ propertyId: 'notes', visible: true, width: 210 });
    });
  });
});
