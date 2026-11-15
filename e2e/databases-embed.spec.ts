import { expect, test, type Locator, type Page } from '@playwright/test';
import { dragByHandle } from './blockDrag';

const editor = (page: Page) => page.locator('.bn-editor');
const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Page title' });
const treeRow = (page: Page, name: string) => page.getByRole('treeitem').filter({ hasText: name });
const paragraphs = (page: Page) => editor(page).locator('[data-content-type="paragraph"]');
/** The database blocks of the open page. */
const blocks = (page: Page) => editor(page).locator('[data-content-type="database"]');
const embedded = (page: Page) => blocks(page).first();
const grid = (scope: Locator) => scope.getByRole('grid');
const bodyRows = (scope: Locator) =>
  grid(scope)
    .getByRole('row')
    .filter({ has: scope.page().getByRole('gridcell') });
const tab = (scope: Locator, name: string) =>
  scope.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name, exact: true });
const selectionKind = (page: Page) =>
  page.evaluate(() => {
    // Tiptap keeps its editor on the editable element.
    const dom = document.querySelector('.bn-editor') as unknown as {
      editor?: { state: { selection: { toJSON: () => { type: string } } } };
    };
    return dom.editor?.state.selection.toJSON().type ?? 'unknown';
  });

/** The document as the editor shows it: `p:Text` for a paragraph, `db:<id>` for a database. */
const outline = (page: Page) =>
  editor(page)
    .locator('.bn-block-content')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const type = node.getAttribute('data-content-type');
        if (type === 'database') return `db:${node.getAttribute('data-database-id') ?? ''}`;
        return `${type === 'paragraph' ? 'p' : type}:${node.textContent ?? ''}`;
      }),
    );

const storedBlocks = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem('notiva.fake.blocks') ?? '');

/** How often the blocks were saved: the fake backend writes them to storage on each save. */
const saves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __saves: number }).__saves);

/** Longer than the autosave delay of 500 ms. */
const AUTOSAVE = 1200;

const emptyTable = {
  version: 1,
  type: 'table',
  filters: [],
  sorts: [],
  properties: [],
  groupBy: null,
};

/**
 * A page "Notes" with a paragraph, a block of the database "Tasks" and another
 * paragraph; the database has the rows "Write spec" and "Build it", a text
 * property "Notes" and the views "All" and "Board". `rowCount` gives it that
 * many numbered rows instead. `copies` puts more blocks of it below.
 */
async function seed(page: Page, { rowCount = 0, copies = 0 } = {}) {
  await page.evaluate(
    ({ emptyTable, rowCount, copies }) => {
      const pages: Record<string, string | number | null>[] = [
        {
          id: 'notes',
          title: 'Notes',
          parentId: null,
          position: 0,
          kind: 'page',
          databaseId: null,
        },
        {
          id: 'db',
          title: 'Tasks',
          parentId: 'notes',
          position: 0,
          kind: 'database',
          databaseId: null,
        },
      ];
      const cells: Record<string, Record<string, string>> = {};
      const titles = rowCount === 0 ? ['Write spec', 'Build it'] : [];
      for (let index = 0; index < rowCount; index += 1) titles.push(`Row ${index + 1}`);
      titles.forEach((rowTitle, index) => {
        pages.push({
          id: `r${index}`,
          title: rowTitle,
          parentId: 'db',
          position: index,
          kind: 'page',
          databaseId: 'db',
        });
      });
      if (rowCount === 0) cells.r0 = { notes: 'First draft' };
      const properties = [
        {
          id: 'notes',
          databaseId: 'db',
          name: 'Notes',
          type: 'text',
          position: 0,
          options: [],
          targetId: null,
        },
      ];
      const views = [
        { id: 'v1', databaseId: 'db', name: 'All', position: 0, config: emptyTable },
        { id: 'v2', databaseId: 'db', name: 'Board', position: 1, config: emptyTable },
      ];
      const paragraph = (id: string, text: string) => ({
        id,
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text, styles: {} }],
        children: [],
      });
      const database = (id: string) => ({
        id,
        type: 'database',
        props: { databaseId: 'db' },
        children: [],
      });
      const extra = Array.from({ length: copies }, (_, index) => database(`b-copy-${index}`));
      window.localStorage.setItem('notiva.fake.pages', JSON.stringify(pages));
      window.localStorage.setItem(
        'notiva.fake.databases',
        JSON.stringify({ properties, views, cells }),
      );
      window.localStorage.setItem(
        'notiva.fake.blocks',
        JSON.stringify({
          notes: [
            paragraph('b-above', 'Above'),
            database('b-db'),
            ...extra,
            paragraph('b-below', 'Below'),
          ],
        }),
      );
    },
    { emptyTable, rowCount, copies },
  );
  // The fake backend reads its storage when the app starts.
  await page.reload();
  await page.goto('/#/page/notes');
  await expect(grid(embedded(page))).toBeVisible();
}

/** The cell of a row (by its title) in a column (by its header), inside `scope`. */
async function cell(scope: Locator, rowName: string, column: string) {
  const index = (await grid(scope).getByRole('columnheader').allTextContents()).indexOf(column);
  expect(index, `column ${column}`).toBeGreaterThanOrEqual(0);
  return grid(scope)
    .getByRole('row', { name: rowName, exact: true })
    .getByRole('gridcell')
    .nth(index);
}

/** Puts the text cursor at the end of a paragraph by clicking behind its text. */
async function clickAtEnd(target: Locator) {
  const box = (await target.boundingBox())!;
  await target.page().mouse.click(box.x + box.width - 2, box.y + box.height / 2);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as { __saves: number };
    target.__saves = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'notiva.fake.blocks') target.__saves += 1;
      original.call(this, key, value);
    };
  });
  await page.goto('/');
  await expect(page.getByText('No pages yet')).toBeVisible();
});

test('the slash menu creates a database below the page and inserts a block that names it', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'New page' }).click();
  await title(page).fill('Notes');
  await title(page).press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Above');
  await page.keyboard.press('Enter');

  await page.keyboard.type('/datab');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Database']);
  await page.keyboard.press('Enter');
  await expect(grid(embedded(page))).toBeVisible();
  // The cursor goes on below the block.
  await page.keyboard.type('Below');

  const id = await embedded(page).getAttribute('data-database-id');
  expect(id).toBeTruthy();
  expect(await outline(page)).toEqual(['p:Above', `db:${id}`, 'p:Below']);
  await expect(embedded(page)).toContainText('Untitled');
  await expect(embedded(page).getByRole('tab', { name: 'Table' })).toBeVisible();

  // The database is a child of the page in the sidebar.
  await treeRow(page, 'Notes').getByRole('button', { name: 'Expand' }).click();
  await expect(page.getByRole('treeitem')).toHaveText(['Notes', 'Untitled']);
  await expect(treeRow(page, 'Untitled').locator('svg.lucide-table')).toBeVisible();

  // The block is stored by the database's id and nothing else of it.
  await expect.poll(() => storedBlocks(page)).toContain('Below');
  const stored = JSON.parse(await storedBlocks(page)) as Record<string, { type: string }[]>;
  const [notesId] = Object.keys(stored);
  expect(stored[notesId!]!.find((block) => block.type === 'database')).toEqual({
    id: expect.any(String),
    type: 'database',
    props: { databaseId: id },
    children: [],
  });
});

test('typing in cells, filters and view names changes no block and saves nothing', async ({
  page,
}) => {
  await seed(page);
  const block = embedded(page);
  await page.waitForTimeout(AUTOSAVE);
  const savesBefore = await saves(page);
  const before = await outline(page);

  // A property and a row, added inside the block.
  await block.getByRole('button', { name: 'Add a property' }).click();
  await page
    .getByRole('dialog', { name: 'Add a property' })
    .getByRole('button', { name: 'Text' })
    .click();
  const propertyName = page.getByRole('textbox', { name: 'Property name' });
  await expect(propertyName).toBeFocused();
  await propertyName.fill('Owner');
  await propertyName.press('Enter');
  await block.getByRole('button', { name: 'New', exact: true }).click();
  const rowTitle = grid(block).getByRole('textbox', { name: 'Name' });
  await expect(rowTitle).toBeFocused();
  await page.keyboard.type('Test it/');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(grid(block).getByRole('row', { name: 'Test it', exact: true })).toBeVisible();

  // A cell, typed into with the keyboard.
  await (await cell(block, 'Test it', 'Owner')).click();
  const input = grid(block).getByRole('textbox', { name: 'Owner' });
  await expect(input).toBeFocused();
  await page.keyboard.type('Ada / Bob');
  await page.keyboard.press('Enter');
  await expect(await cell(block, 'Test it', 'Owner')).toHaveText('Ada / Bob');

  // A filter value, in a popover opened from the block.
  await block
    .getByRole('group', { name: 'View settings' })
    .getByRole('button', { name: /^Filter/ })
    .click();
  const filters = page.getByRole('dialog', { name: 'Filters' });
  await filters.getByRole('button', { name: 'Add a filter' }).click();
  await filters
    .getByRole('group', { name: 'Filter 1' })
    .getByRole('textbox', { name: 'Value' })
    .click();
  await page.keyboard.type('Test');
  await expect(bodyRows(block)).toHaveCount(1);
  await page.keyboard.press('Escape');

  // A view's name.
  await block.getByRole('button', { name: 'Actions for “All”' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const viewName = block.getByRole('textbox', { name: 'View name' });
  await expect(viewName).toBeFocused();
  await page.keyboard.type('Mine');
  await page.keyboard.press('Enter');
  await expect(tab(block, 'Mine')).toBeVisible();

  await page.waitForTimeout(AUTOSAVE);
  expect(await outline(page)).toEqual(before);
  expect(await saves(page)).toBe(savesBefore);
  await expect(page.getByRole('listbox')).toHaveCount(0);

  // The database's own page shows what was typed in the block.
  await embedded(page).getByRole('link', { name: 'Open as page' }).click();
  await expect(title(page)).toHaveValue('Tasks');
  const fullPage = page.getByRole('main');
  await expect(tab(fullPage, 'Mine')).toBeVisible();
  await expect(await cell(fullPage, 'Test it', 'Owner')).toHaveText('Ada / Bob');
});

test('cmd+z in a cell changes neither the block nor the text around it', async ({ page }) => {
  await seed(page);
  await clickAtEnd(paragraphs(page).nth(1));
  await page.keyboard.type(' more');
  await expect(paragraphs(page).nth(1)).toHaveText('Below more');

  await (await cell(embedded(page), 'Build it', 'Notes')).click();
  const input = grid(embedded(page)).getByRole('textbox', { name: 'Notes' });
  await expect(input).toBeFocused();
  await page.keyboard.type('abc');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(input).toHaveValue('');
  // More presses than the field has to undo: the rest goes nowhere.
  for (let press = 0; press < 4; press++) await page.keyboard.press('ControlOrMeta+z');

  await expect(input).toBeFocused();
  expect(await outline(page)).toEqual(['p:Above', 'db:db', 'p:Below more']);
});

test('cmd+z in the page title no longer undoes an edit of the document', async ({ page }) => {
  await page.getByRole('button', { name: 'New page' }).click();
  await title(page).fill('Notes');
  await title(page).press('Enter');
  await page.keyboard.type('Document text');
  await title(page).click();
  await page.keyboard.type('!');

  for (let press = 0; press < 4; press++) await page.keyboard.press('ControlOrMeta+z');

  await expect(title(page)).toBeFocused();
  expect(await outline(page)).toEqual(['p:Document text']);
  // Undo in the editor still works.
  await clickAtEnd(paragraphs(page).first());
  await page.keyboard.press('ControlOrMeta+z');
  expect(await outline(page)).toEqual(['p:']);
});

test('clicking cells and controls of the block leaves the document alone', async ({ page }) => {
  await seed(page);
  const block = embedded(page);

  // A cell is active after a click; keys move through the table, not the document.
  await (await cell(block, 'Write spec', 'Notes')).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.keyboard.type('x');
  await tab(block, 'Board').click();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);

  expect(await outline(page)).toEqual(['p:Above', 'db:db', 'p:Below']);
  await expect(grid(block)).toBeVisible();
});

test('a click on the block outside its controls selects it, and Backspace removes it', async ({
  page,
}) => {
  await seed(page);
  await clickAtEnd(paragraphs(page).first());

  await embedded(page).getByText('Tasks', { exact: true }).click();
  expect(await selectionKind(page)).toBe('node');
  await page.keyboard.press('Backspace');

  // Removed like an image: the paragraphs around it stay as they are.
  expect(await outline(page)).toEqual(['p:Above', 'p:Below']);
  // The database is not deleted.
  await treeRow(page, 'Notes').getByRole('button', { name: 'Expand' }).click();
  await expect(treeRow(page, 'Tasks')).toBeVisible();

  // Undo brings the block back; it acts on the document the editor holds, so the editor has the focus.
  await clickAtEnd(paragraphs(page).first());
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => outline(page)).toEqual(['p:Above', 'db:db', 'p:Below']);
  await expect(grid(embedded(page))).toBeVisible();
});

test('Backspace from the paragraph below removes the block, and undo brings it back', async ({
  page,
}) => {
  await seed(page);
  const below = paragraphs(page).nth(1);
  const box = (await below.boundingBox())!;
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
  await page.keyboard.press('Home');

  await page.keyboard.press('Backspace');
  expect(await outline(page)).toEqual(['p:Above', 'p:Below']);
  await expect(treeRow(page, 'Notes').getByRole('button', { name: 'Expand' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  expect(await outline(page)).toEqual(['p:Above', 'db:db', 'p:Below']);
});

test('a paragraph dropped onto the block lands next to it', async ({ page }) => {
  await seed(page);
  const box = (await embedded(page).boundingBox())!;

  await dragByHandle(page, paragraphs(page).nth(1), { x: box.x + 60, y: box.y + 3 }, 'below');

  await expect.poll(() => outline(page)).toEqual(['p:Above', 'p:Below', 'db:db']);
});

test('the view chosen in the block survives moving the block and a reload', async ({ page }) => {
  await seed(page);
  await tab(embedded(page), 'Board').click();
  await expect(tab(embedded(page), 'Board')).toHaveAttribute('aria-selected', 'true');
  // The address belongs to the page around the block.
  await expect(page).toHaveURL(/#\/page\/notes$/);

  const above = (await paragraphs(page).first().boundingBox())!;
  await dragByHandle(page, embedded(page), { x: above.x + 40, y: above.y + 1 }, 'below');
  await expect.poll(() => outline(page)).toEqual(['db:db', 'p:Above', 'p:Below']);
  await expect(tab(embedded(page), 'Board')).toHaveAttribute('aria-selected', 'true');

  await expect.poll(() => storedBlocks(page)).toMatch(/^\{"notes":\[\{"id":"b-db"/);
  await page.reload();
  await expect(grid(embedded(page))).toBeVisible();
  expect(await outline(page)).toEqual(['db:db', 'p:Above', 'p:Below']);
  await expect(tab(embedded(page), 'Board')).toHaveAttribute('aria-selected', 'true');
  await expect(bodyRows(embedded(page))).toHaveCount(2);
  await expect(await cell(embedded(page), 'Write spec', 'Notes')).toHaveText('First draft');

  // The database's own page opens on the same view.
  await embedded(page).getByRole('link', { name: 'Open as page' }).click();
  await expect(tab(page.getByRole('main'), 'Board')).toHaveAttribute('aria-selected', 'true');
});

test('copying the block gives a second block of the same database', async ({ page }) => {
  await seed(page);
  await embedded(page).getByText('Tasks', { exact: true }).click();
  expect(await selectionKind(page)).toBe('node');
  await page.keyboard.press('ControlOrMeta+c');

  await clickAtEnd(paragraphs(page).nth(1));
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+v');

  await expect.poll(() => outline(page)).toEqual(['p:Above', 'db:db', 'p:Below', 'db:db']);
  await expect(blocks(page).nth(1).getByRole('grid')).toBeVisible();
  // Still one database.
  await treeRow(page, 'Notes').getByRole('button', { name: 'Expand' }).click();
  await expect(page.getByRole('treeitem')).toHaveText(['Notes', 'Tasks']);
});

test('two blocks of one database show the same rows', async ({ page }) => {
  await seed(page, { copies: 1 });
  await expect(blocks(page)).toHaveCount(2);
  const [first, second] = [blocks(page).nth(0), blocks(page).nth(1)];

  await (await cell(first, 'Build it', 'Notes')).click();
  await page.keyboard.type('Typed above');
  await page.keyboard.press('Enter');

  await expect(await cell(second, 'Build it', 'Notes')).toHaveText('Typed above');
  await second.getByRole('button', { name: 'New', exact: true }).click();
  await page.keyboard.type('From below');
  await page.keyboard.press('Enter');
  await expect(bodyRows(first)).toHaveCount(3);
});

test('a block whose database was deleted says so and can still be removed', async ({ page }) => {
  await seed(page);
  await treeRow(page, 'Notes').getByRole('button', { name: 'Expand' }).click();
  await treeRow(page, 'Tasks').hover();
  await treeRow(page, 'Tasks').getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

  const notice = editor(page).locator('[data-database-block="deleted"]');
  await expect(notice).toHaveText('Deleted database');
  await expect(notice).toHaveCSS('text-decoration-line', 'line-through');
  expect(await outline(page)).toEqual(['p:Above', 'db:db', 'p:Below']);

  // Moved and removed like any block.
  const above = (await paragraphs(page).first().boundingBox())!;
  await dragByHandle(page, embedded(page), { x: above.x + 40, y: above.y + 1 }, 'below');
  await expect.poll(() => outline(page)).toEqual(['db:db', 'p:Above', 'p:Below']);
  await notice.click();
  expect(await selectionKind(page)).toBe('node');
  await page.keyboard.press('Backspace');
  expect(await outline(page)).toEqual(['p:Above', 'p:Below']);
});

test('a block of a page that is no database reads as deleted', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('notiva.fake.blocks')!) as {
      notes: { props: Record<string, string> }[];
    };
    stored.notes[1]!.props.databaseId = 'notes';
    window.localStorage.setItem('notiva.fake.blocks', JSON.stringify(stored));
  });
  await page.reload();

  await expect(editor(page).locator('[data-database-block="deleted"]')).toHaveText(
    'Deleted database',
  );
});

test('a long database scrolls inside the block, which keeps to the text column', async ({
  page,
}) => {
  await seed(page, { rowCount: 2000 });
  const block = embedded(page);
  const scroller = block.getByRole('region', { name: 'Rows' });

  const height = (await scroller.boundingBox())!.height;
  expect(height).toBeLessThanOrEqual(480);
  expect(height).toBeGreaterThan(300);
  // Virtualised: only the rows in sight are there.
  expect(await bodyRows(block).count()).toBeLessThan(60);
  await scroller.evaluate((node) => (node.scrollTop = node.scrollHeight));
  await expect(grid(block).getByRole('row', { name: 'Row 2000', exact: true })).toBeVisible();

  // As wide as the paragraphs, and the table scrolls sideways when it is wider.
  const text = (await paragraphs(page).first().boundingBox())!;
  const own = (await block.boundingBox())!;
  expect(Math.abs(own.x - text.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(own.width - text.width)).toBeLessThanOrEqual(1);
  for (let index = 0; index < 4; index++) {
    await block.getByRole('button', { name: 'Add a property' }).click();
    await page
      .getByRole('dialog', { name: 'Add a property' })
      .getByRole('button', { name: 'Text' })
      .click();
    await page.getByRole('textbox', { name: 'Property name' }).press('Enter');
  }
  await expect
    .poll(() => scroller.evaluate((node) => node.scrollWidth > node.clientWidth))
    .toBe(true);
  expect((await block.boundingBox())!.width).toBeCloseTo(own.width, 0);
});

test('tabs, toolbar and table look as on the database page', async ({ page }) => {
  await seed(page);
  const probe = (scope: Locator) =>
    Promise.all(
      [
        tab(scope, 'All'),
        tab(scope, 'All').locator('svg'),
        scope.getByRole('group', { name: 'View settings' }).getByRole('button', { name: /^Sort/ }),
        grid(scope).getByRole('columnheader').first(),
        bodyRows(scope).first().getByRole('gridcell').first(),
        scope.getByRole('button', { name: 'New', exact: true }),
        scope.getByRole('button', { name: 'New', exact: true }).locator('svg'),
      ].map((element) =>
        element.evaluate((node) => {
          const style = getComputedStyle(node);
          return [
            style.fontSize,
            style.lineHeight,
            style.padding,
            style.margin,
            style.color,
            style.width,
            style.height,
            style.minWidth,
          ].join(' ');
        }),
      ),
    );

  const inBlock = await probe(embedded(page));
  await embedded(page).getByRole('link', { name: 'Open as page' }).click();
  await expect(title(page)).toHaveValue('Tasks');
  const onPage = await probe(page.getByRole('main'));

  // Widths of things that fill the space differ; the tab, icons and buttons do not.
  const fixed = (values: string[]) =>
    values.map((value, index) => (index === 4 ? value.split(' ').slice(0, 5).join(' ') : value));
  expect(fixed(inBlock)).toEqual(fixed(onPage));
});
