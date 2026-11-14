import type { Page } from '@/lib/commands';

export type PageNode = { id: string; title: string; kind: Page['kind']; children: PageNode[] };

function byPosition(a: Page, b: Page) {
  return a.position - b.position;
}

/**
 * Whether a page is a row of a database. A backend that does not know
 * databases yet leaves the field out, which means the same as `null`.
 */
export function isRow(page: Page): boolean {
  return Boolean(page.databaseId);
}

/**
 * Turns the flat list into a tree. A page whose parent is missing becomes a
 * top-level page. The rows of a database, and everything below a row, are
 * left out: a database shows them itself.
 */
export function buildTree(pages: readonly Page[]): PageNode[] {
  const nodes = new Map<string, PageNode>(
    pages.map((page) => [
      page.id,
      { id: page.id, title: page.title, kind: page.kind, children: [] },
    ]),
  );
  const roots: PageNode[] = [];

  for (const page of [...pages].sort(byPosition)) {
    // A row is attached to nothing, so the pages below it never reach the tree either.
    if (isRow(page)) continue;
    const parent = page.parentId === null ? undefined : nodes.get(page.parentId);
    (parent ? parent.children : roots).push(nodes.get(page.id)!);
  }

  return roots;
}

/** The ids of the children of `parentId`, in display order. */
export function childIds(pages: readonly Page[], parentId: string | null): string[] {
  return pages
    .filter((page) => page.parentId === parentId)
    .sort(byPosition)
    .map((page) => page.id);
}

/** The ids of every page below `id`, at any depth. Rows count as well. */
export function descendantIds(pages: readonly Page[], id: string): string[] {
  // One pass over the list, so that a database with thousands of rows stays cheap.
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parentId === null) continue;
    const siblings = children.get(page.parentId);
    if (siblings) siblings.push(page.id);
    else children.set(page.parentId, [page.id]);
  }

  const found: string[] = [];
  let current: string | undefined = id;
  for (let next = 0; current !== undefined; next += 1) {
    for (const child of children.get(current) ?? []) found.push(child);
    current = found[next];
  }

  return found;
}

/** What goes along when a page is deleted: the rows of databases, and every other page. */
export function countDescendants(
  pages: readonly Page[],
  id: string,
): { subpages: number; rows: number } {
  const below = new Set(descendantIds(pages, id));
  const rows = pages.filter((page) => below.has(page.id) && isRow(page)).length;
  return { subpages: below.size - rows, rows };
}

/**
 * A page cannot be moved into itself, into one of its subpages or into a
 * database, whose children are its rows. A row cannot be moved at all.
 */
export function canMove(pages: readonly Page[], id: string, parentId: string | null): boolean {
  const page = pages.find((candidate) => candidate.id === id);
  if (page && isRow(page)) return false;
  if (parentId === null) return true;
  if (parentId === id) return false;

  const parent = pages.find((candidate) => candidate.id === parentId);
  return parent?.kind !== 'database' && !descendantIds(pages, id).includes(parentId);
}

/**
 * Places a page at `index` among the children of `parentId` and renumbers
 * those children. This mirrors what the backend does.
 */
export function movePage(
  pages: readonly Page[],
  id: string,
  parentId: string | null,
  index: number,
): Page[] {
  const order = childIds(pages, parentId).filter((sibling) => sibling !== id);
  order.splice(Math.min(index, order.length), 0, id);

  return pages.map((page) => {
    const position = order.indexOf(page.id);
    if (position === -1) return page;
    return { ...page, position, parentId: page.id === id ? parentId : page.parentId };
  });
}
