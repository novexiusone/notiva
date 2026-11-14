import { Calendar, CircleChevronDown, Hash, Type } from 'lucide-react';
import type { PropertyType } from '@/lib/commands';
import { DateDisplay, DateEditor } from './DateProperty';
import { NumberDisplay, NumberEditor } from './NumberProperty';
import { dateRules, numberRules, selectRules, textRules } from './rules';
import { SelectDisplay, SelectEditor } from './SelectProperty';
import { TextDisplay, TextEditor } from './TextProperty';
import type { PropertyTypeDefinition } from './types';

export { compareInDirection } from './rules';
export type { DisplayProps, EditorProps, PropertyTypeDefinition } from './types';

const definitions: Partial<Record<PropertyType, PropertyTypeDefinition>> = {
  text: { icon: Type, Display: TextDisplay, Editor: TextEditor, ...textRules },
  number: { icon: Hash, Display: NumberDisplay, Editor: NumberEditor, ...numberRules },
  date: { icon: Calendar, Display: DateDisplay, Editor: DateEditor, ...dateRules },
  select: { icon: CircleChevronDown, Display: SelectDisplay, Editor: SelectEditor, ...selectRules },
};

/**
 * Everything that differs between property types. `undefined` for a type this
 * version cannot show yet (relation), so callers skip the property.
 */
export function propertyTypeDefinition(type: PropertyType): PropertyTypeDefinition | undefined {
  return definitions[type];
}
