import { screen, within } from '@testing-library/react';
import { page, renderApp } from '@/test/renderApp';

const precedes = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('page header', () => {
  it('shows the path, last edited, the favourite star and the page menu in that order', async () => {
    renderApp({
      pages: [
        { ...page('a', 'Alpha'), updatedAt: new Date().toISOString() },
        { ...page('b', 'Beta'), parentId: 'a' },
      ],
      path: '/page/b',
    });

    const main = await screen.findByRole('main');
    const path = await within(main).findByRole('navigation', { name: 'Path' });
    const edited = within(main).getByText(/^Edited /);
    const favourite = within(main).getByRole('button', { name: 'Add to favourites' });
    const actions = within(main).getByRole('button', { name: 'Page actions' });

    expect(precedes(path, edited)).toBe(true);
    expect(precedes(edited, favourite)).toBe(true);
    expect(precedes(favourite, actions)).toBe(true);
  });

  it('lists the parents as links and the open page as the current item', async () => {
    renderApp({
      pages: [{ ...page('a', 'Alpha') }, { ...page('b', 'Beta'), parentId: 'a' }],
      path: '/page/b',
    });

    const main = await screen.findByRole('main');
    const path = await within(main).findByRole('navigation', { name: 'Path' });

    expect(within(path).getByRole('link', { name: 'Alpha' })).toHaveAttribute(
      'href',
      expect.stringContaining('/page/a'),
    );
    expect(within(path).getByText('Beta').closest('[aria-current="page"]')).not.toBeNull();
  });

  it('offers appearance, export and delete, but not rename or add database', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });

    const main = await screen.findByRole('main');
    await user.click(await within(main).findByRole('button', { name: 'Page actions' }));
    const menu = await screen.findByRole('menu');

    for (const name of ['Add icon', 'Add cover', 'Export', 'Delete']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Add database' })).toBeNull();
  });

  it('opens the export panel from the menu', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });

    const main = await screen.findByRole('main');
    await user.click(await within(main).findByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export' }));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Markdown')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});

describe('page appearance', () => {
  it('offers "Add icon" and "Add cover" above the title of a page without them', async () => {
    renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
    const main = await screen.findByRole('main');

    expect(await within(main).findByRole('button', { name: 'Add icon' })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Add cover' })).toBeInTheDocument();
  });

  it('applies an icon chosen in the picker to the page and the sidebar', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
    const main = await screen.findByRole('main');

    await user.click(await within(main).findByRole('button', { name: 'Add icon' }));
    await user.click(await screen.findByRole('tab', { name: 'Icons' }));
    await user.click(await screen.findByRole('button', { name: 'book' }));

    expect(main.querySelector('.lucide-book-open')).toBeInTheDocument();
    expect(document.querySelector('[role="treeitem"] .lucide-book-open')).toBeInTheDocument();
  });

  it('applies an emoji chosen in the picker', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
    const main = await screen.findByRole('main');

    await user.click(await within(main).findByRole('button', { name: 'Add icon' }));
    await user.type(await screen.findByRole('textbox', { name: 'Filter…' }), 'rocket');
    await user.click(await screen.findByRole('button', { name: 'rocket' }));

    expect(await within(main).findByRole('button', { name: 'Change icon' })).toHaveTextContent(
      '🚀',
    );
  });

  it('opens the picker from the menu', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
    const main = await screen.findByRole('main');

    await user.click(await within(main).findByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add icon' }));

    expect(await screen.findByRole('textbox', { name: 'Filter…' })).toBeInTheDocument();
  });
});
