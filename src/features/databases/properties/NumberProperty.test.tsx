import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/lib/i18n';
import { NumberDisplay, NumberEditor } from './NumberProperty';
import { testProperty } from './testing';

const property = testProperty('number');

function renderEditor(value: number | null) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <>
      <NumberEditor value={value} property={property} onCommit={onCommit} onCancel={onCancel} />
      <button>Elsewhere</button>
    </>,
  );
  return { onCommit, onCancel, input: screen.getByRole('textbox', { name: 'Field' }) };
}

afterEach(() => i18n.changeLanguage('en'));

describe('NumberDisplay', () => {
  it('formats the number in English', () => {
    render(<NumberDisplay value={1234567.891} property={property} />);
    expect(screen.getByText('1,234,567.891')).toBeInTheDocument();
  });

  it('formats the number in German', async () => {
    await i18n.changeLanguage('de');
    render(<NumberDisplay value={1234567.891} property={property} />);
    expect(screen.getByText('1.234.567,891')).toBeInTheDocument();
  });

  it('keeps every fraction digit and shows negative numbers', () => {
    render(<NumberDisplay value={-0.123456} property={property} />);
    expect(screen.getByText('-0.123456')).toBeInTheDocument();
  });

  it('shows nothing for an empty cell', () => {
    const { container } = render(<NumberDisplay value={null} property={property} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('NumberEditor', () => {
  it('starts focused with the number selected', () => {
    const { input } = renderEditor(2.5);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('2.5');
    expect((input as HTMLInputElement).selectionEnd).toBe(3);
  });

  it('commits a number with Enter', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(null);
    await user.type(input, '42.5{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(42.5);
  });

  it('commits when it loses the focus', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(1);
    await user.clear(input);
    await user.type(input, '-3');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-3);
  });

  it('commits nothing as an empty cell', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(7);
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('refuses what is not a number and stays open, marked invalid', async () => {
    const user = userEvent.setup();
    const { input, onCommit, onCancel } = renderEditor(null);
    for (const text of ['abc', '1,234.5', '12abc', 'Infinity', '1e999']) {
      await user.clear(input);
      await user.type(input, `${text}{Enter}`);
      expect(input).toHaveAttribute('aria-invalid', 'true');
    }
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it('drops the invalid mark as soon as the text changes', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(null);
    await user.type(input, 'x{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.type(input, '{Backspace}5');
    expect(input).not.toHaveAttribute('aria-invalid');
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('accepts the German decimal comma as well as a point', async () => {
    await i18n.changeLanguage('de');
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(1.5);
    expect(input).toHaveValue('1,5');
    await user.clear(input);
    await user.type(input, '3,25{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(3.25);
  });

  it('accepts a point in German too', async () => {
    await i18n.changeLanguage('de');
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(null);
    await user.type(input, '0.5{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.5);
  });

  it('cancels with Escape', async () => {
    const user = userEvent.setup();
    const { input, onCommit, onCancel } = renderEditor(3);
    await user.type(input, '9{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
