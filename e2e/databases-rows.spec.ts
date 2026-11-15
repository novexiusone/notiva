import { expect, test, type Page } from '@playwright/test';

const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const grid = (page: Page) => page.getByRole('grid');
const row = (page: Page, name: string) => grid(page).getByRole('row', { name, exact: true });
const properties = (page: Page) => page.getByRole('group', { name: 'Properties' });
/** The value of a property on a row's page, by the property's name. */
const value = (page: Page, name: string) =>
  properties(page).getByRole('button', { name: new RegExp(`^${name}( |$)`) });
const backLink = (page: Page) => page.getByRole('article').getByRole('link', { name: 'Tasks' });

/** The cell of a row (by its title) in a column (by its header). */
async function cell(page: Page, rowName: string, column: string) {
  const headers = await grid(page).getByRole('columnheader').allTextContents();
  const index = headers.indexOf(column);
  expect(index, `column ${column}`).toBeGreaterThanOrEqual(0);
  return row(page, rowName).getByRole('gridcell').nth(index);
}

/** A database "Tasks" with a text, a number and a select, two rows, and an ordinary page. */
async function seed(page: Page) {
  await page.evaluate(() => {
    const pages = [
      { id: 'db', title: 'Tasks', parentId: null, position: 0, kind: 'database', databaseId: null },
      {
        id: 'r1',
        title: 'Write spec',
        parentId: 'db',
        position: 0,
        kind: 'page',
        databaseId: 'db',
      },
      { id: 'r2', title: 'Build it', parentId: 'db', position: 1, kind: 'page', databaseId: 'db' },
      { id: 'notes', title: 'Notes', parentId: null, position: 1, kind: 'page', databaseId: null },
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
      property('comment', 'Comment', 'text', 0),
      property('hours', 'Hours', 'number', 1),
      {
        ...property('status', 'Status', 'select', 2),
        options: [
          { id: 'todo', name: 'Todo', color: 'gray' },
          { id: 'done', name: 'Done', color: 'green' },
        ],
      },
    ];
    const cells = { r1: { comment: 'First draft', hours: 3, status: 'done' }, r2: { hours: 8 } };
    window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
    window.localStorage.setItem(
      'notiva.fake.databases',
      JSON.stringify({ properties, views: [], cells }),
    );
  });
  await page.reload();
  await page.goto('/#/page/db');
  await expect(grid(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
  await seed(page);
});

test('a value changed on the row page shows in the table, and survives a reload', async ({
  page,
}) => {
  await row(page, 'Write spec').hover();
  await row(page, 'Write spec').getByRole('link', { name: 'Open' }).click();
  await expect(title(page)).toHaveValue('Write spec');
  await expect(properties(page).getByRole('term')).toHaveText(['Comment', 'Hours', 'Status']);
  await expect(value(page, 'Comment')).toHaveAccessibleName('Comment First draft');

  await value(page, 'Comment').click();
  const input = properties(page).getByRole('textbox', { name: 'Comment' });
  await expect(input).toBeFocused();
  await input.fill('Second draft');
  await input.press('Enter');
  await expect(value(page, 'Comment')).toBeFocused();

  // A select through the keyboard: Tab to it, Enter, pick an option.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(value(page, 'Status')).toBeFocused();
  await page.keyboard.press('Enter');
  const options = page.getByRole('dialog', { name: 'Status' });
  await options.getByRole('option', { name: 'Todo' }).click();
  await expect(value(page, 'Status')).toHaveAccessibleName('Status Todo');

  await backLink(page).click();
  await expect(grid(page)).toBeVisible();
  await expect(await cell(page, 'Write spec', 'Comment')).toHaveText('Second draft');
  await expect(await cell(page, 'Write spec', 'Status')).toHaveText('Todo');

  await page.reload();
  await expect(grid(page)).toBeVisible();
  await expect(await cell(page, 'Write spec', 'Comment')).toHaveText('Second draft');
  await expect(await cell(page, 'Write spec', 'Status')).toHaveText('Todo');
});

test('a value changed in the table shows on the row page, and survives a reload', async ({
  page,
}) => {
  await (await cell(page, 'Build it', 'Hours')).click();
  const input = grid(page).getByRole('textbox', { name: 'Hours' });
  await input.fill('13');
  await input.press('Enter');
  await expect(await cell(page, 'Build it', 'Hours')).toHaveText('13');

  await row(page, 'Build it').hover();
  await row(page, 'Build it').getByRole('link', { name: 'Open' }).click();
  await expect(title(page)).toHaveValue('Build it');
  await expect(value(page, 'Hours')).toHaveAccessibleName('Hours 13');
  await expect(value(page, 'Comment')).toHaveAccessibleName('Comment Empty');

  await page.reload();
  await expect(title(page)).toHaveValue('Build it');
  await expect(value(page, 'Hours')).toHaveAccessibleName('Hours 13');
  await expect(backLink(page)).toBeVisible();
});

test('an ordinary page shows no properties and no link back', async ({ page }) => {
  await page.goto('/#/page/notes');
  await expect(title(page)).toHaveValue('Notes');
  await expect(page.locator('.bn-editor')).toBeVisible();
  await expect(properties(page)).toHaveCount(0);
  await expect(page.getByRole('article').getByRole('link')).toHaveCount(0);
});
