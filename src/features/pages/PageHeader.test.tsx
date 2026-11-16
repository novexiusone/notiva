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

  it('colours the star of a favourite yellow without filling it', async () => {
    renderApp({
      pages: [{ ...page('a', 'Alpha'), isFavorite: true }, page('b', 'Beta')],
      path: '/page/a',
    });
    const main = await screen.findByRole('main');
    const star = (
      await within(main).findByRole('button', { name: 'Remove from favourites' })
    ).querySelector('svg');
    expect(star).toHaveClass('text-favorite');
    expect(star).not.toHaveClass('fill-current');
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
    await user.click(await screen.findByRole('button', { name: 'Book Open' }));

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

describe('the cover', () => {
  const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
  const withCover = (banner: string) => [{ ...page('a', 'Alpha'), banner }];

  it('is chosen from the gallery after "Add cover"', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
    const main = await screen.findByRole('main');

    await user.click(await within(main).findByRole('button', { name: 'Add cover' }));
    expect(await screen.findByText('Color & Gradient')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Coral' }));

    expect(await within(main).findByRole('img', { name: 'Page cover' })).toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: 'Add cover' })).toBeNull();
  });

  it('has Change, Reposition and Download over an image', async () => {
    renderApp({ pages: withCover(IMAGE), path: '/page/a' });
    const toolbar = await screen.findByRole('toolbar', { name: 'Cover' });

    for (const name of ['Change', 'Reposition', 'Download']) {
      expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('shows its controls only in the top right corner and fades them', async () => {
    renderApp({ pages: withCover(IMAGE), path: '/page/a' });
    const toolbar = await screen.findByRole('toolbar', { name: 'Cover' });
    const zone = screen.getByTestId('cover-controls-zone');

    expect(zone).toContainElement(toolbar);
    expect(toolbar.parentElement).toHaveClass(
      'opacity-0',
      'duration-150',
      'motion-reduce:transition-none',
    );
    expect(toolbar.parentElement).toHaveClass('group-hover/zone:opacity-100');
    expect(toolbar.parentElement).toHaveClass('group-focus-within/zone:opacity-100');
  });

  it('can only be changed when it is from the gallery', async () => {
    renderApp({ pages: withCover('gallery:azure'), path: '/page/a' });
    const toolbar = await screen.findByRole('toolbar', { name: 'Cover' });

    expect(within(toolbar).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Reposition' })).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('is repositioned with the arrow keys and the position is kept', async () => {
    const { user } = renderApp({ pages: withCover(IMAGE), path: '/page/a' });

    await user.click(await screen.findByRole('button', { name: 'Reposition' }));
    const slider = await screen.findByRole('slider', { name: 'Cover position' });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(slider).toHaveAttribute('aria-valuenow', '40');
    await user.click(screen.getByRole('button', { name: 'Save position' }));

    expect(screen.queryByRole('slider')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reposition' }));
    expect(await screen.findByRole('slider')).toHaveAttribute('aria-valuenow', '40');
  });

  it('keeps its position when repositioning is cancelled', async () => {
    const { user } = renderApp({ pages: withCover(IMAGE), path: '/page/a' });

    await user.click(await screen.findByRole('button', { name: 'Reposition' }));
    await screen.findByRole('slider');
    await user.keyboard('{ArrowUp}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Reposition' }));

    expect(await screen.findByRole('slider')).toHaveAttribute('aria-valuenow', '50');
  });

  it('is removed from the picker', async () => {
    const { user } = renderApp({ pages: withCover(IMAGE), path: '/page/a' });
    const main = await screen.findByRole('main');

    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(within(main).queryByRole('img', { name: 'Page cover' })).toBeNull();
    expect(await within(main).findByRole('button', { name: 'Add cover' })).toBeInTheDocument();
  });
});
