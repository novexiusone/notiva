import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCreateProperty } from '@/features/databases/api';
import { propertyTypeDefinition, propertyTypes } from '@/features/databases/properties/registry';
import type { PropertyType } from '@/lib/commands';

/** The `+` at the end of the header: choose a type, then type a name. */
export function AddPropertyMenu({
  databaseId,
  readOnly = false,
}: {
  databaseId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const createProperty = useCreateProperty(databaseId);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PropertyType | null>(null);
  const [name, setName] = useState('');

  const close = () => {
    setOpen(false);
    setType(null);
  };

  return (
    <Popover
      open={!readOnly && open}
      onOpenChange={(next) => (next && !readOnly ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('databases.table.addProperty')}
          disabled={readOnly}
          className="text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent focus-visible:ring-ring/60 flex h-full w-full items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <Plus size={16} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 gap-1 p-1"
        aria-label={t('databases.table.addProperty')}
      >
        {type === null ? (
          <div role="group" aria-label={t('databases.table.chooseType')}>
            <p aria-hidden className="text-muted-foreground px-2 py-1 text-xs">
              {t('databases.table.chooseType')}
            </p>
            {propertyTypes.map((candidate) => {
              const Icon = propertyTypeDefinition(candidate)?.icon;
              const label = t(`databases.table.types.${candidate}`);
              return (
                <button
                  key={candidate}
                  type="button"
                  className="hover:bg-accent focus-visible:bg-accent flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none"
                  onClick={() => {
                    setType(candidate);
                    setName(label);
                  }}
                >
                  {Icon ? <Icon size={16} aria-hidden className="text-muted-foreground" /> : null}
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <form
            className="flex flex-col gap-1 p-1"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              createProperty.mutate({
                name: trimmed === '' ? t(`databases.table.types.${type}`) : trimmed,
                type,
              });
              close();
            }}
          >
            <Input
              autoFocus
              aria-label={t('databases.table.propertyName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              className="h-8"
            />
            <Button type="submit" size="sm">
              {t('databases.table.add')}
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
