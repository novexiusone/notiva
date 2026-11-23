import type { Row } from '@/lib/commands';
import { toCalendarEntries } from './toCalendarEntries';

function row(id: string, title: string, date?: unknown): Row {
  return { id, title, position: 0, cells: date === undefined ? {} : { due: date as string } };
}

describe('toCalendarEntries', () => {
  it('turns rows with a valid chosen date into entries in row order', () => {
    const result = toCalendarEntries(
      [row('r1', 'First', '2026-11-14'), row('r2', 'Second', '2026-11-02')],
      'due',
    );

    expect(result).toEqual({
      entries: [
        { id: 'r1', title: 'First', date: '2026-11-14' },
        { id: 'r2', title: 'Second', date: '2026-11-02' },
      ],
      withoutDate: 0,
    });
  });

  it('omits and counts rows without a real date on the chosen property', () => {
    const result = toCalendarEntries(
      [
        row('r1', 'Missing'),
        row('r2', 'Empty', null),
        row('r3', 'Invalid', '2026-02-30'),
        row('r4', 'Wrong type', 42),
        { ...row('r5', 'Other property'), cells: { other: '2026-11-14' } },
        row('r6', 'Dated', '2026-11-23'),
      ],
      'due',
    );

    expect(result.entries).toEqual([{ id: 'r6', title: 'Dated', date: '2026-11-23' }]);
    expect(result.withoutDate).toBe(5);
  });

  it('shows no entries until a date property is chosen', () => {
    expect(toCalendarEntries([row('r1', 'First', '2026-11-14')], null)).toEqual({
      entries: [],
      withoutDate: 1,
    });
  });
});
