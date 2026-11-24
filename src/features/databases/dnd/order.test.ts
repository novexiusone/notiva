import { mergeVisibleColumnOrder, rowMoveAfterReorder } from './order';

describe('table drag ordering', () => {
  it('reorders visible columns without moving hidden columns or the title', () => {
    expect(
      mergeVisibleColumnOrder(
        ['title', 'notes', 'hours', 'due', 'status'],
        ['notes', 'due', 'status'],
        0,
        2,
      ),
    ).toEqual(['title', 'due', 'hours', 'status', 'notes']);
  });

  it('keeps the title first when the last property moves to the front', () => {
    expect(mergeVisibleColumnOrder(['title', 'notes', 'due'], ['notes', 'due'], 1, 0)).toEqual([
      'title',
      'due',
      'notes',
    ]);
  });

  it('names the new visible neighbour for a row move', () => {
    expect(rowMoveAfterReorder(['one', 'two', 'three'], 2, 0)).toEqual({
      rowId: 'three',
      afterRowId: null,
    });
    expect(rowMoveAfterReorder(['one', 'two', 'three'], 0, 2)).toEqual({
      rowId: 'one',
      afterRowId: 'three',
    });
    expect(rowMoveAfterReorder(['one', 'two'], 1, 1)).toBeNull();
  });
});
