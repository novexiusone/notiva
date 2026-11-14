import { ListFilter, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { numberToInput, parseNumberInput } from '@/features/databases/properties/format';
import {
  readFilters,
  viewFields,
  withFilters,
  type ViewField,
} from '@/features/databases/viewState';
import type { FilterOperator, ViewFilter } from '@/lib/commands';
import { EmptyNote, NativeSelect, ToolbarButton } from './parts';
import type { ToolbarMenuProps } from './types';

/** Operators that test whether there is a value at all, so they take none. */
const valueless: readonly FilterOperator[] = ['isEmpty', 'isNotEmpty'];

/** The label of an operator; numbers write "=" and "≠" where text says "is". */
function useOperatorLabel() {
  const { t } = useTranslation();
  return (operator: FilterOperator, field: ViewField) =>
    field.property.type === 'number' && (operator === 'equals' || operator === 'notEquals')
      ? t(`databases.toolbar.numberOperators.${operator}`)
      : t(`databases.toolbar.operators.${operator}`);
}

/** The value of a condition, edited the way its property's type is. */
function FilterValue({
  field,
  filter,
  onChange,
}: {
  field: ViewField;
  filter: ViewFilter;
  onChange: (value: ViewFilter['value']) => void;
}) {
  const { t, i18n } = useTranslation();
  const label = t('databases.toolbar.value');
  // What was typed stays as it was typed; the condition gets what it means.
  const [text, setText] = useState(() =>
    typeof filter.value === 'number'
      ? numberToInput(filter.value, i18n.language)
      : (filter.value ?? ''),
  );
  const className = 'h-7 min-w-0 flex-1 px-1.5';

  switch (field.property.type) {
    case 'select':
      return (
        <NativeSelect
          label={label}
          value={typeof filter.value === 'string' ? filter.value : ''}
          onChange={(event) => onChange(event.target.value || null)}
          className="flex-1"
        >
          <option value="">{t('databases.toolbar.chooseOption')}</option>
          {field.property.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      );
    case 'date':
      return (
        <Input
          type="date"
          aria-label={label}
          value={typeof filter.value === 'string' ? filter.value : ''}
          onChange={(event) => onChange(event.target.value || null)}
          className={className}
        />
      );
    case 'number': {
      const parsed = parseNumberInput(text, i18n.language);
      return (
        <Input
          aria-label={label}
          inputMode="decimal"
          aria-invalid={parsed === undefined || undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const number = parseNumberInput(event.target.value, i18n.language);
            // Text that is no number yet is kept, and filters nothing until it is one.
            onChange(number === undefined ? event.target.value : number);
          }}
          className={className}
        />
      );
    }
    default:
      return (
        <Input
          aria-label={label}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value === '' ? null : event.target.value);
          }}
          className={className}
        />
      );
  }
}

/**
 * Conditions a row has to meet, all of them: add, change and remove. A new
 * condition is on the title and lets every row pass until it has a value.
 */
export function FilterMenu({ config, properties, onChange }: ToolbarMenuProps) {
  const { t } = useTranslation();
  const operatorLabel = useOperatorLabel();
  const fields = viewFields(properties, t('databases.table.titleColumn'));
  const filters = readFilters(config, properties);
  const label = t('databases.toolbar.filters');

  const write = (next: ViewFilter[]) => onChange(withFilters(config, properties, next));
  const replace = (index: number, filter: ViewFilter) =>
    write(filters.map((current, at) => (at === index ? filter : current)));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton
          icon={ListFilter}
          label={t('databases.toolbar.filter')}
          badge={filters.length > 0 ? filters.length : undefined}
        />
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={label} className="w-[min(36rem,calc(100vw-2rem))]">
        {filters.length === 0 ? (
          <EmptyNote>{t('databases.toolbar.noFilters')}</EmptyNote>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {filters.map((filter, index) => {
              const field = fields.find((candidate) => candidate.id === filter.propertyId)!;
              return (
                <li
                  // A new editor when the property or the kind of value changes.
                  key={`${index}-${filter.propertyId}`}
                  role="group"
                  aria-label={`${t('databases.toolbar.filter')} ${index + 1}`}
                  className="flex items-center gap-1.5"
                >
                  <NativeSelect
                    label={t('databases.toolbar.property')}
                    value={filter.propertyId}
                    onChange={(event) => {
                      const next = fields.find((candidate) => candidate.id === event.target.value);
                      if (next) {
                        replace(index, {
                          propertyId: next.id,
                          operator: next.definition.operators[0]!,
                          value: null,
                        });
                      }
                    }}
                    className="w-32"
                  >
                    {fields.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.property.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    label={t('databases.toolbar.operator')}
                    value={filter.operator}
                    onChange={(event) => {
                      const operator = event.target.value as FilterOperator;
                      replace(index, {
                        ...filter,
                        operator,
                        value: valueless.includes(operator) ? null : filter.value,
                      });
                    }}
                    className="w-32"
                  >
                    {field.definition.operators.map((operator) => (
                      <option key={operator} value={operator}>
                        {operatorLabel(operator, field)}
                      </option>
                    ))}
                  </NativeSelect>
                  {valueless.includes(filter.operator) ? (
                    <span className="flex-1" />
                  ) : (
                    <FilterValue
                      field={field}
                      filter={filter}
                      onChange={(value) => replace(index, { ...filter, value })}
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('databases.toolbar.removeFilter')}
                    onClick={() => write(filters.filter((_, at) => at !== index))}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            const [title] = fields;
            write([
              ...filters,
              { propertyId: title!.id, operator: title!.definition.operators[0]!, value: null },
            ]);
          }}
        >
          <Plus aria-hidden />
          {t('databases.toolbar.addFilter')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
