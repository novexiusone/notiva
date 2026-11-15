import { screen, within } from '@testing-library/react';
import { page, renderApp } from '@/test/renderApp';

describe('page header', () => {
  it('shows last edited, the favourite star and the page menu in that order', async () => {
    renderApp({
      pages: [{ ...page('a', 'Alpha'), updatedAt: new Date().toISOString() }],
      path: '/page/a',
    });

    const main = await screen.findByRole('main');
    const edited = await within(main).findByText(/^Edited /);
    const favourite = within(main).getByRole('button', { name: 'Add to favourites' });
    const actions = within(main).getByRole('button', { name: 'Page actions' });

    expect(
      edited.compareDocumentPosition(favourite) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      favourite.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers the existing page actions and appearance actions in the menu', async () => {
    const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });

    const main = await screen.findByRole('main');
    await user.click(await within(main).findByRole('button', { name: 'Page actions' }));
    const menu = await screen.findByRole('menu');

    for (const name of ['Rename', 'Add database', 'Export as Markdown…', 'Delete']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(within(menu).getByRole('menuitem', { name: 'Add icon' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Add banner' })).toBeInTheDocument();
  });
});

it('applies a chosen icon to the page and the sidebar', async () => {
  const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
  const main = await screen.findByRole('main');

  await user.click(await within(main).findByRole('button', { name: 'Page actions' }));
  await user.hover(await screen.findByRole('menuitem', { name: 'Add icon' }));
  await user.keyboard('{ArrowRight}{Enter}');

  expect(main.querySelector('.lucide-book-open')).toBeInTheDocument();
  expect(document.querySelector('[role="treeitem"] .lucide-book-open')).toBeInTheDocument();
});

it('moves focus to the title when Rename is chosen', async () => {
  const { user } = renderApp({ pages: [page('a', 'Alpha')], path: '/page/a' });
  const main = await screen.findByRole('main');

  await user.click(await within(main).findByRole('button', { name: 'Page actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

  expect(await within(main).findByRole('textbox', { name: 'Page title' })).toHaveFocus();
});
