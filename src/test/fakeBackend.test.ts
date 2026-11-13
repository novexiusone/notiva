import { commands, type CellValue, type PropertyType, type View } from '@/lib/commands';
import { installFakeBackend } from '@/test/fakeBackend';
import { database, page, row } from '@/test/renderApp';

const invalid = { kind: 'invalid' };
const notFound = { kind: 'not_found' };

/** A database with the rows `titles`, in that order. */
async function databaseWithRows(...titles: string[]) {
  const { page: databasePage } = await commands.createDatabase(null);
  const rows = [];
  for (const title of titles) {
    const created = await commands.createRow(databasePage.id);
    await commands.renamePage(created.id, title);
    rows.push(created);
  }
  return { id: databasePage.id, rows };
}

/** A property of `type` whose cells hold `values`, one new row per value. */
async function propertyWithValues(type: PropertyType, values: CellValue[]) {
  const { id } = await databaseWithRows();
  const property = await commands.createProperty(id, 'Property', type, null);
  for (const value of values) {
    const created = await commands.createRow(id);
    await commands.setCell(created.id, property.id, value);
  }
  return { databaseId: id, property };
}

async function cellsOf(databaseId: string, propertyId: string) {
  return (await commands.listRows(databaseId)).map((entry) => entry.cells[propertyId] ?? null);
}

function tableView(databaseId: string, propertyId: string): View {
  return {
    id: 'view',
    databaseId,
    name: 'Table',
    position: 0,
    config: {
      version: 1,
      type: 'table',
      filters: [{ propertyId, operator: 'isNotEmpty', value: null }],
      sorts: [
        { propertyId, direction: 'asc' },
        { propertyId: 'title', direction: 'desc' },
      ],
      properties: [
        { propertyId: 'title', visible: true, width: null },
        { propertyId, visible: true, width: 120 },
      ],
      groupBy: { propertyId, collapsed: [] },
    },
  };
}

describe('databases', () => {
  beforeEach(() => installFakeBackend());

  it('creates a database as a page with one table view and nothing else', async () => {
    const created = await commands.createDatabase(null);

    expect(created.page).toMatchObject({
      title: '',
      parentId: null,
      kind: 'database',
      databaseId: null,
    });
    expect(created.properties).toEqual([]);
    expect(created.views).toHaveLength(1);
    expect(created.views[0]).toMatchObject({
      databaseId: created.page.id,
      name: 'Table',
      config: { version: 1, type: 'table', filters: [], sorts: [], properties: [], groupBy: null },
    });
    expect(await commands.loadDatabase(created.page.id)).toEqual(created);
    expect(await commands.listPages()).toEqual([created.page]);
  });

  it('appends a database after the last sibling, below a page too', async () => {
    const parent = await commands.createPage(null);
    await commands.createPage(parent.id);

    const created = await commands.createDatabase(parent.id);

    expect(created.page).toMatchObject({ parentId: parent.id, position: 1 });
  });

  it('does not load a database from an ordinary page or an unknown id', async () => {
    const ordinary = await commands.createPage(null);

    await expect(commands.loadDatabase(ordinary.id)).rejects.toMatchObject(notFound);
    await expect(commands.loadDatabase('missing')).rejects.toMatchObject(notFound);
    await expect(commands.listRows(ordinary.id)).rejects.toMatchObject(notFound);
    await expect(commands.createRow(ordinary.id)).rejects.toMatchObject(notFound);
  });

  it('refuses a database as the parent of a page or of another database', async () => {
    const { id } = await databaseWithRows();

    await expect(commands.createPage(id)).rejects.toMatchObject(invalid);
    await expect(commands.createDatabase(id)).rejects.toMatchObject(invalid);
    await expect(commands.createDatabase('missing')).rejects.toMatchObject(notFound);
  });

  it('refuses to move a row and to move anything into a database', async () => {
    const { id, rows } = await databaseWithRows('Row');
    const ordinary = await commands.createPage(null);

    await expect(commands.movePage(rows[0]!.id, null, 0)).rejects.toMatchObject(invalid);
    await expect(commands.movePage(rows[0]!.id, ordinary.id, 0)).rejects.toMatchObject(invalid);
    await expect(commands.movePage(ordinary.id, id, 0)).rejects.toMatchObject(invalid);
  });

  it('moves a database like a page', async () => {
    const { id, rows } = await databaseWithRows('Row');
    const ordinary = await commands.createPage(null);

    await commands.movePage(id, ordinary.id, 0);

    const pages = await commands.listPages();
    expect(pages.find((candidate) => candidate.id === id)).toMatchObject({ parentId: ordinary.id });
    expect(pages.find((candidate) => candidate.id === rows[0]!.id)).toMatchObject({
      parentId: id,
      databaseId: id,
    });
  });
});

describe('rows', () => {
  beforeEach(() => installFakeBackend());

  it('appends rows in the order they were created, as pages of the database', async () => {
    const { id, rows } = await databaseWithRows('One', 'Two', 'Three');

    expect(rows.map((entry) => entry.cells)).toEqual([{}, {}, {}]);
    expect((await commands.listRows(id)).map((entry) => entry.title)).toEqual([
      'One',
      'Two',
      'Three',
    ]);
    expect((await commands.listPages()).filter((entry) => entry.databaseId === id)).toEqual(
      rows.map((entry) =>
        expect.objectContaining({ id: entry.id, parentId: id, kind: 'page', databaseId: id }),
      ),
    );
  });

  it('puts a new row after the last one without touching the others', async () => {
    const { id, rows } = await databaseWithRows('One', 'Two', 'Three');
    await commands.deletePage(rows[0]!.id);
    const before = await commands.listRows(id);

    const added = await commands.createRow(id);

    const after = await commands.listRows(id);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toEqual(added);
    expect(added.position).toBeGreaterThan(before[1]!.position);
  });

  it('follows a row that is renamed and loses one that is deleted', async () => {
    const { id, rows } = await databaseWithRows('One', 'Two');

    await commands.renamePage(rows[1]!.id, 'Second');
    await commands.deletePage(rows[0]!.id);

    expect((await commands.listRows(id)).map((entry) => entry.title)).toEqual(['Second']);
  });
});

describe('properties', () => {
  beforeEach(() => installFakeBackend());

  it('appends properties in the order they were created', async () => {
    const { id } = await databaseWithRows();
    const status = await commands.createProperty(id, 'Status', 'select', null);
    const due = await commands.createProperty(id, 'Due', 'date', null);

    expect(status).toMatchObject({
      databaseId: id,
      name: 'Status',
      type: 'select',
      options: [],
      targetId: null,
    });
    expect(due.position).toBeGreaterThan(status.position);
    expect((await commands.loadDatabase(id)).properties).toEqual([status, due]);
  });

  it('refuses an unknown type, an unknown database and a target that makes no sense', async () => {
    const { id } = await databaseWithRows();
    const ordinary = await commands.createPage(null);

    await expect(
      commands.createProperty(id, 'Done', 'checkbox' as PropertyType, null),
    ).rejects.toMatchObject(invalid);
    await expect(commands.createProperty('missing', 'Name', 'text', null)).rejects.toMatchObject(
      notFound,
    );
    await expect(commands.createProperty(id, 'Name', 'text', id)).rejects.toMatchObject(invalid);
    await expect(commands.createProperty(id, 'Link', 'relation', null)).rejects.toMatchObject(
      invalid,
    );
    await expect(
      commands.createProperty(id, 'Link', 'relation', ordinary.id),
    ).rejects.toMatchObject(notFound);
  });

  it('lets a relation point at another database or at its own', async () => {
    const { id } = await databaseWithRows();
    const other = await databaseWithRows();

    expect(await commands.createProperty(id, 'Other', 'relation', other.id)).toMatchObject({
      type: 'relation',
      targetId: other.id,
    });
    expect(await commands.createProperty(id, 'Self', 'relation', id)).toMatchObject({
      targetId: id,
    });
  });

  it('renames a property and leaves its options alone', async () => {
    const { id } = await databaseWithRows();
    const status = await commands.createProperty(id, 'Status', 'select', null);
    const options = [{ id: 'open', name: 'Open', color: 'green' }];
    await commands.updateProperty(status.id, null, options);

    const renamed = await commands.updateProperty(status.id, 'State', null);

    expect(renamed).toEqual({ ...status, name: 'State', options });
    expect((await commands.loadDatabase(id)).properties).toEqual([renamed]);
  });

  it('replaces the list of options: add, rename, recolour and reorder', async () => {
    const { id } = await databaseWithRows();
    const status = await commands.createProperty(id, 'Status', 'select', null);
    await commands.updateProperty(status.id, null, [
      { id: 'open', name: 'Open', color: 'green' },
      { id: 'done', name: 'Done', color: 'gray' },
    ]);

    const updated = await commands.updateProperty(status.id, null, [
      { id: 'done', name: 'Finished', color: 'blue' },
      { id: 'open', name: 'Open', color: 'green' },
      { id: 'later', name: 'Later', color: 'yellow' },
    ]);

    expect(updated.name).toBe('Status');
    expect(updated.options.map((option) => option.name)).toEqual(['Finished', 'Open', 'Later']);
    expect(updated.options[0]).toEqual({ id: 'done', name: 'Finished', color: 'blue' });
  });

  it('refuses options on anything but a select, and options that share an id', async () => {
    const { id } = await databaseWithRows();
    const notes = await commands.createProperty(id, 'Notes', 'text', null);
    const status = await commands.createProperty(id, 'Status', 'select', null);
    const option = { id: 'open', name: 'Open', color: 'green' };

    await expect(commands.updateProperty(notes.id, null, [option])).rejects.toMatchObject(invalid);
    await expect(commands.updateProperty(status.id, null, [option, option])).rejects.toMatchObject(
      invalid,
    );
    await expect(commands.updateProperty('missing', 'Name', null)).rejects.toMatchObject(notFound);
  });
});

describe('set_cell', () => {
  beforeEach(() => installFakeBackend());

  it('stores a value of each type and returns it with the rows', async () => {
    const target = await databaseWithRows('Target one', 'Target two');
    const { id, rows } = await databaseWithRows('Row');
    const text = await commands.createProperty(id, 'Notes', 'text', null);
    const number = await commands.createProperty(id, 'Amount', 'number', null);
    const date = await commands.createProperty(id, 'Due', 'date', null);
    const select = await commands.createProperty(id, 'Status', 'select', null);
    const relation = await commands.createProperty(id, 'Links', 'relation', target.id);
    await commands.updateProperty(select.id, null, [{ id: 'open', name: 'Open', color: 'green' }]);
    const rowId = rows[0]!.id;
    const linked = [target.rows[1]!.id, target.rows[0]!.id];

    await commands.setCell(rowId, text.id, 'hello');
    await commands.setCell(rowId, number.id, 12.5);
    await commands.setCell(rowId, date.id, '2026-11-13');
    await commands.setCell(rowId, select.id, 'open');
    await commands.setCell(rowId, relation.id, linked);

    expect((await commands.listRows(id))[0]!.cells).toEqual({
      [text.id]: 'hello',
      [number.id]: 12.5,
      [date.id]: '2026-11-13',
      [select.id]: 'open',
      // In the order in which the rows were added.
      [relation.id]: linked,
    });
  });

  it.each<[PropertyType, CellValue[]]>([
    ['text', [5, ['a']]],
    ['number', ['5', 'five', Number.NaN, Number.POSITIVE_INFINITY, ['a']]],
    ['date', ['13.11.2026', '2026-13-01', '2026-02-30', '2026-1-1', 20261113, ['2026-11-13']]],
    ['select', ['Open', 3, ['open']]],
  ])('refuses a value that does not fit a %s property', async (type, values) => {
    const { id, rows } = await databaseWithRows('Row');
    const property = await commands.createProperty(id, 'Property', type, null);
    if (type === 'select') {
      await commands.updateProperty(property.id, null, [
        { id: 'open', name: 'Open', color: 'green' },
      ]);
    }

    for (const value of values) {
      await expect(commands.setCell(rows[0]!.id, property.id, value)).rejects.toMatchObject(
        invalid,
      );
    }
    expect((await commands.listRows(id))[0]!.cells).toEqual({});
  });

  it('refuses an option the select does not have', async () => {
    const { id, rows } = await databaseWithRows('Row');
    const status = await commands.createProperty(id, 'Status', 'select', null);
    const other = await commands.createProperty(id, 'Priority', 'select', null);
    await commands.updateProperty(other.id, null, [{ id: 'high', name: 'High', color: 'red' }]);

    await expect(commands.setCell(rows[0]!.id, status.id, 'high')).rejects.toMatchObject(invalid);
  });

  it('refuses a relation target that is not a row of the target database', async () => {
    const target = await databaseWithRows('Target');
    const { id, rows } = await databaseWithRows('Row', 'Sibling');
    const ordinary = await commands.createPage(null);
    const relation = await commands.createProperty(id, 'Links', 'relation', target.id);
    const set = (value: CellValue) => commands.setCell(rows[0]!.id, relation.id, value);

    await expect(set([rows[1]!.id])).rejects.toMatchObject(invalid);
    await expect(set([ordinary.id])).rejects.toMatchObject(invalid);
    await expect(set([target.id])).rejects.toMatchObject(invalid);
    await expect(set(['missing'])).rejects.toMatchObject(invalid);
    await expect(set([target.rows[0]!.id, 'missing'])).rejects.toMatchObject(invalid);
    await expect(set([target.rows[0]!.id, target.rows[0]!.id])).rejects.toMatchObject(invalid);
    await expect(set(target.rows[0]!.id)).rejects.toMatchObject(invalid);
    expect((await commands.listRows(id))[0]!.cells).toEqual({});
  });

  it('empties a cell of any type with null', async () => {
    const target = await databaseWithRows('Target');
    const { id, rows } = await databaseWithRows('Row');
    const text = await commands.createProperty(id, 'Notes', 'text', null);
    const relation = await commands.createProperty(id, 'Links', 'relation', target.id);
    await commands.setCell(rows[0]!.id, text.id, 'hello');
    await commands.setCell(rows[0]!.id, relation.id, [target.rows[0]!.id]);

    await commands.setCell(rows[0]!.id, text.id, null);
    await commands.setCell(rows[0]!.id, relation.id, null);

    expect((await commands.listRows(id))[0]!.cells).toEqual({});
  });

  it('refuses a page that is no row, a property of another database and unknown ids', async () => {
    const { id, rows } = await databaseWithRows('Row');
    const other = await databaseWithRows('Other row');
    const text = await commands.createProperty(id, 'Notes', 'text', null);
    const ordinary = await commands.createPage(null);

    await expect(commands.setCell(ordinary.id, text.id, 'a')).rejects.toMatchObject(invalid);
    await expect(commands.setCell(id, text.id, 'a')).rejects.toMatchObject(invalid);
    await expect(commands.setCell(other.rows[0]!.id, text.id, 'a')).rejects.toMatchObject(invalid);
    await expect(commands.setCell('missing', text.id, 'a')).rejects.toMatchObject(notFound);
    await expect(commands.setCell(rows[0]!.id, 'missing', 'a')).rejects.toMatchObject(notFound);
    // The title is not a property: it is changed with rename_page.
    await expect(commands.setCell(rows[0]!.id, 'title', 'a')).rejects.toMatchObject(notFound);
  });
});

describe('deleting properties and options', () => {
  it('removes a property with its value in every row', async () => {
    installFakeBackend();
    const { id, rows } = await databaseWithRows('One', 'Two');
    const notes = await commands.createProperty(id, 'Notes', 'text', null);
    const amount = await commands.createProperty(id, 'Amount', 'number', null);
    await commands.setCell(rows[0]!.id, notes.id, 'gone');
    await commands.setCell(rows[0]!.id, amount.id, 1);
    await commands.setCell(rows[1]!.id, notes.id, 'gone too');

    await commands.deleteProperty(notes.id);

    expect((await commands.loadDatabase(id)).properties).toEqual([amount]);
    expect((await commands.listRows(id)).map((entry) => entry.cells)).toEqual([
      { [amount.id]: 1 },
      {},
    ]);
    await expect(commands.deleteProperty(notes.id)).rejects.toMatchObject(notFound);
  });

  it('removes a deleted property from the views of its database', async () => {
    installFakeBackend({
      pages: [database('db', 'Tasks')],
      properties: [
        {
          id: 'status',
          databaseId: 'db',
          name: 'Status',
          type: 'select',
          position: 0,
          options: [],
          targetId: null,
        },
      ],
      views: [tableView('db', 'status')],
    });

    await commands.deleteProperty('status');

    expect((await commands.loadDatabase('db')).views[0]!.config).toEqual({
      version: 1,
      type: 'table',
      filters: [],
      sorts: [{ propertyId: 'title', direction: 'desc' }],
      properties: [{ propertyId: 'title', visible: true, width: null }],
      groupBy: null,
    });
  });

  it('empties the cells that held a deleted option', async () => {
    installFakeBackend();
    const { id, rows } = await databaseWithRows('One', 'Two');
    const status = await commands.createProperty(id, 'Status', 'select', null);
    const open = { id: 'open', name: 'Open', color: 'green' };
    const done = { id: 'done', name: 'Done', color: 'gray' };
    await commands.updateProperty(status.id, null, [open, done]);
    await commands.setCell(rows[0]!.id, status.id, 'open');
    await commands.setCell(rows[1]!.id, status.id, 'done');

    await commands.deleteSelectOption(status.id, 'open');

    expect((await commands.loadDatabase(id)).properties[0]!.options).toEqual([done]);
    expect(await cellsOf(id, status.id)).toEqual([null, 'done']);
    await expect(commands.setCell(rows[0]!.id, status.id, 'open')).rejects.toMatchObject(invalid);
  });

  it('refuses to delete an option that does not exist or from a property without options', async () => {
    installFakeBackend();
    const { id } = await databaseWithRows();
    const status = await commands.createProperty(id, 'Status', 'select', null);
    const notes = await commands.createProperty(id, 'Notes', 'text', null);

    await expect(commands.deleteSelectOption(status.id, 'missing')).rejects.toMatchObject(notFound);
    await expect(commands.deleteSelectOption(notes.id, 'open')).rejects.toMatchObject(invalid);
    await expect(commands.deleteSelectOption('missing', 'open')).rejects.toMatchObject(notFound);
  });
});

describe('change_property_type', () => {
  beforeEach(() => installFakeBackend());

  it('number → text: the number as written', async () => {
    const { databaseId, property } = await propertyWithValues('number', [12.5, -3, null]);

    const changed = await commands.changePropertyType(property.id, 'text');

    expect(changed).toEqual({ ...property, type: 'text' });
    expect(await cellsOf(databaseId, property.id)).toEqual(['12.5', '-3', null]);
  });

  it('date → text: the date as yyyy-MM-dd', async () => {
    const { databaseId, property } = await propertyWithValues('date', ['2026-11-13', null]);

    await commands.changePropertyType(property.id, 'text');

    expect(await cellsOf(databaseId, property.id)).toEqual(['2026-11-13', null]);
  });

  it('select → text: the name of the option, and the options are gone', async () => {
    const { databaseId, property } = await propertyWithValues('select', []);
    await commands.updateProperty(property.id, null, [
      { id: 'open', name: 'Open', color: 'green' },
      { id: 'done', name: 'Done', color: 'gray' },
    ]);
    for (const value of ['done', 'open', null]) {
      const created = await commands.createRow(databaseId);
      await commands.setCell(created.id, property.id, value);
    }

    const changed = await commands.changePropertyType(property.id, 'text');

    expect(changed.options).toEqual([]);
    expect(await cellsOf(databaseId, property.id)).toEqual(['Done', 'Open', null]);
  });

  it('text → number: the number if the text is one, otherwise empty', async () => {
    const { databaseId, property } = await propertyWithValues('text', [
      '42',
      ' -1.5 ',
      '1e3',
      '12 apples',
      'twelve',
      '',
      'Infinity',
      '0x10',
      null,
    ]);

    await commands.changePropertyType(property.id, 'number');

    expect(await cellsOf(databaseId, property.id)).toEqual([
      42,
      -1.5,
      1000,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('text → date: the date if the text is yyyy-MM-dd, otherwise empty', async () => {
    const { databaseId, property } = await propertyWithValues('text', [
      '2026-11-13',
      '13.11.2026',
      '2026-02-30',
      'tomorrow',
      null,
    ]);

    await commands.changePropertyType(property.id, 'date');

    expect(await cellsOf(databaseId, property.id)).toEqual(['2026-11-13', null, null, null, null]);
  });

  it('text → select: one option per distinct text, and the cells point at their option', async () => {
    const { databaseId, property } = await propertyWithValues('text', [
      'Open',
      'Done',
      'Open',
      '',
      null,
    ]);

    const changed = await commands.changePropertyType(property.id, 'select');

    expect(changed.options.map((option) => option.name)).toEqual(['Open', 'Done']);
    expect(new Set(changed.options.map((option) => option.color)).size).toBe(2);
    const [open, done] = changed.options.map((option) => option.id);
    expect(await cellsOf(databaseId, property.id)).toEqual([open, done, open, null, null]);
    expect((await commands.loadDatabase(databaseId)).properties).toEqual([changed]);
  });

  it.each<[PropertyType, CellValue, PropertyType]>([
    ['number', 5, 'date'],
    ['number', 5, 'select'],
    ['date', '2026-11-13', 'number'],
    ['date', '2026-11-13', 'select'],
    ['select', 'open', 'number'],
    ['select', 'open', 'date'],
  ])('%s → %s: empty', async (from, value, to) => {
    const { databaseId, property } = await propertyWithValues(from, []);
    if (from === 'select') {
      await commands.updateProperty(property.id, null, [
        { id: 'open', name: 'Open', color: 'green' },
      ]);
    }
    const created = await commands.createRow(databaseId);
    await commands.setCell(created.id, property.id, value);

    const changed = await commands.changePropertyType(property.id, to);

    expect(changed).toMatchObject({ type: to, options: [] });
    expect(await cellsOf(databaseId, property.id)).toEqual([null]);
  });

  it('leaves the cells of other properties and other databases alone', async () => {
    const { databaseId, property } = await propertyWithValues('text', ['12']);
    const other = await commands.createProperty(databaseId, 'Other', 'text', null);
    const [first] = await commands.listRows(databaseId);
    await commands.setCell(first!.id, other.id, '34');
    const elsewhere = await propertyWithValues('text', ['56']);

    await commands.changePropertyType(property.id, 'number');

    expect((await commands.listRows(databaseId))[0]!.cells).toEqual({
      [property.id]: 12,
      [other.id]: '34',
    });
    expect(await cellsOf(elsewhere.databaseId, elsewhere.property.id)).toEqual(['56']);
  });

  it('keeps everything when the type stays the same', async () => {
    const { databaseId, property } = await propertyWithValues('number', [5]);

    expect(await commands.changePropertyType(property.id, 'number')).toEqual(property);
    expect(await cellsOf(databaseId, property.id)).toEqual([5]);
  });

  it('refuses to change a relation and to turn anything into one', async () => {
    const { id } = await databaseWithRows();
    const relation = await commands.createProperty(id, 'Links', 'relation', id);
    const notes = await commands.createProperty(id, 'Notes', 'text', null);

    await expect(commands.changePropertyType(relation.id, 'text')).rejects.toMatchObject(invalid);
    await expect(commands.changePropertyType(notes.id, 'relation')).rejects.toMatchObject(invalid);
    await expect(
      commands.changePropertyType(notes.id, 'checkbox' as PropertyType),
    ).rejects.toMatchObject(invalid);
    await expect(commands.changePropertyType('missing', 'text')).rejects.toMatchObject(notFound);
  });
});

describe('relations and cascades', () => {
  beforeEach(() => installFakeBackend());

  /** Tasks point at projects; one task also points at another task. */
  async function tasksAndProjects() {
    const projects = await databaseWithRows('Notiva', 'Garden');
    const tasks = await databaseWithRows('Write spec', 'Build it', 'Plant');
    const project = await commands.createProperty(tasks.id, 'Project', 'relation', projects.id);
    const blockedBy = await commands.createProperty(tasks.id, 'Blocked by', 'relation', tasks.id);
    const [notiva, garden] = projects.rows.map((entry) => entry.id);
    const [write, build, plant] = tasks.rows.map((entry) => entry.id);
    await commands.setCell(write!, project.id, [notiva!]);
    await commands.setCell(build!, project.id, [notiva!, garden!]);
    await commands.setCell(plant!, project.id, [garden!]);
    await commands.setCell(build!, blockedBy.id, [write!]);
    return { projects, tasks, project, blockedBy, notiva, garden, write, build, plant };
  }

  it('lists the rows that point at a row, grouped by property', async () => {
    const { project, blockedBy, notiva, write, build } = await tasksAndProjects();

    expect(await commands.listIncomingRelations(notiva!)).toEqual([
      {
        property: project,
        rows: [
          { id: write, title: 'Write spec' },
          { id: build, title: 'Build it' },
        ],
      },
    ]);
    expect(await commands.listIncomingRelations(write!)).toEqual([
      { property: blockedBy, rows: [{ id: build, title: 'Build it' }] },
    ]);
    expect(await commands.listIncomingRelations(build!)).toEqual([]);
  });

  it('only lists incoming relations of a row', async () => {
    const { tasks } = await tasksAndProjects();

    await expect(commands.listIncomingRelations(tasks.id)).rejects.toMatchObject(invalid);
    await expect(commands.listIncomingRelations('missing')).rejects.toMatchObject(notFound);
  });

  it('removes a deleted row from every relation cell that held it', async () => {
    // Persisted, so that the stored cells can be looked at: a reader would skip a missing row anyway.
    installFakeBackend({ persist: true });
    const { tasks, project, blockedBy, notiva, garden, write, build, plant } =
      await tasksAndProjects();

    await commands.deletePage(notiva!);
    await commands.deletePage(write!);

    expect((await commands.listRows(tasks.id)).map((entry) => entry.cells)).toEqual([
      { [project.id]: [garden] },
      { [project.id]: [garden] },
    ]);
    const stored = JSON.parse(window.localStorage.getItem('notiva.fake.databases')!) as {
      cells: Record<string, unknown>;
    };
    expect(stored.cells).toEqual({
      [build!]: { [project.id]: [garden] },
      [plant!]: { [project.id]: [garden] },
    });
    expect(await commands.listIncomingRelations(garden!)).toHaveLength(1);
    expect((await commands.loadDatabase(tasks.id)).properties).toEqual([project, blockedBy]);
  });

  it('deletes a database with its rows, properties and views', async () => {
    // Persisted, so that what is left can be looked at.
    installFakeBackend({ persist: true });
    const { projects, tasks } = await tasksAndProjects();
    const subpage = await commands.createPage(tasks.rows[0]!.id);

    await commands.deletePage(tasks.id);

    expect((await commands.listPages()).map((entry) => entry.id)).toEqual([
      projects.id,
      ...projects.rows.map((entry) => entry.id),
    ]);
    await expect(commands.loadDatabase(tasks.id)).rejects.toMatchObject(notFound);
    await expect(commands.listRows(tasks.id)).rejects.toMatchObject(notFound);
    await expect(commands.loadBlocks(subpage.id)).rejects.toMatchObject(notFound);
    const left = JSON.parse(window.localStorage.getItem('notiva.fake.databases')!) as {
      properties: unknown[];
      views: { databaseId: string }[];
      cells: Record<string, unknown>;
    };
    expect(left.properties).toEqual([]);
    expect(left.views.map((view) => view.databaseId)).toEqual([projects.id]);
    expect(left.cells).toEqual({});
  });

  it('deletes the relation properties that point at a deleted database', async () => {
    const { projects, tasks, project, blockedBy, write, build } = await tasksAndProjects();

    await commands.deletePage(projects.id);

    expect((await commands.loadDatabase(tasks.id)).properties).toEqual([blockedBy]);
    expect((await commands.listRows(tasks.id)).map((entry) => entry.cells)).toEqual([
      {},
      { [blockedBy.id]: [write] },
      {},
    ]);
    await expect(commands.setCell(build!, project.id, null)).rejects.toMatchObject(notFound);
  });

  it('deletes a database that sits below a deleted page', async () => {
    const parent = await commands.createPage(null);
    const { page: nested } = await commands.createDatabase(parent.id);
    const nestedRow = await commands.createRow(nested.id);
    const notes = await commands.createProperty(nested.id, 'Notes', 'text', null);
    await commands.setCell(nestedRow.id, notes.id, 'hello');

    await commands.deletePage(parent.id);

    expect(await commands.listPages()).toEqual([]);
    await expect(commands.updateProperty(notes.id, 'Name', null)).rejects.toMatchObject(notFound);
  });
});

describe('readers', () => {
  it('skip property ids, option ids and rows that no longer exist', async () => {
    const property = (id: string, type: PropertyType, targetId: string | null = null) => ({
      id,
      databaseId: 'db',
      name: id,
      type,
      position: 0,
      options: type === 'select' ? [{ id: 'open', name: 'Open', color: 'green' }] : [],
      targetId,
    });
    installFakeBackend({
      pages: [
        database('db', 'Tasks'),
        row('one', 'One', 'db', 0),
        row('two', 'Two', 'db', 1),
        page('ordinary', 'Ordinary', null, 1),
      ],
      properties: [
        property('notes', 'text'),
        property('status', 'select'),
        property('links', 'relation', 'db'),
      ],
      cells: {
        one: { notes: 'kept', deleted: 'skipped', status: 'gone', links: ['two', 'missing'] },
        two: { status: 'open', links: ['missing', 'ordinary'] },
        missing: { notes: 'a row that is gone' },
      },
    });

    expect(await commands.listRows('db')).toEqual([
      { id: 'one', title: 'One', position: 0, cells: { notes: 'kept', links: ['two'] } },
      { id: 'two', title: 'Two', position: 1, cells: { status: 'open' } },
    ]);
  });

  it('give pages that were stored before databases existed the new fields', async () => {
    window.localStorage.setItem(
      'notiva.fake.pages',
      JSON.stringify([{ id: 'old', title: 'Old', parentId: null, position: 0 }]),
    );
    installFakeBackend({ persist: true });

    expect(await commands.listPages()).toEqual([page('old', 'Old')]);
  });
});

describe('persistence', () => {
  it('keeps databases, properties, rows and cells across a reload', async () => {
    installFakeBackend({ persist: true });
    const { id, rows } = await databaseWithRows('One', 'Two');
    const status = await commands.createProperty(id, 'Status', 'select', null);
    await commands.updateProperty(status.id, null, [{ id: 'open', name: 'Open', color: 'green' }]);
    await commands.setCell(rows[1]!.id, status.id, 'open');
    const before = {
      pages: await commands.listPages(),
      database: await commands.loadDatabase(id),
      rows: await commands.listRows(id),
    };

    // A reload starts the fake backend again; only localStorage is left.
    installFakeBackend({ persist: true });

    expect(await commands.listPages()).toEqual(before.pages);
    expect(await commands.loadDatabase(id)).toEqual(before.database);
    expect(await commands.listRows(id)).toEqual(before.rows);
    expect(before.rows[1]!.cells).toEqual({ [status.id]: 'open' });
    expect(before.database.views).toHaveLength(1);
  });
});
