import { screen, waitFor, within } from '@testing-library/react';
import { commands, type ViewConfig } from '@/lib/commands';
import { database, renderApp, row } from '@/test/renderApp';

const table: ViewConfig = {
  version: 1,
  type: 'table',
  filters: [],
  sorts: [],
  properties: [],
  groupBy: null,
};

const calendar: ViewConfig = {
  version: 1,
  type: 'calendar',
  filters: [],
  sorts: [],
  properties: [],
  datePropertyId: 'due',
};

function seed(config: ViewConfig = calendar) {
  return {
    pages: [
      database('db', 'Tasks'),
      row('r1', 'Write spec', 'db', 0),
      row('r2', 'No date', 'db', 1),
    ],
    properties: [
      ...['Due', 'Start'].map((name, position) => ({
        id: name.toLowerCase(),
        databaseId: 'db',
        name,
        type: 'date' as const,
        position,
        options: [],
        targetId: null,
      })),
    ],
    cells: { r1: { due: '2026-11-14' } },
    views: [
      { id: 'v1', databaseId: 'db', name: 'All', position: 0, config: table },
      { id: 'v2', databaseId: 'db', name: 'Calendar', position: 1, config },
    ],
    path: '/page/db?view=v2',
  };
}

describe('CalendarView', () => {
  it('shows a localized month with dated rows and the number left without a date', async () => {
    renderApp(seed());

    const grid = await screen.findByRole('grid', { name: 'November 2026' });
    expect(within(grid).getByRole('link', { name: 'Write spec' })).toBeInTheDocument();
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    expect(screen.getByText('1 row without a date')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Date property' })).toHaveValue('due');
  });

  it('chooses the first date property when a calendar view is created', async () => {
    const { user } = renderApp({ ...seed(), path: '/page/db' });

    await user.click(await screen.findByRole('button', { name: 'Add a view' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Calendar' }));

    await screen.findByRole('grid', { name: 'November 2026' });
    await waitFor(async () => {
      const views = (await commands.loadDatabase('db')).views;
      expect(views.at(-1)?.config).toMatchObject({ type: 'calendar', datePropertyId: 'due' });
    });
  });

  it('changes and saves the date property', async () => {
    const { user } = renderApp(seed());

    const picker = await screen.findByRole('combobox', { name: 'Date property' });
    await user.selectOptions(picker, 'start');

    expect(picker).toHaveValue('start');
    expect(screen.queryByRole('link', { name: 'Write spec' })).toBeNull();
    expect(screen.getByText('2 rows without a date')).toBeInTheDocument();
    await waitFor(async () => {
      expect((await commands.loadDatabase('db')).views[1].config).toMatchObject({
        datePropertyId: 'start',
      });
    });
  });
});
