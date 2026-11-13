// Spike #52, throwaway: what an interactive custom block does inside BlockNote.
// Each test documents the behaviour that was observed, also where it is not the wanted one.
import { expect, test, type Page } from '@playwright/test';
import {
  block,
  countSaves,
  cursorBlock,
  dragByHandle,
  dragItem,
  editor,
  fullDocument,
  items,
  nativeDrags,
  newPage,
  outline,
  pageWithBlock,
  placeCursor,
  recordNativeDrags,
  row,
  rows,
  saves,
  selectionKind,
  spike,
  spikeInput,
  stored,
  title,
  type SpikeType,
} from './spike-helpers';

const popoverInput = (page: Page) => page.getByTestId('spike-popover-input');
const activeTestId = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('data-testid') ??
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.nodeName,
  );

/** Longer than the autosave delay of 500 ms. */
const AUTOSAVE = 1200;

test('the slash menu inserts the block and the cursor goes on below it', async ({ page }) => {
  await page.goto('/');
  await newPage(page, 'Slash');
  await page.keyboard.type('Above');
  await page.keyboard.press('Enter');

  await page.keyboard.type('/spike');
  await expect(page.getByRole('option')).toHaveText([
    'Spike block',
    'Spike block (selectable)',
  ]);
  await page.keyboard.press('Enter');
  await expect(spike(page)).toBeVisible();
  await page.keyboard.type('after');

  expect(await outline(page)).toEqual(['p:Above', 'spike:', 'p:after']);
});

for (const type of ['spike', 'spikeSelectable'] as SpikeType[]) {
  const flag = type === 'spike' ? 'selectable: false' : 'selectable: default';

  test.describe(flag, () => {
    test('check 1: typing in the input changes no block and saves nothing', async ({ page }) => {
      await countSaves(page);
      await pageWithBlock(page, type);
      await page.waitForTimeout(AUTOSAVE);
      const savesBefore = await saves(page);
      const storedBefore = await stored(page);
      const documentBefore = await fullDocument(page);

      await spikeInput(page).click();
      await page.keyboard.type('hello world');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type('/');
      await page.waitForTimeout(AUTOSAVE);

      await expect(spikeInput(page)).toHaveValue('hello wor/l');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      expect(await fullDocument(page)).toBe(documentBefore);
      expect(await saves(page)).toBe(savesBefore);
      expect(await stored(page)).toBe(storedBefore);
    });

    test('check 2: cmd+z in the input undoes its text and keeps the block', async ({ page }) => {
      await pageWithBlock(page, type);
      await spikeInput(page).click();
      await page.keyboard.type('hello');

      await page.keyboard.press('ControlOrMeta+z');

      await expect(spikeInput(page)).toHaveValue('');
      expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:Below']);
    });

    test('check 2: undo in the editor still works after typing in the input', async ({ page }) => {
      await pageWithBlock(page, type);
      await spikeInput(page).click();
      await page.keyboard.type('hello');
      await placeCursor(page, 2, 'end');
      await page.keyboard.type(' more');
      expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:Below more']);

      await page.keyboard.press('ControlOrMeta+z');

      expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:Below']);
      await expect(spikeInput(page)).toHaveValue('hello');

      await page.keyboard.press('ControlOrMeta+Shift+z');
      expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:Below more']);
    });

    test('check 3: the drag handle moves the block above and below a paragraph', async ({
      page,
    }) => {
      await pageWithBlock(page, type);

      const above = (await block(page, 'paragraph').first().boundingBox())!;
      await dragByHandle(page, spike(page), { x: above.x + 40, y: above.y + 1 }, 'below');
      await expect.poll(() => outline(page)).toEqual([`${type}:ref-1`, 'p:Above', 'p:Below']);

      const below = (await block(page, 'paragraph').nth(1).boundingBox())!;
      await dragByHandle(
        page,
        spike(page),
        { x: below.x + 40, y: below.y + below.height - 1 },
        'above',
      );
      await expect.poll(() => outline(page)).toEqual(['p:Above', 'p:Below', `${type}:ref-1`]);
    });

    test('check 3: a paragraph can be dropped on the upper edge of the block', async ({ page }) => {
      await pageWithBlock(page, type);
      const box = (await spike(page).boundingBox())!;

      await dragByHandle(
        page,
        block(page, 'paragraph').nth(1),
        { x: box.x + 60, y: box.y + 3 },
        'below',
      );

      await expect.poll(() => outline(page)).toEqual(['p:Above', 'p:Below', `${type}:ref-1`]);
    });

    test('check 4: backspace at the start of the paragraph below deletes the block at once', async ({
      page,
    }) => {
      await pageWithBlock(page, type);
      await placeCursor(page, 2, 'start');

      await page.keyboard.press('Backspace');

      // No selection first, no confirmation: one key press and the block is gone.
      expect(await outline(page)).toEqual(['p:Above', 'p:Below']);
      expect(await cursorBlock(page)).toBe(1);
      await expect(spike(page)).toHaveCount(0);

      // Undo brings it back with its prop.
      await page.keyboard.press('ControlOrMeta+z');
      expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:Below']);
    });

    test('check 4: delete at the end of the paragraph above deletes the block at once', async ({
      page,
    }) => {
      await pageWithBlock(page, type);
      await placeCursor(page, 0, 'end');

      await page.keyboard.press('Delete');

      expect(await outline(page)).toEqual(['p:Above', 'p:Below']);
      expect(await cursorBlock(page)).toBe(0);
    });

    for (const [forward, backward] of [
      ['ArrowDown', 'ArrowUp'],
      ['ArrowRight', 'ArrowLeft'],
    ]) {
      test(`check 5: ${forward} and ${backward} move the cursor past the block`, async ({
        page,
      }) => {
        await pageWithBlock(page, type);

        await placeCursor(page, 0, 'end');
        await page.keyboard.press(forward);
        if (type === 'spikeSelectable') {
          // A selectable block is a stop on the way: the first press selects it as a node.
          expect(await selectionKind(page)).toBe('node');
          expect(await cursorBlock(page)).toBe(1);
          await page.keyboard.press(forward);
        }
        expect(await selectionKind(page)).toBe('text');
        expect(await cursorBlock(page)).toBe(2);
        await page.keyboard.type('X');
        expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:XBelow']);

        await placeCursor(page, 2, 'start');
        await page.keyboard.press(backward);
        if (type === 'spikeSelectable') {
          expect(await selectionKind(page)).toBe('node');
          await page.keyboard.press(backward);
        }
        expect(await cursorBlock(page)).toBe(0);
        await page.keyboard.type('Y');
        expect(await outline(page)).toEqual(['p:AboveY', `${type}:ref-1`, 'p:XBelow']);
      });
    }

    test('check 6: copying a selection across the block pastes a second block with the same prop', async ({
      page,
    }) => {
      await pageWithBlock(page, type);
      const above = (await block(page, 'paragraph').first().boundingBox())!;
      const below = (await block(page, 'paragraph').nth(1).boundingBox())!;

      // Selected with the mouse, from before "Above" to behind "Below".
      await page.mouse.move(above.x + 1, above.y + above.height / 2);
      await page.mouse.down();
      await page.mouse.move(above.x + 30, above.y + above.height / 2 + 10, { steps: 5 });
      await page.mouse.move(below.x + 80, below.y + below.height / 2, { steps: 15 });
      await page.mouse.up();
      await page.keyboard.press('ControlOrMeta+c');

      await placeCursor(page, 2, 'end');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ControlOrMeta+v');

      await expect
        .poll(() => outline(page))
        .toEqual([
          'p:Above',
          `${type}:ref-1`,
          'p:Below',
          'p:Above',
          `${type}:ref-1`,
          'p:Below',
        ]);
      await expect(spike(page)).toHaveCount(2);
    });

    test('check 6: copying inside the input copies only the text of the input', async ({ page }) => {
      await pageWithBlock(page, type);
      await spikeInput(page).click();
      await page.keyboard.type('cell text');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ControlOrMeta+c');

      await placeCursor(page, 2, 'end');
      await page.keyboard.press('ControlOrMeta+v');

      await expect
        .poll(() => outline(page))
        .toEqual(['p:Above', `${type}:ref-1`, 'p:Belowcell text']);
    });

    test('check 7: typing in the input of the popover does not reach the document', async ({
      page,
    }) => {
      await countSaves(page);
      await pageWithBlock(page, type);
      await page.waitForTimeout(AUTOSAVE);
      const savesBefore = await saves(page);
      const documentBefore = await fullDocument(page);

      await editor(page).getByTestId('spike-popover-button').click();
      await expect(popoverInput(page)).toBeFocused();
      // The popover is rendered in a portal, outside the editor's DOM.
      expect(await popoverInput(page).evaluate((node) => node.closest('.bn-editor') === null)).toBe(
        true,
      );
      await page.keyboard.type('in the popover/');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(AUTOSAVE);

      await expect(popoverInput(page)).toHaveValue('in the popover');
      expect(await fullDocument(page)).toBe(documentBefore);
      expect(await saves(page)).toBe(savesBefore);

      // Escape closes it and focus goes back to the button, not into the document.
      await page.keyboard.press('Escape');
      await expect(popoverInput(page)).toHaveCount(0);
      expect(await activeTestId(page)).toBe('spike-popover-button');
      expect(await fullDocument(page)).toBe(documentBefore);
    });

    test('check 8: dragging in the sortable list reorders it and starts no block drag', async ({
      page,
    }) => {
      await countSaves(page);
      await pageWithBlock(page, type);
      await page.waitForTimeout(AUTOSAVE);
      const savesBefore = await saves(page);
      const documentBefore = await fullDocument(page);
      await recordNativeDrags(page);
      await expect(items(page)).toHaveText(['One', 'Two', 'Three']);

      await dragItem(page, 0, 2);
      await expect(items(page)).toHaveText(['Two', 'Three', 'One']);
      await dragItem(page, 2, 0);
      await expect(items(page)).toHaveText(['One', 'Two', 'Three']);
      await dragItem(page, 1, 2);
      await expect(items(page)).toHaveText(['One', 'Three', 'Two']);
      await page.waitForTimeout(AUTOSAVE);

      expect(await nativeDrags(page)).toEqual([]);
      expect(await fullDocument(page)).toBe(documentBefore);
      expect(await saves(page)).toBe(savesBefore);
    });

    test('check 9: the sidebar tree drag and the block drag still work after a sortable drag', async ({
      page,
    }) => {
      await pageWithBlock(page, type, ['Alpha', 'Beta']);
      await expect(rows(page)).toHaveText(['Alpha', 'Beta', 'Spike']);
      await dragItem(page, 0, 2);
      await expect(items(page)).toHaveText(['Two', 'Three', 'One']);

      // The tree, with the block mounted and its drag provider alive.
      await row(page, 'Spike').dragTo(row(page, 'Alpha'), { targetPosition: { x: 60, y: 2 } });
      await expect(rows(page)).toHaveText(['Spike', 'Alpha', 'Beta']);
      await row(page, 'Beta').dragTo(row(page, 'Alpha'), { targetPosition: { x: 60, y: 14 } });
      await expect(row(page, 'Alpha').getByRole('button', { name: /Expand|Collapse/ })).toBeVisible();

      // A paragraph by its handle.
      await expect(spike(page)).toBeVisible();
      const above = (await block(page, 'paragraph').first().boundingBox())!;
      await dragByHandle(
        page,
        block(page, 'paragraph').nth(1),
        { x: above.x + 40, y: above.y + 1 },
        'below',
      );
      await expect.poll(() => outline(page)).toEqual(['p:Below', 'p:Above', `${type}:ref-1`]);

      // The block itself by its handle.
      const first = (await block(page, 'paragraph').first().boundingBox())!;
      await dragByHandle(page, spike(page), { x: first.x + 40, y: first.y + 1 }, 'below');
      await expect.poll(() => outline(page)).toEqual([`${type}:ref-1`, 'p:Below', 'p:Above']);

      // And the list inside the moved block still sorts.
      await dragItem(page, 0, 1);
      await expect(items(page)).toHaveText(['Two', 'One', 'Three']);
    });

    test('check 10: a click on the block outside its controls', async ({ page }) => {
      await pageWithBlock(page, type);
      await placeCursor(page, 0, 'end');

      await spike(page).getByText('Spike block').click();
      await page.waitForTimeout(100);
      const focused = await editor(page).evaluate((node) => document.activeElement === node);

      if (type === 'spike') {
        // The editor ignores the click and gives up focus: nothing is selected.
        expect(await selectionKind(page)).toBe('text');
        expect(focused).toBe(false);
        await page.keyboard.press('Backspace');
        expect(await outline(page)).toEqual(['p:Above', 'spike:ref-1', 'p:Below']);
      } else {
        // The block becomes the selection, and Backspace then removes it.
        expect(await selectionKind(page)).toBe('node');
        expect(focused).toBe(true);
        await page.keyboard.press('Backspace');
        expect(await outline(page)).toEqual(['p:Above', 'p:Below']);
      }
    });

    test('check 11: the block and its prop are there after a reload', async ({ page }) => {
      await pageWithBlock(page, type);
      const documentBefore = await fullDocument(page);

      await page.goto('/');

      await expect(spike(page)).toBeVisible();
      await expect(spike(page).getByTestId('spike-ref')).toHaveText('ref-1');
      expect(await outline(page)).toEqual(['p:Above', `${type}:ref-1`, 'p:Below']);
      // Ids, types and props survive the save and the load unchanged.
      expect(await fullDocument(page)).toBe(documentBefore);
      expect(JSON.parse(await stored(page))).toMatchObject({});
      expect(await stored(page)).toContain(`"type":"${type}","props":{"refId":"ref-1"}`);
    });
  });
}

test.describe('undo and the page-wide undo stack of WebKit', () => {
  test('check 2, actual behaviour: one cmd+z in the input also undoes the last document edit and moves focus to the title', async ({
    page,
  }) => {
    await pageWithBlock(page);
    await placeCursor(page, 2, 'end');
    await page.keyboard.type(' doc');
    await spikeInput(page).click();
    await page.keyboard.type('hello');

    await page.keyboard.press('ControlOrMeta+z');

    await expect(spikeInput(page)).toHaveValue('');
    // Not wanted: the document lost its last edit, and focus left the block.
    expect(await outline(page)).toEqual(['p:Above', 'spike:ref-1', 'p:Below']);
    expect(await activeTestId(page)).toBe('Page title');
  });

  test('control: without any custom block, cmd+z in the page title undoes text of the document', async ({
    page,
  }) => {
    await page.goto('/');
    await newPage(page, 'Control');
    await page.keyboard.type('Document text');
    expect(await outline(page)).toEqual(['p:Document text']);
    await title(page).click();
    await page.keyboard.type('x');

    await page.keyboard.press('ControlOrMeta+z');

    // The same leak exists on main today; it is not caused by the block.
    expect(await outline(page)).toEqual(['p:']);
  });

  test('check 2, workaround "guard": dropping an undo aimed at another element keeps the document', async ({
    page,
  }) => {
    await pageWithBlock(page);
    await page.evaluate(() => window.localStorage.setItem('spike.undo', 'guard'));
    await placeCursor(page, 2, 'end');
    await page.keyboard.type(' doc');
    await spikeInput(page).click();
    await page.keyboard.type('hello');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(spikeInput(page)).toHaveValue('');
    expect(await outline(page)).toEqual(['p:Above', 'spike:ref-1', 'p:Below doc']);

    await page.keyboard.press('ControlOrMeta+z');
    expect(await outline(page)).toEqual(['p:Above', 'spike:ref-1', 'p:Below doc']);
    expect(await activeTestId(page)).toBe('spike-input');
  });

  test('check 2, workaround "own": a field with its own history never runs the undo of the browser', async ({
    page,
  }) => {
    await pageWithBlock(page);
    await page.evaluate(() => window.localStorage.setItem('spike.undo', 'own'));
    await placeCursor(page, 2, 'end');
    await page.keyboard.type(' doc');
    await spikeInput(page).click();
    await page.keyboard.type('hello');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(spikeInput(page)).toHaveValue('hell');
    for (let press = 0; press < 6; press++) await page.keyboard.press('ControlOrMeta+z');

    await expect(spikeInput(page)).toHaveValue('');
    expect(await outline(page)).toEqual(['p:Above', 'spike:ref-1', 'p:Below doc']);
    expect(await activeTestId(page)).toBe('spike-input');
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`check 12: screenshot of the block in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await pageWithBlock(page);
    await spikeInput(page).fill('Text in the input');

    await page.screenshot({ path: `test-results/spike/block-${colorScheme}.png` });

    await editor(page).getByTestId('spike-popover-button').click();
    await popoverInput(page).fill('Text in the popover');
    await page.screenshot({ path: `test-results/spike/popover-${colorScheme}.png` });

    // The side menu next to the block, and a list item in mid-drag.
    await page.keyboard.press('Escape');
    const box = (await spike(page).boundingBox())!;
    await page.mouse.move(box.x + 57, box.y + 7);
    await page.mouse.move(box.x + 60, box.y + 10, { steps: 3 });
    await expect(page.locator('.bn-side-menu')).toBeVisible();
    await page.screenshot({ path: `test-results/spike/side-menu-${colorScheme}.png` });

    const item = (await items(page).first().boundingBox())!;
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2);
    await page.mouse.down();
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2 + 20, { steps: 8 });
    await page.screenshot({ path: `test-results/spike/sorting-${colorScheme}.png` });
    await page.mouse.up();
  });
}
