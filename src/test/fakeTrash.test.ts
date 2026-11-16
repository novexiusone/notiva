import { commands, type Block } from '@/lib/commands';
import { installFakeBackend } from '@/test/fakeBackend';

const notFound = { kind: 'not_found' };
const invalid = { kind: 'invalid' };

function paragraph(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    props: {},
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  };
}

describe('trash', () => {
  beforeEach(() => installFakeBackend());

  it('moves a page with its subpages to the trash and restores all of them', async () => {
    const keep = await commands.createPage(null);
    const parent = await commands.createPage(null);
    const child = await commands.createPage(parent.id);
    await commands.renamePage(parent.id, 'Zebra plan');
    await commands.saveBlocks(parent.id, [paragraph('p1', 'zebra stripes')]);

    await commands.deletePage(parent.id);

    expect((await commands.listPages()).map((page) => page.id)).toEqual([keep.id]);
    expect(await commands.search('zebra')).toEqual([]);
    await expect(commands.loadBlocks(parent.id)).rejects.toMatchObject(notFound);
    const trashed = await commands.listTrash();
    expect(trashed).toMatchObject([{ id: parent.id, title: 'Zebra plan', pageCount: 2 }]);

    const restored = await commands.restorePage(parent.id);

    expect(restored.id).toBe(parent.id);
    expect((await commands.listPages()).map((page) => page.id).sort()).toEqual(
      [keep.id, parent.id, child.id].sort(),
    );
    expect(await commands.loadBlocks(parent.id)).toEqual([paragraph('p1', 'zebra stripes')]);
    expect(await commands.listTrash()).toEqual([]);
  });

  it('restores to the top level when the old parent is gone', async () => {
    const parent = await commands.createPage(null);
    const child = await commands.createPage(parent.id);
    await commands.deletePage(child.id);
    await commands.deletePage(parent.id);
    await commands.deletePagePermanently(parent.id);

    expect((await commands.restorePage(child.id)).parentId).toBeNull();
  });

  it('brings a database back with its rows, properties and cells', async () => {
    const { page: database } = await commands.createDatabase(null);
    const property = await commands.createProperty(database.id, 'Notes', 'text', null);
    const row = await commands.createRow(database.id);
    await commands.setCell(row.id, property.id, 'marsupial');

    await commands.deletePage(database.id);
    expect(await commands.listPages()).toEqual([]);

    await commands.restorePage(database.id);

    const rows = await commands.listRows(database.id);
    expect(rows.map((entry) => entry.cells[property.id])).toEqual(['marsupial']);
    expect((await commands.loadDatabase(database.id)).properties).toHaveLength(1);
  });

  it('deletes for good, empties the trash and validates the retention', async () => {
    const first = await commands.createPage(null);
    const second = await commands.createPage(null);
    await commands.deletePage(first.id);
    await commands.deletePage(second.id);

    await commands.deletePagePermanently(first.id);
    await expect(commands.restorePage(first.id)).rejects.toMatchObject(notFound);
    expect(await commands.emptyTrash()).toBe(1);
    expect(await commands.listTrash()).toEqual([]);

    expect(await commands.getTrashSettings()).toEqual({ retentionDays: 30 });
    expect(await commands.setTrashRetention(null)).toEqual({ retentionDays: null });
    await expect(commands.setTrashRetention(0)).rejects.toMatchObject(invalid);
  });

  it('drops pages that stayed longer than the retention', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const page = await commands.createPage(null);
      await commands.deletePage(page.id);
      vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);

      expect(await commands.listTrash()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('page versions', () => {
  beforeEach(() => installFakeBackend());

  it('keeps the overwritten state at most once per interval and restores it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const page = await commands.createPage(null);
      await commands.saveBlocks(page.id, [paragraph('a', 'one')]);
      expect(await commands.listPageVersions(page.id)).toEqual([]);
      await commands.saveBlocks(page.id, [paragraph('a', 'two')]);
      await commands.saveBlocks(page.id, [paragraph('a', 'three')]);

      const versions = await commands.listPageVersions(page.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ preview: 'one', blockCount: 1 });

      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await commands.saveBlocks(page.id, [paragraph('a', 'four')]);
      expect((await commands.listPageVersions(page.id)).map((v) => v.preview)).toEqual([
        'three',
        'one',
      ]);

      const restored = await commands.restorePageVersion(page.id, versions[0]!.id);
      expect(restored).toEqual([paragraph('a', 'one')]);
      expect(await commands.loadBlocks(page.id)).toEqual(restored);
      // Restoring kept what it replaced.
      expect((await commands.listPageVersions(page.id))[0]?.preview).toBe('four');
      expect((await commands.loadPageVersion(page.id, versions[0]!.id)).blocks).toEqual(restored);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses unknown pages and versions', async () => {
    const page = await commands.createPage(null);

    await expect(commands.listPageVersions('missing')).rejects.toMatchObject(notFound);
    await expect(commands.loadPageVersion(page.id, 'missing')).rejects.toMatchObject(notFound);
    await expect(commands.restorePageVersion(page.id, 'missing')).rejects.toMatchObject(notFound);
  });
});
