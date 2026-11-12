import { getSlashMenuItems } from '@/features/editor/slashMenuItems';
import { i18n } from '@/lib/i18n';

// Building the list never touches the editor; only choosing an entry does.
const editor = {} as Parameters<typeof getSlashMenuItems>[0];
const items = (query: string) => getSlashMenuItems(editor, i18n.t, query);

describe('getSlashMenuItems', () => {
  it('opens with suggestions followed by every block', () => {
    const all = items('');

    expect(all.filter((item) => item.group === 'suggested').map((item) => item.title)).toEqual([
      'Text',
      'Heading 1',
      'Bulleted list',
      'To-do list',
    ]);
    expect(all.filter((item) => item.group === 'basic')).toHaveLength(10);
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
});
