import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('opens the row when its entry is clicked', async () => {
    const { user } = renderApp(seed());

    await user.click(await screen.findByRole('link', { name: 'Write spec' }));

    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Write spec');
  });

  it('does not suppress keyboard activation after a cancelled drag', async () => {
    const { user } = renderApp(seed());
    const entry = await screen.findByRole('link', { name: 'Write spec' });

    const nativeElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => null;
    try {
      fireEvent.pointerDown(entry, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(entry, { pointerId: 1, clientX: 20, clientY: 20 });
      fireEvent.pointerCancel(entry, { pointerId: 1 });
      entry.focus();
      await user.keyboard('{Enter}');

      expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Write spec');
    } finally {
      document.elementFromPoint = nativeElementFromPoint;
    }
  });

  it('creates a row with the clicked day as its date', async () => {
    const { user } = renderApp(seed());
    const grid = await screen.findByRole('grid', { name: 'November 2026' });

    const day = grid.querySelector<HTMLElement>('[data-calendar-date="2026-11-17"]');
    expect(day).not.toBeNull();
    await user.click(day!);

    await waitFor(async () => {
      const rows = await commands.listRows('db');
      expect(rows).toHaveLength(3);
      expect(rows[2].cells.due).toBe('2026-11-17');
    });
  });

  it('treats a deleted stored date property as unchosen', async () => {
    renderApp(seed({ ...calendar, datePropertyId: 'deleted' }));

    await screen.findByRole('grid', { name: 'November 2026' });
    expect(screen.getByRole('combobox', { name: 'Date property' })).toHaveValue('');
    expect(screen.getByRole('button', { name: /Create a row on.*November 17/ })).toBeDisabled();
    expect(screen.queryByText(/rows? without a date/)).toBeNull();
  });

  it('disables calendar and entry writes but not row navigation when everything is locked', async () => {
    const { user } = renderApp({
      ...seed(),
      pages: seed().pages.map((entry) =>
        entry.id === 'db' ? { ...entry, lock: 'all' as const } : entry,
      ),
    });

    const entry = await screen.findByRole('link', { name: 'Write spec' });
    expect(screen.getByRole('combobox', { name: 'Date property' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Create a row on.*November 17/ })).toBeDisabled();
    expect(entry).not.toHaveAttribute('aria-disabled');
    fireEvent.pointerDown(entry, { pointerId: 1, button: 0 });
    fireEvent.pointerMove(entry, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(entry, { pointerId: 1 });
    expect((await commands.listRows('db'))[0].cells.due).toBe('2026-11-14');

    await user.click(entry);
    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Write spec');
  });

  it('does not let an everything lock on a row write its date', async () => {
    renderApp({
      ...seed(),
      pages: seed().pages.map((entry) =>
        entry.id === 'r1' ? { ...entry, lock: 'all' as const } : entry,
      ),
    });

    const entry = await screen.findByRole('link', { name: 'Write spec' });
    expect(entry).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: /Create a row on.*November 17/ })).toBeEnabled();
    fireEvent.pointerDown(entry, { pointerId: 1, button: 0 });
    fireEvent.pointerMove(entry, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(entry, { pointerId: 1 });
    expect((await commands.listRows('db'))[0].cells.due).toBe('2026-11-14');
  });

  it('keeps cells, day creation and the date property editable under content locks', async () => {
    renderApp({
      ...seed(),
      pages: seed().pages.map((entry) =>
        entry.id === 'db' || entry.id === 'r1' ? { ...entry, lock: 'content' as const } : entry,
      ),
    });

    await screen.findByRole('grid', { name: 'November 2026' });
    expect(screen.getByRole('combobox', { name: 'Date property' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Create a row on.*November 17/ })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Write spec' })).not.toHaveAttribute('aria-disabled');
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
