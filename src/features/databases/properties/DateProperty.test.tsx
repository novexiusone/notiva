import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/lib/i18n';
import { DateDisplay, DateEditor } from './DateProperty';
import { testProperty } from './testing';

const property = testProperty('date');

function renderEditor(value: string | null) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<DateEditor value={value} property={property} onCommit={onCommit} onCancel={onCancel} />);
  return { onCommit, onCancel, popover: screen.getByRole('dialog', { name: 'Field' }) };
}

afterEach(() => i18n.changeLanguage('en'));

describe('DateDisplay', () => {
  it('formats the date in English', () => {
    render(<DateDisplay value="2026-03-04" property={property} />);
    expect(screen.getByText('Mar 4, 2026')).toBeInTheDocument();
  });

  it('formats the date in German', async () => {
    await i18n.changeLanguage('de');
    render(<DateDisplay value="2026-03-04" property={property} />);
    expect(screen.getByText('4. März 2026')).toBeInTheDocument();
  });

  it('shows nothing for an empty cell or a value that is no date', () => {
    for (const value of [null, '', '2026-02-30', '4.3.2026']) {
      const { container, unmount } = render(<DateDisplay value={value} property={property} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('DateEditor', () => {
  it('opens on the month of the date, with the date selected', () => {
    const { popover } = renderEditor('2026-03-14');
    expect(within(popover).getByText('March 2026')).toBeInTheDocument();
    expect(
      within(popover).getByRole('button', { name: /March 14th, 2026, selected/ }),
    ).toBeVisible();
  });

  it('commits the day that is picked as yyyy-MM-dd', async () => {
    const user = userEvent.setup();
    const { popover, onCommit, onCancel } = renderEditor('2026-03-14');
    await user.click(within(popover).getByRole('button', { name: /March 20th, 2026/ }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026-03-20');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('commits the picked day when the cell was empty', async () => {
    const user = userEvent.setup();
    const { popover, onCommit } = renderEditor(null);
    const today = within(popover).getByRole('button', { name: /^Today/ });
    await user.click(today);
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('commits the day again when the selected one is picked', async () => {
    const user = userEvent.setup();
    const { popover, onCommit } = renderEditor('2026-03-14');
    await user.click(within(popover).getByRole('button', { name: /March 14th, 2026/ }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026-03-14');
  });

  it('clears the date', async () => {
    const user = userEvent.setup();
    const { popover, onCommit } = renderEditor('2026-03-14');
    await user.click(within(popover).getByRole('button', { name: 'Clear' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('offers no clear for an empty cell', () => {
    const { popover } = renderEditor(null);
    expect(within(popover).queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('cancels with Escape', async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderEditor('2026-03-14');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels when clicked outside', async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderEditor('2026-03-14');
    await user.click(document.body);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('starts the week on Sunday in English', () => {
    const { popover } = renderEditor('2026-03-14');
    expect(popover.querySelector('th')).toHaveAttribute('aria-label', 'Sunday');
  });

  it('uses German month names and starts the week on Monday in German', async () => {
    await i18n.changeLanguage('de');
    const { popover } = renderEditor('2026-03-14');
    expect(within(popover).getByText('März 2026')).toBeInTheDocument();
    expect(popover.querySelector('th')).toHaveAttribute('aria-label', 'Montag');
    expect(within(popover).getByRole('button', { name: 'Leeren' })).toBeInTheDocument();
  });
});
