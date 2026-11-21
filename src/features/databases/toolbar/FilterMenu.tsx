import { GripVertical, ListFilter, Plus, Trash2 } from 'lucide-react';
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
import { Select, PanelHeader, ToolbarButton } from './parts';
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
        <Select
          label={label}
          value={typeof filter.value === 'string' ? filter.value : ''}
          onValueChange={(next) => onChange(next || null)}
          className="flex-1"
        >
          <option value="">{t('databases.toolbar.chooseOption')}</option>
          {field.property.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
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

/** What the filters of a view are: the list of conditions, and the choice of a property for a new one. */
export function FilterPanel({
  config,
  properties,
  onChange,
  onBack,
  onClose,
}: ToolbarMenuProps & { onBack?: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const operatorLabel = useOperatorLabel();
  const fields = viewFields(properties, t('databases.table.titleColumn'));
  const filters = readFilters(config, properties);
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
    <>
      {adding ? (
        <>
          <PanelHeader
            title={t('databases.toolbar.addFilterTitle')}
            onBack={stopAdding}
            onClose={onClose}
          />
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
          <PanelHeader title={t('databases.toolbar.filters')} onBack={onBack} onClose={onClose} />
          {filters.length === 0 ? null : (
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
                      <Select
                        label={t('databases.toolbar.property')}
                        value={filter.propertyId}
                        onValueChange={(id) => {
                          const next = fields.find((candidate) => candidate.id === id);
                          if (next) {
                            replace(index, {
                              propertyId: next.id,
                              operator: next.definition.operators[0]!,
                              value: null,
                            });
                          }
                        }}
                      >
                        {fields.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.property.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="border-border ml-5 flex flex-col gap-1.5 rounded-md border p-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <Select
                          label={t('databases.toolbar.operator')}
                          value={filter.operator}
                          onValueChange={(next) => {
                            const operator = next as FilterOperator;
                            replace(index, {
                              ...filter,
                              operator,
                              value: valueless.includes(operator) ? null : filter.value,
                            });
                          }}
                        >
                          {field.definition.operators.map((operator) => (
                            <option key={operator} value={operator}>
                              {operatorLabel(operator, field)}
                            </option>
                          ))}
                        </Select>
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
    </>
  );
}

/** The filters of a view, from the toolbar. */
export function FilterMenu(props: ToolbarMenuProps) {
  const { t } = useTranslation();
  const filters = readFilters(props.config, props.properties);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarButton
          icon={ListFilter}
          label={t('databases.toolbar.filter')}
          badge={filters.length > 0 ? filters.length : undefined}
          disabled={props.readOnly}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('databases.toolbar.filters')}
        className="w-80 gap-2 p-2"
      >
        <FilterPanel {...props} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
