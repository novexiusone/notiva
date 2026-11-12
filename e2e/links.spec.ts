import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('.bn-editor');
const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const treeRow = (page: Page, name: string) => page.getByRole('treeitem').filter({ hasText: name });
const link = (page: Page) => editor(page).locator('[data-page-link]');
const backlinks = (page: Page) => page.getByRole('navigation', { name: 'Backlinks' });

async function newPage(page: Page, name: string) {
  await page.getByRole('button', { name: 'New page' }).click();
  await title(page).fill(name);
  await title(page).press('Enter');
  await expect(editor(page)).toBeFocused();
}

async function waitForSave(page: Page, text: string) {
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''))
    .toContain(text);
}

/** Two pages, "Target" and "Source", where Source links to Target. */
async function linkSourceToTarget(page: Page) {
  await newPage(page, 'Target');
  await newPage(page, 'Source');
  await page.keyboard.type('See [[Tar');
  await expect(
    page.getByRole('listbox', { name: 'Link to a page' }).getByRole('option'),
  ).toHaveText(['Target']);
  await page.keyboard.press('Enter');
  await expect(link(page)).toHaveText('Target');
  await waitForSave(page, 'pageLink');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('two brackets open a page picker and insert a link', async ({ page }) => {
  await linkSourceToTarget(page);

  await page.keyboard.type('for details');

  await expect(editor(page)).toContainText('See Target for details');
  await expect(editor(page)).not.toContainText('[[');
});

test('the picker lists pages and filters them by title', async ({ page }) => {
  await newPage(page, 'Apple pie');
  await newPage(page, 'Apricot jam');
  await newPage(page, 'Bread');

  await page.keyboard.type('[[');
  const options = page.getByRole('listbox', { name: 'Link to a page' }).getByRole('option');
  await expect(options).toHaveText(['Apple pie', 'Apricot jam', 'Bread']);

  await page.keyboard.type('ap');
  await expect(options).toHaveText(['Apple pie', 'Apricot jam']);

  await page.keyboard.type('zzz');
  await expect(page.getByText('No matching pages')).toBeVisible();
});

test('clicking a link opens the page, which lists the linking page as a backlink', async ({
  page,
}) => {
  await linkSourceToTarget(page);

  await link(page).click();

  await expect(title(page)).toHaveValue('Target');
  await expect(backlinks(page).getByRole('link')).toHaveText(['Source']);

  await backlinks(page).getByRole('link', { name: 'Source' }).click();
  await expect(title(page)).toHaveValue('Source');
  await expect(backlinks(page)).toHaveCount(0);
});

test('renaming the target changes the text of the link', async ({ page }) => {
  await linkSourceToTarget(page);

  await treeRow(page, 'Target').click();
  await title(page).fill('Renamed target');
  await treeRow(page, 'Source').click();

  await expect(link(page)).toHaveText('Renamed target');
});

test('a link to a deleted page says so and cannot be followed', async ({ page }) => {
  await linkSourceToTarget(page);

  await treeRow(page, 'Target').hover();
  await treeRow(page, 'Target').getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(treeRow(page, 'Target')).toHaveCount(0);

  await expect(link(page)).toHaveText('Deleted page');
  await link(page).click();
  await expect(title(page)).toHaveValue('Source');
});

test('links and backlinks are still there after a restart', async ({ page }) => {
  await linkSourceToTarget(page);

  await page.goto('/');
  await expect(link(page)).toHaveText('Target');

  await link(page).click();
  await expect(backlinks(page).getByRole('link')).toHaveText(['Source']);
});

test('removing the link removes the backlink', async ({ page }) => {
  await linkSourceToTarget(page);

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(link(page)).toHaveCount(0);
  await page.keyboard.type('nothing');
  await waitForSave(page, 'nothing');

  await treeRow(page, 'Target').click();
  await expect(title(page)).toHaveValue('Target');
  await expect(backlinks(page)).toHaveCount(0);
});
