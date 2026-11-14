import { expect, test, type Page } from '@playwright/test';

const treeRows = (page: Page) => page.getByRole('treeitem');
const treeRow = (page: Page, name: string) => treeRows(page).filter({ hasText: name });
const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const rowList = (page: Page) => page.getByRole('region', { name: 'Rows' });
const rowLinks = (page: Page) => rowList(page).getByRole('link');
const tableIcon = (page: Page, name: string) => treeRow(page, name).locator('svg.lucide-table');
const editor = (page: Page) => page.locator('.bn-editor');

async function createPage(page: Page, name: string) {
  await page.getByRole('button', { name: 'New page' }).click();
  await expect(title(page)).toBeFocused();
  await title(page).fill(name);
  await expect(treeRow(page, name)).toBeVisible();
}

/** Creates a top-level database from the menu of the "Pages" header. */
async function createDatabase(page: Page, name: string) {
  await page.getByRole('button', { name: 'More to create' }).click();
  await page.getByRole('menuitem', { name: 'New database' }).click();
  await expect(title(page)).toBeFocused();
  await expect(title(page)).toHaveValue('');
  await title(page).fill(name);
  await expect(treeRow(page, name)).toBeVisible();
}

/** Adds a row to the open database and gives it a title on its own page. */
async function addRow(page: Page, databaseName: string, name: string) {
  const before = await rowLinks(page).count();
  await rowList(page).getByRole('button', { name: 'New', exact: true }).click();
  await expect(rowLinks(page)).toHaveCount(before + 1);
  await rowLinks(page).last().click();
  await expect(title(page)).toBeFocused();
  await title(page).fill(name);
  await treeRow(page, databaseName).click();
  await expect(rowLinks(page).last()).toHaveText(name);
}

async function openMenu(page: Page, name: string) {
  await treeRow(page, name).hover();
  await treeRow(page, name).getByRole('button', { name: 'Page actions' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('a database is created from the header menu, shows its icon and survives a restart', async ({
  page,
}) => {
  await createDatabase(page, 'Tasks');

  await expect(tableIcon(page, 'Tasks')).toBeVisible();
  await expect(rowList(page)).toContainText('No rows yet');
  // A database has rows instead of text.
  await expect(editor(page)).toHaveCount(0);
  // Its children are rows, so there is nothing to add from the sidebar.
  await treeRow(page, 'Tasks').hover();
  await expect(treeRow(page, 'Tasks').getByRole('button', { name: 'Add a subpage' })).toHaveCount(
    0,
  );

  // Starting the app again means loading its entry page.
  await page.goto('/');

  await expect(title(page)).toHaveValue('Tasks');
  await expect(treeRows(page)).toHaveText(['Tasks']);
  await expect(tableIcon(page, 'Tasks')).toBeVisible();
  await expect(rowList(page)).toContainText('No rows yet');
});

test('a database is added below a page from the menu of its row', async ({ page }) => {
  await createPage(page, 'Projects');

  await openMenu(page, 'Projects');
  await page.getByRole('menuitem', { name: 'Add database' }).click();
  await expect(title(page)).toBeFocused();
  await title(page).fill('Tasks');

  await expect(treeRows(page)).toHaveText(['Projects', 'Tasks']);
  await expect(treeRow(page, 'Tasks')).toHaveAttribute('aria-level', '2');
  await expect(tableIcon(page, 'Tasks')).toBeVisible();
  await expect(tableIcon(page, 'Projects')).toHaveCount(0);
  await expect(rowList(page)).toBeVisible();

  // A database cannot have a database of its own.
  await openMenu(page, 'Tasks');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add database' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('/');

  await expect(title(page)).toHaveValue('Tasks');
  await expect(treeRows(page)).toHaveText(['Projects', 'Tasks']);
  await expect(treeRow(page, 'Tasks')).toHaveAttribute('aria-level', '2');
});

test('rows are listed in the database and stay out of the sidebar', async ({ page }) => {
  await createDatabase(page, 'Tasks');
  await createPage(page, 'Notes');
  await treeRow(page, 'Tasks').click();

  await addRow(page, 'Tasks', 'Write spec');
  await addRow(page, 'Tasks', 'Build it');
  await rowList(page).getByRole('button', { name: 'New', exact: true }).click();

  await expect(rowLinks(page)).toHaveText(['Write spec', 'Build it', 'Untitled']);
  await expect(treeRows(page)).toHaveText(['Tasks', 'Notes']);
  await expect(treeRow(page, 'Tasks').getByRole('button', { name: /Expand|Collapse/ })).toHaveCount(
    0,
  );

  await page.goto('/');

  await expect(title(page)).toHaveValue('Tasks');
  await expect(rowLinks(page)).toHaveText(['Write spec', 'Build it', 'Untitled']);
  await expect(treeRows(page)).toHaveText(['Tasks', 'Notes']);

  // A row is a page: it opens with its own title and text.
  await rowLinks(page).first().click();
  await expect(title(page)).toHaveValue('Write spec');
  await expect(editor(page)).toBeVisible();
  await expect(treeRows(page)).toHaveText(['Tasks', 'Notes']);
});

test('a database is renamed from its title and from the sidebar', async ({ page }) => {
  await createDatabase(page, 'Tasks');

  await title(page).fill('Chores');
  await expect(treeRows(page)).toHaveText(['Chores']);

  await openMenu(page, 'Chores');
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  // While it is edited, the row shows an input instead of its title.
  const input = page.getByRole('tree').getByRole('textbox', { name: 'Page title' });
  await expect(input).toBeFocused();
  await input.fill('Errands');
  await input.press('Enter');

  await expect(treeRows(page)).toHaveText(['Errands']);
  await expect(title(page)).toHaveValue('Errands');
  await expect(tableIcon(page, 'Errands')).toBeVisible();

  await page.goto('/');

  await expect(title(page)).toHaveValue('Errands');
  await expect(treeRows(page)).toHaveText(['Errands']);
});

test('deleting a database asks first, names its rows and takes them along', async ({ page }) => {
  await createDatabase(page, 'Tasks');
  await addRow(page, 'Tasks', 'Write spec');
  await addRow(page, 'Tasks', 'Build it');
  await createPage(page, 'Keep me');
  await treeRow(page, 'Tasks').click();
  // The open page is one of the rows that are about to go.
  await rowLinks(page).first().click();
  await expect(title(page)).toHaveValue('Write spec');

  await openMenu(page, 'Tasks');
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete “Tasks”?');
  await expect(dialog).toContainText('This also deletes 2 rows. This cannot be undone.');
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect(treeRows(page)).toHaveText(['Keep me']);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.goto('/');

  await expect(treeRows(page)).toHaveText(['Keep me']);
  // Nothing of the database is left for the picker to offer.
  await treeRow(page, 'Keep me').click();
  await title(page).press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('[[');
  await expect(
    page.getByRole('listbox', { name: 'Link to a page' }).getByRole('option'),
  ).toHaveText(['Keep me']);
});

test('deleting a page names the database below it as a subpage and its rows as rows', async ({
  page,
}) => {
  await createPage(page, 'Projects');
  await openMenu(page, 'Projects');
  await page.getByRole('menuitem', { name: 'Add database' }).click();
  await expect(title(page)).toBeFocused();
  await title(page).fill('Tasks');
  await addRow(page, 'Tasks', 'Write spec');

  await openMenu(page, 'Projects');
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('This also deletes 1 subpage and 1 row.');
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('a link to a row shows the title of the row and opens it', async ({ page }) => {
  await createDatabase(page, 'Tasks');
  await addRow(page, 'Tasks', 'Write spec');
  await createPage(page, 'Source');
  await title(page).press('Enter');
  await expect(editor(page)).toBeFocused();

  await page.keyboard.type('See [[Write');
  await expect(
    page.getByRole('listbox', { name: 'Link to a page' }).getByRole('option'),
  ).toHaveText(['Write spec']);
  await page.keyboard.press('Enter');

  const link = editor(page).locator('[data-page-link]');
  await expect(link).toHaveText('Write spec');
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''))
    .toContain('pageLink');

  // The link follows the title of the row, and still does after a restart.
  await treeRow(page, 'Tasks').click();
  await rowLinks(page).first().click();
  await title(page).fill('Write the spec');
  await treeRow(page, 'Source').click();
  await expect(link).toHaveText('Write the spec');

  await page.goto('/');
  await expect(link).toHaveText('Write the spec');

  await link.click();
  await expect(title(page)).toHaveValue('Write the spec');
  await expect(page.getByRole('navigation', { name: 'Backlinks' }).getByRole('link')).toHaveText([
    'Source',
  ]);
  await expect(treeRows(page)).toHaveText(['Tasks', 'Source']);
});

test('a page cannot be dragged into a database', async ({ page }) => {
  await createPage(page, 'Alpha');
  await createDatabase(page, 'Tasks');
  await createPage(page, 'Beta');
  await expect(treeRows(page)).toHaveText(['Alpha', 'Tasks', 'Beta']);

  // Dropping on the middle of a row would make the page a subpage.
  await treeRow(page, 'Beta').dragTo(treeRow(page, 'Tasks'), { targetPosition: { x: 60, y: 14 } });

  await expect(treeRow(page, 'Beta')).toHaveAttribute('aria-level', '1');
  await expect(treeRow(page, 'Tasks').getByRole('button', { name: /Expand|Collapse/ })).toHaveCount(
    0,
  );

  // The database itself moves like a page.
  await treeRow(page, 'Tasks').dragTo(treeRow(page, 'Alpha'), { targetPosition: { x: 60, y: 14 } });
  await expect(
    treeRow(page, 'Alpha').getByRole('button', { name: /Expand|Collapse/ }),
  ).toBeVisible();
  if (await treeRow(page, 'Tasks').isHidden()) {
    await treeRow(page, 'Alpha').getByRole('button', { name: 'Expand' }).click();
  }
  await expect(treeRow(page, 'Tasks')).toHaveAttribute('aria-level', '2');
  await expect(tableIcon(page, 'Tasks')).toBeVisible();
});
