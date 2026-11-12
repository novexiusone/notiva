import { expect, test, type Page } from '@playwright/test';

/** A one-pixel PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const editor = (page: Page) => page.locator('.bn-editor');
const images = (page: Page) => editor(page).locator('[data-content-type="image"] img');

async function waitForSave(page: Page, text: string) {
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? ''))
    .toContain(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New page' }).click();
  const title = page.getByRole('main').getByRole('textbox', { name: 'Page title' });
  await title.fill('Pictures');
  await title.press('Enter');
  await expect(editor(page)).toBeFocused();
});

test('an image is added from the slash menu and is back after a restart', async ({ page }) => {
  await page.keyboard.type('/image');
  await page.keyboard.press('Enter');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  await expect(images(page)).toHaveCount(1);
  await expect(images(page)).toHaveAttribute('src', /^data:image\/png;base64,/);
  await waitForSave(page, 'data:image/png');

  await page.goto('/');

  await expect(images(page)).toHaveCount(1);
});

test('an image dropped on the editor is added', async ({ page }) => {
  await page.keyboard.type('Above the picture');
  const target = await editor(page).boundingBox();

  await page.evaluate(
    ({ bytes, x, y }) => {
      const file = new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      const element = document.querySelector('.bn-editor')!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: data,
          }),
        );
      }
    },
    { bytes: [...PNG], x: target!.x + 40, y: target!.y + target!.height - 4 },
  );

  await expect(images(page)).toHaveCount(1);
  await expect(editor(page)).toContainText('Above the picture');
});

test('an image pasted from the clipboard is added', async ({ page }) => {
  await page.keyboard.type('Before the paste');

  await page.evaluate(
    (bytes) => {
      const file = new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      document
        .querySelector('.bn-editor')!
        .dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
        );
    },
    [...PNG],
  );

  await expect(images(page)).toHaveCount(1);
  await expect(editor(page)).toContainText('Before the paste');
});

test('a file that is not an image is refused', async ({ page }) => {
  await page.keyboard.type('/image');
  await page.keyboard.press('Enter');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'notes.png',
    mimeType: 'image/png',
    buffer: Buffer.from('this is plain text, not a picture'),
  });

  await expect(page.getByRole('alert')).toHaveText(
    'Only PNG, JPEG, GIF and WebP images up to 20 MiB can be added.',
  );
  await expect(images(page)).toHaveCount(0);
});
