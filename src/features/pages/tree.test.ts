import { buildTree, canMove, childIds, descendantIds, movePage } from '@/features/pages/tree';
import { page } from '@/test/renderApp';

const pages = [
  page('b', 'B', null, 1),
  page('a', 'A', null, 0),
  page('a2', 'A2', 'a', 1),
  page('a1', 'A1', 'a', 0),
  page('a1x', 'A1X', 'a1', 0),
];

describe('buildTree', () => {
  it('nests pages below their parent, ordered by position', () => {
    expect(buildTree(pages)).toEqual([
      {
        id: 'a',
        title: 'A',
        children: [
          { id: 'a1', title: 'A1', children: [{ id: 'a1x', title: 'A1X', children: [] }] },
          { id: 'a2', title: 'A2', children: [] },
        ],
      },
      { id: 'b', title: 'B', children: [] },
    ]);
  });

  it('keeps a page whose parent is missing as a top-level page', () => {
    expect(buildTree([page('orphan', 'Orphan', 'gone')])).toEqual([
      { id: 'orphan', title: 'Orphan', children: [] },
    ]);
  });
});

describe('descendantIds', () => {
  it('finds subpages at every depth', () => {
    expect(descendantIds(pages, 'a').sort()).toEqual(['a1', 'a1x', 'a2']);
    expect(descendantIds(pages, 'b')).toEqual([]);
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
