// Игра 4: Święta («Tablica sezonowa», ФЕРМА_v2.md §5). Нижняя панель, вход — сезонная доска у калитки.
// Задания: «Co to za święto?» (сторона A: по подсказке-предмету, по обычаю с пропуском, по дате), «Kiedy jest…?» (дата цифрами),
// «Sklepy otwarte?» (otwarte / zamknięte / do czternastej), «Spakuj koszyk» и «Nakryj stół» (тап по предметам среди дистракторов),
// «Życzenia» и обычай из плиток (режим «сам»). Ближайший праздник по реальной дате (`ctx.date()`) сажается первым и висит
// строкой «Najbliższe święto: … za N дней» над каждым заданием. Календарь — calendar.ts, иконки — icons.ts.
import { el } from '../../ui/dom';
import type { GameCheck, GameCtx, GamePanel, GameTask, PolskaGame, PolskaUnit, Want } from '../../types/polska';
import { choice, prompt, sameTiles, shuffle, tiles } from '../kit';
import { fmtSpan, inDays, dayNo, nearestHoliday, nextSpan, overlaps, seasonFrame, seasonalOrder, shiftSpan, shortName, WEEKDAY_PL, weekdayOf, type Span } from './calendar';
import { frameIcon, itemIcon, itemWord } from './icons';
import { atlasIcon, plantIconFrame } from '../../ui/atlasIcon';

export type SwKind = 'what' | 'when' | 'shops' | 'pack' | 'wish';
export type PackKind = 'basket' | 'bag' | 'table';

export interface ItemRef {
  id: string;
  pl: string;
  ru: string;
}

export interface SwTask extends GameTask {
  kind: SwKind;
  /** Подвид: what — clue|custom|date; pack — basket|bag|table; wish — wish|wish_alt|custom. */
  variant: string;
  q: string;
  qLang: 'pl' | 'ru';
  hint: string;
  /** «Картинка»-подсказка: id слов-предметов (what/clue). */
  clue?: string[];
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

export function customTilesTask(ctx: GameCtx, u: PolskaUnit): SwTask | null {
  const list = (Array.isArray(u.raw.customs) ? u.raw.customs : []).map(obj).filter((c) => strs(c.tiles_pl).length > 0);
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

// ---------- DOM ----------

const css = `
.pq-pg .sw-near { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; padding: 2px 8px 2px 2px; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; font-size: 14px; }
.pq-pg .sw-near .sw-ico { flex: 0 0 auto; }
.pq-pg .sw-near b { font-weight: 800; }
.pq-pg .sw-ico { display: inline-block; flex: 0 0 auto; background-repeat: no-repeat; image-rendering: pixelated; }
.pq-pg .sw-ico.emoji { width: 32px; height: 32px; font-size: 28px; line-height: 32px; text-align: center; background: none; }
.pq-pg .sw-clue { display: flex; gap: 10px; margin: 2px 0 10px; }
.pq-pg .sw-clue .sw-card { flex: 1 1 0; }
.pq-pg .sw-big { font-size: 24px; font-weight: 800; margin: 2px 0 10px; padding: 8px 10px; background: #fffaf0; border: 2px dashed var(--pq-wood); border-radius: 8px; overflow-wrap: break-word; }
.pq-pg .sw-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; box-sizing: border-box; min-height: 74px; padding: 4px 4px 5px; color: var(--pq-ink); background: #fffaf0; text-align: center; }
.pq-pg .sw-card .sw-box { height: 34px; display: flex; align-items: center; justify-content: center; }
.pq-pg .sw-card .sw-box .sw-ico { margin: 0 auto; }
.pq-pg .sw-card .sw-pl { font-size: 15px; font-weight: 800; line-height: 1.1; overflow-wrap: anywhere; }
.pq-pg .sw-card .sw-ru { font-size: 11px; font-weight: 600; opacity: .65; line-height: 1.1; }
.pq-pg .sw-clue .sw-card { min-height: 120px; cursor: default; }
.pq-pg .sw-clue .sw-card .sw-box { height: 64px; }
.pq-pg .sw-clue .sw-ico.emoji { width: 48px; height: 48px; font-size: 40px; line-height: 48px; }
.pq-pg .sw-clue .sw-card .sw-pl { font-size: 18px; }
.pq-pg .sw-pack { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 6px; }
.pq-pg .sw-pack .sw-card.sel { background: #cfe6a8; outline: 3px solid var(--pq-leaf); outline-offset: -3px; }
.pq-pg .sw-pack .sw-card.right { background: #8cc66a; }
.pq-pg .sw-pack .sw-card.wrong { background: #e88e7c; }
.pq-pg .sw-pack .sw-card.miss { background: #f2dcae; outline: 3px dashed var(--pq-leaf); outline-offset: -3px; }
.pq-pg .sw-count { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 14px; font-weight: 700; }
.pq-pg .sw-count .sw-ico.emoji { width: 22px; height: 22px; font-size: 18px; line-height: 22px; }
.pq-pg .sw-near .sw-ico { transform: scale(.75); margin: -4px -2px; }
@media (max-width: 720px), (max-height: 860px) {
  .pq-pg .sw-near { margin-bottom: 6px; font-size: 13px; }
  .pq-pg .sw-clue { margin: 0 0 8px; gap: 8px; }
  .pq-pg .sw-clue .sw-card { min-height: 54px; display: grid; grid-template-columns: 40px minmax(0, 1fr); grid-template-rows: auto auto; align-content: center; column-gap: 6px; text-align: left; justify-items: start; }
  .pq-pg .sw-clue .sw-card .sw-box { height: 40px; width: 40px; grid-row: span 2; align-self: center; }
  .pq-pg .sw-clue .sw-ico.emoji { width: 36px; height: 36px; font-size: 30px; line-height: 36px; }
  .pq-pg .sw-clue .sw-box .sw-ico:not(.emoji) { transform: scale(.75); }
  .pq-pg .sw-clue .sw-card .sw-pl { font-size: 16px; }
  .pq-pg .sw-big { font-size: 19px; margin: 0 0 8px; padding: 5px 8px; }
  .pq-pg .sw-card { min-height: 66px; }
  .pq-pg .sw-pack { grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 4px; }
  .pq-pg .sw-pack .sw-card { min-height: 52px; padding: 1px 2px 2px; gap: 0; }
  .pq-pg .sw-count { margin-bottom: 4px; }
  .pq-pg .sw-pack .sw-card .sw-box { height: 26px; }
  .pq-pg .sw-pack .sw-card .sw-box .sw-ico:not(.emoji) { transform: scale(.8); }
  .pq-pg .sw-pack .sw-card .sw-box .sw-ico.emoji { width: 26px; height: 26px; font-size: 22px; line-height: 26px; }
  .pq-pg .sw-pack .sw-card .sw-pl { font-size: 12px; line-height: 1.05; }
  .pq-pg .sw-pack .sw-card .sw-ru { font-size: 10px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}
`;

/** «Najbliższe święto: Wigilia za 3 dni» (итог раунда, баннер). */
export function nearestLine(ctx: GameCtx): string | null {
  const near = nearestHoliday(ctx.units, ctx.date());
  return near ? `Najbliższe święto: ${shortName(near.unit)} ${inDays(near.days)}` : null;
}

/** Баннер над заданием — только у самого ближайшего праздника (сезон): на остальных заданиях он съедал место под варианты. */
function banner(ctx: GameCtx, id: string): HTMLElement | null {
  const date = ctx.date();
  const near = nearestHoliday(ctx.units, date);
  if (!near || near.unit.id !== id) return null;
  const board = frameIcon(`w2_season_board/${seasonFrame(date.m)}`, 1);
  const text = near
    ? el('span', { 'data-nearest-text': '' }, 'Najbliższe święto: ', el('b', {}, shortName(near.unit)), ` ${inDays(near.days)}`)
    : el('span', {}, 'Najbliższe święto: —');
  return el('div', { class: 'sw-near', 'data-nearest': near?.unit.id ?? '' }, board, text);
}

function card(it: ItemRef, tag: 'button' | 'div' = 'button', scale = 2): HTMLElement {
  return el(tag, { class: 'pq-btn sw-card', 'data-item': it.id, ...(tag === 'button' ? { type: 'button', 'data-nav': '' } : {}) }, el('span', { class: 'sw-box' }, itemIcon(it.id, scale)), el('span', { class: 'sw-pl' }, it.pl), el('span', { class: 'sw-ru' }, it.ru));
}

function renderPack(task: SwTask, panel: GamePanel): void {
  prompt(panel, task.q, task.hint);
  const sel = new Set<string>();
  const label = task.packKind === 'table' ? 'Na stole' : task.packKind === 'bag' ? 'W torbie' : 'W koszyku';
  const icon = el('span', { class: 'sw-ib' });
  const num = el('span', { 'data-count': '' }, '0');
  const strip = el('div', { class: 'sw-count' }, icon, label, ': ', num);
  const paintStrip = (): void => {
    icon.replaceChildren((task.packKind === 'table' ? atlasIcon(plantIconFrame('plate') ?? '', 1, 'sw-ico') : null) ?? frameIcon(sel.size ? 'w2_basket/1' : 'w2_basket/0', 1));
    num.textContent = String(sel.size);
  };
  const grid = el('div', { class: 'sw-pack', 'data-pack': '' });
  const done = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', disabled: true }, 'Gotowe · Готово');
  for (const it of task.items ?? []) {
    const c = card(it);
    c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', () => {
      if (sel.has(it.id)) sel.delete(it.id);
      else sel.add(it.id);
      c.classList.toggle('sel', sel.has(it.id));
      c.setAttribute('aria-pressed', String(sel.has(it.id)));
      done.disabled = sel.size === 0;
      paintStrip();
    });
    grid.append(c);
  }
  done.addEventListener('click', () => {
    if (!sel.size) return;
    const want = new Set(task.expect);
    for (const c of grid.querySelectorAll<HTMLElement>('[data-item]')) {
      const id = c.dataset.item!;
      c.classList.remove('sel');
      if (sel.has(id)) c.classList.add(want.has(id) ? 'right' : 'wrong');
      else if (want.has(id)) c.classList.add('miss');
    }
    panel.submit([...sel]);
  });
  paintStrip();
  panel.body.append(strip, grid);
  panel.foot.replaceChildren(done);
}

export const game: PolskaGame<SwTask> = {
  id: 'swieta',
  title: { pl: 'Święta', ru: 'Праздники' },
  desc: 'Праздники года: когда, что делают, что кладут в корзинку и на стол, что желают и открыты ли магазины',
  entry: 'seasonBoard',
  plot: 'klumba',
  kinds: ['holiday'],
  layout: 'panel',

  pool(ctx) {
    return seasonalOrder(ctx.units, ctx.date());
  },

  nextTask(ctx, want) {
    const u = ctx.unit(want.id);
    return u ? pickTask(ctx, u, want) : null;
  },

  render(task, panel, ctx) {
    const b = banner(ctx, task.id);
    panel.body.append(el('style', {}, css));
    if (b) panel.body.append(b);
    switch (task.kind) {
      case 'what': {
        prompt(panel, task.q, task.hint, task.qLang);
        if (task.clue?.length) panel.body.append(el('div', { class: 'sw-clue', 'data-clue': '' }, ...task.clue.map((id) => card(itemWord(id), 'div', 3))));
        if (task.big) panel.body.append(el('div', { class: 'sw-big', 'data-big': '', lang: 'pl' }, task.big));
        choice(panel, task.options ?? [], task.answer);
        return;
      }
      case 'when':
      case 'shops':
        prompt(panel, task.q, task.hint, task.qLang);
        choice(panel, task.options ?? [], task.answer);
        return;
      case 'pack':
        renderPack(task, panel);
        return;
      case 'wish':
        prompt(panel, task.q, task.hint, task.qLang);
        tiles(panel, task.tiles ?? []);
        return;
    }
  },

  summaryLine: nearestLine,

  check(task, answer): GameCheck {
    const say = task.say;
    const rest = { ...(say ? { say } : {}), ...(task.note ? { note: task.note } : {}) };
    if (task.kind === 'pack') {
      const picked = Array.isArray(answer) ? answer.map(String) : [];
      const want = new Set(task.expect);
      const got = new Set(picked);
      const extra = [...got].filter((id) => !want.has(id));
      const missing = [...want].filter((id) => !got.has(id));
      const ok = picked.length > 0 && !extra.length && !missing.length;
      const names = (ids: string[]): string => ids.map((id) => itemWord(id).pl).join(', ');
      const note = ok ? undefined : [extra.length ? `Лишнее: ${names(extra)}` : '', missing.length ? `Не хватило: ${names(missing)}` : ''].filter(Boolean).join(' · ');
      return { ok, correct: task.correct, ...(note ? { note } : {}), ...(say ? { say } : {}) };
    }
    if (task.kind === 'wish') {
      const given = Array.isArray(answer) ? answer.map(String) : String(answer ?? '').split(/\s+/).filter(Boolean);
      return { ok: sameTiles(given, task.expectTiles ?? []), correct: task.correct, ...rest };
    }
    return { ok: String(answer) === task.answer, correct: task.correct, ...rest };
  },
};
