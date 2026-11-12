import { expect, test, type Page } from '@playwright/test';

const rows = (page: Page) => page.getByRole('treeitem');
const row = (page: Page, title: string) => rows(page).filter({ hasText: title });
const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });

async function createPage(page: Page, name: string) {
  await page.getByRole('button', { name: 'New page' }).click();
  await expect(title(page)).toBeFocused();
  await title(page).fill(name);
  await expect(row(page, name)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('a new page is opened, titled and still there after a restart', async ({ page }) => {
  await createPage(page, 'Reading list');
  await page.getByRole('button', { name: 'Add a subpage' }).click();
  await title(page).fill('Fiction');
  await expect(rows(page)).toHaveText(['Reading list', 'Fiction']);

  // Starting the app again means loading its entry page.
  await page.goto('/');

  await expect(title(page)).toHaveValue('Fiction');
  await expect(rows(page)).toHaveText(['Reading list', 'Fiction']);
});

test('pages can be reordered and nested by dragging', async ({ page }) => {
  await createPage(page, 'Alpha');
  await createPage(page, 'Beta');
  await createPage(page, 'Gamma');
  await expect(rows(page)).toHaveText(['Alpha', 'Beta', 'Gamma']);

  // Dropping on the top edge of a row places the page before it.
  await row(page, 'Gamma').dragTo(row(page, 'Alpha'), { targetPosition: { x: 60, y: 2 } });
  await expect(rows(page)).toHaveText(['Gamma', 'Alpha', 'Beta']);

  // Dropping on the middle of a row makes the page a subpage.
  await row(page, 'Beta').dragTo(row(page, 'Alpha'), { targetPosition: { x: 60, y: 14 } });
  await expect(row(page, 'Alpha').getByRole('button', { name: /Expand|Collapse/ })).toBeVisible();
  if (await row(page, 'Beta').isHidden()) {
    await row(page, 'Alpha').getByRole('button', { name: 'Expand' }).click();
  }
  await expect(rows(page)).toHaveText(['Gamma', 'Alpha', 'Beta']);
  await expect(row(page, 'Beta')).toHaveAttribute('aria-level', '2');
});

test('deleting a page asks first and takes its subpages along', async ({ page }) => {
  await createPage(page, 'Projects');
  await page.getByRole('button', { name: 'Add a subpage' }).click();
  await title(page).fill('Notiva');
  await createPage(page, 'Keep me');

  await row(page, 'Projects').hover();
  await row(page, 'Projects').getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('This also deletes 1 subpage.');
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect(rows(page)).toHaveText(['Keep me']);
});
