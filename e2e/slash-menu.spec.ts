import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('.bn-editor');
const block = (page: Page, type: string) => editor(page).locator(`[data-content-type="${type}"]`);
const menu = (page: Page) => page.getByRole('listbox');
const options = (page: Page) => menu(page).getByRole('option');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New page' }).click();
  const title = page.getByRole('main').getByRole('textbox', { name: 'Page title' });
  await title.fill('Slash');
  await title.press('Enter');
  await expect(editor(page)).toBeFocused();
});

test('typing a slash opens the menu with its groups, shortcuts and footer', async ({ page }) => {
  await page.keyboard.type('/');

  await expect(menu(page).getByRole('group', { name: 'Suggested' })).toBeVisible();
  await expect(
    menu(page).getByRole('group', { name: 'Basic blocks' }).getByRole('option'),
  ).toHaveText([
    'Text',
    'Heading 1#',
    'Heading 2##',
    'Heading 3###',
    'Bulleted list-',
    'Numbered list1.',
    'To-do list[]',
    'Quote>',
    'Code```',
  ]);
  await expect(page.getByText('Type to filter')).toBeVisible();
  await expect(page.getByText('Close menu')).toBeVisible();
  await expect(page.getByText('esc', { exact: true })).toBeVisible();
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
});

test('typing filters the menu and shows the filter text', async ({ page }) => {
  await page.keyboard.type('/head');

  await expect(options(page)).toHaveText(['Heading 1#', 'Heading 2##', 'Heading 3###']);
  await expect(menu(page).getByRole('group', { name: 'Suggested' })).toHaveCount(0);
  await expect(page.getByText('head', { exact: true })).toBeVisible();
});

test('arrow keys and Enter insert the chosen block', async ({ page }) => {
  await page.keyboard.type('/head');
  await expect(options(page)).toHaveCount(3);

  await page.keyboard.press('ArrowDown');
  await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Chapter');

  await expect(menu(page)).toHaveCount(0);
  await expect(block(page, 'heading')).toHaveText('Chapter');
  await expect(block(page, 'heading')).toHaveAttribute('data-level', '2');
  await expect(editor(page)).not.toContainText('/head');
});

test('clicking an entry inserts the block', async ({ page }) => {
  await page.keyboard.type('/');

  await menu(page)
    .getByRole('group', { name: 'Basic blocks' })
    .getByRole('option', { name: 'To-do list' })
    .click();
  await page.keyboard.type('Buy milk');

  await expect(block(page, 'checkListItem')).toHaveText('Buy milk');
});

test('a search term in German finds the block too', async ({ page }) => {
  await page.keyboard.type('/zitat');

  await expect(options(page)).toHaveText(['Quote>']);
});

test('Escape closes the menu', async ({ page }) => {
  await page.keyboard.type('/');
  await expect(menu(page)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(menu(page)).toHaveCount(0);
});

test('a filter without matches says so', async ({ page }) => {
  await page.keyboard.type('/zzz');

  await expect(page.getByText('No matching blocks')).toBeVisible();
});
