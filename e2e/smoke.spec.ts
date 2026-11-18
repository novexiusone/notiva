import { expect, test } from '@playwright/test';

test('the app loads and creates a page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/No pages yet|Noch keine Seiten/)).toBeVisible();

  await page.getByRole('button', { name: 'New page' }).click();
  const title = page.getByRole('main').getByRole('textbox', { name: 'Page title' });
  await expect(title).toBeFocused();
  await title.fill('Chromium smoke');

  await expect(page.getByRole('treeitem')).toHaveText(['Chromium smoke']);
});
