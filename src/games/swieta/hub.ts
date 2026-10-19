// Игра «Święta»: экран игры — колесо года (12 месяцев по кругу, праздники значками на своих датах, стрелка «сегодня», ближайший праздник
// подсвечен, тип цветом) и карточка знакомства «Poznaj święto». Тап по значку выбирает праздник; «Graj» ведёт раунд про него одного.
// Первый раз раунду предшествует карточка (картина, справка, обычаи, пожелание), потом она открывается с колеса кнопкой «ℹ Справка».
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import { ABOUT_CSS, aboutBlock } from './about';
import type { GameCtx, GamePanel, PolskaUnit } from '../../types/polska';
import { fmtSpan, inDays, nearestHoliday, nextSpan, nextSpanOfWhen, seasonFrame, shortName, upcoming, WEEKDAY_PL, weekdayOf, dayNo, type Span } from './calendar';
import { FRAMES, WORD_FRAME, frameIcon, itemIcon, itemWord } from './icons';
import { creditLine, picCss, picFrame } from './pic';
import { buildRound, clearSession, startSession } from './plan';
import { boldRuns, isFirst, sentences, shopsLine, shortIntro } from './story';
import { customsOf, packSpec } from './tasks';
import { resetSheet } from './view';
import { CLASSES, CLASS_INFO, GROWTH_LABEL, MARK_UNITS, TRACKS, growthOf, markerOfUnit, monthAngle, parseWheel, placeMarkers, todayAngle, type Marker, type WheelNode } from './wheel';

const MONTHS = ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAŹ', 'LIS', 'GRU'] as const;

/** Значок праздника без единицы или с неудачным первым предметом (высокие кадры не лезут в рамку). */
const NODE_ITEM: Readonly<Record<string, string>> = {
  popielec: 'sw.procesja',
  '1-sierpnia': 'sw.cmentarz',
  '11-listopada': 'sw.flaga',
  '1-maja': 'sw.grill',
  '2-maja': 'sw.flaga',
  '3-maja': 'sw.flaga',
};
const isTall = (id: string): boolean => {
  const k = WORD_FRAME[id];
  return !!k && FRAMES[k].h > FRAMES[k].w;
};
export function nodeItem(node: WheelNode, unit: PolskaUnit | null): string {
  const own = NODE_ITEM[node.id];
  if (own) return own;
  const clue = Array.isArray(unit?.raw.clue) ? (unit!.raw.clue as string[]) : [];
  return clue.find((id) => !isTall(id)) ?? clue[0] ?? 'w.kwiat';
}

const CENTER_R = 17;
const NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number>, ...kids: (Node | string)[]): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  n.append(...kids);
  return n as SVGElement;
}
const pt = (r: number, a: number): [number, number] => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)];
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

export const css = `
.pq-pg .sw-hub { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 100%; }
.pq-pg.full .paper > .sw-hub.sw-hub.sw-hub { margin-left: 0; margin-right: 0; }
.pq-pg .sw-wheel { --ico: 1; position: relative; flex: 0 0 auto; width: min(100%, calc(100dvh - 350px)); min-width: 250px; aspect-ratio: 1; }
.pq-pg .sw-wheel > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; shape-rendering: geometricPrecision; font-family: inherit; }
.pq-pg .sw-side { width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 0 8px; }
.pq-pg .sw-mk { position: absolute; box-sizing: border-box; width: calc(16px * var(--ico) + 14px); height: calc(16px * var(--ico) + 14px); margin: 0; padding: 0; display: grid; place-items: center;
  transform: translate(-50%, -50%); background: #fff4d6; border: 3px solid var(--mc, #888); border-radius: 7px; cursor: pointer; touch-action: manipulation; color: var(--pq-ink);
  box-shadow: 0 0 0 2px var(--pq-ink), 0 3px 0 2px var(--pq-ink); font: inherit; }
.pq-pg .sw-mk:active { transform: translate(-50%, -48%); }
.pq-pg .sw-mk .sw-mi { display: block; width: 16px; height: 16px; transform: scale(var(--ico)); transform-origin: center; pointer-events: none; }
.pq-pg .sw-mk .sw-mi .sw-ico { display: block; }
.pq-pg .sw-mk.info { background: #efe4c4; border-style: dashed; }
.pq-pg .sw-mk.sel { z-index: 6; transform: translate(-50%, -50%) scale(1.22); background: #fffaf0; box-shadow: 0 0 0 3px var(--pq-ink), 0 0 0 6px #fffaf0, 0 0 0 8px var(--pq-ink); }
.pq-pg .sw-mk.near::after { content: ''; position: absolute; inset: -8px; border: 3px solid var(--pq-accent); border-radius: 10px; animation: sw-blink 1.1s steps(2, jump-none) infinite; pointer-events: none; }
@keyframes sw-blink { 0% { opacity: 1; } 100% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .pq-pg .sw-mk.near::after { animation: none; } }
.pq-pg .sw-mk .sw-pip { position: absolute; right: -7px; top: -7px; width: 11px; height: 11px; box-sizing: border-box; border: 2px solid var(--pq-ink); border-radius: 3px; background: var(--g, transparent); pointer-events: none; }
.pq-pg .sw-mk[data-growth='new'] .sw-pip, .pq-pg .sw-mk.info .sw-pip { display: none; }
.pq-pg .sw-mk[data-growth='seed'] { --g: #b08a5a; } .pq-pg .sw-mk[data-growth='sprout'] { --g: #b8d86a; }
.pq-pg .sw-mk[data-growth='bush'] { --g: #4f9a3c; } .pq-pg .sw-mk[data-growth='ripe'] { --g: #f2c230; }
.pq-pg .sw-mk .sw-c2 { position: absolute; left: -6px; bottom: -6px; width: 9px; height: 9px; box-sizing: border-box; border: 2px solid var(--pq-ink); border-radius: 2px; background: var(--c2, transparent); pointer-events: none; }
.pq-pg .sw-near { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 2px 8px 2px 2px; text-align: left; color: var(--pq-ink); background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; }
.pq-pg .sw-near b { font-weight: 800; }
.pq-pg .sw-sel { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 10px; padding: 8px; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; }
.pq-pg .sw-sel .sw-hd { min-width: 0; }
.pq-pg .sw-sel .sw-sub { grid-column: 1 / -1; }
.pq-pg .sw-sel .sw-th { display: flex; align-items: center; justify-content: center; align-self: start; width: 78px; min-height: 58px; background: #f2dcae; border: 2px solid var(--pq-wood-dark); border-radius: 4px; box-sizing: border-box; }
.pq-pg .sw-sel .sw-th .sw-frame { width: 100%; min-width: 0; border-width: 2px; outline-width: 1px; box-shadow: none; }
.pq-pg .sw-sel .sw-nm { font-size: 17px; font-weight: 800; line-height: 1.15; overflow-wrap: anywhere; }
.pq-pg .sw-sel .sw-rn { font-size: 13px; opacity: .72; line-height: 1.2; }
.pq-pg .sw-sel .sw-mt { font-size: 13px; margin-top: 3px; line-height: 1.3; }
.pq-pg .sw-sel .sw-gr { font-size: 12.5px; margin-top: 3px; color: #4a6b2a; font-weight: 700; }
.pq-pg .sw-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.pq-pg .sw-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; padding: 1px 6px 1px 4px; background: #fff4d6; border: 2px solid var(--pq-ink); border-radius: 5px; white-space: nowrap; }
.pq-pg .sw-tag i { width: 9px; height: 9px; background: var(--c, #888); border: 1.5px solid var(--pq-ink); display: inline-block; }
.pq-pg .sw-tag.off i { background: transparent; }
.pq-pg .sw-legend { display: flex; flex-wrap: wrap; gap: 4px 6px; justify-content: center; }
.pq-pg .sw-legend .sw-tag { cursor: default; font: inherit; font-size: 11.5px; font-weight: 700; color: var(--pq-ink); }
.pq-pg .sw-legend button.sw-tag { cursor: pointer; }
@media (max-width: 520px) {
  .pq-pg .sw-wheel { width: min(100%, calc(100dvh - 475px)); }
  .pq-pg .sw-near { font-size: 12px; gap: 6px; }
  .pq-pg .sw-hub { gap: 6px; }
  .pq-pg .sw-side { gap: 6px; }
  .pq-pg .sw-sel { grid-template-columns: 64px minmax(0, 1fr); gap: 4px 8px; padding: 6px 8px; }
  .pq-pg .sw-sel .sw-th { width: 64px; min-height: 48px; }
  .pq-pg .sw-sel .sw-nm { font-size: 16px; }
  .pq-pg .sw-sel .sw-mt { margin-top: 1px; }
  .pq-pg .sw-sel .sw-tags { margin-top: 0; }
  .pq-pg .sw-sel .sw-gr { margin-top: 2px; }
  /* Раскрытое «О празднике» занимает место баннера, легенды и строки чипов: страница не прокручивается, листается сам текст. */
  .pq-pg .sw-hub.about-open .sw-near, .pq-pg .sw-hub.about-open .sw-legend, .pq-pg .sw-hub.about-open .sw-sel .sw-sub { display: none; }
}
@media (min-aspect-ratio: 13/10) and (min-width: 760px), (min-width: 1100px) and (min-height: 880px) {
  .pq-pg .sw-hub { flex-direction: row; gap: 22px; }
  .pq-pg .sw-wheel { width: min(60%, calc(100dvh - 176px)); }
  .pq-pg .sw-side { flex: 1 1 0; max-width: 430px; padding: 0; }
}
.pq-pg .sw-info { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px 20px; width: 100%; max-width: 600px; margin: 0 auto; padding: 6px 10px 4px; box-sizing: border-box; font-size: 14.5px; line-height: 1.35; }
.pq-pg .sw-info .sw-fig { min-width: 0; }
.pq-pg .sw-info .sw-fig .sw-frame { max-width: min(100%, 300px); margin: 0 auto; }
.pq-pg .sw-info .sw-fig .sw-credit { max-width: 300px; margin-left: auto; margin-right: auto; }
.pq-pg .sw-info .sw-bd { min-width: 0; display: flex; flex-direction: column; gap: 9px; }
.pq-pg .sw-info h2 { margin: 0; font-size: 23px; line-height: 1.12; font-weight: 800; overflow-wrap: anywhere; }
.pq-pg .sw-info .sw-ru2 { font-size: 14px; opacity: .72; margin-top: -4px; }
.pq-pg .sw-info .sw-dt { font-size: 14px; font-weight: 700; }
.pq-pg .sw-info .sw-game { font-size: 12.5px; padding: 3px 8px; background: #f2dcae; border: 2px dashed var(--pq-wood); border-radius: 6px; }
.pq-pg .sw-info p { margin: 0; }
.pq-pg .sw-info p b { font-weight: 800; color: #7a3a14; }
.pq-pg .sw-sec { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; }
.pq-pg .sw-info h3.sw-hist { margin: 4px 0 -4px; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .65; font-weight: 800; }
.pq-pg .sw-sec h3 { margin: 0; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .65; font-weight: 800; }
.pq-pg .sw-sec .sw-pltxt { font-style: italic; }
.pq-pg .sw-row { display: flex; align-items: flex-start; gap: 6px; }
.pq-pg .sw-row > :first-child { flex: 1 1 auto; min-width: 0; }
.pq-pg .sw-ln b { display: block; font-weight: 800; }
.pq-pg .sw-ln span { display: block; font-size: 12.5px; opacity: .72; }
.pq-pg .sw-items { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 12.5px; }
.pq-pg .sw-items span { display: inline-flex; align-items: center; gap: 3px; }
.pq-pg .sw-wishline { font-size: 18px; font-weight: 800; }
@media (min-width: 900px) {
  .pq-pg .sw-info .sw-fig .sw-frame { max-width: 400px; }
  .pq-pg .sw-info .sw-fig .sw-credit { max-width: 400px; }
  .pq-pg .sw-info { max-width: 1040px; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); align-items: start; }
}
@media (max-width: 520px), (max-height: 860px) {
  .pq-pg .sw-info { font-size: 14px; gap: 8px; }
  .pq-pg .sw-info h2 { font-size: 20px; }
}
`;

// ---------- сведения об узле ----------

const todayNo = (ctx: GameCtx): number => {
  const d = ctx.date();
  return dayNo(d.y, d.m, d.d);
};

/** «1.11 (poniedziałek)» / «28.03.2027»: дата узла по его собственным данным. */
function dateText(span: Span | null): string {
  if (!span) return 'bez daty · без даты';
  const wd = span.movable ? ` (${WEEKDAY_PL[weekdayOf(span.start)]})` : '';
  return `${fmtSpan(span)}${wd}`;
}

function tagsOf(node: WheelNode): HTMLElement {
  const list = [node.cls, ...(node.cls2 ? [node.cls2] : [])];
  const box = el('div', { class: 'sw-tags' }, ...list.map((c) => el('span', { class: 'sw-tag', style: `--c:${CLASS_INFO[c].color}` }, el('i', {}), `${CLASS_INFO[c].pl} · ${CLASS_INFO[c].ru}`)));
  if (node.off) box.append(el('span', { class: 'sw-tag off' }, el('i', {}), 'wolne · выходной'));
  return box;
}

function rich(text: string): HTMLElement {
  return el('p', {}, ...boldRuns(text).map((r) => (r.b ? el('b', { lang: 'pl' }, r.t) : r.t)));
}

// ---------- карточка знакомства ----------

type CardMode = 'intro' | 'info';

function sayBtn(panel: GamePanel, text: string): HTMLElement {
  // Общая кнопка 🔊 (`ui/sayButton.ts`): не в рамке стрелок, клавиатура — клавиша G.
  return sayButton(text, panel.say);
}

export function buildCard(panel: GamePanel, ctx: GameCtx, node: WheelNode, unit: PolskaUnit | null, mode: CardMode): HTMLElement {
  const today = todayNo(ctx);
  const span = nextSpanOfNode(node, today);
  const fig = el('div', { class: 'sw-fig' });
  if (node.img) {
    fig.append(picFrame(node.img, node.pl));
    if (node.credit) fig.append(creditLine(node.credit));
  } else {
    fig.append(el('div', { class: 'sw-frame', style: 'display:flex;align-items:center;justify-content:center;min-height:120px;background:#f2dcae;line-height:1' }, itemIcon(nodeItem(node, unit), 4)));
  }
  const bd = el('div', { class: 'sw-bd' });
  const head = el('div', {}, el('div', { class: 'sw-row' }, el('h2', { lang: 'pl', 'data-card-name': '' }, node.pl), sayBtn(panel, node.pl)), node.ru ? el('div', { class: 'sw-ru2' }, node.ru) : null);
  const days = span ? Math.max(0, span.start - today) : null;
  bd.append(head, el('div', { class: 'sw-dt' }, dateText(span), days === null ? '' : ` · ${inDays(days)}`), tagsOf(node));
  if (unit) {
    const us = nextSpan(unit, today);
    if (shortName(unit) !== node.pl || fmtSpan(us ?? { start: 0, end: 0, movable: false }) !== fmtSpan(span ?? { start: 0, end: 0, movable: false })) {
      bd.append(el('div', { class: 'sw-game', 'data-ingame': '' }, 'В игре: ', el('b', { lang: 'pl' }, shortName(unit)), us ? ` · ${fmtSpan(us)}` : ''));
    }
  }
  // «О празднике»: контекст RU (польские слова жирным) и простые польские предложения, у каждого своя 🔊. Это и есть справка знакомства;
  // по кнопке «ℹ Справка» ниже добавляется история (`intro`): без повтора — они о разном. Узел без `about` показывает прежнюю справку.
  const about = node.about;
  if (about) bd.append(aboutBlock(about, panel.say, false));
  const intro = node.intro;
  if (intro && (mode === 'info' || !about)) {
    const ruText = mode === 'intro' ? [shortIntro(intro.ru)] : intro.ru;
    if (about) bd.append(el('h3', { class: 'sw-hist' }, 'Historia · История'));
    bd.append(el('div', { 'data-intro': '' }, ...ruText.map((t) => rich(t))));
    if (intro.pl.length) {
      const pl = mode === 'intro' ? sentences(intro.pl).slice(0, 2).join(' ') : intro.pl.join(' ');
      bd.append(el('div', { class: 'sw-sec', 'data-intro-pl': '' }, el('h3', {}, 'Po polsku'), el('div', { class: 'sw-row' }, el('div', { class: 'sw-pltxt', lang: 'pl' }, pl), sayBtn(panel, pl))));
    }
  } else if (!about && unit) {
    const note = unit.raw.note as { pl?: string; ru?: string } | undefined;
    if (note?.ru) bd.append(el('div', { 'data-intro': '' }, rich(note.ru)));
  }
  if (unit) {
    const customs = customsOf(unit);
    const list = mode === 'intro' ? customs.slice(0, 3) : customs;
    if (list.length)
      bd.append(
        el('div', { class: 'sw-sec', 'data-customs': '' }, el('h3', {}, 'Zwyczaje · Обычаи'), ...list.map((c) => el('div', { class: 'sw-row' }, el('div', { class: 'sw-ln' }, el('b', { lang: 'pl' }, c.pl), el('span', {}, c.ru)), sayBtn(panel, c.pl)))),
      );
    const pack = packSpec(unit);
    if (pack)
      bd.append(
        el(
          'div',
          { class: 'sw-sec', 'data-pack-strip': '' },
          el('h3', {}, `${pack.src === 'table' ? 'Na stole · На столе' : /torb/i.test(pack.title.pl) ? 'W torbie · В сумке' : 'W koszyku · В корзинке'}`),
          el('div', { class: 'sw-items' }, ...pack.in.map((id) => el('span', {}, itemIcon(id, 1), el('b', { lang: 'pl' }, itemWord(id).pl)))),
        ),
      );
    const shops = shopsLine(unit);
    if (shops) bd.append(el('div', { class: 'sw-sec', 'data-shops': '' }, el('h3', {}, 'Sklepy · Магазины'), el('div', { class: 'sw-row' }, el('div', { class: 'sw-ln' }, el('b', { lang: 'pl' }, shops.pl), el('span', {}, shops.ru)), sayBtn(panel, shops.pl))));
    const wish = unit.raw.wish as { pl?: string; ru?: string; situation?: { ru?: string } } | undefined;
    if (wish?.pl)
      bd.append(el('div', { class: 'sw-sec', 'data-wish': '' }, el('h3', {}, 'Mówimy · Говорим'), el('div', { class: 'sw-row' }, el('div', { class: 'sw-ln' }, el('div', { class: 'sw-wishline', lang: 'pl' }, wish.pl), el('span', {}, wish.ru ?? '')), sayBtn(panel, wish.pl))));
  }
  if (mode === 'info' && node.phrase)
    bd.append(
      el('div', { class: 'sw-sec', 'data-phrase': '' }, el('h3', {}, 'Fraza · Фраза'), el('div', { class: 'sw-row' }, el('div', { class: 'sw-ln' }, el('b', { lang: 'pl' }, node.phrase.pl), el('span', {}, node.phrase.tr), el('span', {}, node.phrase.ru)), sayBtn(panel, node.phrase.pl))),
    );
  return el('div', { class: 'sw-info', 'data-card': mode, 'data-node': node.id }, fig, bd);
}

const nextSpanOfNode = (node: WheelNode, today: number): Span | null => nextSpanOfWhen(node.when, today);

// ---------- колесо ----------

/** Праздник, с которого ушли в раунд: после итога «К колесу» он остаётся выбранным, а колесо показывает его прогресс. */
let returnTo: string | null = null;
export const forgetSelection = (): void => {
  returnTo = null;
};

function drawFace(date: { y: number; m: number; d: number }, markers: readonly Marker[]): SVGElement {
  const R_OUT = 98;
  const R_IN = 82;
  const g = svg('svg', { viewBox: '-100 -100 200 200', role: 'img', 'aria-label': 'Koło roku · Колесо года' });
  // кольцо месяцев
  for (let m = 0; m < 12; m++) {
    const a0 = monthAngle(date.y, m + 1);
    const a1 = m < 11 ? monthAngle(date.y, m + 2) : 360;
    const [x0, y0] = pt(R_OUT, a0);
    const [x1, y1] = pt(R_OUT, a1);
    const [x2, y2] = pt(R_IN, a1);
    const [x3, y3] = pt(R_IN, a0);
    const big = a1 - a0 > 180 ? 1 : 0;
    g.append(svg('path', { d: `M${f2(x0)},${f2(y0)}A${R_OUT},${R_OUT} 0 ${big} 1 ${f2(x1)},${f2(y1)}L${f2(x2)},${f2(y2)}A${R_IN},${R_IN} 0 ${big} 0 ${f2(x3)},${f2(y3)}Z`, fill: m % 2 ? '#5a3d2a' : '#6c4a33', stroke: '#2a1418', 'stroke-width': 1 }));
    const mid = (a0 + a1) / 2;
    const [tx, ty] = pt((R_IN + R_OUT) / 2, mid);
    const rot = mid > 90 && mid < 270 ? mid + 180 : mid;
    g.append(svg('text', { x: f2(tx), y: f2(ty), transform: `rotate(${f2(rot)} ${f2(tx)} ${f2(ty)})`, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#f7ecd2', 'font-size': 5.4, 'font-weight': 800, 'letter-spacing': 0.4 }, MONTHS[m]!));
  }
  g.append(svg('circle', { r: R_IN, fill: '#f7ecd2', stroke: '#2a1418', 'stroke-width': 1 }));
  for (const r of TRACKS) g.append(svg('circle', { r, fill: 'none', stroke: '#cdb98a', 'stroke-width': 0.7, 'stroke-dasharray': '1.2 2.4' }));
  // стрелка «сегодня»
  const ta = todayAngle(date);
  const [hx, hy] = pt(78, ta);
  const [t0x, t0y] = pt(R_IN + 7, ta);
  const [t1x, t1y] = pt(R_IN - 3, ta - 3.2);
  const [t2x, t2y] = pt(R_IN - 3, ta + 3.2);
  g.append(svg('line', { x1: 0, y1: 0, x2: f2(hx), y2: f2(hy), stroke: '#2a1418', 'stroke-width': 3.2, 'stroke-linecap': 'butt' }), svg('line', { x1: 0, y1: 0, x2: f2(hx), y2: f2(hy), stroke: '#d9782f', 'stroke-width': 1.5, 'stroke-linecap': 'butt', 'data-hand': '' }));
  g.append(svg('polygon', { points: `${f2(t0x)},${f2(t0y)} ${f2(t1x)},${f2(t1y)} ${f2(t2x)},${f2(t2y)}`, fill: '#d9782f', stroke: '#2a1418', 'stroke-width': 1, 'stroke-linejoin': 'miter', 'data-today': '' }));
  // выводы к кольцу и метки дат
  for (const m of markers) {
    const color = CLASS_INFO[m.node.cls].color;
    const [a0x, a0y] = pt(R_IN - 1, m.angle);
    const [b0x, b0y] = pt(R_IN + 6, m.angle);
    if (m.track > 0) {
      const [lx, ly] = pt(m.r + MARK_UNITS / 2, m.angle);
      g.append(svg('line', { x1: f2(lx), y1: f2(ly), x2: f2(a0x), y2: f2(a0y), stroke: color, 'stroke-width': 0.8, opacity: 0.7 }));
    }
    g.append(svg('line', { x1: f2(a0x), y1: f2(a0y), x2: f2(b0x), y2: f2(b0y), stroke: '#2a1418', 'stroke-width': 2.4 }), svg('line', { x1: f2(a0x), y1: f2(a0y), x2: f2(b0x), y2: f2(b0y), stroke: color, 'stroke-width': 1.3 }));
  }
  // центр
  g.append(svg('circle', { r: CENTER_R, fill: '#46302a', stroke: '#2a1418', 'stroke-width': 1.2 }));
  g.append(svg('text', { y: -2, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#f7ecd2', 'font-size': 7.2, 'font-weight': 800 }, String(date.y)));
  g.append(svg('text', { y: 6.2, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#ffc27a', 'font-size': 3.9, 'font-weight': 700, 'data-today-label': '' }, `dziś ${date.d}.${String(date.m).padStart(2, '0')}`));
  return g;
}

function growthLine(ctx: GameCtx, unit: PolskaUnit | null): string {
  if (!unit) return 'Только справка: вопросов по этому дню в игре нет';
  const info = ctx.info(unit.id);
  const g = growthOf(info);
  if (g === 'new') return GROWTH_LABEL.new;
  if (g === 'ripe') return `${GROWTH_LABEL.ripe} · вернётся повторить, когда придёт срок`;
  return `🌱 ${GROWTH_LABEL[g]} · ${info.next}`;
}

export function renderHub(panel: GamePanel, ctx: GameCtx, begin: (id: string, size: number) => void): void {
  const box = panel.root?.querySelector<HTMLElement>('.box') ?? null;
  box?.style.removeProperty('width');
  clearSession();
  resetSheet();
  const date = ctx.date();
  const today = dayNo(date.y, date.m, date.d);
  const nodes = parseWheel(ctx.doc, ctx.units);
  const { placed, undated } = placeMarkers(nodes, ctx.units, date);
  const near = nearestHoliday(ctx.units, date);
  const nearM = near ? markerOfUnit(placed, near.unit.id) : null;
  // С чего начинаем, если игрок не выбирал сам: ближайший из ещё не выращенных.
  const order = upcoming(ctx.units, today);
  const first = order.find((x) => ctx.info(x.unit.id).harvests === 0) ?? order[0];
  const defM = first ? markerOfUnit(placed, first.unit.id) : null;
  const all = [...placed.map((m) => m.node), ...undated];
  let selId = returnTo && all.some((n) => n.id === returnTo) ? returnTo : (defM?.node.id ?? placed[0]?.node.id ?? all[0]?.id ?? '');
  returnTo = null;
  const markerOf = (id: string): Marker | null => placed.find((m) => m.node.id === id) ?? null;
  const unitOf = (n: WheelNode): PolskaUnit | null => (n.unit ? (ctx.unit(n.unit) ?? null) : null);

  const hub = el('div', { class: 'sw-hub', 'data-hub': '' });
  const wheel = el('div', { class: 'sw-wheel', 'data-wheel': '', style: '--ico:1' });
  wheel.append(drawFace(date, placed));
  const buttons = new Map<string, HTMLElement>();
  for (const m of placed) {
    const n = m.node;
    const u = m.unit;
    const b = el(
      'button',
      {
        type: 'button',
        class: `sw-mk${u ? '' : ' info'}${nearM?.node.id === n.id ? ' near' : ''}`,
        'data-nav': '',
        'data-node': n.id,
        'data-class': n.cls,
        ...(u ? { 'data-unit': u.id, 'data-growth': growthOf(ctx.info(u.id)) } : {}),
        'aria-label': `${n.pl}, ${dateText(m.span)}`,
        style: `left:${f2(50 + m.x / 2)}%;top:${f2(50 + m.y / 2)}%;--mc:${CLASS_INFO[n.cls].color}${n.cls2 ? `;--c2:${CLASS_INFO[n.cls2].color}` : ''}`,
        onclick: () => select(n.id),
      },
      el('span', { class: 'sw-mi' }, itemIcon(nodeItem(n, u), 1)),
      el('i', { class: 'sw-pip' }),
      n.cls2 ? el('i', { class: 'sw-c2' }) : null,
    );
    buttons.set(n.id, b);
    wheel.append(b);
  }
  // Размер значков по размеру колеса: целый масштаб иконки, чтобы пиксели не мылились.
  const resize = (): void => {
    const w = wheel.clientWidth;
    if (!w) return;
    wheel.style.setProperty('--ico', String(Math.max(1, Math.round(((w * MARK_UNITS) / 200 - 14) / 16))));
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => (wheel.isConnected ? resize() : ro.disconnect()));
    ro.observe(wheel);
  }

  const side = el('div', { class: 'sw-side' });
  const banner = near
    ? el(
        'button',
        { type: 'button', class: 'sw-near', 'data-nav': '', 'data-nearest': near.unit.id, onclick: () => nearM && select(nearM.node.id) },
        frameIcon(`w2_season_board/${seasonFrame(date.m)}`, 1),
        el('span', { 'data-nearest-text': '' }, 'Najbliższe święto: ', el('b', {}, shortName(near.unit)), ` ${inDays(near.days)}`),
      )
    : null;
  const sel = el('div', { class: 'sw-sel', 'data-sel': '' });
  const legend = el('div', { class: 'sw-legend', 'data-legend': '' }, ...CLASSES.map((c) => el('span', { class: 'sw-tag', style: `--c:${CLASS_INFO[c].color}` }, el('i', {}), CLASS_INFO[c].pl)));
  for (const n of undated) {
    legend.append(
      el('button', { type: 'button', class: 'sw-tag', 'data-nav': '', 'data-node': n.id, 'data-undated': '', onclick: () => select(n.id) }, '✿ ', n.pl, ' · без даты'),
    );
  }
  side.append(...(banner ? [banner] : []), sel, legend);
  hub.append(wheel, side);
  panel.body.append(el('style', {}, css + ABOUT_CSS + picCss), hub);

  const nodeOf = (id: string): WheelNode | undefined => all.find((n) => n.id === id);

  function paintSel(): void {
    const n = nodeOf(selId);
    if (!n) return;
    const m = markerOf(n.id);
    const u = unitOf(n);
    const span = m?.span ?? null;
    const th = el('div', { class: 'sw-th' });
    if (n.img) th.append(picFrame(n.img, n.pl, 96, 72));
    else th.append(itemIcon(nodeItem(n, u), 3));
    hub.classList.remove('about-open');
    sel.replaceChildren(
      th,
      el(
        'div',
        { class: 'sw-hd' },
        el('div', { class: 'sw-row' }, el('div', { class: 'sw-nm', lang: 'pl', 'data-sel-name': '' }, n.pl), sayButton(n.pl, panel.say)),
        n.ru ? el('div', { class: 'sw-rn' }, n.ru) : null,
        el('div', { class: 'sw-mt' }, span ? `${dateText(span)} · ${inDays(Math.max(0, span.start - today))}` : 'bez daty · без даты'),
      ),
      el('div', { class: 'sw-sub' }, tagsOf(n), el('div', { class: 'sw-gr', 'data-growth-line': '' }, growthLine(ctx, u))),
      ...(n.about ? [aboutBlock(n.about, panel.say, true, (open) => hub.classList.toggle('about-open', open))] : []),
    );
    for (const [id, b] of buttons) {
      const on = id === n.id;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', String(on));
    }
    paintFoot();
  }

  function select(id: string): void {
    selId = id;
    paintSel();
  }

  function goRound(n: WheelNode, u: PolskaUnit, firstTime: boolean): void {
    // Флаг «знакомство принято» ставится только по «Rozumiem · Понятно», не при открытии карточки.
    if (firstTime) ctx.markSeen(u.id);
    const tasks = buildRound(ctx, u, n, firstTime);
    startSession(u.id, tasks);
    returnTo = n.id;
    resetSheet();
    begin(u.id, tasks.length || 1);
  }

  function showCard(n: WheelNode, mode: CardMode): void {
    const u = unitOf(n);
    box?.style.removeProperty('width');
    panel.body.replaceChildren(el('style', {}, css + ABOUT_CSS + picCss), el('div', { class: 'sw-hub', 'data-hub-card': '' }, buildCard(panel, ctx, n, u, mode)));
    panel.body.scrollTop = 0;
    const back = el('button', { type: 'button', class: 'pq-btn', style: 'flex:0 0 auto', 'data-nav': '', 'data-back': '', 'aria-label': 'К колесу', onclick: () => draw() }, '‹ Koło');
    const go = u
      ? el(
          'button',
          { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-start': '', onclick: () => goRound(n, u, mode === 'intro') },
          mode === 'intro' ? 'Rozumiem · Понятно →' : 'Graj · Играть →',
        )
      : null;
    panel.foot.replaceChildren(back, ...(go ? [go] : []));
  }

  function paintFoot(): void {
    const n = nodeOf(selId);
    if (!n) return;
    const u = unitOf(n);
    const firstTime = !!u && isFirst(ctx, u.id);
    const info = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-info': '', onclick: () => showCard(n, 'info') }, 'ℹ Справка');
    if (!u) return void panel.foot.replaceChildren(info);
    if (firstTime) return void panel.foot.replaceChildren(el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-poznaj': '', onclick: () => showCard(n, 'intro') }, 'Poznaj · Знакомство →'));
    panel.foot.replaceChildren(info, el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-play': '', onclick: () => goRound(n, u, false) }, 'Graj · Играть →'));
  }

  function draw(): void {
    box?.style.removeProperty('width');
    panel.body.replaceChildren(el('style', {}, css + ABOUT_CSS + picCss), hub);
    paintSel();
    resize();
  }

  paintSel();
  requestAnimationFrame(resize);
}
