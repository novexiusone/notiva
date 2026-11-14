import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useUpdateProperty } from '@/features/databases/api';
import { SELECT_COLORS, type Property, type SelectOption } from '@/lib/commands';
import { SelectBadge } from './SelectBadge';
import type { DisplayProps, EditorProps } from './types';

function findOption(property: Property, value: unknown) {
  return typeof value === 'string'
    ? property.options.find((option) => option.id === value)
    : undefined;
}

export function SelectDisplay({ value, property }: DisplayProps) {
  const option = findOption(property, value);
  return option ? <SelectBadge option={option} /> : null;
}

/** The colour a new option gets: the colours in order, starting again after the last one. */
function nextColor(property: Property) {
  return SELECT_COLORS[property.options.length % SELECT_COLORS.length];
}

// cmdk identifies items by their value; these cannot clash with option ids,
// which are only ever looked up through `optionValue`.
const clearValue = 'clear';
const createValue = 'create';
const optionValue = (option: SelectOption) => `option:${option.id}`;

/**
 * A searchable list of the options in a popover. Choosing an option saves it,
 * choosing the current one empties the cell, and a name that is no option yet
 * can be created on the spot.
 */
export function SelectEditor({ value, property, onCommit, onCancel }: EditorProps) {
  const { t } = useTranslation();
  const updateProperty = useUpdateProperty(property.databaseId);
  const [query, setQuery] = useState('');

  const current = findOption(property, value);
  const name = query.trim();
  const needle = name.toLocaleLowerCase();
  const shown = property.options.filter((option) =>
    option.name.toLocaleLowerCase().includes(needle),
  );
  const canCreate =
    name !== '' && !property.options.some((option) => option.name.toLocaleLowerCase() === needle);

  const create = () => {
    const option: SelectOption = { id: crypto.randomUUID(), name, color: nextColor(property) };
    updateProperty(property.id, { options: [...property.options, option] });
    onCommit(option.id);
  };

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <PopoverAnchor asChild>
        <div className="h-full w-full min-w-0 px-1">
          <SelectDisplay value={value} property={property} />
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-64 p-0" aria-label={property.name}>
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('databases.properties.searchOptions')}
          />
          <CommandList>
            {shown.length > 0 ? (
              <CommandGroup>
                {shown.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={optionValue(option)}
                    data-checked={option.id === current?.id}
                    onSelect={() => onCommit(option.id === current?.id ? null : option.id)}
                  >
                    <SelectBadge option={option} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {canCreate ? (
              <CommandGroup>
                <CommandItem value={createValue} onSelect={create}>
                  <Plus aria-hidden className="text-muted-foreground" />
                  <span className="truncate">
                    {t('databases.properties.createOption', { name })}
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {shown.length === 0 && !canCreate ? (
              <p className="text-muted-foreground px-2 py-4 text-center text-sm">
                {t('databases.properties.noOptions')}
              </p>
            ) : null}
            {current ? (
              <CommandGroup>
                <CommandItem value={clearValue} onSelect={() => onCommit(null)}>
                  <X aria-hidden className="text-muted-foreground" />
                  {t('databases.properties.clear')}
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
