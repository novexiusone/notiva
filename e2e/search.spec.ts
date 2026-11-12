import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('.bn-editor');
const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Search' });
const input = (page: Page) => dialog(page).getByPlaceholder('Search pages and content');
const results = (page: Page) => dialog(page).getByRole('option');

async function newPage(page: Page, name: string, text: string) {
  await page.getByRole('button', { name: 'New page' }).click();
  await title(page).fill(name);
  await title(page).press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(text);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''))
    .toContain(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
  await newPage(page, 'Bread', 'Sourdough needs a long fermentation.');
  await newPage(page, 'Garden', 'The fence needs paint before winter.');
});

test('the shortcut and the sidebar entry open the search', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(input(page)).toBeFocused();
  await expect(dialog(page).getByText('Type at least two letters')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  await page.getByRole('button', { name: /Search/ }).click();
  await expect(input(page)).toBeFocused();
});

test('a page is found by its title', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await input(page).fill('gar');

  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('Garden');
});

test('a page is found by its content, with the match highlighted', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await input(page).fill('ferm');

  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('Bread');
  await expect(results(page).first()).toContainText('Sourdough needs a long fermentation.');
  await expect(results(page).first().locator('mark')).toHaveText(['fermentation']);
});

test('Enter opens the selected result and closes the search', async ({ page }) => {
  await expect(title(page)).toHaveValue('Garden');
  await page.keyboard.press('ControlOrMeta+k');
  await input(page).fill('sourdough');
  await expect(results(page)).toHaveCount(1);

  await page.keyboard.press('Enter');

  await expect(dialog(page)).toHaveCount(0);
  await expect(title(page)).toHaveValue('Bread');
});

test('arrow keys choose between several results', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await input(page).fill('needs');
  await expect(results(page)).toHaveCount(2);
  await expect(results(page).first()).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowDown');
  await expect(results(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  const chosen = await results(page).nth(1).locator('div.truncate').innerText();
  await page.keyboard.press('Enter');

  await expect(title(page)).toHaveValue(chosen);
});

test('text that was just written is found without a restart', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Marmalade too.');
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''))
    .toContain('Marmalade');

  await page.keyboard.press('ControlOrMeta+k');
  await input(page).fill('marma');

  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('Garden');
});

test('a search without matches says so', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await input(page).fill('zebra');

  await expect(dialog(page).getByRole('status')).toHaveText('No results for “zebra”');
});

test('the search starts empty every time it is opened', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await input(page).fill('ferm');
  await expect(results(page)).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+k');

  await expect(input(page)).toHaveValue('');
  await expect(results(page)).toHaveCount(0);
});
