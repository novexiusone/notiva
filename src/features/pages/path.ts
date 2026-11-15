import type { Page } from '@/lib/commands';

/** The page and its ancestors from the top down. */
export function pathTo(pages: Page[], page: Page): Page[] {
  const byId = new Map(pages.map((candidate) => [candidate.id, candidate]));
  const path = [page];
  const seen = new Set([page.id]);
  let parent = page.parentId === null ? undefined : byId.get(page.parentId);
  while (parent && !seen.has(parent.id)) {
    path.unshift(parent);
    seen.add(parent.id);
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
  }
  return path;
}
