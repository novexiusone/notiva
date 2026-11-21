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
  await expect(page.getByText(/No pages yet|Noch keine Seiten/)).toBeVisible();
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

test('a favourite survives a reload, stays in Private and disappears when deleted', async ({
  page,
}) => {
  await createPage(page, 'Important');
  const favourites = page.getByRole('navigation', { name: 'Favourites' });
  await expect(favourites.getByText('No favourites yet')).toBeVisible();

  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await expect(favourites.getByRole('button', { name: 'Important' })).toBeVisible();
  await page.reload();
  await expect(favourites.getByRole('button', { name: 'Important' })).toBeVisible();
  await expect(row(page, 'Important')).toBeVisible();

  await page.getByRole('button', { name: 'Remove from favourites' }).click();
  await expect(favourites.getByRole('button', { name: 'Important' })).toHaveCount(0);
  await expect(row(page, 'Important')).toBeVisible();
  await page.getByRole('button', { name: 'Add to favourites' }).click();

  await row(page, 'Important').hover();
  await row(page, 'Important').getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(favourites.getByRole('button', { name: 'Important' })).toHaveCount(0);
});

test('icon, banner and page actions work from the page menu and survive a reload', async ({
  page,
}) => {
  await createPage(page, 'Decorated');
  const main = page.getByRole('main');
  const actions = main.getByRole('button', { name: 'Page actions' });
  const banner = main.getByRole('img', { name: 'Page cover' });

  await main.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('tab', { name: 'Icons' }).click();
  await page.getByRole('button', { name: 'Book Open', exact: true }).click();
  await expect(main.locator('article .lucide-book-open')).toBeVisible();
  await expect(row(page, 'Decorated').locator('.lucide-book-open')).toBeVisible();

  await actions.click();
  await page.getByRole('menuitem', { name: 'Add cover' }).click();
  await page.getByRole('tab', { name: 'Upload' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose an image' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(banner).toHaveAttribute('src', /^data:image\/png;base64,/);

  await page.reload();
  await expect(main.locator('article .lucide-book-open')).toBeVisible();
  await expect(banner).toBeVisible();

  // The cover is repositioned and downloaded from its controls.
  await main.getByTestId('cover-controls-zone').hover();
  await main.getByRole('button', { name: 'Reposition' }).click();
  await page.keyboard.press('ArrowDown');
  await main.getByRole('button', { name: 'Save position' }).click();
  await page.reload();
  await main.getByTestId('cover-controls-zone').hover();
  await main.getByRole('button', { name: 'Reposition' }).click();
  await expect(main.getByRole('slider', { name: 'Cover position' })).toHaveAttribute(
    'aria-valuenow',
    '45',
  );
  await main.getByRole('button', { name: 'Cancel' }).click();
  await main.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByText('Saved the cover to /Users/demo/Downloads/cover.png')).toBeVisible();

  await actions.click();
  await page.getByRole('menuitem', { name: 'Remove icon' }).click();
  await expect(main.locator('article .lucide-book-open')).toHaveCount(0);
  await actions.click();
  await page.getByRole('menuitem', { name: 'Remove cover' }).click();
  await expect(banner).toHaveCount(0);

  await actions.click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Export' }).click();
  await expect(
    page.getByText('Exported 1 page to /Users/demo/Documents/Notiva export'),
  ).toBeVisible();

  await actions.click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Delete “Decorated”?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('content locking persists, blocks editing without autosaving and unlocks from the top bar', async ({
  page,
}) => {
  await createPage(page, 'Locked notes');
  const main = page.getByRole('main');
  const editor = main.locator('.bn-editor');
  const actions = main.getByRole('button', { name: 'Page actions' });
  await title(page).press('Enter');
  await page.keyboard.type('Keep this text');
  await expect(editor).toContainText('Keep this text');
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''))
    .toContain('Keep this text');
  const editedBefore = await main.locator('time').getAttribute('datetime');

  await actions.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitemcheckbox', { name: 'Lock content' }).press('Enter');
  await page.keyboard.press('Escape');

  const unlock = main.getByRole('button', { name: 'Unlock page' });
  await expect(unlock).toBeVisible();
  await expect(title(page)).toHaveAttribute('readonly', '');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(main.getByRole('button', { name: 'Add icon' })).toHaveCount(0);
  await expect(main.locator('time')).toHaveAttribute('datetime', editedBefore!);

  await title(page).click();
  await page.keyboard.type('Must not be saved');
  await expect(title(page)).toHaveValue('Locked notes');
  await expect(editor).not.toContainText('Must not be saved');
  await page.waitForTimeout(600);
  expect(
    await page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''),
  ).not.toContain('Must not be saved');

  await page.reload();
  await expect(title(page)).toHaveAttribute('readonly', '');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(editor).toContainText('Keep this text');

  await unlock.focus();
  await page.keyboard.press('Enter');
  await expect(title(page)).toBeEditable();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(unlock).toHaveCount(0);
});

test('the top bar shows the path to the page and links to its parents', async ({ page }) => {
  await createPage(page, 'Parent');
  await row(page, 'Parent').getByRole('button', { name: 'Add a subpage' }).click();
  await title(page).fill('Child');

  const path = page.getByRole('main').getByRole('navigation', { name: 'Path' });
  await expect(path.getByRole('link', { name: 'Parent' })).toBeVisible();
  await expect(path.locator('[aria-current="page"]')).toHaveText('Child');

  await path.getByRole('link', { name: 'Parent' }).click();
  await expect(title(page)).toHaveValue('Parent');
});

test('the page menu has no rename or add database', async ({ page }) => {
  await createPage(page, 'Plain');
  await page.getByRole('main').getByRole('button', { name: 'Page actions' }).click();

  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Add database' })).toHaveCount(0);
});

test.describe('the page header in light mode and German', () => {
  test.use({ colorScheme: 'light', locale: 'de-DE' });

  test('uses the theme and translates its controls and edit time', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Neue Seite' }).click();

    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(242, 242, 242)');
    await expect(page.getByRole('navigation', { name: 'Favoriten' })).toBeVisible();
    await expect(page.getByText(/^Bearbeitet /)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zu Favoriten hinzufügen' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Seitenaktionen' }).click();
    await expect(page.getByRole('menuitem', { name: 'Icon hinzufügen' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Cover hinzufügen' })).toBeVisible();
  });
});

test('a cover is chosen from the gallery and changed again', async ({ page }) => {
  await createPage(page, 'Gallery');
  const main = page.getByRole('main');
  const cover = main.getByRole('img', { name: 'Page cover' });

  await main.getByRole('button', { name: 'Add cover' }).click();
  await page.getByRole('button', { name: 'Coral' }).click();
  await expect(cover).toBeVisible();

  await page.reload();
  await expect(cover).toBeVisible();

  await main.getByTestId('cover-controls-zone').hover();
  await main.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('button', { name: 'Harbor' }).click();
  await expect(cover).toHaveCSS('background-image', /linear-gradient/);
  await expect(main.getByRole('button', { name: 'Reposition' })).toHaveCount(0);
});
