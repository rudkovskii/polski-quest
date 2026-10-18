// Игра «Święta»: задания про один праздник без DOM — «Co to za święto?» (по картине, предмету, обычаю, дате), «Kiedy jest…?», «Sklepy otwarte?»,
// «Spakuj koszyk» / «Nakryj stół», обычай по-русски → по-польски, пожелание и обычай из плиток (режим «сам»). Рисует их `view.ts`, ведёт раунд `plan.ts`.
import type { GameCtx, GameTask, PolskaUnit, Want } from '../../types/polska';
import { shuffle } from '../kit';
import { fmtSpan, dayNo, nextSpan, overlaps, shiftSpan, shortName, WEEKDAY_PL, weekdayOf, type Span } from './calendar';
import { itemWord } from './icons';
import type { Credit } from './wheel';

export type SwKind = 'what' | 'when' | 'shops' | 'pack' | 'wish' | 'custom';
export type PackKind = 'basket' | 'bag' | 'table';
export interface ItemRef {
  id: string;
  pl: string;
  ru: string;
}

export interface SwTask extends GameTask {
  kind: SwKind;
  /** Подвид: what — pic|clue|custom|date; pack — basket|bag|table; wish — wish|wish_alt|custom. */
  variant: string;
  q: string;
  qLang: 'pl' | 'ru';
  hint: string;
  /** «Картинка»-подсказка: id слов-предметов (what/clue). */
  clue?: string[];
  /** Картина из колеса (what/pic): файл в `public/swieta/` и автор для подписи. */
  pic?: { img: string; credit: Credit | null };
  /** Крупная строка (дата или обычай с пропуском). */
  big?: string;
  options?: string[];
  answer?: string;
  /** pack: все предметы сцены в перемешанном порядке и те, что надо взять. */
  items?: ItemRef[];
  expect?: string[];
  packKind?: PackKind;
  /** wish: плитки и верная сборка. */
  tiles?: string[];
  expectTiles?: string[];
  tilesLang?: 'pl' | 'ru';
  /** Что показать как правильный ответ и что озвучить. */
  correct: string;
  say?: string;
  note?: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const todayNo = (ctx: GameCtx): number => {
  const d = ctx.date();
  return dayNo(d.y, d.m, d.d);
};

interface Bilingual {
  pl: string;
  ru: string;
}
const bil = (v: unknown): Bilingual => ({ pl: String(obj(v).pl ?? ''), ru: String(obj(v).ru ?? '') });

// ---------- «Co to za święto?» ----------

/** Слова названия праздника в виде основ: по ним в обычае прячется само название («W ___ jemy pączki»). */
function nameStems(u: PolskaUnit): string[] {
  return shortName(u)
    .split(/\s+/)
    .map((w) => w.replace(/[.,!?;:()]/g, '').toLowerCase())
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, Math.max(4, w.length - 2)));
}

/** Обычаи с названием праздника, спрятанным в «___»: годятся как задание «по обычаю». */
export function maskedCustoms(u: PolskaUnit): string[] {
  const stems = nameStems(u);
  const out: string[] = [];
  for (const c of Array.isArray(u.raw.customs) ? u.raw.customs : []) {
    const pl = String(obj(c).pl ?? '');
    let hit = false;
    const masked = pl
      .split(/(\s+)/)
      .map((tok) => {
        const core = tok.replace(/[.,!?;:]/g, '').toLowerCase();
        if (core.length >= 4 && stems.some((s) => core.startsWith(s))) {
          hit = true;
          return tok.replace(/[^\s.,!?;:]+/, '___');
        }
        return tok;
      })
      .join('');
    if (hit) out.push(masked);
  }
  return out;
}

/** Три неверных названия: из `distract` данных, без праздников с теми же предметами-подсказками (или датой) и дозаполнение другими. */
function whatOptions(ctx: GameCtx, u: PolskaUnit, span: Span | null, byDate: boolean): string[] {
  const clue = new Set(strs(u.raw.clue));
  const today = todayNo(ctx);
  const clash = (x: PolskaUnit): boolean => {
    if (x.id === u.id) return true;
    if (byDate) {
      const s = nextSpan(x, today);
      return !s || (!!span && overlaps(s, span));
    }
    return strs(x.raw.clue).some((c) => clue.has(c));
  };
  const named = (ids: readonly string[]): PolskaUnit[] => ids.map((id) => ctx.unit(id)).filter((x): x is PolskaUnit => !!x);
  const seen = new Set([shortName(u).toLowerCase()]);
  const out: string[] = [];
  for (const x of [...named(strs(u.raw.distract)), ...shuffle(ctx.units, ctx.rand)]) {
    if (out.length >= 3) break;
    const n = shortName(x);
    if (clash(x) || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

export function whatTask(ctx: GameCtx, u: PolskaUnit, mode?: 'clue' | 'custom' | 'date'): SwTask | null {
  const today = todayNo(ctx);
  const span = nextSpan(u, today);
  const masked = maskedCustoms(u);
  const clue = strs(u.raw.clue);
  const modes: ('clue' | 'custom' | 'date')[] = [];
  if (clue.length) modes.push('clue', 'clue');
  if (masked.length) modes.push('custom');
  if (span) modes.push('date');
  if (!modes.length) return null;
  const pick = mode && modes.includes(mode) ? mode : modes[Math.floor(ctx.rand() * modes.length)]!;
  const base = { id: u.id, side: 'A' as const, kind: 'what' as const, variant: pick, q: 'Co to za święto?', qLang: 'pl' as const, correct: shortName(u), answer: shortName(u) };
  const options = (byDate: boolean): string[] => shuffle([shortName(u), ...whatOptions(ctx, u, span, byDate)], ctx.rand);
  if (pick === 'clue') return { ...base, hint: 'По чему узнаёшь праздник?', clue, options: options(false) };
  if (pick === 'custom') {
    const big = masked[Math.floor(ctx.rand() * masked.length)]!;
    return { ...base, hint: 'Какой праздник пропущен в обычае?', big, options: options(false) };
  }
  const wd = span!.movable ? ` (${WEEKDAY_PL[weekdayOf(span!.start)]})` : '';
  return { ...base, hint: 'Какой праздник в этот день?', big: `${fmtSpan(span!)}${wd}`, options: options(true) };
}

/** «Co to za święto?» по картине из рассказа: та же картина, что в карточке знакомства. */
export function picTask(ctx: GameCtx, u: PolskaUnit, pic: { img: string; credit: Credit | null }): SwTask {
  const name = shortName(u);
  const options = shuffle([name, ...whatOptions(ctx, u, nextSpan(u, todayNo(ctx)), false)], ctx.rand);
  return { id: u.id, side: 'A', kind: 'what', variant: 'pic', q: 'Co to za święto?', qLang: 'pl', correct: name, answer: name, hint: 'Какой это праздник? Картина из рассказа', pic, options };
}

// ---------- обычай: русская фраза → польская ----------

export function customsOf(u: PolskaUnit): Bilingual[] {
  return (Array.isArray(u.raw.customs) ? u.raw.customs : []).map(bil).filter((c) => c.pl && c.ru);
}

/** Какое польское предложение говорит об этом обычае: верное, остальные обычаи праздника и чужие (A: узнать). `only` — номера обычаев, из которых брать. */
export function customChoiceTask(ctx: GameCtx, u: PolskaUnit, only?: readonly number[]): SwTask | null {
  const list = customsOf(u);
  const pool = (only?.length ? only : list.map((_, i) => i)).filter((i) => i >= 0 && i < list.length);
  if (!pool.length) return null;
  const c = list[pool[Math.floor(ctx.rand() * pool.length)]!]!;
  const seen = new Set([c.pl.toLowerCase()]);
  const wrong: string[] = [];
  const own = shuffle(list.filter((x) => x !== c).map((x) => x.pl), ctx.rand);
  const foreign = shuffle(ctx.units.filter((x) => x.id !== u.id).flatMap((x) => customsOf(x).map((y) => y.pl)), ctx.rand);
  for (const t of [...own, ...foreign]) {
    if (wrong.length >= 3) break;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    wrong.push(t);
  }
  if (wrong.length < 2) return null;
  return { id: u.id, side: 'A', kind: 'custom', variant: 'custom', q: c.ru, qLang: 'ru', hint: 'Как это сказать по-польски? Выбери предложение', options: shuffle([c.pl, ...wrong], ctx.rand), answer: c.pl, correct: c.pl, say: c.pl };
}

// ---------- «Kiedy jest…?» ----------

/** Дата верная и три неверных, хронологически; подвижный праздник — с годом, неверные сдвинуты на недели (день недели тот же). */
export function dateChoices(ctx: GameCtx, u: PolskaUnit): { answer: string; options: string[] } | null {
  const today = todayNo(ctx);
  const span = nextSpan(u, today);
  if (!span) return null;
  const answer = fmtSpan(span);
  const others: Span[] = [];
  if (span.movable) {
    for (const dn of shuffle([-28, -21, -14, -7, 7, 14, 21, 28], ctx.rand)) others.push(shiftSpan(span, dn));
  } else {
    const near = ctx.units
      .filter((x) => x.id !== u.id)
      .map((x) => nextSpan(x, today))
      .filter((s): s is Span => !!s && !overlaps(s, span))
      .map((s) => ({ ...s, movable: false }))
      .sort((a, b) => Math.abs(a.start - span.start) - Math.abs(b.start - span.start));
    others.push(...shuffle(near.slice(0, 7), ctx.rand));
    // На случай нехватки: сдвиги на несколько дней.
    for (const dn of shuffle([-9, -6, -3, 3, 6, 9], ctx.rand)) others.push(shiftSpan(span, dn));
  }
  const picked: Span[] = [];
  const seen = new Set([answer]);
  for (const s of others) {
    const t = fmtSpan(s);
    if (picked.length >= 3) break;
    if (seen.has(t) || overlaps(s, span)) continue;
    seen.add(t);
    picked.push(s);
  }
  const all = [span, ...picked].sort((a, b) => a.start - b.start);
  return { answer, options: all.map(fmtSpan) };
}

export function whenTask(ctx: GameCtx, u: PolskaUnit): SwTask | null {
  const ch = dateChoices(ctx, u);
  const span = nextSpan(u, todayNo(ctx));
  if (!ch || !span) return null;
  const hint = span.movable ? `Дата меняется каждый год, день недели всегда: ${WEEKDAY_PL[weekdayOf(span.start)]}` : 'Выбери дату (день.месяц)';
  return { id: u.id, side: 'B', kind: 'when', variant: 'date', q: `Kiedy jest ${shortName(u)}?`, qLang: 'pl', hint, options: ch.options, answer: ch.answer, correct: ch.answer, say: `${shortName(u)}: ${ch.answer}` };
}

// ---------- «Sklepy otwarte?» ----------

interface ShopsQ {
  say: string | null;
  shops: string;
}

export function shopsQuestions(u: PolskaUnit): ShopsQ[] {
  const list = (Array.isArray(u.raw.shops_q) ? u.raw.shops_q : []).map((x) => ({ say: typeof obj(x).say === 'string' ? String(obj(x).say) : null, shops: String(obj(x).shops ?? '') }));
  if (list.length) return list.filter((q) => ['open', 'closed', 'short'].includes(q.shops));
  const shops = String(u.raw.shops ?? '');
  return ['open', 'closed', 'short'].includes(shops) ? [{ say: typeof u.raw.say === 'string' ? u.raw.say : null, shops }] : [];
}

export function shopsTask(ctx: GameCtx, u: PolskaUnit, index?: number): SwTask | null {
  const qs = shopsQuestions(u);
  if (!qs.length) return null;
  const q = qs[index !== undefined ? index % qs.length : Math.floor(ctx.rand() * qs.length)]!;
  const tpl = obj(obj(ctx.doc.tasks).shops);
  const words = { open: 'otwarte', closed: 'zamknięte', short: 'otwarte do czternastej', ...obj(tpl.answers) } as Record<string, string>;
  const options = [words.open!, words.closed!, words.short!];
  const answer = words[q.shops]!;
  const subject = cap(q.say ?? shortName(u));
  const template = typeof tpl.q === 'string' ? tpl.q : '{say}: sklepy są otwarte czy zamknięte?';
  const note = bil(u.raw.shops_note).pl;
  return {
    id: u.id,
    side: 'B',
    kind: 'shops',
    variant: q.shops,
    q: template.replace('{say}', subject),
    qLang: 'pl',
    hint: 'Магазины в этот день: открыты, закрыты или только до 14:00?',
    options,
    answer,
    correct: answer,
    say: `${subject} sklepy są ${answer}.`,
    ...(note ? { note } : {}),
  };
}

// ---------- «Spakuj koszyk» / «Nakryj stół» ----------

export function packSpec(u: PolskaUnit): { src: 'basket' | 'table'; in: string[]; out: string[]; title: Bilingual } | null {
  for (const src of ['basket', 'table'] as const) {
    const b = obj(u.raw[src]);
    const inn = strs(b.in);
    if (!inn.length) continue;
    return { src, in: inn, out: strs(b.out), title: bil(b.title) };
  }
  return null;
}

export function packTask(ctx: GameCtx, u: PolskaUnit, self = false): SwTask | null {
  const spec = packSpec(u);
  if (!spec) return null;
  const generic = bil(obj(obj(ctx.doc.tasks)[spec.src]));
  const title = { pl: spec.title.pl || generic.pl, ru: spec.title.ru || generic.ru };
  const kind: PackKind = spec.src === 'table' ? 'table' : /torb/i.test(title.pl) ? 'bag' : 'basket';
  const items = shuffle([...spec.in, ...spec.out], ctx.rand).map(itemWord);
  const correct = spec.in.map((id) => itemWord(id).pl).join(', ');
  return {
    id: u.id,
    side: 'B',
    ...(self ? { self: true } : {}),
    kind: 'pack',
    variant: kind,
    q: title.pl,
    qLang: 'pl',
    hint: `${title.ru}. Тапай по нужному, лишнее оставь`,
    items,
    expect: [...spec.in],
    packKind: kind,
    correct,
  };
}

// ---------- «Życzenia» и обычай из плиток («сам») ----------

export function wishTask(ctx: GameCtx, u: PolskaUnit, alt?: boolean): SwTask | null {
  const useAlt = alt ?? (!!u.raw.wish_alt && ctx.rand() < 0.5);
  const w = obj(useAlt ? u.raw.wish_alt : u.raw.wish);
  const tl = strs(w.tiles_pl);
  if (!tl.length) return null;
  const sit = bil(w.situation);
  const pool = shuffle([...tl, ...strs(w.distract_pl)], ctx.rand);
  return {
    id: u.id,
    side: 'B',
    self: true,
    kind: 'wish',
    variant: useAlt ? 'wish_alt' : 'wish',
    q: sit.pl,
    qLang: 'pl',
    hint: `${sit.ru} · Что скажешь? Собери пожелание`,
    tiles: pool,
    expectTiles: tl,
    tilesLang: 'pl',
    correct: String(w.pl ?? tl.join(' ')),
    say: String(w.pl ?? tl.join(' ')),
  };
}

export function customTilesTask(ctx: GameCtx, u: PolskaUnit, only?: readonly number[]): SwTask | null {
  const all = (Array.isArray(u.raw.customs) ? u.raw.customs : []).map(obj);
  const list = all.filter((c, i) => strs(c.tiles_pl).length > 0 && (!only?.length || only.includes(i)));
  if (!list.length) return null;
  // Короткие обычаи собирать приятнее: берём из тех, что до 8 плиток, если такие есть.
  const short = list.filter((c) => strs(c.tiles_pl).length <= 8);
  const pool = short.length ? short : list;
  const c = pool[Math.floor(ctx.rand() * pool.length)]!;
  const tl = strs(c.tiles_pl);
  return {
    id: u.id,
    side: 'B',
    self: true,
    kind: 'wish',
    variant: 'custom',
    q: String(c.ru ?? ''),
    qLang: 'ru',
    hint: 'Собери обычай по-польски',
    tiles: shuffle([...tl, ...strs(c.distract_pl)], ctx.rand),
    expectTiles: tl,
    tilesLang: 'ru',
    correct: String(c.pl ?? tl.join(' ')),
    say: String(c.pl ?? tl.join(' ')),
  };
}

// ---------- выбор задания ----------

export function pickTask(ctx: GameCtx, u: PolskaUnit, want: Pick<Want, 'side' | 'self'>): SwTask | null {
  const R = ctx.rand;
  if (want.self) {
    const hasWish = !!obj(u.raw.wish).pl;
    const pack = packSpec(u);
    if (pack && (!hasWish || R() < 0.5)) return packTask(ctx, u, true) ?? wishTask(ctx, u) ?? customTilesTask(ctx, u);
    if (hasWish) return wishTask(ctx, u) ?? customTilesTask(ctx, u);
    return customTilesTask(ctx, u);
  }
  if (want.side === 'A') return whatTask(ctx, u);
  // B: сцена (корзинка, стол) весит вдвое, дальше дата и магазины.
  const order: (() => SwTask | null)[] = [];
  if (packSpec(u)) order.push(() => packTask(ctx, u), () => packTask(ctx, u));
  order.push(() => whenTask(ctx, u), () => shopsTask(ctx, u));
  for (const f of shuffle(order, R)) {
    const t = f();
    if (t) return t;
  }
  return shopsTask(ctx, u) ?? whenTask(ctx, u) ?? whatTask(ctx, u);
}
