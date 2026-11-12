export type PageLinkItem = { id: string; title: string };

const MAX_ITEMS = 8;

/** The pages to offer for a filter text: titles that contain it, best matches first. */
export function getPageLinkItems(pages: readonly PageLinkItem[], query: string): PageLinkItem[] {
  const needle = query.trim().toLowerCase();

  return pages
    .filter((page) => page.title.toLowerCase().includes(needle))
    .sort((a, b) => {
      const startsA = a.title.toLowerCase().startsWith(needle);
      const startsB = b.title.toLowerCase().startsWith(needle);
      return Number(startsB) - Number(startsA) || a.title.localeCompare(b.title);
    })
    .slice(0, MAX_ITEMS);
}
