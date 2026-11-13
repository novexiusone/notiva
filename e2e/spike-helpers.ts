// Spike #52, throwaway: helpers shared by the spike tests.
import { expect, type Locator, type Page } from '@playwright/test';

export type SpikeType = 'spike' | 'spikeSelectable';

export const editor = (page: Page) => page.locator('.bn-editor');
export const title = (page: Page) =>
  page.getByRole('main').getByRole('textbox', { name: 'Page title' });
export const block = (page: Page, type: string) =>
  editor(page).locator(`[data-content-type="${type}"]`);
export const spike = (page: Page) => editor(page).getByTestId('spike-block');
export const spikeInput = (page: Page) => editor(page).getByTestId('spike-input');
export const items = (page: Page) => editor(page).getByTestId('spike-list').locator('li');
export const rows = (page: Page) => page.getByRole('treeitem');
export const row = (page: Page, name: string) => rows(page).filter({ hasText: name });

type EditorWindow = {
  __editor: {
    document: { id: string; type: string; props: Record<string, unknown>; content?: unknown }[];
    replaceBlocks: (remove: unknown[], insert: unknown[]) => void;
    setTextCursorPosition: (block: unknown, placement: 'start' | 'end') => void;
    getTextCursorPosition: () => { block: { id: string; type: string } };
    focus: () => void;
  };
  __blockSaves: number;
};

/** Counts the `save_blocks` calls: the fake backend writes the blocks to localStorage on each. */
export async function countSaves(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as { __blockSaves: number };
    target.__blockSaves = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'notiva.fake.blocks') target.__blockSaves += 1;
      original.call(this, key, value);
    };
  });
}

export const saves = (page: Page) =>
  page.evaluate(() => (window as unknown as EditorWindow).__blockSaves);

export const stored = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? '');

/** The document as a list like `p:Above`, `spike:ref-1`. */
export const outline = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as EditorWindow).__editor.document.map((entry) => {
      if (entry.type === 'spike' || entry.type === 'spikeSelectable') {
        return `${entry.type}:${String(entry.props.refId)}`;
      }
      const content = Array.isArray(entry.content) ? (entry.content as { text?: string }[]) : [];
      return `p:${content.map((part) => part.text ?? '').join('')}`;
    }),
  );

export const fullDocument = (page: Page) =>
  page.evaluate(() => JSON.stringify((window as unknown as EditorWindow).__editor.document));

export async function newPage(page: Page, name: string) {
  await page.getByRole('button', { name: 'New page' }).click();
  await title(page).fill(name);
  await title(page).press('Enter');
  await expect(editor(page)).toBeFocused();
}

/** A page with a paragraph, the block and another paragraph, saved. Other pages come first. */
export async function pageWithBlock(page: Page, type: SpikeType = 'spike', others: string[] = []) {
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
  for (const name of others) {
    await page.getByRole('button', { name: 'New page' }).click();
    await expect(title(page)).toBeFocused();
    await title(page).fill(name);
    await expect(row(page, name)).toBeVisible();
  }
  await newPage(page, 'Spike');
  await page.evaluate((blockType) => {
    const { __editor: instance } = window as unknown as EditorWindow;
    instance.replaceBlocks(instance.document, [
      { type: 'paragraph', content: 'Above' },
      { type: blockType, props: { refId: 'ref-1' } },
      { type: 'paragraph', content: 'Below' },
    ]);
  }, type);
  await expect(spike(page)).toBeVisible();
  await expect.poll(() => stored(page)).toContain('ref-1');
  expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:Below']);
}

/** Puts the text cursor at the start or end of the block with this index and focuses the editor. */
export async function placeCursor(page: Page, index: number, placement: 'start' | 'end') {
  await page.evaluate(
    ([blockIndex, where]) => {
      const { __editor: instance } = window as unknown as EditorWindow;
      instance.focus();
      instance.setTextCursorPosition(instance.document[blockIndex as number], where as 'start');
    },
    [index, placement] as const,
  );
}

export const cursorBlock = (page: Page) =>
  page.evaluate(() => {
    const { __editor: instance } = window as unknown as EditorWindow;
    const current = instance.getTextCursorPosition().block;
    return instance.document.findIndex((entry) => entry.id === current.id);
  });

type Point = { x: number; y: number };

/**
 * Moves a block by its drag handle, by hand, the way `editor.spec.ts` does:
 * hover the block, wait for the side menu to sit next to it, press on the
 * handle, move to `drop` and approach it from `from`.
 */
export async function dragByHandle(
  page: Page,
  source: Locator,
  drop: Point,
  from: 'below' | 'above',
) {
  const box = (await source.boundingBox())!;
  const hover = { x: box.x + 60, y: box.y + Math.min(10, box.height / 2) };
  await page.mouse.move(hover.x - 3, hover.y - 3);
  await page.mouse.move(hover.x, hover.y, { steps: 3 });
  const handle = page.locator('.bn-side-menu [draggable="true"]');
  await expect
    .poll(async () => {
      const position = await handle.boundingBox();
      if (position === null) return false;
      const middle = position.y + position.height / 2;
      return middle > box.y - 4 && middle < box.y + box.height + 4;
    })
    .toBe(true);
  const grip = (await handle.boundingBox())!;
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await page.mouse.move(start.x, start.y, { steps: 3 });
  await page.mouse.down();
  // The drag has to start while the pointer is still on the handle, as it does for a person.
  // With large first steps the pointer is over another block before the browser starts the
  // drag, the side menu re-renders for that block and the drag never reaches BlockNote.
  await page.mouse.move(start.x + 2, start.y + 2);
  await page.mouse.move(start.x + 4, start.y + 4);
  await page.mouse.move(start.x + 6, start.y + 6);
  await page.mouse.move(drop.x, drop.y + (from === 'below' ? 9 : -9), { steps: 12 });
  await page.mouse.move(drop.x, drop.y, { steps: 4 });
  await page.mouse.up();
}

/** The selection of the editor, as ProseMirror sees it. */
export const selectionKind = (page: Page) =>
  page.evaluate(() => {
    const instance = (window as unknown as EditorWindow).__editor as unknown as {
      prosemirrorState: { selection: { toJSON: () => { type: string } } };
    };
    return instance.prosemirrorState.selection.toJSON().type;
  });

/** Records native drag events, to see whether a block drag started. */
export async function recordNativeDrags(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as { __drags: string[] };
    target.__drags = [];
    for (const type of ['dragstart', 'drop', 'dragend']) {
      document.addEventListener(type, () => target.__drags.push(type), true);
    }
  });
}

export const nativeDrags = (page: Page) =>
  page.evaluate(() => (window as unknown as { __drags: string[] }).__drags);

/** Drags inside the sortable list with real pointer movement, slowly enough for the list to follow. */
export async function dragItem(page: Page, from: number, to: number) {
  const source = (await items(page).nth(from).boundingBox())!;
  const target = (await items(page).nth(to).boundingBox())!;
  const x = source.x + source.width / 2;
  const start = source.y + source.height / 2;
  // Ends in the far part of the target, so the item settles in its place.
  const end = to > from ? target.y + target.height - 4 : target.y + 4;
  await page.mouse.move(x, start);
  await page.mouse.down();
  const steps = 16;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x, start + ((end - start) * step) / steps);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
}
