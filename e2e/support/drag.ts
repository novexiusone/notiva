import type { Locator, Page } from '@playwright/test';

export type Point = { x: number; y: number };

async function center(locator: Locator): Promise<Point> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags with browser pointer input, never with synthetic drag events. */
export async function dragToPoint(page: Page, source: Locator, target: Point) {
  await source.hover();
  const start = await center(source);
  await page.mouse.move(start.x, start.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y + 2, { steps: 2 });
  await page.mouse.move(start.x + 5, start.y + 5, { steps: 2 });
  await page.mouse.move(target.x, target.y, { steps: 18 });
  await page.mouse.up();
}

/** Drags to the leading edge of a target, for sorting before it. */
export async function dragBefore(page: Page, source: Locator, target: Locator) {
  const box = (await target.boundingBox())!;
  await dragToPoint(page, source, { x: box.x + 12, y: box.y + Math.min(5, box.height / 2) });
}
