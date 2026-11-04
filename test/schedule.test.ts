import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER, localDateKey, nextReminders, reminderCronPattern } from '../src/schedule.js';

// Asia/Yerevan is UTC+4 all year (no DST), so 14:00 local is 10:00 UTC.
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

describe('reminder schedule', () => {
  it('defaults to Monday-Friday 14:00 Asia/Yerevan', () => {
    expect(DEFAULT_REMINDER).toMatchObject({ time: '14:00', days: 'MON-FRI', timezone: 'Asia/Yerevan' });
    expect(reminderCronPattern(DEFAULT_REMINDER)).toBe('0 14 * * MON-FRI');
  });

  it('fires on weekdays only, at 14:00 Yerevan time', () => {
    // Monday 2026-11-02 08:00 Yerevan
    const from = new Date('2026-11-02T04:00:00Z');
    expect(iso(nextReminders(DEFAULT_REMINDER, 6, from))).toEqual([
      '2026-11-02T10:00:00.000Z', // Mon
      '2026-11-03T10:00:00.000Z', // Tue
      '2026-11-04T10:00:00.000Z', // Wed
      '2026-11-05T10:00:00.000Z', // Thu
      '2026-11-06T10:00:00.000Z', // Fri
      '2026-11-09T10:00:00.000Z', // next Mon, weekend skipped
    ]);
  });

  it('skips to Monday when asked after Friday 14:00', () => {
    const fridayEvening = new Date('2026-11-06T14:00:00Z'); // 18:00 Yerevan
    expect(iso(nextReminders(DEFAULT_REMINDER, 1, fridayEvening))).toEqual(['2026-11-09T10:00:00.000Z']);
  });

  it('respects a custom time and day list', () => {
    const config = { ...DEFAULT_REMINDER, time: '9:30', days: 'MON,WED,FRI' };
    expect(reminderCronPattern(config)).toBe('30 9 * * MON,WED,FRI');
    const from = new Date('2026-11-02T00:00:00Z'); // Monday 04:00 Yerevan
    expect(iso(nextReminders(config, 3, from))).toEqual([
      '2026-11-02T05:30:00.000Z',
      '2026-11-04T05:30:00.000Z',
      '2026-11-06T05:30:00.000Z',
    ]);
  });

  it('accepts numeric day ranges', () => {
    const config = { ...DEFAULT_REMINDER, days: '1-5' };
    const from = new Date('2026-11-07T00:00:00Z'); // Saturday
    expect(iso(nextReminders(config, 1, from))).toEqual(['2026-11-09T10:00:00.000Z']);
  });

  it('rejects invalid values', () => {
    expect(() => reminderCronPattern({ time: '25:00', days: 'MON-FRI' })).toThrow(/HH:MM/);
    expect(() => reminderCronPattern({ time: '14:00', days: ' ' })).toThrow(/REMINDER_DAYS/);
    expect(() => nextReminders({ ...DEFAULT_REMINDER, days: 'FUNDAY' }, 1, new Date())).toThrow();
  });

  it('computes the local calendar date in Yerevan', () => {
    // 22:30 UTC Monday is already Tuesday 02:30 in Yerevan
    expect(localDateKey(new Date('2026-11-02T22:30:00Z'), 'Asia/Yerevan')).toBe('2026-11-03');
  });
});
