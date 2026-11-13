import {
  buildTree,
  canMove,
  childIds,
  countDescendants,
  descendantIds,
  isRow,
  movePage,
} from '@/features/pages/tree';
import type { Page } from '@/lib/commands';
import { database, page, row } from '@/test/renderApp';

const pages = [
  page('b', 'B', null, 1),
  page('a', 'A', null, 0),
  page('a2', 'A2', 'a', 1),
  page('a1', 'A1', 'a', 0),
  page('a1x', 'A1X', 'a1', 0),
];

/** A page with a database below it, whose rows have a subpage and a database of their own. */
const withDatabase = [
  page('a', 'A', null, 0),
  database('db', 'Tasks', 'a', 0),
  row('r1', 'Row 1', 'db', 0),
  row('r2', 'Row 2', 'db', 1),
  page('r1x', 'Below a row', 'r1', 0),
  database('r1db', 'Database below a row', 'r1', 1),
  row('r1dbr', 'Row below a row', 'r1db', 0),
  database('top', 'Top-level database', null, 1),
  row('t1', 'Top row', 'top', 0),
];

describe('buildTree', () => {
  it('nests pages below their parent, ordered by position', () => {
    expect(buildTree(pages)).toEqual([
      {
        id: 'a',
        title: 'A',
        kind: 'page',
        children: [
          {
            id: 'a1',
            title: 'A1',
            kind: 'page',
            children: [{ id: 'a1x', title: 'A1X', kind: 'page', children: [] }],
          },
          { id: 'a2', title: 'A2', kind: 'page', children: [] },
        ],
      },
      { id: 'b', title: 'B', kind: 'page', children: [] },
    ]);
  });

  it('keeps a page whose parent is missing as a top-level page', () => {
    expect(buildTree([page('orphan', 'Orphan', 'gone')])).toEqual([
      { id: 'orphan', title: 'Orphan', kind: 'page', children: [] },
    ]);
  });

  it('shows a database and hides its rows and everything below them', () => {
    expect(buildTree(withDatabase)).toEqual([
      {
        id: 'a',
        title: 'A',
        kind: 'page',
        children: [{ id: 'db', title: 'Tasks', kind: 'database', children: [] }],
      },
      { id: 'top', title: 'Top-level database', kind: 'database', children: [] },
    ]);
  });

  it('hides rows whatever the order of the list', () => {
    expect(buildTree([...withDatabase].reverse())).toEqual(buildTree(withDatabase));
  });

  it('shows the pages of a backend that does not know databases yet', () => {
    const old = { id: 'old', title: 'Old', parentId: null, position: 0 } as Page;

    expect(isRow(old)).toBe(false);
    expect(buildTree([old]).map((node) => node.id)).toEqual(['old']);
  });
});

describe('descendantIds', () => {
  it('finds subpages at every depth', () => {
    expect(descendantIds(pages, 'a').sort()).toEqual(['a1', 'a1x', 'a2']);
    expect(descendantIds(pages, 'b')).toEqual([]);
  });

  it('counts the rows of a database and what is below them', () => {
    expect(descendantIds(withDatabase, 'db').sort()).toEqual(['r1', 'r1db', 'r1dbr', 'r1x', 'r2']);
    expect(descendantIds(withDatabase, 'a')).toHaveLength(6);
  });

  it('stays fast with the rows of a large database in the list', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => row(`row${index}`, '', 'db', index));

    expect(descendantIds([database('db', 'Large'), ...rows], 'db')).toHaveLength(10_000);
  });
});

describe('countDescendants', () => {
  it('tells rows from the other pages below a page', () => {
    expect(countDescendants(pages, 'a')).toEqual({ subpages: 3, rows: 0 });
    expect(countDescendants(withDatabase, 'top')).toEqual({ subpages: 0, rows: 1 });
    // The database, the page and the database below a row; three rows.
    expect(countDescendants(withDatabase, 'a')).toEqual({ subpages: 3, rows: 3 });
    expect(countDescendants(withDatabase, 'r2')).toEqual({ subpages: 0, rows: 0 });
  });
});

describe('canMove', () => {
  it('refuses a move into the page itself or one of its subpages', () => {
    expect(canMove(pages, 'a', 'a')).toBe(false);
    expect(canMove(pages, 'a', 'a1')).toBe(false);
    expect(canMove(pages, 'a', 'a1x')).toBe(false);
  });

  it('allows a move to the top level or into an unrelated page', () => {
    expect(canMove(pages, 'a1', null)).toBe(true);
    expect(canMove(pages, 'a1', 'b')).toBe(true);
  });

  it('refuses a move into a database', () => {
    expect(canMove(withDatabase, 'a', 'top')).toBe(false);
    expect(canMove(withDatabase, 'db', 'top')).toBe(false);
  });

  it('refuses to move a row', () => {
    expect(canMove(withDatabase, 'r2', null)).toBe(false);
    expect(canMove(withDatabase, 'r2', 'a')).toBe(false);
    expect(canMove(withDatabase, 'r2', 'top')).toBe(false);
  });

  it('allows a database to move like a page', () => {
    expect(canMove(withDatabase, 'db', null)).toBe(true);
    expect(canMove(withDatabase, 'top', 'a')).toBe(true);
    expect(canMove(withDatabase, 'db', 'r1')).toBe(false);
  });
});

describe('movePage', () => {
  it('reorders siblings', () => {
    const moved = movePage(pages, 'b', null, 0);

    expect(childIds(moved, null)).toEqual(['b', 'a']);
  });

  it('moves a page into another parent at the given index', () => {
    const moved = movePage(pages, 'b', 'a', 1);

    expect(childIds(moved, null)).toEqual(['a']);
    expect(childIds(moved, 'a')).toEqual(['a1', 'b', 'a2']);
  });

  it('puts the page last when the index is past the end', () => {
    expect(childIds(movePage(pages, 'a1', null, 99), null)).toEqual(['a', 'b', 'a1']);
  });

  it('keeps the subpages of the moved page with it', () => {
    const moved = movePage(pages, 'a1', 'b', 0);

    expect(descendantIds(moved, 'b').sort()).toEqual(['a1', 'a1x']);
  });
});
