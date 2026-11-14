import { useTranslation } from 'react-i18next';
import { formatNumber, numberToInput, parseNumberInput } from './format';
import { InlineInput } from './InlineInput';
import type { DisplayProps, EditorProps } from './types';

export function NumberDisplay({ value }: DisplayProps) {
  const { i18n } = useTranslation();
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return <span className="block truncate tabular-nums">{formatNumber(value, i18n.language)}</span>;
}

/** Typed in place. Anything that is not a finite number is refused; nothing empties the cell. */
export function NumberEditor({ value, property, onCommit, onCancel }: EditorProps) {
  const { i18n } = useTranslation();
  return (
    <InlineInput
      initialText={typeof value === 'number' ? numberToInput(value, i18n.language) : ''}
      label={property.name}
      inputMode="decimal"
      onSubmit={(text) => {
        const number = parseNumberInput(text, i18n.language);
        if (number === undefined) return false;
        onCommit(number);
        return true;
      }}
      onCancel={onCancel}
    />
  );
}
