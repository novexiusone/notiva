import { expect, test, type Locator, type Page } from '@playwright/test';
import { dragBefore } from './support/drag';

const board = (page: Page) => page.getByRole('region', { name: 'Kanban board' });
const column = (page: Page, name: string) => board(page).getByRole('region', { name, exact: true });
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name, exact: true });

const emptyTable = {
  version: 1,
  type: 'table',
  filters: [],
  sorts: [],
  properties: [],
  groupBy: null,
};

const emptyBoard = {
  version: 1,
  type: 'kanban',
  filters: [],
  sorts: [],
  properties: [],
  groupPropertyId: 'status',
  hiddenGroups: [],
};

async function seed(page: Page, { withSelect = true, sorted = false } = {}) {
  await page.evaluate(
    ({ emptyTable, emptyBoard, withSelect }) => {
      const pages = [
        {
          id: 'db',
          title: 'Tasks',
          parentId: null,
          position: 0,
          kind: 'database',
          databaseId: null,
        },
        {
          id: 'one',
          title: 'Write spec',
          parentId: 'db',
          position: 0,
          kind: 'page',
          databaseId: 'db',
        },
        {
          id: 'two',
          title: 'Build it',
          parentId: 'db',
          position: 1,
          kind: 'page',
          databaseId: 'db',
        },
        {
          id: 'three',
          title: 'Test it',
          parentId: 'db',
          position: 2,
          kind: 'page',
          databaseId: 'db',
        },
      ];
      const property = (id: string, name: string, type: string, position: number) => ({
        id,
        databaseId: 'db',
        name,
        type,
        position,
        options: [] as { id: string; name: string; color: string }[],
        targetId: null,
      });
      const properties = [
        property('notes', 'Notes', 'text', 0),
        ...(withSelect
          ? [
              {
                ...property('status', 'Status', 'select', 1),
                options: [
                  { id: 'todo', name: 'Todo', color: 'gray' },
                  { id: 'done', name: 'Done', color: 'green' },
                ],
              },
              {
                ...property('priority', 'Priority', 'select', 2),
                options: [
                  { id: 'high', name: 'High', color: 'red' },
                  { id: 'low', name: 'Low', color: 'blue' },
                ],
              },
            ]
          : []),
      ];
      const views = [
        { id: 'all', databaseId: 'db', name: 'All', position: 0, config: emptyTable },
        {
          id: 'board',
          databaseId: 'db',
          name: 'Board',
          position: 1,
          config: withSelect ? emptyBoard : { ...emptyBoard, groupPropertyId: null },
        },
      ];
      const cells = {
        one: { notes: 'First draft', status: 'todo', priority: 'high' },
        two: { notes: 'Implementation', status: 'todo', priority: 'low' },
        three: { status: 'done' },
      };
      window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
      window.localStorage.setItem(
        'notiva.fake.databases',
        JSON.stringify({ properties, views, cells }),
      );
    },
    {
      emptyTable,
      emptyBoard: {
        ...emptyBoard,
        sorts: sorted ? [{ propertyId: 'title', direction: 'asc' }] : [],
      },
      withSelect,
    },
  );
  await page.reload();
  await page.goto('/#/page/db?view=board');
}

async function storedDatabase(page: Page) {
  return page.evaluate(() => {
    return JSON.parse(window.localStorage.getItem('notiva.fake.databases') ?? '{}') as {
      properties: { id: string; type: string }[];
      views: { id: string; config: unknown }[];
      cells: Record<string, Record<string, string>>;
    };
  });
}

async function storedRowIds(page: Page) {
  return page.evaluate(() => {
    const pages = JSON.parse(window.localStorage.getItem('notiva.fake.pages') ?? '[]') as {
      id: string;
      databaseId: string | null;
      position: number;
    }[];
    return pages
      .filter((page) => page.databaseId === 'db')
      .sort((a, b) => a.position - b.position)
      .map((page) => page.id);
  });
}

async function cardTitles(column: Locator) {
  return column
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')));
}

async function tableCell(page: Page, rowName: string, property: string) {
  const grid = page.getByRole('grid', { name: 'Tasks' });
  const headers = await grid.getByRole('columnheader').allTextContents();
  return grid
    .getByRole('row', { name: rowName, exact: true })
    .getByRole('gridcell')
    .nth(headers.indexOf(property));
}

async function setLock(page: Page, id: string, lock: string) {
  await page.evaluate(
    ({ id, lock }) => {
      const pages = JSON.parse(window.localStorage.getItem('notiva.fake.pages') ?? '[]') as {
        id: string;
        lock?: string;
      }[];
      Object.assign(
        pages.find((page) => page.id === id)!,
        {
          lock,
          banner: null,
          bannerPosition: 50,
          icon: null,
          isFavorite: false,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      );
      window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
    },
    { id, lock },
  );
  await page.reload();
  await expect(board(page)).toBeVisible();
}

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test('cards show visible properties, open rows, and New uses the column value', async ({
  page,
}) => {
  await seed(page);
  await expect(column(page, 'Todo').getByRole('link', { name: 'Write spec' })).toBeVisible();
  await expect(column(page, 'Todo').getByText('First draft')).toBeVisible();
  await expect(column(page, 'Done').getByRole('link', { name: 'Test it' })).toBeVisible();
  await expect(column(page, 'No Status')).toBeVisible();

  await column(page, 'Todo').getByRole('button', { name: 'New', exact: true }).click();
  await expect(column(page, 'Todo').getByRole('link', { name: 'Untitled' })).toBeVisible();
  await expect.poll(async () => (await storedRowIds(page)).length).toBe(4);
  expect(
    Object.values((await storedDatabase(page)).cells).some((cells) => cells.status === 'todo'),
  ).toBe(true);

  await column(page, 'No Status').getByRole('button', { name: 'New', exact: true }).click();
  await expect(column(page, 'No Status').getByRole('link', { name: 'Untitled' })).toBeVisible();
  await expect.poll(async () => (await storedRowIds(page)).length).toBe(5);
  const rowIds = await storedRowIds(page);
  const stored = await storedDatabase(page);
  const emptyRowId = rowIds.find(
    (id) => !['one', 'two', 'three'].includes(id) && stored.cells[id] === undefined,
  )!;
  expect(stored.cells[emptyRowId]).toBeUndefined();

  await column(page, 'Todo').getByRole('link', { name: 'Write spec' }).click();
  await expect(page.getByRole('main').getByRole('textbox', { name: 'Page title' })).toHaveValue(
    'Write spec',
  );
});

test('the grouping property and hidden columns persist across reload', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Group by', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Priority', exact: true }).click();
  await expect(column(page, 'High')).toBeVisible();
  await expect(column(page, 'Low')).toBeVisible();
  await expect(column(page, 'No Priority')).toBeVisible();

  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  const columns = page.getByRole('dialog', { name: 'Columns' });
  await columns.getByRole('checkbox', { name: 'High', exact: true }).click();
  await columns.getByRole('checkbox', { name: 'No Priority', exact: true }).click();
  await expect(column(page, 'High')).toHaveCount(0);
  await expect(column(page, 'No Priority')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await expect
    .poll(async () => (await storedDatabase(page)).views[1]!.config)
    .toMatchObject({
      groupPropertyId: 'priority',
      hiddenGroups: ['high', ''],
    });
  await page.reload();
  await expect(column(page, 'Low')).toBeVisible();
  await expect(column(page, 'High')).toHaveCount(0);
  await expect(column(page, 'No Priority')).toHaveCount(0);
  await tab(page, 'All').click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
});

test('a board without a select property offers to create one', async ({ page }) => {
  await seed(page, { withSelect: false });
  await page.getByRole('button', { name: 'Create select property' }).click();
  await expect(column(page, 'No Status')).toBeVisible();

  const stored = await storedDatabase(page);
  const select = stored.properties.find((property) => property.type === 'select')!;
  await expect
    .poll(async () => (await storedDatabase(page)).views[1]!.config)
    .toMatchObject({
      groupPropertyId: select.id,
      hiddenGroups: [],
    });
});

test('a real pointer drag to another column updates the table value too', async ({ page }) => {
  await seed(page);
  await dragBefore(
    page,
    column(page, 'Todo').getByRole('button', { name: 'Drag Write spec' }),
    column(page, 'Done').getByRole('link', { name: 'Test it' }),
  );

  await expect(column(page, 'Done').getByRole('link', { name: 'Write spec' })).toBeVisible();
  await expect.poll(async () => (await storedDatabase(page)).cells.one?.status).toBe('done');
  await tab(page, 'All').click();
  await expect(await tableCell(page, 'Write spec', 'Status')).toHaveText('Done');
});

test('a real pointer drag within a column shares its manual order with the table', async ({
  page,
}) => {
  await seed(page);
  await dragBefore(
    page,
    column(page, 'Todo').getByRole('button', { name: 'Drag Build it' }),
    column(page, 'Todo').getByRole('link', { name: 'Write spec' }),
  );

  await expect.poll(() => cardTitles(column(page, 'Todo'))).toEqual(['Build it', 'Write spec']);
  await expect.poll(() => storedRowIds(page)).toEqual(['two', 'one', 'three']);
  await tab(page, 'All').click();
  await expect
    .poll(() =>
      page
        .getByRole('grid', { name: 'Tasks' })
        .getByRole('row')
        .evaluateAll((rows) => rows.slice(1).map((row) => row.getAttribute('aria-label'))),
    )
    .toEqual(['Build it', 'Write spec', 'Test it']);
});

test('a card handle reorders with the keyboard', async ({ page }) => {
  await seed(page);
  const handle = column(page, 'Todo').getByRole('button', { name: 'Drag Write spec' });
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');

  await expect.poll(() => cardTitles(column(page, 'Todo'))).toEqual(['Build it', 'Write spec']);
  await expect.poll(() => storedRowIds(page)).toEqual(['two', 'one', 'three']);
});

test('a locked card is a drop target but never a drag source', async ({ page }) => {
  await seed(page);
  await setLock(page, 'two', 'content');
  await expect(column(page, 'Todo').getByRole('button', { name: 'Drag Build it' })).toHaveCount(0);
  const before = await page.evaluate(() => {
    const pages = JSON.parse(window.localStorage.getItem('notiva.fake.pages') ?? '[]') as {
      id: string;
    }[];
    return pages.find((page) => page.id === 'two');
  });

  await dragBefore(
    page,
    column(page, 'Todo').getByRole('button', { name: 'Drag Write spec' }),
    column(page, 'Todo').getByRole('link', { name: 'Build it' }),
  );
  await expect.poll(() => cardTitles(column(page, 'Todo'))).toEqual(['Build it', 'Write spec']);
  await expect.poll(() => storedRowIds(page)).toEqual(['two', 'one', 'three']);
  const after = await page.evaluate(() => {
    const pages = JSON.parse(window.localStorage.getItem('notiva.fake.pages') ?? '[]') as {
      id: string;
    }[];
    return pages.find((page) => page.id === 'two');
  });
  expect(after).toEqual(before);

  await setLock(page, 'db', 'all');
  await expect(board(page).getByRole('button', { name: /^Drag / })).toHaveCount(0);
  await expect(
    board(page).getByRole('button', { name: 'New', exact: true }).first(),
  ).toBeDisabled();
  await expect(board(page).getByRole('button', { name: 'Columns', exact: true })).toBeDisabled();
});

test('sort suppresses same-column positioning but still allows a value-only move', async ({
  page,
}) => {
  await seed(page, { sorted: true });
  await expect.poll(() => cardTitles(column(page, 'Todo'))).toEqual(['Build it', 'Write spec']);
  const before = await storedRowIds(page);

  await dragBefore(
    page,
    column(page, 'Todo').getByRole('button', { name: 'Drag Write spec' }),
    column(page, 'Todo').getByRole('link', { name: 'Build it' }),
  );
  await expect.poll(() => cardTitles(column(page, 'Todo'))).toEqual(['Build it', 'Write spec']);
  expect(await storedRowIds(page)).toEqual(before);

  await dragBefore(
    page,
    column(page, 'Todo').getByRole('button', { name: 'Drag Write spec' }),
    column(page, 'Done').getByRole('link', { name: 'Test it' }),
  );
  await expect(column(page, 'Done').getByRole('link', { name: 'Write spec' })).toBeVisible();
  await expect.poll(async () => (await storedDatabase(page)).cells.one?.status).toBe('done');
  expect(await storedRowIds(page)).toEqual(before);
});
