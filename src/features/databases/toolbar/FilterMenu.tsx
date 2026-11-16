import { ArrowLeft, GripVertical, ListFilter, Plus, Trash2 } from 'lucide-react';
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
 * Conditions a row has to meet, all of them. "Add filter" first asks for the
 * property, then shows the condition as a card: its operator, its value and a
 * button that removes it. A new condition lets every row pass until it has a value.
 */
export function FilterMenu({ config, properties, onChange }: ToolbarMenuProps) {
  const { t } = useTranslation();
  const operatorLabel = useOperatorLabel();
  const fields = viewFields(properties, t('databases.table.titleColumn'));
  const filters = readFilters(config, properties);
  const label = t('databases.toolbar.filters');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');

  const write = (next: ViewFilter[]) => onChange(withFilters(config, properties, next));
  const replace = (index: number, filter: ViewFilter) =>
    write(filters.map((current, at) => (at === index ? filter : current)));
  const stopAdding = () => {
    setAdding(false);
    setSearch('');
  };
  const offered = fields.filter((field) =>
    field.property.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  return (
    <Popover onOpenChange={(open) => !open && stopAdding()}>
      <PopoverTrigger asChild>
        <ToolbarButton
          icon={ListFilter}
          label={t('databases.toolbar.filter')}
          badge={filters.length > 0 ? filters.length : undefined}
        />
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={label} className="w-80 gap-2 p-2">
        {adding ? (
          <>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('databases.toolbar.back')}
                onClick={stopAdding}
              >
                <ArrowLeft aria-hidden />
              </Button>
              <h3 className="text-sm font-medium">{t('databases.toolbar.addFilterTitle')}</h3>
            </div>
            <Input
              autoFocus
              aria-label={t('databases.toolbar.filterBy')}
              placeholder={t('databases.toolbar.filterBy')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-7 px-2"
            />
            <ul aria-label={t('databases.toolbar.property')} className="flex flex-col">
              {offered.map((field) => {
                const Icon = field.definition.icon;
                return (
                  <li key={field.id}>
                    <button
                      type="button"
                      className="hover:bg-accent focus-visible:bg-accent flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none"
                      onClick={() => {
                        write([
                          ...filters,
                          {
                            propertyId: field.id,
                            operator: field.definition.operators[0]!,
                            value: null,
                          },
                        ]);
                        stopAdding();
                      }}
                    >
                      <Icon size={16} aria-hidden className="text-muted-foreground" />
                      <span className="truncate">{field.property.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <h3 className="px-1 text-sm font-medium">{t('databases.toolbar.filters')}</h3>
            {filters.length === 0 ? (
              <EmptyNote>{t('databases.toolbar.noFilters')}</EmptyNote>
            ) : (
              <ul className="flex flex-col gap-2">
                {filters.map((filter, index) => {
                  const field = fields.find((candidate) => candidate.id === filter.propertyId)!;
                  const Icon = field.definition.icon;
                  return (
                    <li
                      // A new editor when the property or the kind of value changes.
                      key={`${index}-${filter.propertyId}`}
                      role="group"
                      aria-label={`${t('databases.toolbar.filter')} ${index + 1}`}
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-center gap-1">
                        <GripVertical size={14} aria-hidden className="text-muted-foreground/50" />
                        <Icon size={16} aria-hidden className="text-muted-foreground" />
                        <NativeSelect
                          label={t('databases.toolbar.property')}
                          value={filter.propertyId}
                          onChange={(event) => {
                            const next = fields.find(
                              (candidate) => candidate.id === event.target.value,
                            );
                            if (next) {
                              replace(index, {
                                propertyId: next.id,
                                operator: next.definition.operators[0]!,
                                value: null,
                              });
                            }
                          }}
                          className="border-0 bg-transparent"
                        >
                          {fields.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.property.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className="border-border ml-5 flex flex-col gap-1.5 rounded-md border p-1.5">
                        <div className="flex items-center justify-between gap-1">
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
                            className="border-0 bg-transparent"
                          >
                            {field.definition.operators.map((operator) => (
                              <option key={operator} value={operator}>
                                {operatorLabel(operator, field)}
                              </option>
                            ))}
                          </NativeSelect>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('databases.toolbar.removeFilter')}
                            onClick={() => write(filters.filter((_, at) => at !== index))}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                        {valueless.includes(filter.operator) ? null : (
                          <FilterValue
                            field={field}
                            filter={filter}
                            onChange={(value) => replace(index, { ...filter, value })}
                          />
                        )}
                      </div>
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
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden />
              {t('databases.toolbar.addFilter')}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
