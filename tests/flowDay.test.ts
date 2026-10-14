// Номер игрового дня для строки «Сейчас» (P-02, ПОЛИРОВКА §2 р. 11): первые 3 дня её ведёт Казик.
import { describe, expect, it } from 'vitest';
import { gameDayNo, NOW_HIDDEN_DAYS } from '../src/flow';
import type { Derived } from '../src/systems/derive';

type DayStats = Derived['days'][string];

const played = { segs: ['water'], lessons: 1 } as unknown as DayStats;

describe('gameDayNo', () => {
  it('новый игрок — день 1; сегодняшний день считается текущим, даже если ещё не засчитан', () => {
    expect(gameDayNo({ days: {}, today: '2026-10-14' })).toBe(1);
    expect(gameDayNo({ days: { '2026-10-14': played }, today: '2026-10-14' })).toBe(1);
  });
  it('засчитанные дни до сегодня + 1; строка «Сейчас» спрятана по 3-й день включительно', () => {
    const days = { '2026-10-10': played, '2026-10-12': played };
    expect(gameDayNo({ days, today: '2026-10-14' })).toBe(3);
    expect(gameDayNo({ days, today: '2026-10-14' }) <= NOW_HIDDEN_DAYS).toBe(true);
    expect(gameDayNo({ days: { ...days, '2026-10-13': played }, today: '2026-10-14' })).toBe(4);
  });
});
