import { commands } from '@/lib/commands';
import { installFakeBackend } from '@/test/fakeBackend';

const invalid = { kind: 'invalid' };
const notFound = { kind: 'not_found' };

function install(files: Record<string, string> = {}, folder: string | null = '/notes') {
  installFakeBackend({ notes: { folder, files } });
}

describe('the notes folder in the fake backend', () => {
  it('remembers, reports and forgets the chosen folder', async () => {
    install({}, null);
    expect(await commands.getNotesFolder()).toBeNull();
    await expect(commands.listNotes('')).rejects.toMatchObject(notFound);

    expect(await commands.setNotesFolder('/Users/me/notes')).toBe('/Users/me/notes');
    expect(await commands.getNotesFolder()).toBe('/Users/me/notes');
    await commands.clearNotesFolder();
    expect(await commands.getNotesFolder()).toBeNull();
  });

  it('lists folders before files, one level at a time', async () => {
    install({ 'b.md': '', 'A.md': '', 'z/inner.md': '', 'a/deep/x.md': '' });

    expect((await commands.listNotes('')).map((entry) => entry.name)).toEqual([
      'a',
      'z',
      'A.md',
      'b.md',
    ]);
    expect((await commands.listNotes('a')).map((entry) => entry.path)).toEqual(['a/deep']);
    await expect(commands.listNotes('nope')).rejects.toMatchObject(notFound);
  });

  it('creates, reads and renames notes', async () => {
    install({ 'sub/a.md': 'text', 'sub/b.md': '' });

    const created = await commands.createNote('c.md');
    expect(created.content).toBe('');
    await expect(commands.createNote('c.md')).rejects.toMatchObject(invalid);
    await expect(commands.createNote('c.txt')).rejects.toMatchObject(invalid);
    await expect(commands.createNote('missing/c.md')).rejects.toMatchObject(notFound);

    expect((await commands.readNote('sub/a.md')).content).toBe('text');
    const renamed = await commands.renameNote('sub/a.md', 'd.md');
    expect(renamed.path).toBe('sub/d.md');
    await expect(commands.readNote('sub/a.md')).rejects.toMatchObject(notFound);
    await expect(commands.renameNote('sub/d.md', 'b.md')).rejects.toMatchObject(invalid);
    await expect(commands.renameNote('sub/d.md', 'x.txt')).rejects.toMatchObject(invalid);
  });

  it('saves with the modified time and reports a conflict', async () => {
    install({ 'a.md': 'one' });
    const read = await commands.readNote('a.md');

    const saved = await commands.saveNote('a.md', 'two', read.modified);
    expect(saved.modified).not.toBe(read.modified);

    await expect(commands.saveNote('a.md', 'three', read.modified)).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect((await commands.readNote('a.md')).content).toBe('two');
    await commands.saveNote('a.md', 'three', null);
    expect((await commands.readNote('a.md')).content).toBe('three');
  });

  it('refuses unsafe paths', async () => {
    install({ 'a.md': '' });
    for (const path of ['../a.md', '/a.md', 'a//b.md', 'sub/../a.md', 'a\\b.md']) {
      await expect(commands.readNote(path)).rejects.toMatchObject(invalid);
    }
  });

  it('deletes only with a confirmation', async () => {
    install({ 'a.md': '' });
    await expect(commands.deleteNote('a.md', false)).rejects.toMatchObject(invalid);
    await commands.deleteNote('a.md', true);
    await expect(commands.readNote('a.md')).rejects.toMatchObject(notFound);
  });
});
