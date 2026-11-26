import { moveCard, type KanbanMoveColumn } from './moveCard';

const columns: KanbanMoveColumn[] = [
  { key: 'todo', value: 'todo', rowIds: ['one', 'two', 'three'] },
  { key: 'done', value: 'done', rowIds: ['four', 'five'] },
  { key: '', value: null, rowIds: ['six'] },
];

describe('moveCard', () => {
  it('sets a new value and inserts before the target card in another column', () => {
    expect(moveCard(columns, { rowId: 'two', group: 'todo' }, { group: 'done', index: 1 })).toEqual(
      { rowId: 'two', value: 'done', position: { afterRowId: 'four' } },
    );
  });

  it('clears the value and appends in the no-value column', () => {
    expect(moveCard(columns, { rowId: 'one', group: 'todo' }, { group: '', index: 1 })).toEqual({
      rowId: 'one',
      value: null,
      position: { afterRowId: 'six' },
    });
  });

  it('moves a card after its new predecessor when reordered down a column', () => {
    expect(moveCard(columns, { rowId: 'one', group: 'todo' }, { group: 'todo', index: 2 })).toEqual(
      { rowId: 'one', value: 'todo', position: { afterRowId: 'three' } },
    );
  });

  it('appends after the last remaining card for the column end sentinel', () => {
    expect(moveCard(columns, { rowId: 'one', group: 'todo' }, { group: 'todo', index: 3 })).toEqual(
      { rowId: 'one', value: 'todo', position: { afterRowId: 'three' } },
    );
    expect(
      moveCard(columns, { rowId: 'three', group: 'todo' }, { group: 'todo', index: 3 }),
    ).toBeNull();
  });

  it('moves a card to the start when reordered up a column', () => {
    expect(
      moveCard(columns, { rowId: 'three', group: 'todo' }, { group: 'todo', index: 0 }),
    ).toEqual({ rowId: 'three', value: 'todo', position: { afterRowId: null } });
  });

  it('does nothing when a card stays at its index', () => {
    expect(
      moveCard(columns, { rowId: 'two', group: 'todo' }, { group: 'todo', index: 1 }),
    ).toBeNull();
  });

  it('keeps cross-column value changes but suppresses all manual positioning when sorted', () => {
    expect(
      moveCard(
        columns,
        { rowId: 'one', group: 'todo' },
        { group: 'done', index: 0 },
        { sorted: true },
      ),
    ).toEqual({ rowId: 'one', value: 'done', position: null });
    expect(
      moveCard(
        columns,
        { rowId: 'one', group: 'todo' },
        { group: 'todo', index: 2 },
        { sorted: true },
      ),
    ).toBeNull();
  });

  it('rejects unknown rows, columns and target positions', () => {
    expect(
      moveCard(columns, { rowId: 'missing', group: 'todo' }, { group: 'done', index: 0 }),
    ).toBeNull();
    expect(
      moveCard(columns, { rowId: 'one', group: 'todo' }, { group: 'missing', index: 0 }),
    ).toBeNull();
    expect(
      moveCard(columns, { rowId: 'one', group: 'todo' }, { group: 'done', index: 3 }),
    ).toBeNull();
  });
});
