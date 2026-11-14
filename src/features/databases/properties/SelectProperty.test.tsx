import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { commands, type SelectOption } from '@/lib/commands';
import { i18n } from '@/lib/i18n';
import { installFakeBackend } from '@/test/fakeBackend';
import { database, row } from '@/test/renderApp';
import { SelectDisplay, SelectEditor } from './SelectProperty';
import { testProperty, withQueryClient } from './testing';

const todo: SelectOption = { id: 'todo', name: 'Todo', color: 'gray' };
const doing: SelectOption = { id: 'doing', name: 'Doing', color: 'blue' };
const done: SelectOption = { id: 'done', name: 'Done', color: 'green' };
const property = testProperty('select', { name: 'Status', options: [todo, doing, done] });

function renderEditor(value: string | null, options = property.options) {
  installFakeBackend({
    pages: [database('db', 'Tasks'), row('r1', 'One', 'db')],
    properties: [{ ...property, options }],
  });
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <SelectEditor
      value={value}
      property={{ ...property, options }}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
    { wrapper: withQueryClient() },
  );
  const popover = screen.getByRole('dialog', { name: 'Status' });
  return { onCommit, onCancel, popover, input: within(popover).getByRole('combobox') };
}

function optionNames(popover: HTMLElement) {
  return within(popover)
    .getAllByRole('option')
    .map((option) => option.textContent);
}

afterEach(() => i18n.changeLanguage('en'));

describe('SelectDisplay', () => {
  it('shows the option as a badge in its colour', () => {
    render(<SelectDisplay value="doing" property={property} />);
    const badge = screen.getByText('Doing').closest('[data-slot="badge"]');
    expect(badge).toHaveAttribute('data-color', 'blue');
    expect(badge).toHaveClass('bg-select-blue');
  });

  it('shows the same badge in German', async () => {
    await i18n.changeLanguage('de');
    render(<SelectDisplay value="done" property={property} />);
    expect(screen.getByText('Done').closest('[data-slot="badge"]')).toHaveClass('bg-select-green');
  });

  it('shows a colour it does not know as gray', () => {
    const odd = testProperty('select', { options: [{ id: 'x', name: 'Odd', color: 'teal' }] });
    render(<SelectDisplay value="x" property={odd} />);
    expect(screen.getByText('Odd').closest('[data-slot="badge"]')).toHaveClass('bg-select-gray');
  });

  it('shows nothing for an empty cell or an option that is gone', () => {
    for (const value of [null, 'gone']) {
      const { container, unmount } = render(<SelectDisplay value={value} property={property} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('SelectEditor', () => {
  it('lists the options in their order, focused on the search', () => {
    const { popover, input } = renderEditor(null);
    expect(input).toHaveFocus();
    expect(optionNames(popover)).toEqual(['Todo', 'Doing', 'Done']);
  });

  it('commits the option that is chosen', async () => {
    const user = userEvent.setup();
    const { popover, onCommit, onCancel } = renderEditor('todo');
    await user.click(within(popover).getByRole('option', { name: 'Doing' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('doing');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('narrows the list while typing and chooses with Enter', async () => {
    const user = userEvent.setup();
    const { popover, input, onCommit } = renderEditor(null);
    await user.type(input, 'don');
    expect(optionNames(popover)).toEqual(['Done', 'Create “don”']);
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('done');
  });

  it('empties the cell when the current option is chosen again', async () => {
    const user = userEvent.setup();
    const { popover, onCommit } = renderEditor('doing');
    const current = within(popover).getByRole('option', { name: 'Doing' });
    expect(current).toHaveAttribute('data-checked', 'true');
    await user.click(current);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('clears the cell', async () => {
    const user = userEvent.setup();
    const { popover, onCommit } = renderEditor('doing');
    await user.click(within(popover).getByRole('option', { name: 'Clear' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('offers no clear for an empty cell', () => {
    const { popover } = renderEditor(null);
    expect(within(popover).queryByRole('option', { name: 'Clear' })).toBeNull();
  });

  it('creates an option with the next colour and commits it', async () => {
    const user = userEvent.setup();
    const { popover, input, onCommit } = renderEditor('todo');
    await user.type(input, '  Blocked ');
    expect(optionNames(popover)).toEqual(['Create “Blocked”', 'Clear']);
    await user.click(within(popover).getByRole('option', { name: 'Create “Blocked”' }));

    expect(onCommit).toHaveBeenCalledOnce();
    const id = onCommit.mock.calls[0][0] as string;
    await waitFor(async () => {
      const { properties } = await commands.loadDatabase('db');
      expect(properties[0].options).toEqual([
        todo,
        doing,
        done,
        { id, name: 'Blocked', color: 'yellow' },
      ]);
    });
  });

  it('starts the colours again after the eighth option', async () => {
    const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => ({
      id,
      name: id.toUpperCase(),
      color: 'red',
    }));
    const user = userEvent.setup();
    const { input, onCommit } = renderEditor(null, eight);
    await user.type(input, 'Ninth{Enter}');
    const id = onCommit.mock.calls[0][0] as string;
    await waitFor(async () => {
      const { properties } = await commands.loadDatabase('db');
      expect(properties[0].options.at(-1)).toEqual({ id, name: 'Ninth', color: 'gray' });
    });
  });

  it('does not offer to create a name that exists, whatever its case', async () => {
    const user = userEvent.setup();
    const { popover, input } = renderEditor(null);
    await user.type(input, 'DONE');
    expect(optionNames(popover)).toEqual(['Done']);
  });

  it('cancels with Escape', async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderEditor('todo');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels when clicked outside', async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderEditor('todo');
    await user.click(document.body);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('speaks German', async () => {
    await i18n.changeLanguage('de');
    const user = userEvent.setup();
    const { popover, input } = renderEditor('todo');
    expect(input).toHaveAttribute('placeholder', 'Option suchen oder anlegen');
    await user.type(input, 'Neu');
    expect(optionNames(popover)).toEqual(['„Neu“ anlegen', 'Leeren']);
  });
});
