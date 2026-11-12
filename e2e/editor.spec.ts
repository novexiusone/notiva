import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('.bn-editor');
const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const block = (page: Page, type: string) => editor(page).locator(`[data-content-type="${type}"]`);
const blockIds = (page: Page) =>
  editor(page)
    .locator('[data-node-type="blockContainer"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));

async function newPage(page: Page, name: string) {
  await page.getByRole('button', { name: 'New page' }).click();
  await title(page).fill(name);
  await title(page).press('Enter');
  await expect(editor(page)).toBeFocused();
}

/** Autosave waits a moment after the last edit. */
async function waitForSave(page: Page, text: string) {
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''))
    .toContain(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('pressing Enter in the title moves into the editor', async ({ page }) => {
  await newPage(page, 'Notes');

  await page.keyboard.type('First line');

  await expect(block(page, 'paragraph').first()).toHaveText('First line');
  await expect(title(page)).toHaveValue('Notes');
});

test('markdown shortcuts create the block types of the MVP', async ({ page }) => {
  await newPage(page, 'Blocks');

  await page.keyboard.type('# Heading one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Heading two');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- Bullet');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. Numbered');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Task');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> Quote');

  await expect(block(page, 'heading')).toHaveText(['Heading one', 'Heading two']);
  await expect(block(page, 'bulletListItem')).toHaveText('Bullet');
  await expect(block(page, 'numberedListItem')).toHaveText('Numbered');
  await expect(block(page, 'checkListItem')).toHaveText('Task');
  await expect(block(page, 'quote')).toHaveText('Quote');
});

test('content is saved without a save button and is back after a restart', async ({ page }) => {
  await newPage(page, 'Journal');
  await page.keyboard.type('# Monday');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Wrote the editor.');
  await waitForSave(page, 'Wrote the editor.');
  const idsBefore = await blockIds(page);

  await page.goto('/');

  await expect(block(page, 'heading')).toHaveText('Monday');
  await expect(block(page, 'paragraph').first()).toHaveText('Wrote the editor.');
  // Blocks keep their identity across save and load.
  expect((await blockIds(page)).slice(0, 2)).toEqual(idsBefore.slice(0, 2));
});

test('leaving a page right after typing does not lose the change', async ({ page }) => {
  await newPage(page, 'First');
  await page.keyboard.type('Typed and left at once');
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.getByRole('treeitem').filter({ hasText: 'First' }).click();

  await expect(block(page, 'paragraph').first()).toHaveText('Typed and left at once');
});

test('each page has its own content', async ({ page }) => {
  await newPage(page, 'Alpha');
  await page.keyboard.type('Alpha text');
  await newPage(page, 'Beta');
  await page.keyboard.type('Beta text');

  await page.getByRole('treeitem').filter({ hasText: 'Alpha' }).click();
  await expect(block(page, 'paragraph').first()).toHaveText('Alpha text');

  await page.getByRole('treeitem').filter({ hasText: 'Beta' }).click();
  await expect(block(page, 'paragraph').first()).toHaveText('Beta text');
});

test('undo and redo work', async ({ page }) => {
  // The shortcut uses Cmd on macOS and Ctrl elsewhere, such as on the CI runner.
  await newPage(page, 'Undo');
  await page.keyboard.type('Keep this');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Remove this');
  await expect(editor(page)).toContainText('Remove this');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor(page)).not.toContainText('Remove this');

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor(page)).toContainText('Remove this');
});

test('a block shows its drag handle and add button on hover', async ({ page }) => {
  await newPage(page, 'Handles');
  await page.keyboard.type('Hover me');

  await block(page, 'paragraph').first().hover();

  await expect(page.locator('.bn-side-menu')).toBeVisible();
});

test('three backticks start a code block', async ({ page }) => {
  await newPage(page, 'Code');

  await page.keyboard.type('``` ');
  await page.keyboard.type('let answer = 42;');

  await expect(block(page, 'codeBlock')).toContainText('let answer = 42;');
});

test('a block can be moved with its drag handle', async ({ page }) => {
  await newPage(page, 'Order');
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await expect(block(page, 'paragraph')).toHaveText(['First', 'Second']);

  // Dragged by hand, in small steps, the way a person moves the mouse.
  await block(page, 'paragraph').nth(1).hover();
  const handle = (await page.locator('.bn-side-menu [draggable="true"]').boundingBox())!;
  const target = (await block(page, 'paragraph').first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 10, { steps: 12 });
  await page.mouse.move(target.x + 40, target.y + 1, { steps: 4 });
  await page.mouse.up();

  await expect(block(page, 'paragraph')).toHaveText(['Second', 'First']);
  await waitForSave(page, 'Second');
  await page.goto('/');
  await expect(block(page, 'paragraph')).toHaveText(['Second', 'First']);
});
