// @vitest-environment happy-dom
// Лента собеса (10.11, ТЗ-лента-прогресса): `slowa/sobes.json` применяется без выкладки сайта.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBundle } from '../src/games/sobes/plan';
import { fetchWordFeed, SOBES_FEED_URL } from '../src/systems/platform/wordFeed';
import { createPolska, newPolskaSave, normalizePolska, type PolskaSave } from '../src/systems/polska';
import { sobesFeedLine } from '../src/systems/sobesFeed';
import { parseV2, replaceSobes } from '../src/systems/v2content';
import type { GameCtx } from '../src/types/polska';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 10, 10, 10, 0);
const unit = (n: number, chunks: string[], status = 'учу') => ({
  id: `ans.${n}`, kind: 'answer', type: 'core', n, pl: `Pytanie ${n}?`, ru: `Вопрос ${n}`, tr: '', band: 1,
  answer: chunks.join(' '), chunks, sedno: ['суть'], status, last: '10.11.2026',
});
const doc = (...units: ReturnType<typeof unit>[]) => ({ version: 1, src: 'test', units });
const A = unit(1, ['Mam na imię', 'Dima.']);
const B = unit(2, ['Mieszkam', 'w Warszawie.']);
const C = unit(3, ['Pracuję', 'w firmie.']);

function setup(first = doc(A, B)) {
  const content = parseV2({ geo: {}, hymn: {}, daty: {}, swieta: {}, words: [], sobes: first });
  let save: PolskaSave = newPolskaSave();
  const p = createPolska({ bus: testBus(), load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0, content });
  p.syncContent();
  const ctx = (): GameCtx => ({
    units: p.units('sobes'), unit: (id) => p.unit(id), info: (id) => p.info(id), seen: (id) => p.seen(id), markSeen: (id) => p.markSeen(id),
    doc: content.docs.sobes ?? {}, now: () => NOW, date: () => ({ y: 2026, m: 11, d: 10, weekday: 2 }), rand: seeded(1),
  });
  const pool = (): string[] => p.units('sobes').map((u) => u.id);
  return { content, p, ctx, pool, save: () => save };
}
/** Вопрос прочитан и полит: есть что сбрасывать. */
function learn(s: ReturnType<typeof setup>, id: string): void {
  s.p.plant([id]);
  s.p.markSeen(id);
  s.p.answer({ id, side: 'A' }, true);
}

describe('Лента собеса: применение к сохранению', () => {
  it('первая сверка (вшитое, старое сохранение) ничего не сбрасывает', () => {
    const s = setup();
    learn(s, 'ans.1');
    expect(s.p.syncContent().reset).toEqual([]);
    expect(s.p.seen('ans.1')).toBe(true);
    expect(s.save().hashes?.['ans.1']).toBeTruthy();
  });

  it('новый вопрос — в «Новой связке» нечитанным', () => {
    const s = setup();
    learn(s, 'ans.1');
    learn(s, 'ans.2');
    expect(replaceSobes(s.content, doc(A, B, C))).toEqual([]);
    const r = s.p.syncContent();
    expect(r.added).toEqual(['ans.3']);
    expect(s.p.seen('ans.3')).toBe(false);
    expect(newBundle(s.ctx(), s.pool())).toContain('ans.3');
    expect(sobesFeedLine(r)).toBe('Собес: 1 новый вопрос');
  });

  it('изменённый ответ — прогресс и знакомство сброшены, старых кусков нет', () => {
    const s = setup();
    learn(s, 'ans.1');
    learn(s, 'ans.2');
    const A2 = unit(1, ['Nazywam się', 'Dmitrii.']);
    replaceSobes(s.content, doc(A2, B));
    const r = s.p.syncContent();
    expect(r.reset).toEqual(['ans.1']);
    expect(s.p.seen('ans.1')).toBe(false);
    expect(s.p.info('ans.1').planted).toBe(false);
    expect(s.p.seen('ans.2')).toBe(true);
    expect(s.p.info('ans.2').planted).toBe(true);
    expect(s.p.unit('ans.1')!.raw.chunks).toEqual(['Nazywam się', 'Dmitrii.']);
    expect(newBundle(s.ctx(), s.pool())).toContain('ans.1');
    expect(sobesFeedLine(r)).toBe('Собес: 1 ответ обновлён — учим заново');
    // повторная сверка того же — без сброса
    expect(s.p.syncContent().reset).toEqual([]);
  });

  it('статус «знаю» — остаётся в игре, из «Новой связки» убран', () => {
    const s = setup();
    replaceSobes(s.content, doc(A, unit(2, ['Mieszkam', 'w Warszawie.'], 'знаю'), C));
    s.p.syncContent();
    expect(s.pool()).toContain('ans.2');
    expect(newBundle(s.ctx(), s.pool())).not.toContain('ans.2');
  });

  it('пропал из ленты — скрыт, прогресс в сохранении остался; вернулся тем же — прогресс на месте', () => {
    const s = setup();
    learn(s, 'ans.2');
    replaceSobes(s.content, doc(A, C));
    s.p.syncContent();
    expect(s.pool()).not.toContain('ans.2');
    expect(s.p.state.items.has('ans.2')).toBe(true);
    replaceSobes(s.content, doc(A, B, C));
    expect(s.p.syncContent().reset).toEqual([]);
    expect(s.p.info('ans.2').planted).toBe(true);
  });

  it('битый документ не трогает контент', () => {
    const s = setup();
    expect(replaceSobes(s.content, { units: [unit(9, ['Tylko jeden'])] }).length).toBeGreaterThan(0);
    expect(replaceSobes(s.content, { nope: 1 }).length).toBeGreaterThan(0);
    expect(replaceSobes(s.content, null).length).toBeGreaterThan(0);
    expect(s.pool()).toEqual(['ans.1', 'ans.2']);
  });

  it('сохранение помнит отпечатки и документ ленты', () => {
    const p = normalizePolska({ seen: {}, hashes: { 'ans.1': 'x', bad: 3 }, sobesFeed: doc(A) });
    expect(p.hashes).toEqual({ 'ans.1': 'x' });
    expect((p.sobesFeed as { units: unknown[] }).units).toHaveLength(1);
    expect(normalizePolska({}).sobesFeed).toBeUndefined();
  });
});

describe('Лента собеса: без сети — вшитый файл', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('нет сети или файла — null (игра остаётся на вшитом / прошлой ленте)', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await fetchWordFeed(SOBES_FEED_URL, NOW)).toBeNull();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 404 })));
    expect(await fetchWordFeed(SOBES_FEED_URL, NOW)).toBeNull();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{битый', { status: 200 })));
    expect(await fetchWordFeed(SOBES_FEED_URL, NOW)).toBeNull();
  });
});
