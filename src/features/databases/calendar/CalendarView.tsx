import { usePages } from '@/features/pages/api';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateRow, useSetCell } from '@/features/databases/api';
import { dateLocale } from '@/features/databases/properties/format';
import { TABLE_INSET, TABLE_MAX_HEIGHT } from '@/features/databases/table/layout';
import { useDatabaseTable } from '@/features/databases/useDatabaseTable';
import type { ViewRendererProps } from '@/features/databases/viewTypes';
import type { ViewConfig } from '@/lib/commands';
import { cn } from '@/lib/utils';
import { CalendarEntry } from './CalendarEntry';
import { toCalendarEntries } from './toCalendarEntries';

const emptyCalendar: Extract<ViewConfig, { type: 'calendar' }> = {
  version: 1,
  type: 'calendar',
  filters: [],
  sorts: [],
  properties: [],
  datePropertyId: null,
};

export function CalendarView({
  database,
  rows,
  view,
  readOnly = false,
  onConfigChange,
}: ViewRendererProps) {
  const { t, i18n } = useTranslation();
  const config = view?.config.type === 'calendar' ? view.config : emptyCalendar;
  const { table } = useDatabaseTable(database.properties, rows, config);
  const createRow = useCreateRow(database.page.id);
  const setCell = useSetCell(database.page.id);
  const pages = usePages().data;
  const rowLocks = new Map((pages ?? []).map((page) => [page.id, page.lock]));
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dropDate, setDropDate] = useState<string | null>(null);
  const locale = dateLocale(i18n.language);
  const dateProperties = database.properties.filter((property) => property.type === 'date');
  const datePropertyId = dateProperties.some((property) => property.id === config.datePropertyId)
    ? config.datePropertyId
    : null;
  const visibleRows = table.getRowModel().rows.map((row) => row.original);
  const { entries, withoutDate } = toCalendarEntries(visibleRows, datePropertyId);
  const byDate = useMemo(() => {
    const grouped = new Map<string, typeof entries>();
    for (const entry of entries) {
      const day = grouped.get(entry.date) ?? [];
      day.push(entry);
      grouped.set(entry.date, day);
    }
    return grouped;
  }, [entries]);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { locale }),
    end: endOfWeek(endOfMonth(month), { locale }),
  });
  const weekdays = days.slice(0, 7);
  const title = format(month, 'LLLL yyyy', { locale });

  const createOn = (date: string) => {
    if (readOnly || datePropertyId === null) return;
    const propertyId = datePropertyId;
    createRow.mutate(undefined, {
      onSuccess: (created) => setCell(created.id, propertyId, date),
    });
  };

  return (
    <section
      aria-label={t('databases.views.types.calendar')}
      className="pb-4"
      style={{ paddingLeft: TABLE_INSET, paddingRight: TABLE_INSET }}
    >
      <div className="flex flex-wrap items-center gap-2 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            aria-label={t('databases.calendar.previousMonth')}
            onClick={() => setMonth((current) => addMonths(current, -1))}
            className="hover:bg-accent flex size-7 items-center justify-center rounded-md"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <h2 className="min-w-0 truncate px-1 text-sm font-medium">{title}</h2>
          <button
            type="button"
            aria-label={t('databases.calendar.nextMonth')}
            onClick={() => setMonth((current) => addMonths(current, 1))}
            className="hover:bg-accent flex size-7 items-center justify-center rounded-md"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMonth(startOfMonth(new Date()))}
            className="hover:bg-accent text-muted-foreground hover:text-foreground ml-1 h-7 rounded-md px-2 text-xs"
          >
            {t('databases.calendar.today')}
          </button>
        </div>
        <select
          aria-label={t('databases.calendar.dateProperty')}
          value={datePropertyId ?? ''}
          disabled={readOnly || dateProperties.length === 0}
          onChange={(event) =>
            onConfigChange({ ...config, datePropertyId: event.target.value || null })
          }
          className="border-input bg-background h-7 max-w-48 rounded-md border px-2 text-xs"
        >
          {datePropertyId === null ? (
            <option value="">{t('databases.calendar.chooseDate')}</option>
          ) : null}
          {dateProperties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </div>
      {dateProperties.length === 0 ? (
        <p role="status" className="text-muted-foreground py-8 text-center text-sm">
          {t('databases.calendar.noDateProperties')}
        </p>
      ) : (
        <div className="overflow-auto" style={{ maxHeight: TABLE_MAX_HEIGHT }}>
          <div role="grid" aria-label={title} className="min-w-[560px]">
            <div role="row" className="grid grid-cols-7">
              {weekdays.map((day) => (
                <div
                  role="columnheader"
                  key={day.toISOString()}
                  className="border-border border-b px-2 pb-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {format(day, 'EEEE', { locale })}
                </div>
              ))}
            </div>
            {Array.from({ length: days.length / 7 }, (_, week) => (
              <div role="row" key={week} className="grid grid-cols-7">
                {days.slice(week * 7, week * 7 + 7).map((day) => {
                  const stored = format(day, 'yyyy-MM-dd');
                  return (
                    <div
                      role="gridcell"
                      key={stored}
                      data-calendar-date={stored}
                      onClick={(event) => {
                        if (!(event.target as Element).closest('a')) createOn(stored);
                      }}
                      className={cn(
                        'border-border min-h-24 border-r border-b p-1',
                        !isSameMonth(day, month) && 'bg-muted/40 text-muted-foreground',
                        dropDate === stored && 'bg-accent',
                      )}
                    >
                      <button
                        type="button"
                        aria-label={t('databases.calendar.createOn', {
                          date: format(day, 'PPPP', { locale }),
                        })}
                        disabled={readOnly || datePropertyId === null}
                        className={cn(
                          'hover:bg-accent flex size-6 items-center justify-center rounded-full px-1 text-xs disabled:hover:bg-transparent',
                          isToday(day) && 'text-primary font-semibold',
                        )}
                      >
                        {format(day, 'd')}
                      </button>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {(byDate.get(stored) ?? []).map((entry) => (
                          <CalendarEntry
                            key={entry.id}
                            entry={entry}
                            editable={
                              !readOnly &&
                              datePropertyId !== null &&
                              rowLocks.get(entry.id) !== 'all'
                            }
                            onMove={(date) => {
                              if (datePropertyId !== null) {
                                setCell(entry.id, datePropertyId, date);
                              }
                            }}
                            onTargetChange={setDropDate}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {withoutDate > 0 && datePropertyId !== null ? (
        <p className="text-muted-foreground px-1 pt-2 text-xs">
          {t('databases.calendar.withoutDate', { count: withoutDate })}
        </p>
      ) : null}
    </section>
  );
}
