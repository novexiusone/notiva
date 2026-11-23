import { expect, test, type Page } from '@playwright/test';

const table = {
  version: 1,
  type: 'table',
  filters: [],
  sorts: [],
  properties: [],
  groupBy: null,
};
const calendar = {
  version: 1,
  type: 'calendar',
  filters: [],
  sorts: [],
  properties: [],
  datePropertyId: 'due',
};

const month = (page: Page, name = 'November 2026') => page.getByRole('grid', { name });
const day = (page: Page, date: string) => page.locator(`[data-calendar-date="${date}"]`);
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name, exact: true });

async function cell(page: Page, rowName: string, column: string) {
  const grid = page.getByRole('grid', { name: 'Tasks' });
  await expect(grid.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  const index = (await grid.getByRole('columnheader').allTextContents()).indexOf(column);
  expect(index, `column ${column}`).toBeGreaterThanOrEqual(0);
  return grid.getByRole('row', { name: rowName, exact: true }).getByRole('gridcell').nth(index);
}

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(
    ({ table, calendar }) => {
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
          id: 'r1',
          title: 'Write spec',
          parentId: 'db',
          position: 0,
          kind: 'page',
          databaseId: 'db',
        },
        { id: 'r2', title: 'No date', parentId: 'db', position: 1, kind: 'page', databaseId: 'db' },
      ];
      const property = (id: string, name: string, position: number) => ({
        id,
        databaseId: 'db',
        name,
        type: 'date',
        position,
        options: [],
        targetId: null,
      });
      window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
      window.localStorage.setItem(
        'notiva.fake.databases',
        JSON.stringify({
          properties: [property('due', 'Due', 0), property('start', 'Start', 1)],
          views: [
            { id: 'v1', databaseId: 'db', name: 'All', position: 0, config: table },
            { id: 'v2', databaseId: 'db', name: 'Calendar', position: 1, config: calendar },
          ],
          cells: { r1: { due: '2026-11-14', start: '2026-11-03' }, r2: {} },
        }),
      );
    },
    { table, calendar },
  );
  await page.reload();
  await page.goto('/#/page/db?view=v2');
  await expect(month(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test('moving an entry updates its date in the table and survives a reload', async ({ page }) => {
  await day(page, '2026-11-14').getByRole('link', { name: 'Write spec' }).hover();
  await page.mouse.down();
  const target = await day(page, '2026-11-17').boundingBox();
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 28, { steps: 16 });
  await page.mouse.up();

  await expect(day(page, '2026-11-17').getByRole('link', { name: 'Write spec' })).toBeVisible();
  await tab(page, 'All').click();
  await expect(await cell(page, 'Write spec', 'Due')).toHaveText('Nov 17, 2026');
  await page.reload();
  await expect(await cell(page, 'Write spec', 'Due')).toHaveText('Nov 17, 2026');
});

test('clicking an entry opens its row and clicking a day creates a dated row', async ({ page }) => {
  await day(page, '2026-11-14').getByRole('link', { name: 'Write spec' }).click();
  await expect(page.getByRole('main').getByRole('textbox', { name: 'Page title' })).toHaveValue(
    'Write spec',
  );

  await page.goto('/#/page/db?view=v2');
  await day(page, '2026-11-17').click({ position: { x: 20, y: 60 } });
  await expect(day(page, '2026-11-17').getByRole('link', { name: 'Untitled' })).toBeVisible();
  await tab(page, 'All').click();
  await expect(await cell(page, 'Untitled', 'Due')).toHaveText('Nov 17, 2026');
});

test('English weekday names and calendar colors follow the system theme', async ({
  page,
}, testInfo) => {
  await expect(month(page).getByRole('columnheader')).toHaveText([
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ]);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(242, 242, 242)');
  await expect(day(page, '2026-11-14').getByRole('link', { name: 'Write spec' })).toHaveCSS(
    'background-color',
    'rgb(26, 26, 26)',
  );
  await page.screenshot({ path: testInfo.outputPath('calendar-en-light.png'), fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await expect(day(page, '2026-11-14').getByRole('link', { name: 'Write spec' })).toHaveCSS(
    'background-color',
    'rgb(237, 237, 237)',
  );
  await page.screenshot({ path: testInfo.outputPath('calendar-en-dark.png'), fullPage: true });
});

test('the chosen date property survives a reload', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Date property' }).selectOption('start');
  await expect(day(page, '2026-11-03').getByRole('link', { name: 'Write spec' })).toBeVisible();
  await expect(page.getByText('1 row without a date')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Date property' })).toHaveValue('start');
  await expect(day(page, '2026-11-03').getByRole('link', { name: 'Write spec' })).toBeVisible();
});

test.describe('German and dark mode', () => {
  test.use({ locale: 'de-DE', colorScheme: 'dark' });

  test('uses German month and weekday names and Monday as the first day', async ({
    page,
  }, testInfo) => {
    await expect(month(page).getByRole('columnheader')).toHaveText([
      'Montag',
      'Dienstag',
      'Mittwoch',
      'Donnerstag',
      'Freitag',
      'Samstag',
      'Sonntag',
    ]);
    await expect(page.getByRole('combobox', { name: 'Datums-Eigenschaft' })).toHaveValue('due');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
    await page.screenshot({ path: testInfo.outputPath('calendar-de-dark.png'), fullPage: true });

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(242, 242, 242)');
    await page.screenshot({ path: testInfo.outputPath('calendar-de-light.png'), fullPage: true });
  });
});
