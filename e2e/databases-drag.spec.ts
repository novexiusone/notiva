import { expect, test, type Page } from '@playwright/test';
import { dragByHandle } from './blockDrag';
import { dragBefore, dragToPoint } from './support/drag';

const grid = (page: Page) => page.getByRole('grid', { name: 'Tasks' });
const headers = (page: Page) => grid(page).getByRole('columnheader');
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name, exact: true });
const rowTitles = (page: Page) =>
  grid(page)
    .getByRole('row')
    .evaluateAll((rows) => rows.slice(1).map((row) => row.getAttribute('aria-label')));

const emptyTable = {
  version: 1,
  type: 'table',
  filters: [],
  sorts: [],
  properties: [],
  groupBy: null,
};

const views = [
  { id: 'all', databaseId: 'db', name: 'All', position: 0, config: emptyTable },
  { id: 'other', databaseId: 'db', name: 'Other', position: 1, config: emptyTable },
];

async function seed(page: Page) {
  await page.evaluate((views) => {
    const pages = [
      { id: 'alpha', title: 'Alpha', parentId: null, position: 0, kind: 'page', databaseId: null },
      { id: 'db', title: 'Tasks', parentId: null, position: 1, kind: 'database', databaseId: null },
      { id: 'beta', title: 'Beta', parentId: null, position: 2, kind: 'page', databaseId: null },
      {
        id: 'one',
        title: 'Write spec',
        parentId: 'db',
        position: 0,
        kind: 'page',
        databaseId: 'db',
      },
      { id: 'two', title: 'Build it', parentId: 'db', position: 1, kind: 'page', databaseId: 'db' },
      {
        id: 'three',
        title: 'Test it',
        parentId: 'db',
        position: 2,
        kind: 'page',
        databaseId: 'db',
      },
    ];
    const property = (id: string, name: string, position: number) => ({
      id,
      databaseId: 'db',
      name,
      type: 'text',
      position,
      options: [],
      targetId: null,
    });
    const properties = [property('notes', 'Notes', 0), property('hours', 'Hours', 1)];
    window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
    window.localStorage.setItem(
      'notiva.fake.databases',
      JSON.stringify({ properties, views, cells: {} }),
    );
  }, views);
  await page.reload();
  await page.goto('/#/page/db');
  await expect(grid(page)).toBeVisible();
}

async function storedConfig(page: Page, viewId: string) {
  return page.evaluate((viewId) => {
    const stored = JSON.parse(window.localStorage.getItem('notiva.fake.databases') ?? '{}') as {
      views: {
        id: string;
        config: { properties: { propertyId: string; width: number | null }[] };
      }[];
    };
    return stored.views.find((view) => view.id === viewId)?.config;
  }, viewId);
}

async function storedRows(page: Page) {
  return page.evaluate(() => {
    const pages = JSON.parse(window.localStorage.getItem('notiva.fake.pages') ?? '[]') as {
      id: string;
      databaseId: string | null;
      position: number;
    }[];
    return pages
      .filter((page) => page.databaseId === 'db')
      .sort((a, b) => a.position - b.position)
      .map(({ id, position }) => ({ id, position }));
  });
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
  await seed(page);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test('column order and width persist per view after real pointer drags', async ({ page }) => {
  await expect(headers(page)).toHaveText(['Name', 'Notes', 'Hours', '']);

  await dragBefore(page, grid(page).getByLabel('Drag Hours column'), headers(page).nth(1));
  await expect(headers(page)).toHaveText(['Name', 'Hours', 'Notes', '']);

  const resize = grid(page).getByRole('separator', { name: 'Resize Notes column' });
  const edge = (await resize.boundingBox())!;
  await dragToPoint(page, resize, { x: edge.x + edge.width / 2 + 60, y: edge.y + edge.height / 2 });
  await expect(resize).toHaveAttribute('aria-valuenow', '260');
  await expect
    .poll(() => storedConfig(page, 'all'))
    .toMatchObject({
      properties: [
        { propertyId: 'hours', width: null },
        { propertyId: 'notes', width: 260 },
      ],
    });

  await tab(page, 'Other').click();
  await expect(headers(page)).toHaveText(['Name', 'Notes', 'Hours', '']);
  await tab(page, 'All').click();
  await expect(headers(page)).toHaveText(['Name', 'Hours', 'Notes', '']);
  await page.reload();
  await expect(headers(page)).toHaveText(['Name', 'Hours', 'Notes', '']);
  await expect(grid(page).getByRole('separator', { name: 'Resize Notes column' })).toHaveAttribute(
    'aria-valuenow',
    '260',
  );
});

test('a row dragged by its handle shares its manual order and survives reload', async ({
  page,
}) => {
  const before = await storedRows(page);
  const target = grid(page).getByRole('row', { name: 'Write spec' });
  const targetBox = (await target.boundingBox())!;
  await dragToPoint(page, grid(page).getByRole('button', { name: 'Drag Build it' }), {
    x: targetBox.x + 40,
    y: targetBox.y + targetBox.height / 2,
  });

  await expect.poll(() => rowTitles(page)).toEqual(['Build it', 'Write spec', 'Test it']);
  const after = await storedRows(page);
  expect(after.map((row) => row.id)).toEqual(['two', 'one', 'three']);
  expect(after[0]!.position).toBeLessThan(before[0]!.position);
  expect(after[1]).toEqual(before[0]);
  expect(after[2]).toEqual(before[2]);

  await tab(page, 'Other').click();
  await expect.poll(() => rowTitles(page)).toEqual(['Build it', 'Write spec', 'Test it']);
  await page.reload();
  await expect.poll(() => rowTitles(page)).toEqual(['Build it', 'Write spec', 'Test it']);
});

test('a row handle reorders with the keyboard and stops at the boundaries', async ({ page }) => {
  const before = await storedRows(page);
  const first = grid(page).getByRole('button', { name: 'Drag Write spec' });
  await first.focus();
  await page.keyboard.press('ArrowUp');
  const last = grid(page).getByRole('button', { name: 'Drag Test it' });
  await last.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(700);
  expect(await storedRows(page)).toEqual(before);

  const handle = grid(page).getByRole('button', { name: 'Drag Build it' });
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => rowTitles(page)).toEqual(['Build it', 'Write spec', 'Test it']);
});

test('a column handle reorders with the keyboard and stops at the boundaries', async ({ page }) => {
  const handle = grid(page).getByRole('button', { name: 'Drag Hours column' });
  const initial = await storedConfig(page, 'all');
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  expect(await storedConfig(page, 'all')).toEqual(initial);

  await page.keyboard.press('ArrowLeft');
  await expect(headers(page)).toHaveText(['Name', 'Hours', 'Notes', '']);
  await expect
    .poll(() => storedConfig(page, 'all'))
    .toMatchObject({
      properties: [
        { propertyId: 'hours', width: null },
        { propertyId: 'notes', width: null },
      ],
    });

  const reordered = await storedConfig(page, 'all');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);
  expect(await storedConfig(page, 'all')).toEqual(reordered);
  await page.reload();
  await expect(headers(page)).toHaveText(['Name', 'Hours', 'Notes', '']);
});

test('sidebar page dragging still works while a database is open', async ({ page }) => {
  const treeItems = page.getByRole('treeitem');
  await expect(treeItems).toHaveText(['Alpha', 'Tasks', 'Beta']);

  await treeItems
    .filter({ hasText: 'Beta' })
    .dragTo(treeItems.filter({ hasText: 'Alpha' }), { targetPosition: { x: 60, y: 2 } });

  await expect(treeItems).toHaveText(['Beta', 'Alpha', 'Tasks']);
  await expect(grid(page)).toBeVisible();
});

test('editor block dragging still works beside an open database', async ({ page }) => {
  await seedEditor(page);
  const editor = page.locator('.bn-editor');
  const paragraphs = editor.locator('[data-content-type="paragraph"]');
  const outline = () =>
    editor.locator('.bn-block-content').evaluateAll((blocks) =>
      blocks.map((block) => {
        const type = block.getAttribute('data-content-type');
        return type === 'database' ? 'database' : block.textContent;
      }),
    );
  await expect(grid(page)).toBeVisible();

  const above = (await paragraphs.first().boundingBox())!;
  await dragByHandle(page, paragraphs.nth(1), { x: above.x + 40, y: above.y + 1 }, 'below');

  await expect.poll(outline).toEqual(['Below', 'Above', 'database']);
  await expect(grid(page)).toBeVisible();
});

async function seedEditor(page: Page) {
  await page.evaluate((views) => {
    const pages = [
      { id: 'notes', title: 'Notes', parentId: null, position: 0, kind: 'page', databaseId: null },
      {
        id: 'db',
        title: 'Tasks',
        parentId: 'notes',
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
      { id: 'two', title: 'Build it', parentId: 'db', position: 1, kind: 'page', databaseId: 'db' },
      {
        id: 'three',
        title: 'Test it',
        parentId: 'db',
        position: 2,
        kind: 'page',
        databaseId: 'db',
      },
    ];
    const paragraph = (id: string, text: string) => ({
      id,
      type: 'paragraph',
      props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    });
    const blocks = {
      notes: [
        paragraph('above', 'Above'),
        { id: 'database', type: 'database', props: { databaseId: 'db' }, children: [] },
        paragraph('below', 'Below'),
      ],
    };
    window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
    window.localStorage.setItem('notiva.fake.blocks', JSON.stringify(blocks));
    window.localStorage.setItem(
      'notiva.fake.databases',
      JSON.stringify({ properties: [], views, cells: {} }),
    );
  }, views);
  await page.reload();
  await page.goto('/#/page/notes');
  await expect(page.locator('.bn-editor')).toBeVisible();
}

test('same-group rows reorder but a cross-group drop leaves storage unchanged', async ({
  page,
}) => {
  await seedGroups(page);
  const target = grid(page).getByRole('row', { name: 'Build it' });
  const targetBox = (await target.boundingBox())!;
  await dragToPoint(page, grid(page).getByRole('button', { name: 'Drag Test it' }), {
    x: targetBox.x + 40,
    y: targetBox.y + targetBox.height / 2,
  });
  await expect.poll(() => rowTitles(page)).toEqual(['A', 'Write spec', 'B', 'Test it', 'Build it']);

  const before = await storedRows(page);
  const crossGroupTarget = grid(page).getByRole('row', { name: 'Write spec' });
  const crossGroupBox = (await crossGroupTarget.boundingBox())!;
  await dragToPoint(page, grid(page).getByRole('button', { name: 'Drag Build it' }), {
    x: crossGroupBox.x + 40,
    y: crossGroupBox.y + crossGroupBox.height / 2,
  });
  await page.waitForTimeout(700);

  expect(await storedRows(page)).toEqual(before);
  await expect.poll(() => rowTitles(page)).toEqual(['A', 'Write spec', 'B', 'Test it', 'Build it']);
});

test('a row dropped on a column header leaves rows and view config unchanged', async ({ page }) => {
  const beforeRows = await storedRows(page);
  const beforeConfig = await storedConfig(page, 'all');
  const target = headers(page).nth(1);
  const targetBox = (await target.boundingBox())!;
  await dragToPoint(page, grid(page).getByRole('button', { name: 'Drag Build it' }), {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  });
  await page.waitForTimeout(700);

  expect(await storedRows(page)).toEqual(beforeRows);
  expect(await storedConfig(page, 'all')).toEqual(beforeConfig);
});

test('a column dropped on a row leaves rows and view config unchanged', async ({ page }) => {
  const beforeRows = await storedRows(page);
  const beforeConfig = await storedConfig(page, 'all');
  const target = grid(page).getByRole('row', { name: 'Write spec' });
  const targetBox = (await target.boundingBox())!;
  await dragToPoint(page, grid(page).getByLabel('Drag Hours column'), {
    x: targetBox.x + 40,
    y: targetBox.y + targetBox.height / 2,
  });
  await page.waitForTimeout(700);

  expect(await storedRows(page)).toEqual(beforeRows);
  expect(await storedConfig(page, 'all')).toEqual(beforeConfig);
});

async function seedGroups(page: Page) {
  await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('notiva.fake.databases') ?? '{}') as {
      properties: Record<string, unknown>[];
      views: { id: string; config: { groupBy: unknown } }[];
      cells: Record<string, Record<string, string>>;
    };
    stored.properties.push({
      id: 'status',
      databaseId: 'db',
      name: 'Status',
      type: 'select',
      position: 2,
      options: [
        { id: 'a', name: 'A', color: 'gray' },
        { id: 'b', name: 'B', color: 'blue' },
      ],
      targetId: null,
    });
    stored.views.find((view) => view.id === 'all')!.config.groupBy = {
      propertyId: 'status',
      collapsed: [],
    };
    stored.cells = { one: { status: 'a' }, two: { status: 'b' }, three: { status: 'b' } };
    window.localStorage.setItem('notiva.fake.databases', JSON.stringify(stored));
  });
  await page.reload();
  await expect(grid(page).getByRole('row', { name: 'A', exact: true })).toBeVisible();
  await expect(grid(page).getByRole('row', { name: 'B', exact: true })).toBeVisible();
}
