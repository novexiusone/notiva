import { screen, within } from '@testing-library/react';
import { ICON_CATEGORIES } from '@/features/pages/pageIcons';
import { page, renderApp } from '@/test/renderApp';

const scrollIntoView = vi.fn();

async function openIconsTab() {
  const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
  const main = await screen.findByRole('main');
  await user.click(await within(main).findByRole('button', { name: 'Add icon' }));
  await user.click(await screen.findByRole('tab', { name: 'Icons' }));
  return user;
}

describe('icon picker, Icons tab', () => {
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it('shows a header for every category', async () => {
    await openIconsTab();

    const headings = await screen.findAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(ICON_CATEGORIES.length);
    expect(headings[0]).toHaveTextContent('General');
  });

  it('keeps only the categories that have a match while filtering', async () => {
    const user = await openIconsTab();

    await user.type(await screen.findByRole('textbox', { name: 'Filter…' }), 'book');

    expect(screen.getByRole('button', { name: 'Book Open' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeLessThan(
      ICON_CATEGORIES.length,
    );
  });

  it('says so when nothing matches', async () => {
    const user = await openIconsTab();

    await user.type(await screen.findByRole('textbox', { name: 'Filter…' }), 'zzzzzz');

    expect(await screen.findByText('Nothing found')).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('clears the filter and scrolls to the category a jump button names', async () => {
    const user = await openIconsTab();
    const filter = await screen.findByRole('textbox', { name: 'Filter…' });
    await user.type(filter, 'book');

    await user.click(screen.getByRole('button', { name: 'Travel & places' }));

    expect(filter).toHaveValue('');
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(ICON_CATEGORIES.length);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
