import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/lib/i18n';
import { testProperty } from './testing';
import { TextDisplay, TextEditor } from './TextProperty';

const property = testProperty('text');

function renderEditor(value: string | null) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <>
      <TextEditor value={value} property={property} onCommit={onCommit} onCancel={onCancel} />
      <button>Elsewhere</button>
    </>,
  );
  return { onCommit, onCancel, input: screen.getByRole('textbox', { name: 'Field' }) };
}

describe('TextDisplay', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('shows the text on one truncated line, in English and German alike', async () => {
    const { rerender } = render(<TextDisplay value="Write the spec" property={property} />);
    expect(screen.getByText('Write the spec')).toHaveClass('truncate');

    await i18n.changeLanguage('de');
    rerender(<TextDisplay value="Write the spec" property={property} />);
    expect(screen.getByText('Write the spec')).toBeInTheDocument();
  });

  it('shows nothing for an empty cell', () => {
    for (const value of [null, '']) {
      const { container, unmount } = render(<TextDisplay value={value} property={property} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('TextEditor', () => {
  it('starts focused with the text selected', () => {
    const { input } = renderEditor('Draft');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Draft');
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe(5);
  });

  it('commits with Enter', async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderEditor('Draft');
    // Typing replaces the selected text.
    await user.keyboard('Final{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Final');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('commits when it loses the focus', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(null);
    await user.type(input, 'New');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('New');
  });

  it('empties the cell when the text is removed', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor('Draft');
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('cancels with Escape and does not commit when the focus leaves afterwards', async () => {
    const user = userEvent.setup();
    const { input, onCommit, onCancel } = renderEditor('Draft');
    await user.type(input, 'Changed{Escape}');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
