import { expect, test, type Page } from '@playwright/test';

const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const treeRow = (page: Page, name: string) => page.getByRole('treeitem').filter({ hasText: name });

async function newPage(page: Page, name: string) {
  await page.getByRole('button', { name: 'New page' }).click();
  await title(page).fill(name);
  await expect(treeRow(page, name)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
  await newPage(page, 'Projects');
  await page.getByRole('button', { name: 'Add a subpage' }).click();
  await title(page).fill('Notiva');
  await newPage(page, 'Reading list');
});

test('a page is exported with its subpages from its menu', async ({ page }) => {
  await treeRow(page, 'Projects').hover();
  await treeRow(page, 'Projects').getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Export as Markdown…' }).click();

  await expect(
    page.getByText('Exported 2 pages to /Users/demo/Documents/Notiva export'),
  ).toBeVisible();
});

test('a page without subpages is counted as one page', async ({ page }) => {
  await treeRow(page, 'Reading list').hover();
  await treeRow(page, 'Reading list').getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Export as Markdown…' }).click();

  await expect(
    page.getByText('Exported 1 page to /Users/demo/Documents/Notiva export'),
  ).toBeVisible();
});

test('every page is exported from the settings menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Export all pages…' }).click();

  await expect(
    page.getByText('Exported 3 pages to /Users/demo/Documents/Notiva export'),
  ).toBeVisible();
});

test('dismissing the folder dialog exports nothing', async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem('notiva.fake.dialog', 'cancel'));

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Export all pages…' }).click();

  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(page.getByText(/Exported/)).toHaveCount(0);
  await expect(page.getByText(/export failed/)).toHaveCount(0);
});

test('a failed export says why', async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem('notiva.fake.export', 'fail'));

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Export all pages…' }).click();

  await expect(
    page.getByText('The export failed: could not write the export: the disk is full'),
  ).toBeVisible();
});
