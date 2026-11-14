import { expect, test, type Page } from '@playwright/test';

const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const grid = (page: Page) => page.getByRole('grid');
const headers = (page: Page) => grid(page).getByRole('columnheader');
const bodyRows = (page: Page) =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell') });
const row = (page: Page, name: string) => grid(page).getByRole('row', { name, exact: true });
const titleEditor = (page: Page) => grid(page).getByRole('textbox', { name: 'Name' });
const header = (page: Page, name: string) =>
  headers(page).filter({ has: page.getByRole('button', { name, exact: true }) });
const dialog = (page: Page) => page.getByRole('alertdialog');

/** The names in the header, the title column first and the `+` last. */
async function headerNames(page: Page) {
  return (await headers(page).allTextContents()).slice(0, -1);
}

async function rowNames(page: Page) {
  return bodyRows(page).evaluateAll((rows) => rows.map((line) => line.getAttribute('aria-label')));
}

/** The cell of a row (by its title) in a column (by its header). */
async function cell(page: Page, rowName: string, column: string) {
  const index = (await headers(page).allTextContents()).indexOf(column);
  expect(index, `column ${column}`).toBeGreaterThanOrEqual(0);
  return row(page, rowName).getByRole('gridcell').nth(index);
}

async function createDatabase(page: Page, name: string) {
  await page.getByRole('button', { name: 'More to create' }).click();
  await page.getByRole('menuitem', { name: 'New database' }).click();
  await expect(title(page)).toBeFocused();
  await title(page).fill(name);
  await expect(grid(page)).toBeVisible();
}

async function addProperty(page: Page, type: string, name: string) {
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page
    .getByRole('dialog', { name: 'Add a property' })
    .getByRole('button', { name: type })
    .click();
  const input = page.getByRole('textbox', { name: 'Property name' });
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press('Enter');
  await expect(header(page, name)).toBeVisible();
}

async function addRow(page: Page, name: string) {
  const before = await bodyRows(page).count();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(bodyRows(page)).toHaveCount(before + 1);
  await expect(titleEditor(page)).toBeFocused();
  await titleEditor(page).fill(name);
  await titleEditor(page).press('Enter');
  await expect(row(page, name)).toBeVisible();
}

async function openHeaderMenu(page: Page, name: string) {
  await header(page, name).getByRole('button', { name, exact: true }).click();
}

/** Types into a text or number cell and saves with Enter. */
async function typeIntoCell(page: Page, rowName: string, column: string, text: string) {
  await (await cell(page, rowName, column)).click();
  const input = grid(page).getByRole('textbox', { name: column });
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/** Starting the app again: the fake backend reads what it stored, the address stays. */
async function restart(page: Page) {
  await page.reload();
  await expect(grid(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('properties of every type are added, renamed and deleted', async ({ page }) => {
  await createDatabase(page, 'Tasks');
  await expect(headerNames(page)).resolves.toEqual(['Name']);

  await addProperty(page, 'Text', 'Notes');
  await addProperty(page, 'Number', 'Hours');
  await addProperty(page, 'Date', 'Due');
  await addProperty(page, 'Select', 'Status');
  await expect.poll(() => headerNames(page)).toEqual(['Name', 'Notes', 'Hours', 'Due', 'Status']);
  // Each property shows the icon of its type.
  await expect(header(page, 'Hours').locator('svg.lucide-hash')).toBeVisible();
  await expect(header(page, 'Due').locator('svg.lucide-calendar')).toBeVisible();

  await openHeaderMenu(page, 'Notes');
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = grid(page).getByRole('textbox', { name: 'Property name' });
  await expect(rename).toBeFocused();
  await rename.fill('Comments');
  await rename.press('Enter');
  await expect(header(page, 'Comments')).toBeVisible();

  await openHeaderMenu(page, 'Due');
  await page.getByRole('menuitem', { name: 'Delete property' }).click();
  await expect(dialog(page)).toContainText('Delete “Due”?');
  // Cancelling keeps it.
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(header(page, 'Due')).toBeVisible();
  await openHeaderMenu(page, 'Due');
  await page.getByRole('menuitem', { name: 'Delete property' }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => headerNames(page)).toEqual(['Name', 'Comments', 'Hours', 'Status']);

  // The title column cannot be renamed, retyped or deleted.
  await expect(headers(page).first().getByRole('button')).toHaveCount(0);

  await restart(page);
  await expect.poll(() => headerNames(page)).toEqual(['Name', 'Comments', 'Hours', 'Status']);
  await expect(header(page, 'Status').locator('svg.lucide-circle-chevron-down')).toBeVisible();
});

test('changing a type asks first, converts what it can and drops the rest', async ({ page }) => {
  await createDatabase(page, 'Tasks');
  await addProperty(page, 'Text', 'Estimate');
  await addRow(page, 'Write spec');
  await addRow(page, 'Build it');
  await typeIntoCell(page, 'Write spec', 'Estimate', '42');
  await typeIntoCell(page, 'Build it', 'Estimate', 'a lot');

  await openHeaderMenu(page, 'Estimate');
  await page.getByRole('menuitem', { name: 'Change type' }).click();
  await page.getByRole('menuitem', { name: 'Number' }).click();
  await expect(dialog(page)).toContainText('Change “Estimate” to Number?');
  await expect(dialog(page)).toContainText('Values that cannot be converted are dropped.');
  await dialog(page).getByRole('button', { name: 'Change type' }).click();

  await expect(header(page, 'Estimate').locator('svg.lucide-hash')).toBeVisible();
  await expect(await cell(page, 'Write spec', 'Estimate')).toHaveText('42');
  await expect(await cell(page, 'Build it', 'Estimate')).toHaveText('');

  await restart(page);
  await expect(header(page, 'Estimate').locator('svg.lucide-hash')).toBeVisible();
  await expect(await cell(page, 'Write spec', 'Estimate')).toHaveText('42');
  await expect(await cell(page, 'Build it', 'Estimate')).toHaveText('');
});

test('rows are added, edited in every type, opened and deleted', async ({ page }) => {
  await createDatabase(page, 'Tasks');
  await addProperty(page, 'Text', 'Notes');
  await addProperty(page, 'Number', 'Hours');
  await addProperty(page, 'Date', 'Due');
  await addProperty(page, 'Select', 'Status');
  await addRow(page, 'Write spec');
  await addRow(page, 'Build it');
  await addRow(page, 'Ship it');
  await expect.poll(() => rowNames(page)).toEqual(['Write spec', 'Build it', 'Ship it']);

  // Text and number are typed in place.
  await typeIntoCell(page, 'Write spec', 'Notes', 'First draft');
  await typeIntoCell(page, 'Write spec', 'Hours', '12.5');
  await expect(await cell(page, 'Write spec', 'Notes')).toHaveText('First draft');
  await expect(await cell(page, 'Write spec', 'Hours')).toHaveText('12.5');

  // Something that is not a number is refused and stays open until another cell is clicked.
  await (await cell(page, 'Build it', 'Hours')).click();
  const hours = grid(page).getByRole('textbox', { name: 'Hours' });
  await hours.fill('many');
  await hours.press('Enter');
  await expect(hours).toHaveAttribute('aria-invalid', 'true');
  await (await cell(page, 'Build it', 'Notes')).click();
  await expect(hours).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(await cell(page, 'Build it', 'Hours')).toHaveText('');

  // A date is picked from a calendar.
  await (await cell(page, 'Write spec', 'Due')).click();
  const calendar = page.getByRole('dialog', { name: 'Due' });
  await calendar.getByRole('button', { name: /15th/ }).click();
  await expect(calendar).toHaveCount(0);
  await expect(await cell(page, 'Write spec', 'Due')).toHaveText(/^\w{3} 15, \d{4}$/);

  // A select creates its option on the spot, and the next row can choose it.
  await (await cell(page, 'Write spec', 'Status')).click();
  const options = page.getByRole('dialog', { name: 'Status' });
  await options.getByRole('combobox').fill('Doing');
  await options.getByRole('option', { name: 'Create “Doing”' }).click();
  await expect(options).toHaveCount(0);
  await expect(await cell(page, 'Write spec', 'Status')).toHaveText('Doing');
  await (await cell(page, 'Build it', 'Status')).click();
  await options.getByRole('option', { name: 'Doing' }).click();
  await expect(await cell(page, 'Build it', 'Status')).toHaveText('Doing');

  // The title is edited in place too.
  await (await cell(page, 'Ship it', 'Name')).click();
  await titleEditor(page).fill('Release it');
  await titleEditor(page).press('Enter');
  await expect.poll(() => rowNames(page)).toEqual(['Write spec', 'Build it', 'Release it']);

  await restart(page);
  await expect.poll(() => rowNames(page)).toEqual(['Write spec', 'Build it', 'Release it']);
  await expect(await cell(page, 'Write spec', 'Notes')).toHaveText('First draft');
  await expect(await cell(page, 'Write spec', 'Hours')).toHaveText('12.5');
  await expect(await cell(page, 'Write spec', 'Due')).toHaveText(/^\w{3} 15, \d{4}$/);
  await expect(await cell(page, 'Write spec', 'Status')).toHaveText('Doing');
  await expect(await cell(page, 'Build it', 'Status')).toHaveText('Doing');
  await expect(await cell(page, 'Build it', 'Hours')).toHaveText('');

  // A row opens as its own page, and the table is there again on the way back.
  await row(page, 'Build it').hover();
  await row(page, 'Build it').getByRole('link', { name: 'Open' }).click();
  await expect(title(page)).toHaveValue('Build it');
  await expect(grid(page)).toHaveCount(0);
  await page.goBack();
  await expect(title(page)).toHaveValue('Tasks');
  await expect(await cell(page, 'Build it', 'Status')).toHaveText('Doing');

  // Deleting a row asks first, like deleting a page.
  await row(page, 'Build it').hover();
  await row(page, 'Build it').getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(dialog(page)).toContainText('Delete “Build it”?');
  await expect(dialog(page)).toContainText('This cannot be undone.');
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => rowNames(page)).toEqual(['Write spec', 'Release it']);

  await restart(page);
  await expect.poll(() => rowNames(page)).toEqual(['Write spec', 'Release it']);
  await expect(page.getByRole('treeitem')).toHaveText(['Tasks']);
});

test('the keyboard reaches the header and edits cells', async ({ page }) => {
  await createDatabase(page, 'Tasks');
  await addProperty(page, 'Text', 'Notes');
  await addRow(page, 'Write spec');

  // From the page title, Tab goes through the header to the first cell. WebKit,
  // like Safari, reaches buttons only with Option-Tab.
  const tab = () => page.keyboard.press('Alt+Tab');
  await title(page).focus();
  await tab();
  await expect(header(page, 'Notes').getByRole('button')).toBeFocused();
  await tab();
  await expect(page.getByRole('button', { name: 'Add a property' })).toBeFocused();
  await tab();
  await expect(await cell(page, 'Write spec', 'Name')).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(await cell(page, 'Write spec', 'Notes')).toBeFocused();
  await page.keyboard.press('Enter');
  const notes = grid(page).getByRole('textbox', { name: 'Notes' });
  await expect(notes).toBeFocused();
  await page.keyboard.type('Typed');
  await page.keyboard.press('Escape');
  await expect(notes).toHaveCount(0);
  await expect(await cell(page, 'Write spec', 'Notes')).toBeFocused();
  await expect(await cell(page, 'Write spec', 'Notes')).toHaveText('');
});

test('a database with 10,000 rows renders only the visible ones and scrolls to the last', async ({
  page,
}) => {
  // Seeded straight into the fake backend's storage, then loaded like a restart.
  await page.evaluate(() => {
    const pages: Record<string, string | number | null>[] = [
      { id: 'big', title: 'Big', parentId: null, position: 0, kind: 'database', databaseId: null },
    ];
    const cells: Record<string, Record<string, number>> = {};
    for (let index = 0; index < 10_000; index += 1) {
      const id = `row-${index}`;
      pages.push({
        id,
        title: `Row ${index + 1}`,
        parentId: 'big',
        position: index,
        kind: 'page',
        databaseId: 'big',
      });
      cells[id] = { amount: index + 1 };
    }
    const properties = [
      {
        id: 'amount',
        databaseId: 'big',
        name: 'Amount',
        type: 'number',
        position: 0,
        options: [],
        targetId: null,
      },
    ];
    window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
    window.localStorage.setItem(
      'notiva.fake.databases',
      JSON.stringify({ properties, views: [], cells }),
    );
  });
  await page.reload();
  await page.goto('/#/page/big');

  await expect(title(page)).toHaveValue('Big');
  await expect(row(page, 'Row 1')).toBeVisible();
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '10001');
  expect(await grid(page).getByRole('row').count()).toBeLessThan(100);

  await page
    .getByRole('region', { name: 'Rows' })
    .evaluate((scroller) => scroller.scrollTo({ top: scroller.scrollHeight }));

  await expect(row(page, 'Row 10000')).toBeVisible();
  await expect(await cell(page, 'Row 10000', 'Amount')).toHaveText('10,000');
  expect(await grid(page).getByRole('row').count()).toBeLessThan(100);
  await expect(row(page, 'Row 1')).toHaveCount(0);
  // The table is at most as tall as the main area, which scrolls on to "New" below it.
  const newRow = page.getByRole('button', { name: 'New', exact: true });
  await newRow.scrollIntoViewIfNeeded();
  await expect(newRow).toBeInViewport();
  await expect(row(page, 'Row 10000')).toBeInViewport();
});
