import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CellValue, FilterOperator, Property, ViewFilter } from '@/lib/commands';

export type DisplayProps = { value: CellValue; property: Property };

export type EditorProps = {
  value: CellValue;
  property: Property;
  /** Saves a value; `null` empties the cell. The caller closes the editor. */
  onCommit: (value: CellValue) => void;
  /** Leaves the cell as it was. The caller closes the editor. */
  onCancel: () => void;
};

/** How values of one type are told apart from an empty cell, ordered and filtered. */
export type PropertyValueRules = {
  /** `null`, a missing key, a value of the wrong kind or, for select, an option that is gone. */
  isEmpty: (value: CellValue | undefined, property: Property) => boolean;
  /** Ascending order; empty values come after every other value. */
  compare: (a: CellValue | undefined, b: CellValue | undefined, property: Property) => number;
  /** The operators a filter on this type offers, in the order they are offered. */
  operators: readonly FilterOperator[];
  /** Whether a value passes a filter. A filter without a value yet passes every value. */
  matches: (value: CellValue | undefined, filter: ViewFilter, property: Property) => boolean;
};

/** Everything that differs between property types. Callers never switch on the type. */
export type PropertyTypeDefinition = PropertyValueRules & {
  icon: LucideIcon;
  Display: (props: DisplayProps) => ReactNode;
  Editor: (props: EditorProps) => ReactNode;
};
