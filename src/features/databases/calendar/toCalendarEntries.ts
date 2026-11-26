import { parseStoredDate } from '@/features/databases/properties/format';
import type { Row } from '@/lib/commands';

export type CalendarEntry = { id: string; title: string; date: string };

/** Entries on real calendar days, and how many of the given rows cannot be placed. */
export function toCalendarEntries(rows: readonly Row[], datePropertyId: string | null) {
  const entries: CalendarEntry[] = [];
  let withoutDate = 0;
  for (const row of rows) {
    const value = datePropertyId === null ? null : row.cells[datePropertyId];
    if (typeof value !== 'string' || parseStoredDate(value) === null) {
      withoutDate += 1;
      continue;
    }
    entries.push({ id: row.id, title: row.title, date: value });
  }
  return { entries, withoutDate };
}
