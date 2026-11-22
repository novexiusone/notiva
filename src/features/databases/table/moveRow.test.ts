import { commands } from '@/lib/commands';
import { installFakeBackend } from '@/test/fakeBackend';

async function databaseWithRows(...titles: string[]) {
  const { page } = await commands.createDatabase(null);
  const rows = [];
  for (const title of titles) {
    const row = await commands.createRow(page.id);
    await commands.renamePage(row.id, title);
    rows.push(row);
  }
  return { database: page, rows };
}

beforeEach(() => installFakeBackend());

describe('move_row', () => {
  it('places a row between its new neighbours without renumbering other rows', async () => {
    const { database, rows } = await databaseWithRows('One', 'Two', 'Three');
    const before = await commands.listRows(database.id);

    await commands.moveRow(rows[2]!.id, rows[0]!.id);

    const after = await commands.listRows(database.id);
    expect(after.map((row) => row.title)).toEqual(['One', 'Three', 'Two']);
    expect(after[1]!.position).toBe(0.5);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[1]);

    await commands.moveRow(rows[2]!.id, null);
    expect((await commands.listRows(database.id)).map((row) => row.id)).toEqual([
      rows[2]!.id,
      rows[0]!.id,
      rows[1]!.id,
    ]);
  });

  it('refuses rows of another database and locked moves', async () => {
    const first = await databaseWithRows('One', 'Two');
    const second = await databaseWithRows('Other');

    await expect(commands.moveRow(first.rows[0]!.id, second.rows[0]!.id)).rejects.toMatchObject({
      kind: 'invalid',
    });
    await commands.setLock(first.database.id, 'content');
    await commands.moveRow(first.rows[0]!.id, first.rows[1]!.id);
    await commands.setLock(first.database.id, 'all');
    await expect(commands.moveRow(first.rows[0]!.id, null)).rejects.toMatchObject({
      kind: 'locked',
    });
  });
});
