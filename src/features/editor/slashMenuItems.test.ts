import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { Table } from 'lucide-react';
import { getSlashMenuItems, type SlashMenuActions } from '@/features/editor/slashMenuItems';
import { i18n } from '@/lib/i18n';

vi.mock('@blocknote/core/extensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blocknote/core/extensions')>()),
  insertOrUpdateBlockForSlashMenu: vi.fn(),
}));

// Building the list never touches the editor; only choosing an entry does.
const editor = {} as Parameters<typeof getSlashMenuItems>[0];
const noActions: SlashMenuActions = {
  createDatabase: () => Promise.reject(new Error('not expected')),
  onFailure: () => {},
};
const items = (query: string, actions = noActions) =>
  getSlashMenuItems(editor, i18n.t, query, actions);

describe('getSlashMenuItems', () => {
  it('opens with suggestions followed by every block', () => {
    const all = items('');

    expect(all.filter((item) => item.group === 'suggested').map((item) => item.title)).toEqual([
      'Text',
      'Heading 1',
      'Bulleted list',
      'To-do list',
    ]);
    expect(all.filter((item) => item.group === 'basic')).toHaveLength(11);
  });

  it('gives every entry an id of its own, so one block can appear in both groups', () => {
    const ids = items('').map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows the Markdown shortcut of each block', () => {
    const shortcuts = Object.fromEntries(
      items('')
        .filter((item) => item.group === 'basic')
        .map((item) => [item.title, item.shortcut]),
    );

    expect(shortcuts).toEqual({
      Text: undefined,
      'Heading 1': '#',
      'Heading 2': '##',
      'Heading 3': '###',
      'Bulleted list': '-',
      'Numbered list': '1.',
      'To-do list': '[]',
      Quote: '>',
      Code: '```',
      Image: undefined,
      Database: undefined,
    });
  });

  it('lists each match once when filtering', () => {
    expect(items('head').map((item) => item.title)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
    ]);
    expect(items('head').every((item) => item.group === 'basic')).toBe(true);
  });

  it('matches extra search terms in other languages', () => {
    expect(items('todo').map((item) => item.title)).toEqual(['To-do list']);
    expect(items('aufz').map((item) => item.title)).toEqual(['Bulleted list']);
    expect(items('foto').map((item) => item.title)).toEqual(['Image']);
  });

  it('returns nothing for a filter that matches no block', () => {
    expect(items('zzz')).toEqual([]);
  });

  it('lists the database in the basic blocks with its icon and finds it by typing', () => {
    const database = items('').filter((item) => item.title === 'Database');

    expect(database).toHaveLength(1);
    expect(database[0]).toMatchObject({ group: 'basic', icon: Table, shortcut: undefined });
    expect(items('data').map((item) => item.title)).toEqual(['Database']);
    expect(items('tabelle').map((item) => item.title)).toEqual(['Database']);
  });

  describe('choosing "Database"', () => {
    const insert = vi.mocked(insertOrUpdateBlockForSlashMenu);

    beforeEach(() => insert.mockReset());

    const choose = (actions: SlashMenuActions) =>
      items('data', actions)
        .find((item) => item.title === 'Database')!
        .onItemClick();

    it('creates the database first and then inserts a block that names it', async () => {
      let created!: (id: string) => void;
      const createDatabase = vi.fn(() => new Promise<string>((resolve) => (created = resolve)));
      const onFailure = vi.fn();

      choose({ createDatabase, onFailure });

      expect(createDatabase).toHaveBeenCalledOnce();
      // Nothing is inserted while the database does not exist yet.
      expect(insert).not.toHaveBeenCalled();
      created('db1');
      await vi.waitFor(() => expect(insert).toHaveBeenCalledOnce());
      expect(insert).toHaveBeenCalledWith(editor, {
        type: 'database',
        props: { databaseId: 'db1' },
      });
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('inserts nothing and reports the failure when creating fails', async () => {
      const error = { kind: 'storage', message: 'disk full' };
      const onFailure = vi.fn();

      choose({ createDatabase: () => Promise.reject(error), onFailure });

      await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith(error));
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
