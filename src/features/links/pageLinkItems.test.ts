import { getPageLinkItems } from '@/features/links/pageLinkItems';

const pages = [
  { id: '1', title: 'Zebra crossing' },
  { id: '2', title: 'Apple pie' },
  { id: '3', title: 'Pineapple' },
  { id: '4', title: '' },
];

const titles = (query: string) => getPageLinkItems(pages, query).map((page) => page.title);

describe('getPageLinkItems', () => {
  it('lists every page by title when there is no filter', () => {
    expect(titles('')).toEqual(['', 'Apple pie', 'Pineapple', 'Zebra crossing']);
  });

  it('matches anywhere in the title, ignoring case', () => {
    expect(titles('APPLE')).toEqual(['Apple pie', 'Pineapple']);
  });

  it('puts titles that start with the filter first', () => {
    expect(titles('p')).toEqual(['Pineapple', 'Apple pie']);
  });

  it('offers at most eight pages', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: `${index}`,
      title: `Page ${index}`,
    }));

    expect(getPageLinkItems(many, 'page')).toHaveLength(8);
  });
});
