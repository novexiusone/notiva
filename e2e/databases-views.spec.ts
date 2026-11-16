import { expect, test, type Page } from '@playwright/test';

const grid = (page: Page) => page.getByRole('grid');
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name, exact: true });
const headers = (page: Page) => grid(page).getByRole('columnheader');
const toolbarButton = (page: Page, name: RegExp) =>
  page.getByRole('group', { name: 'View toolbar' }).getByRole('button', { name });

/** The names of the lines of the body: rows by their title, groups by their value. */
async function lineNames(page: Page) {
  return grid(page)
    .getByRole('row')
    .evaluateAll((rows) => rows.slice(1).map((line) => line.getAttribute('aria-label')));
}

const emptyTable = {
  version: 1,
  type: 'table',
  filters: [],
  sorts: [],
  properties: [],
  groupBy: null,
};

/** A database "Tasks" with rows, a number and a select, and the views "All" and "Board". */
async function seed(page: Page, rowCount = 0) {
  await page.evaluate(
    ({ emptyTable, rowCount }) => {
      const pages: Record<string, string | number | null>[] = [
        {
          id: 'db',
          title: 'Tasks',
          parentId: null,
          position: 0,
          kind: 'database',
          databaseId: null,
        },
      ];
      const cells: Record<string, Record<string, string | number>> = {};
      const add = (id: string, title: string, hours: number | null, status: string | null) => {
        pages.push({
          id,
          title,
          parentId: 'db',
          position: pages.length,
          kind: 'page',
          databaseId: 'db',
        });
        cells[id] = {};
        if (hours !== null) cells[id].hours = hours;
        if (status !== null) cells[id].status = status;
      };
      if (rowCount === 0) {
        add('r1', 'Write spec', 3, 'done');
        add('r2', 'Build it', 8, 'todo');
        add('r3', 'Test it', 2, 'todo');
        add('r4', 'Plan it', null, null);
      } else {
        for (let index = 0; index < rowCount; index += 1) {
          add(`r${index}`, `Row ${index + 1}`, index % 10, ['todo', 'done', null][index % 3]!);
        }
      }
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
        property('hours', 'Hours', 'number', 0),
        {
          ...property('status', 'Status', 'select', 1),
          options: [
            { id: 'todo', name: 'Todo', color: 'gray' },
            { id: 'done', name: 'Done', color: 'green' },
          ],
        },
      ];
      const views = [
        { id: 'v1', databaseId: 'db', name: 'All', position: 0, config: emptyTable },
        { id: 'v2', databaseId: 'db', name: 'Board', position: 1, config: emptyTable },
      ];
      window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
      window.localStorage.setItem(
        'notiva.fake.databases',
        JSON.stringify({ properties, views, cells }),
      );
    },
    { emptyTable, rowCount },
  );
  await page.reload();
  await page.goto('/#/page/db');
  await expect(grid(page)).toBeVisible();
}

/** The stored configuration of a view, as the fake backend keeps it. */
async function storedConfig(page: Page, viewId: string) {
  return page.evaluate((viewId) => {
    const stored = JSON.parse(window.localStorage.getItem('notiva.fake.databases') ?? '{}') as {
      views: { id: string; config: unknown }[];
    };
    return stored.views.find((view) => view.id === viewId)?.config;
  }, viewId);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('two views keep different filters, sorts and groupings across a reload', async ({ page }) => {
  await seed(page);
  await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true');

  // "All": only rows with more than two hours, the longest first.
  await toolbarButton(page, /^Filter/).click();
  const filters = page.getByRole('dialog', { name: 'Filters' });
  await filters.getByRole('button', { name: 'Add a filter' }).click();
  await filters.getByRole('button', { name: 'Name', exact: true }).click();
  const condition = filters.getByRole('group', { name: 'Filter 1' });
  await condition.getByRole('combobox', { name: 'Property' }).selectOption('Hours');
  await condition.getByRole('combobox', { name: 'Condition' }).selectOption('greaterThan');
  await condition.getByRole('textbox', { name: 'Value' }).fill('2');
  await page.keyboard.press('Escape');
  await toolbarButton(page, /^Sort/).click();
  const sorts = page.getByRole('dialog', { name: 'Sorts' });
  await sorts.getByRole('button', { name: 'Add a sort' }).click();
  await sorts.getByRole('combobox', { name: 'Property' }).selectOption('Hours');
  await sorts.getByRole('combobox', { name: 'Direction' }).selectOption('desc');
  await page.keyboard.press('Escape');
  await expect.poll(() => lineNames(page)).toEqual(['Build it', 'Write spec']);

  // "Board": grouped by status, everything shown.
  await tab(page, 'Board').click();
  await expect
    .poll(() => lineNames(page))
    .toEqual(['Write spec', 'Build it', 'Test it', 'Plan it']);
  await toolbarButton(page, /^View settings/).click();
  await page
    .getByRole('dialog', { name: 'View settings' })
    .getByRole('combobox', { name: 'Group by' })
    .selectOption('Status');
  await page.keyboard.press('Escape');
  await expect
    .poll(() => lineNames(page))
    .toEqual(['Todo', 'Build it', 'Test it', 'Done', 'Write spec', 'No Status', 'Plan it']);

  // Saved after the pause, without a save button.
  await expect
    .poll(() => storedConfig(page, 'v2'))
    .toMatchObject({ groupBy: { propertyId: 'status', collapsed: [] } });

  await page.reload();
  await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => lineNames(page))
    .toEqual(['Todo', 'Build it', 'Test it', 'Done', 'Write spec', 'No Status', 'Plan it']);
  await tab(page, 'All').click();
  await expect.poll(() => lineNames(page)).toEqual(['Build it', 'Write spec']);
  await expect(toolbarButton(page, /^Filter/)).toHaveText('Filter1');
  await expect(toolbarButton(page, /^Sort/)).toHaveText('Sort1');
});

test('the address carries the active view and a reload stays on it', async ({ page }) => {
  await seed(page);

  await tab(page, 'Board').click();
  await expect(page).toHaveURL(/#\/page\/db\?view=v2$/);
  await page.reload();
  await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true');

  await tab(page, 'All').click();
  await expect(page).toHaveURL(/#\/page\/db\?view=v1$/);

  // Without a view in the address, the one that was active last is shown.
  await page.goto('/#/page/db');
  await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true');
});

test('the properties list works with the keyboard alone', async ({ page }) => {
  await seed(page);
  await expect(headers(page)).toHaveText(['Name', 'Hours', 'Status', '']);

  const button = toolbarButton(page, /^View settings/);
  await button.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('dialog', { name: 'View settings' });
  const hours = menu.getByRole('checkbox', { name: 'Hours' });
  // WebKit, like Safari, reaches buttons (a checkbox is one) only with Option-Tab.
  await hours.focus();
  await page.keyboard.press('Space');
  await expect(hours).not.toBeChecked();
  await expect(headers(page)).toHaveText(['Name', 'Status', '']);

  await page.keyboard.press('Alt+Tab');
  await expect(menu.getByRole('checkbox', { name: 'Status' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('a database of 3,000 rows filters and groups with only the visible rows rendered', async ({
  page,
}) => {
  await seed(page, 3_000);
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '3001');

  await toolbarButton(page, /^View settings/).click();
  await page
    .getByRole('dialog', { name: 'View settings' })
    .getByRole('combobox', { name: 'Group by' })
    .selectOption('Status');
  await page.keyboard.press('Escape');
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '3004');
  await expect(grid(page).getByRole('row', { name: 'Todo', exact: true })).toBeVisible();
  expect(await grid(page).getByRole('row').count()).toBeLessThan(100);

  await toolbarButton(page, /^Filter/).click();
  const filters = page.getByRole('dialog', { name: 'Filters' });
  await filters.getByRole('button', { name: 'Add a filter' }).click();
  await filters.getByRole('button', { name: 'Name', exact: true }).click();
  const condition = filters.getByRole('group', { name: 'Filter 1' });
  await condition.getByRole('combobox', { name: 'Property' }).selectOption('Hours');
  await condition.getByRole('textbox', { name: 'Value' }).fill('9');
  await page.keyboard.press('Escape');
  // Every tenth row has nine hours: 300 rows in three groups.
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '304');

  // Collapsing the first group takes its rows out of the body.
  await grid(page)
    .getByRole('button', { name: /^Todo, / })
    .click();
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '204');
});
