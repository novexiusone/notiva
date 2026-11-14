import { InlineInput } from './InlineInput';
import type { DisplayProps, EditorProps } from './types';

export function TextDisplay({ value }: DisplayProps) {
  if (typeof value !== 'string' || value === '') return null;
  return <span className="block truncate">{value}</span>;
}

/** Typed in place. Emptying the text empties the cell. */
export function TextEditor({ value, property, onCommit, onCancel }: EditorProps) {
  return (
    <InlineInput
      initialText={typeof value === 'string' ? value : ''}
      label={property.name}
      onSubmit={(text) => {
        onCommit(text === '' ? null : text);
        return true;
      }}
      onCancel={onCancel}
    />
  );
}
