import { describe, expect, it } from 'vitest';
import { addDays, dayOf, dayStart, dayStartAfter, dayStartOf, daysBetween, isoWeekday } from '../src/systems/time';

const WAW = { tz: 'Europe/Warsaw' };
const H = 3_600_000;

describe('time: игровой день с границей 04:00', () => {
  // 14.10.2026, Варшава в CEST (UTC+2).
  it('03:59 местного — ещё вчерашний день, 04:00 — новый', () => {
    expect(dayOf(Date.UTC(2026, 9, 14, 1, 59), WAW)).toBe('2026-10-13'); // 03:59 CEST
    expect(dayOf(Date.UTC(2026, 9, 14, 2, 0), WAW)).toBe('2026-10-14'); // 04:00 CEST
    expect(dayOf(Date.UTC(2026, 9, 14, 21, 59), WAW)).toBe('2026-10-14'); // 23:59
    expect(dayOf(Date.UTC(2026, 9, 14, 22, 30), WAW)).toBe('2026-10-14'); // 00:30 следующего календарного
  });

  it('dayStart = 04:00 местного дня', () => {
    const ts = Date.UTC(2026, 9, 14, 12, 0);
    expect(dayStart(ts, WAW)).toBe(Date.UTC(2026, 9, 14, 2, 0));
    expect(dayStart(Date.UTC(2026, 9, 14, 1, 0), WAW)).toBe(Date.UTC(2026, 9, 13, 2, 0));
  });

  it('dayStartHour берётся из параметра', () => {
    const ts = Date.UTC(2026, 9, 14, 3, 30); // 05:30 CEST
    expect(dayOf(ts, { ...WAW, dayStartHour: 6 })).toBe('2026-10-13');
    expect(dayOf(ts, { ...WAW, dayStartHour: 0 })).toBe('2026-10-14');
    expect(dayStartOf('2026-10-14', { ...WAW, dayStartHour: 0 })).toBe(Date.UTC(2026, 9, 13, 22, 0));
  });

  it('переход на зимнее время 25.10.2026 (03:00 CEST → 02:00 CET)', () => {
    // Переход в 01:00 UTC. Оба 02:xx (до и после перевода) — ещё день 24-го.
    expect(dayOf(Date.UTC(2026, 9, 25, 0, 30), WAW)).toBe('2026-10-24'); // 02:30 CEST
    expect(dayOf(Date.UTC(2026, 9, 25, 1, 30), WAW)).toBe('2026-10-24'); // 02:30 CET
    expect(dayOf(Date.UTC(2026, 9, 25, 2, 59), WAW)).toBe('2026-10-24'); // 03:59 CET
    expect(dayOf(Date.UTC(2026, 9, 25, 3, 0), WAW)).toBe('2026-10-25'); // 04:00 CET
    const start24 = dayStartOf('2026-10-24', WAW);
    const start25 = dayStartOf('2026-10-25', WAW);
    const start26 = dayStartOf('2026-10-26', WAW);
    expect(start24).toBe(Date.UTC(2026, 9, 24, 2, 0)); // 04:00 CEST
    expect(start25).toBe(Date.UTC(2026, 9, 25, 3, 0)); // 04:00 CET
    expect(start25 - start24).toBe(25 * H); // игровые сутки 24-го длиннее
    expect(start26 - start25).toBe(24 * H);
  });

  it('переход на летнее время 29.03.2026 (02:00 CET → 03:00 CEST)', () => {
    const s28 = dayStartOf('2026-03-28', WAW);
    const s29 = dayStartOf('2026-03-29', WAW);
    expect(s28).toBe(Date.UTC(2026, 2, 28, 3, 0)); // 04:00 CET
    expect(s29).toBe(Date.UTC(2026, 2, 29, 2, 0)); // 04:00 CEST
    expect(s29 - s28).toBe(23 * H);
    expect(dayOf(Date.UTC(2026, 2, 29, 1, 30), WAW)).toBe('2026-03-28'); // 03:30 CEST
  });

  it('due через n дней = 04:00 нужного дня даже через переход часов', () => {
    const now = Date.UTC(2026, 9, 23, 18, 0); // 23.10 20:00 CEST
    expect(dayStartAfter(now, 1, WAW)).toBe(Date.UTC(2026, 9, 24, 2, 0));
    expect(dayStartAfter(now, 3, WAW)).toBe(Date.UTC(2026, 9, 26, 3, 0)); // уже CET
    expect(dayOf(dayStartAfter(now, 3, WAW), WAW)).toBe('2026-10-26');
  });

  it('другой пояс: Нью-Йорк', () => {
    const ny = { tz: 'America/New_York' };
    expect(dayOf(Date.UTC(2026, 9, 14, 7, 59), ny)).toBe('2026-10-13'); // 03:59 EDT
    expect(dayOf(Date.UTC(2026, 9, 14, 8, 0), ny)).toBe('2026-10-14'); // 04:00 EDT
  });

  it('без tz работает в поясе устройства и согласован сам с собой', () => {
    const ts = Date.UTC(2026, 9, 14, 12, 0);
    const d = dayOf(ts);
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dayOf(dayStartOf(d))).toBe(d);
    expect(dayOf(dayStartOf(d) - 1)).toBe(addDays(d, -1));
  });
});

describe('time: календарная арифметика', () => {
  it('addDays через месяц, год и 29 февраля', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-14', 0)).toBe('2026-10-14');
  });
  it('daysBetween и isoWeekday', () => {
    expect(daysBetween('2026-10-14', '2026-10-21')).toBe(7);
    expect(daysBetween('2026-10-21', '2026-10-14')).toBe(-7);
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7); // через переход часов
    expect(isoWeekday('2026-10-14')).toBe(3); // среда
    expect(isoWeekday('2026-10-25')).toBe(7); // воскресенье
    expect(isoWeekday('2026-10-26')).toBe(1);
  });
  it('плохой формат дня — исключение', () => {
    expect(() => addDays('14.10.2026', 1)).toThrow();
  });
});
