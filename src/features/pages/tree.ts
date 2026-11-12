import type { Page } from '@/lib/commands';

export type PageNode = { id: string; title: string; children: PageNode[] };

function byPosition(a: Page, b: Page) {
  return a.position - b.position;
}

/** Turns the flat list into a tree. A page whose parent is missing becomes a top-level page. */
export function buildTree(pages: readonly Page[]): PageNode[] {
  const nodes = new Map<string, PageNode>(
    pages.map((page) => [page.id, { id: page.id, title: page.title, children: [] }]),
  );
  const roots: PageNode[] = [];

  for (const page of [...pages].sort(byPosition)) {
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

/** The ids of every page below `id`, at any depth. */
export function descendantIds(pages: readonly Page[], id: string): string[] {
  const found: string[] = [];
  const queue = [id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const page of pages) {
      if (page.parentId === current) {
        found.push(page.id);
        queue.push(page.id);
      }
    }
  }

  return found;
}

/** A page cannot be moved into itself or into one of its subpages. */
export function canMove(pages: readonly Page[], id: string, parentId: string | null): boolean {
  return parentId !== id && (parentId === null || !descendantIds(pages, id).includes(parentId));
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
