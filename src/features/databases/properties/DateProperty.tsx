import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { calendarLocale, formatDate, parseStoredDate, toStoredDate } from './format';
import type { DisplayProps, EditorProps } from './types';

export function DateDisplay({ value }: DisplayProps) {
  const { i18n } = useTranslation();
  const text = typeof value === 'string' ? formatDate(value, i18n.language) : '';
  if (text === '') return null;
  return <span className="block truncate">{text}</span>;
}

/** A calendar in a popover. Picking a day saves it; closing the popover leaves the cell as it was. */
export function DateEditor({ value, property, onCommit, onCancel }: EditorProps) {
  const { t, i18n } = useTranslation();
  const selected = (typeof value === 'string' && parseStoredDate(value)) || undefined;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <PopoverAnchor asChild>
        <div className="h-full w-full min-w-0 px-1">
          <DateDisplay value={value} property={property} />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-auto gap-1 p-1"
        aria-label={property.name}
        // The calendar puts the focus on the selected day, or on today.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Calendar
          mode="single"
          required
          autoFocus
          selected={selected}
          defaultMonth={selected}
          locale={calendarLocale(i18n.language)}
          onSelect={(date) => onCommit(toStoredDate(date))}
        />
        {selected ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground justify-start"
            onClick={() => onCommit(null)}
          >
            {t('databases.properties.clear')}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
