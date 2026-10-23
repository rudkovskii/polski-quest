// Geografia: уровни карты (решение Шэфа 23.10.2026: «идти по уровням — сначала города и природа, потом соседи, потом парки…»).
// Список уровней — `levels` в `content/v2/geografia.json`; уровень единицы — по её `type` (или полю `level`). Экран уровней — `hub` игры:
// большая кнопка «Dalej» на рекомендованный уровень, ниже карточки уровней с прогрессом. Раунд уровня — `begin(ids, 10)`: движок сажает
// из уровня по порядку (свои ≤ 8 растущих) и спрашивает только его единицы (плюс перезревшие из других уровней).
// Замок мягкий: уровень открыт, если он первый, в нём уже что-то посажено, его открыли кнопкой «Otwórz teraz» (флаг `geo.level.<n>`)
// или в предыдущем непустом уровне OPEN_SHARE единиц дошли до кустика.
import type { GameCtx, GamePanel, PolskaUnit } from '../../types/polska';
import { el } from '../../ui/dom';

export interface GeoLevel {
  n: number;
  id: string;
  pl: string;
  ru: string;
  types: readonly string[];
}

/** Если в данных нет `levels` (старая копия, тестовый фейк): тот же порядок, что в geografia.json. */
export const DEFAULT_LEVELS: readonly GeoLevel[] = [
  { n: 1, id: 'miasta', pl: 'Miasta i przyroda', ru: 'Города, реки, горы и море', types: ['city', 'river', 'mountain', 'sea', 'nature'] },
  { n: 2, id: 'sasiedzi', pl: 'Sąsiedzi', ru: 'Соседи Польши и «граничит с…»', types: ['neighbor'] },
  { n: 3, id: 'parki', pl: 'Parki narodowe', ru: 'Национальные парки', types: ['park'] },
  { n: 4, id: 'unesco', pl: 'UNESCO', ru: 'Всемирное наследие ЮНЕСКО', types: ['unesco'] },
  { n: 5, id: 'wojewodztwa', pl: 'Województwa', ru: 'Воеводства и их столицы', types: ['region'] },
];

/** Доля единиц предыдущего уровня на стадии «кустик» и дальше, с которой открывается следующий. */
export const OPEN_SHARE = 0.6;
/** Длина раунда уровня. */
export const LEVEL_ROUND = 10;
export const levelFlag = (n: number): string => `geo.level.${n}`;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function levelsOf(doc: Readonly<Record<string, unknown>> | undefined): GeoLevel[] {
  const raw = doc && Array.isArray(doc.levels) ? (doc.levels as Record<string, unknown>[]) : [];
  const out: GeoLevel[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || typeof x.n !== 'number' || !Array.isArray(x.types)) continue;
    out.push({ n: x.n, id: str(x.id) || `l${x.n}`, pl: str(x.pl), ru: str(x.ru), types: (x.types as unknown[]).filter((t): t is string => typeof t === 'string') });
  }
  return out.length ? out.sort((a, b) => a.n - b.n) : [...DEFAULT_LEVELS];
}

/** Номер уровня единицы: поле `level` в данных, иначе по типу; 0 — ни в одном уровне. */
export function levelOf(u: PolskaUnit, levels: readonly GeoLevel[]): number {
  if (typeof u.raw.level === 'number' && levels.some((l) => l.n === u.raw.level)) return u.raw.level;
  return levels.find((l) => l.types.includes(u.type))?.n ?? 0;
}

/** Порядок посадки внутри набора: по полосам (`band`), внутри полосы виды чередуются (город, река, гора…), чтобы первые семена были разными. */
export function plantOrder(units: readonly PolskaUnit[]): string[] {
  const out: string[] = [];
  const bands = [...new Set(units.map((u) => u.band))].sort((a, b) => a - b);
  const order = ['city', 'river', 'neighbor', 'mountain', 'sea', 'park', 'unesco', 'region', 'nature'];
  const rank = (t: string): number => (order.indexOf(t) + 100) % 100;
  for (const b of bands) {
    const by = new Map<string, PolskaUnit[]>();
    for (const u of units.filter((x) => x.band === b)) by.set(u.type, [...(by.get(u.type) ?? []), u]);
    const types = [...by.keys()].sort((a, c) => rank(a) - rank(c));
    for (let i = 0; types.some((t) => (by.get(t)?.length ?? 0) > i); i++) for (const t of types) if (by.get(t)![i]) out.push(by.get(t)![i]!.id);
  }
  return out;
}

export type LevelWhy = 'first' | 'started' | 'manual' | 'prev' | 'locked' | 'empty';

export interface LevelView {
  level: GeoLevel;
  /** Единицы уровня в порядке посадки. */
  ids: string[];
  total: number;
  /** Посажено или уже был ответ. */
  planted: number;
  /** Кустик и дальше (в т. ч. собранные). */
  bush: number;
  /** Урожай собран хотя бы раз. */
  grown: number;
  /** bush / total. */
  share: number;
  open: boolean;
  why: LevelWhy;
  /** Для закрытого: уровень, от которого он зависит. */
  after: LevelView | null;
}

export function levelViews(ctx: Pick<GameCtx, 'units' | 'info' | 'doc' | 'flag'>): LevelView[] {
  const levels = levelsOf(ctx.doc);
  const views: LevelView[] = [];
  let prev: LevelView | null = null;
  for (const level of levels) {
    const units = ctx.units.filter((u) => levelOf(u, levels) === level.n);
    let planted = 0;
    let bush = 0;
    let grown = 0;
    for (const u of units) {
      const i = ctx.info(u.id);
      if (i.planted || i.stage !== null || i.harvests > 0 || (i.answers ?? 0) > 0) planted++;
      if (i.harvests > 0 || i.stage === 'bush' || i.stage === 'ripe' || i.stage === 'overripe') bush++;
      if (i.harvests > 0) grown++;
    }
    const total = units.length;
    const share = total ? bush / total : 0;
    let why: LevelWhy;
    if (!total) why = 'empty';
    else if (!prev) why = 'first';
    else if (planted > 0) why = 'started';
    else if (ctx.flag?.(levelFlag(level.n))) why = 'manual';
    else if (prev.share >= OPEN_SHARE) why = 'prev';
    else why = 'locked';
    const v: LevelView = { level, ids: plantOrder(units), total, planted, bush, grown, share, open: why !== 'locked' && why !== 'empty', why, after: why === 'locked' ? prev : null };
    views.push(v);
    if (total) prev = v;
  }
  return views;
}

/** Рекомендованный уровень: первый открытый, где ещё не всё дошло до кустика; иначе первый открытый, где не всё собрано; иначе первый открытый. */
export function nextLevel(views: readonly LevelView[]): LevelView | null {
  const open = views.filter((v) => v.open);
  return open.find((v) => v.bush < v.total) ?? open.find((v) => v.grown < v.total) ?? open[0] ?? null;
}

const pct = (x: number): number => Math.round(x * 100);

export const LEVELS_CSS = `
.pq-pg .geo-lvls { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 640px; margin: 0 auto; box-sizing: border-box; padding: 2px 10px 6px; }
.pq-pg.full .paper > .geo-lvls.geo-lvls { margin-left: auto; margin-right: auto; }
.pq-pg .geo-lvls .pq-q { margin-bottom: 0; }
.pq-pg .geo-go { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; padding: 10px 14px; font-size: 18px; }
.pq-pg .geo-go small { font-size: 13px; font-weight: 600; opacity: .8; }
.pq-pg .geo-lv { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; padding: 8px 10px; background: #fffaf0;
  border: 2px solid var(--pq-wood-dark); border-radius: 8px; }
.pq-pg .geo-lv.next { border-color: var(--pq-accent); box-shadow: 0 0 0 2px var(--pq-accent); }
.pq-pg .geo-lv.locked, .pq-pg .geo-lv.empty { background: #efe6d0; }
.pq-pg .geo-lv.empty { opacity: .7; }
.pq-pg .geo-lv-n { grid-column: 1; grid-row: 1 / span 3; align-self: start; display: grid; place-items: center; width: 32px; height: 32px; border: 2px solid var(--pq-ink); border-radius: 50%;
  font-weight: 800; font-size: 16px; background: #f2dcae; }
.pq-pg .geo-lv.open .geo-lv-n { background: #b8d86a; }
.pq-pg .geo-lv-nm { grid-column: 2; grid-row: 1; min-width: 0; line-height: 1.15; }
.pq-pg .geo-lv-bar, .pq-pg .geo-lv-st { grid-column: 2; }
.pq-pg .geo-lv-nm b { font-size: 17px; font-weight: 800; }
.pq-pg .geo-lv-nm small { display: block; font-size: 13px; opacity: .72; }
.pq-pg .geo-lv .pq-btn { grid-column: 3; grid-row: 1 / span 3; align-self: center; margin: 0; padding: 6px 10px; font-size: 14px; white-space: nowrap; }
.pq-pg .geo-lv-bar { position: relative; height: 10px; border: 2px solid var(--pq-ink); border-radius: 3px; background: #e8dcc0; overflow: hidden; }
.pq-pg .geo-lv-bar > i { position: absolute; top: 0; bottom: 0; left: 0; }
.pq-pg .geo-lv-bar > .pl { background: #d9e8a8; } .pq-pg .geo-lv-bar > .bu { background: #4f9a3c; } .pq-pg .geo-lv-bar > .gr { background: #f2c230; }
.pq-pg .geo-lv-st { font-size: 12px; opacity: .8; line-height: 1.25; }
@media (max-width: 519px) { .pq-pg .geo-lvls { gap: 6px; } .pq-pg .geo-lv { grid-template-columns: 28px minmax(0, 1fr) auto; gap: 3px 8px; padding: 6px 8px; }
  .pq-pg .geo-lv-n { width: 24px; height: 24px; font-size: 13px; } .pq-pg .geo-lv-nm b { font-size: 16px; } .pq-pg .geo-lv-nm small { font-size: 12px; }
  .pq-pg .geo-lv .pq-btn { padding: 5px 8px; font-size: 13px; } .pq-pg .geo-go { font-size: 16px; padding: 8px 12px; } }
`;

function stateLine(v: LevelView): string {
  if (v.why === 'empty') return 'Скоро: данные готовятся';
  if (v.why === 'locked' && v.after) return `Откроется при ${pct(OPEN_SHARE)} % кустиков в уровне ${v.after.level.n} (сейчас ${pct(v.after.share)} %)`;
  return `${v.total} · посажено ${v.planted} · кустиков ${v.bush} · собрано ${v.grown}`;
}

/** Экран уровней (`PolskaGame.hub`). */
export function renderLevels(panel: GamePanel, ctx: GameCtx, begin: (ids: readonly string[], size: number) => void): void {
  const draw = (): void => {
    const views = levelViews(ctx);
    const next = nextLevel(views);
    const root = el('div', { class: 'geo-lvls', 'data-hub': '', 'data-geo-levels': '' }, el('style', {}, LEVELS_CSS));
    root.append(el('div', { class: 'pq-q', lang: 'pl' }, 'Poziomy'), el('div', { class: 'pq-q-hint' }, `Уровни карты · раунд из ${LEVEL_ROUND} заданий`));
    if (next) {
      root.append(
        el(
          'button',
          { type: 'button', class: 'pq-btn geo-go', 'data-nav': '', 'data-level-go': String(next.level.n), onclick: () => begin(next.ids, LEVEL_ROUND) },
          el('span', {}, `▶ Dalej: poziom ${next.level.n} · `, el('span', { lang: 'pl' }, next.level.pl)),
          el('small', {}, next.level.ru),
        ),
      );
    }
    for (const v of views) {
      const state = v.why === 'empty' ? 'empty' : v.open ? 'open' : 'locked';
      const bar = el(
        'div',
        { class: 'geo-lv-bar', 'aria-hidden': 'true' },
        el('i', { class: 'pl', style: `width:${v.total ? pct(v.planted / v.total) : 0}%` }),
        el('i', { class: 'bu', style: `width:${pct(v.share)}%` }),
        el('i', { class: 'gr', style: `width:${v.total ? pct(v.grown / v.total) : 0}%` }),
      );
      let btn: HTMLElement | null = null;
      if (v.open) btn = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-level-play': String(v.level.n), onclick: () => begin(v.ids, LEVEL_ROUND) }, '▶ Graj');
      else if (v.why === 'locked')
        btn = el(
          'button',
          {
            type: 'button',
            class: 'pq-btn',
            'data-nav': '',
            'data-level-open': String(v.level.n),
            onclick: () => {
              ctx.setFlag?.(levelFlag(v.level.n));
              if (!ctx.setFlag) begin(v.ids, LEVEL_ROUND);
              else draw();
            },
          },
          'Otwórz teraz',
        );
      root.append(
        el(
          'div',
          { class: `geo-lv ${state}${next === v ? ' next' : ''}`, 'data-level': String(v.level.n), 'data-state': state },
          el('span', { class: 'geo-lv-n' }, String(v.level.n)),
          el('div', { class: 'geo-lv-nm' }, el('b', { lang: 'pl' }, v.level.pl), el('small', {}, v.level.ru)),
          btn,
          v.total ? bar : null,
          el('div', { class: 'geo-lv-st' }, stateLine(v)),
        ),
      );
    }
    panel.body.replaceChildren(root);
    panel.foot.replaceChildren();
  };
  draw();
}
