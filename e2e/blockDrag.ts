import { expect, type Locator, type Page } from '@playwright/test';

type Point = { x: number; y: number };

/**
 * Moves a block of the editor by its drag handle, the way a person does:
 * hover the block, wait for the side menu to sit next to it, press on the
 * handle, move to `drop` and approach it from `from`.
 *
 * Taken from the spike (#52). A block drag in Playwright has to begin with a
 * few small pointer moves on the handle: with large first steps the pointer
 * is over another block before the browser starts the drag, the side menu
 * re-renders for that block and the drag never reaches BlockNote.
 */
export async function dragByHandle(
  page: Page,
  source: Locator,
  drop: Point,
  from: 'below' | 'above',
) {
  const box = (await source.boundingBox())!;
  // A block of one line is hovered in its middle; the side menu does not show on its top edge.
  const hover = { x: box.x + 60, y: box.y + (box.height < 48 ? box.height / 2 : 10) };
  // Enter the editor at the block's edge first, so that the side menu follows the pointer.
  await page.mouse.move(box.x + 5, hover.y);
  await page.waitForTimeout(300);
  await page.mouse.move(hover.x - 3, hover.y - 3);
  await page.mouse.move(hover.x, hover.y, { steps: 3 });
  const handle = page.locator('.bn-side-menu [draggable="true"]');
  await expect
    .poll(async () => {
      const position = await handle.boundingBox();
      if (position === null) return false;
      const middle = position.y + position.height / 2;
      return middle > box.y - 4 && middle < box.y + Math.min(box.height, 40) + 4;
    })
    .toBe(true);
  const grip = (await handle.boundingBox())!;
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await page.mouse.move(start.x, start.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y + 2);
  await page.mouse.move(start.x + 4, start.y + 4);
  await page.mouse.move(start.x + 6, start.y + 6);
  await page.mouse.move(drop.x, drop.y + (from === 'below' ? 9 : -9), { steps: 12 });
  await page.mouse.move(drop.x, drop.y, { steps: 4 });
  await page.mouse.up();
}
