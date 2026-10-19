// Игра 1: Geografia («Mapa Polski», ФЕРМА_v2.md §2). Экран во весь размер: пиксельная карта Польши на canvas 2D, города точками,
// реки линиями. Задания: «Pokaż na mapie» (тап или курсор + A: мини-герой бежит к месту и втыкает флажок, кот рядом),
// «Co to za miasto?», «Nad jaką rzeką leży…?», «Z kim graniczy Polska na zachodzie?» (сосед + форма «z Niemcami»), столица воеводства,
// сторона света, падежные формы и сборка фраз из плиток (`want.self`).
import type { GameCheck, GameCtx, GamePanel, PolskaGame, PolskaUnit, Want } from '../../types/polska';
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import { choiceGrid } from './choice';
import { canvasSize, planFit, type FitPlan } from './fit';
import { createMap, type MapView } from './mapview';
import { checkTask, makeTask, statusOf, verdict, type DirAnswer, type GeoTask } from './tasks';
import { clusterOf, anchorOf, centroid, dist, MAP_H, MAP_W, type Pt } from './world';
import { prompt, tiles } from '../kit';

/** Высота кнопки варианта в полосе под картой и в узком окне (≥ 44 px под палец). */
const OPT_ROW = 46;
const OPT_ROW_NARROW = 48;
/** Ширина колонки вариантов справа от карты (когда так карта выходит крупнее). */
const SIDE_W = 232;
/** Запас под строку результата движка (`.fb`: ✓/правильно, ru · tr, прогресс), которая появляется под листом после ответа. */
const FB_H = 92;
/** Вторая ступень «сосед → форма» выше на строку вопроса. */
const STEP_H = 32;
/** Зазор между картой и блоком заданий, рамка карты (3 + 3 px). */
const GAP = 8;
const FRAME = 6;
const CSS = `
.geo { display: flex; flex-direction: column; align-items: center; gap: ${GAP}px; }
.geo.wide { flex-direction: row; align-items: flex-start; justify-content: center; gap: 12px; }
.geo-map { position: relative; display: block; padding: 0; margin: 0; border: 3px solid var(--pq-ink); border-radius: 4px; background: #9d9a94;
  box-shadow: 0 3px 0 var(--pq-ink); line-height: 0; flex: 0 0 auto; touch-action: manipulation; cursor: crosshair; font: inherit; }
.geo-map[hidden] { display: none; }
.geo-canvas { display: block; image-rendering: pixelated; }
.geo-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.geo-label { position: absolute; transform: translate(-50%, -100%); font: 700 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink);
  background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 3px; padding: 2px 4px; white-space: nowrap; }
.geo-side { flex: 0 0 auto; min-width: 0; width: 100%; box-sizing: border-box; }
.geo.wide .geo-side { width: ${SIDE_W}px; align-self: stretch; display: flex; flex-direction: column; justify-content: center; }
.geo-hint { font-size: 13px; opacity: .75; text-align: center; min-height: 18px; }
.geo-step { font-size: 17px; font-weight: 800; margin: 0 0 6px; overflow-wrap: break-word; }
.geo-step > span { flex: 1 1 auto; min-width: 0; }
.geo-bar { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 44px; }
.geo-bar .geo-hint { flex: 1 1 auto; min-height: 0; }
.geo-bar .geo-back { flex: 0 0 auto; margin: 0; }
.geo-back[hidden] { display: none; }
.geo .pq-opts { width: 100%; grid-template-columns: repeat(var(--geo-cols, 2), 1fr); grid-auto-rows: ${OPT_ROW}px; gap: 8px; }
.geo .pq-opt { padding: 4px 9px; }
@media (max-width: 519px) { .geo-side { padding: 0 8px; } .geo .pq-opts { grid-auto-rows: ${OPT_ROW_NARROW}px; } }
`;

/** Сколько зелёный флажок виден после анимации, прежде чем движок листает дальше. */
export const SUCCESS_SHOW_MS = 800;

/** Порядок посадки: по полосам, внутри полосы виды чередуются (город, река, сосед, гора…), чтобы первые 8 семян были разными. */
export function geoPool(ctx: GameCtx): readonly string[] {
  const out: string[] = [];
  const bands = [...new Set(ctx.units.map((u) => u.band))].sort((a, b) => a - b);
  const order = ['city', 'river', 'neighbor', 'mountain', 'sea', 'region', 'nature'];
  for (const b of bands) {
    const by = new Map<string, PolskaUnit[]>();
    for (const u of ctx.units.filter((x) => x.band === b)) by.set(u.type, [...(by.get(u.type) ?? []), u]);
    const types = [...by.keys()].sort((a, c) => (order.indexOf(a) + 100) % 100 - (order.indexOf(c) + 100) % 100);
    for (let i = 0; types.some((t) => (by.get(t)?.length ?? 0) > i); i++) for (const t of types) if (by.get(t)![i]) out.push(by.get(t)![i]!.id);
  }
  return out;
}

function render(task: GeoTask, panel: GamePanel, ctx: GameCtx): void {
  const unit = ctx.unit(task.id);
  const hint = task.t === 'show' ? `${task.ru}. Тап по карте или стрелки и A` : task.ru;
  // «Сам» (сборка): вопрос — русская фраза, кнопки озвучки у него нет (польское звучит по плиткам и в отзыве).
  const promptEl = prompt(panel, task.q, hint, task.t === 'build' ? 'ru' : 'pl');
  const body = panel.body;
  const root = el('div', { class: 'geo', 'data-geo': task.t }, el('style', {}, CSS));
  body.append(root);

  // Карту создаём скрытой (0×0): сначала строится блок заданий, потом `fit()` меряет лист и даёт карте наибольший масштаб.
  const stat = new Map(ctx.units.map((u) => [u.id, statusOf(ctx.info(u.id))] as const));
  const map: MapView = createMap({
    units: ctx.units,
    status: (id) => stat.get(id) ?? 'gray',
    maxW: 0,
    maxH: 0,
    mark: task.mark ? [task.mark] : [],
    hide: task.t === 'show' ? task.id : null,
    interactive: task.t === 'show',
  });
  root.append(map.el);
  const side = el('div', { class: 'geo-side' });
  root.append(side);
  const fitHooks: (() => void)[] = [];

  const here = unit ? anchorOf(unit) : ({ x: MAP_W / 2, y: MAP_H / 2 } as Pt);
  /** Герой бежит к месту задания, флажок по вердикту; единицы показываются и подписываются. */
  const celebrate = (ok: boolean, at: Pt = here): void => {
    if (map.scale === 0) return;
    map.reveal(task.reveal);
    map.plant(at, ok);
  };
  const wrapped: GamePanel = {
    body: panel.body,
    foot: panel.foot,
    layout: panel.layout,
    say: panel.say,
    rand: panel.rand,
    submit: (a) => {
      panel.submit(a);
      if (task.t === 'build') celebrate(verdict(task, a, ctx));
    },
  };

  switch (task.t) {
    case 'show': {
      const hintEl = el('div', { class: 'geo-hint', 'data-hint': '' }, 'Тап по карте · стрелки и A: курсор');
      const back = el('button', { type: 'button', class: 'pq-btn geo-back', 'data-nav': '', 'data-back': '', hidden: true, onclick: () => ((map.zoomOut(), (back.hidden = true), (hintEl.textContent = 'Тап по карте · стрелки и A: курсор'), map.unlock())) }, 'Cała mapa · Вся карта');
      side.classList.add('geo-bar');
      side.append(hintEl, back);
      const finish = (p: Pt): void => {
        const ok = verdict(task, p, ctx);
        back.hidden = true;
        map.plant(p, ok, () => {
          map.reveal(task.reveal);
          panel.submit(p);
        });
      };
      map.onPick = (p) => {
        const cl = unit && !map.zoomed ? clusterOf(ctx.units, unit) : [];
        // Рядом несколько городов (Gdańsk · Gdynia · Sopot, Kraków · Wieliczka): сначала приближаем, потом выбираем точку.
        if (cl.length > 1 && dist(p, centroid(cl)) <= 18) {
          map.zoomTo(centroid(cl));
          hintEl.textContent = 'Приблизили: выбери точку (тап или стрелки и A)';
          back.hidden = false;
          map.unlock();
          return;
        }
        finish(p);
      };
      // Совсем нет места: карту не рисуем, остаётся «Не знаю» без флажка (кнопка появляется и пропадает вместе с картой).
      const noMap = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-nomap': '', onclick: () => panel.submit({ x: -1, y: -1 }) }, 'Nie wiem · Не знаю');
      fitHooks.push(() => {
        if (map.scale) {
          noMap.remove();
          if (!map.zoomed) hintEl.textContent = 'Тап по карте · стрелки и A: курсор';
        } else {
          hintEl.textContent = 'Карта не поместилась: увеличь окно';
          if (!noMap.isConnected) side.append(noMap);
        }
      });
      break;
    }
    case 'build':
      tiles(wrapped, task.tiles ?? []);
      break;
    default: {
      const first = task.options ?? [];
      const grid = (opts: string[], correct: string, onPick: (o: string) => void): HTMLElement => choiceGrid(opts, correct, onPick, panel.say);
      const answerTo = (a: unknown, ok: boolean): void => {
        panel.submit(a);
        celebrate(ok);
      };
      if (task.t === 'dir' && task.form) {
        const f = task.form;
        let stepEl = grid(first, task.answer ?? '', (o) => {
          if (o !== task.answer) return answerTo({ nb: o } satisfies DirAnswer, false);
          // Сосед назван верно: теперь форма («Polska graniczy … Niemcy» → z Niemcami).
          const q = el('div', { class: 'geo-step pq-qrow', 'data-step2': '' }, el('span', {}, f.q), sayButton(f.q, panel.say));
          const g2 = grid(f.options, f.answer, (form) => answerTo({ nb: o, form } satisfies DirAnswer, form === f.answer));
          stepEl.replaceWith(q, g2);
          stepEl = g2;
        });
        side.append(stepEl);
      } else {
        side.append(grid(first, task.answer ?? '', (o) => answerTo(o, o === task.answer)));
      }
    }
  }

  // ——— масштаб карты: наибольший, при котором карта и блок заданий влезают без прокрутки ———
  const num = (v: string): number => parseFloat(v) || 0;
  const fbEl = body.closest('.box')?.querySelector<HTMLElement>('[data-feedback]') ?? null;
  const optTexts = [...(task.options ?? []), ...(task.form?.options ?? [])];
  const longest = optTexts.reduce((m, t) => Math.max(m, t.length), 0);
  const nOpts = task.t === 'show' || task.t === 'build' ? 0 : (task.options?.length ?? 4);
  /** Раскладка по измеренному месту `room` (css px); возвращает высоту содержимого листа, чтобы движок сжал лист по нему. */
  const place = (room: { w: number; h: number } | null): number => {
    const cs = getComputedStyle(body);
    const measured = !!room || (body.offsetWidth > 0 && body.offsetHeight > 0);
    const innerW = room ? room.w : measured ? body.offsetWidth - 2 * body.clientLeft - num(cs.paddingLeft) - num(cs.paddingRight) : 336;
    const innerH = room ? room.h : measured ? body.offsetHeight - 2 * body.clientTop - num(cs.paddingTop) - num(cs.paddingBottom) + (fbEl && !fbEl.hidden ? fbEl.offsetHeight + 6 : 0) : 600;
    const narrow = innerW < 520;
    const cols = narrow ? 2 : longest <= 16 && innerW >= 560 ? 4 : 2;
    // Блок заданий под картой (полосой): меряем в этой раскладке, при нуле (нет вёрстки) считаем по числу рядов.
    root.classList.remove('wide');
    root.style.setProperty('--geo-cols', String(cols));
    const rows = Math.ceil(nOpts / cols);
    const rowH = narrow ? OPT_ROW_NARROW : OPT_ROW;
    const sideH = Math.max(side.offsetHeight, rows ? rows * rowH + (rows - 1) * 8 : 0);
    const above = measured ? root.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientTop - num(cs.paddingTop) + body.scrollTop : 0;
    const last = body.lastElementChild;
    const after = measured && last && last !== root ? last.getBoundingClientRect().bottom - root.getBoundingClientRect().bottom : 0;
    const reserve = FB_H + (task.t === 'dir' && task.form ? STEP_H : 0);
    const belowH = task.t === 'show' ? Math.max(side.offsetHeight, 44) : sideH;
    const plan: FitPlan = planFit({ innerW, innerH, above, after, reserve, belowH, sideW: nOpts && !narrow ? SIDE_W : 0, gap: GAP, frame: FRAME });
    root.classList.toggle('wide', plan.mode === 'side');
    if (plan.mode === 'side') root.style.setProperty('--geo-cols', '1');
    if (plan.scale !== map.scale) map.layout(plan.maxW, plan.maxH);
    for (const h of fitHooks) h();
    // Высота содержимого при этой раскладке: над картой, карта с рамкой, блок заданий, под ней, запас под результат.
    const mapH = map.scale ? canvasSize(map.scale).ch + FRAME : 0;
    const mid = plan.mode === 'side' ? Math.max(mapH, sideH) : mapH + (mapH ? GAP : 0) + belowH;
    return above + mid + after + reserve;
  };
  const fit = (): void => {
    if (!root.isConnected) return;
    if (panel.fit) panel.fit((room) => place(room));
    else place(null);
  };
  fit();
  // Окно изменилось (поворот телефона, размер окна): пересчитать. Следим за экраном игры, а не за листом: высота листа меняется сама.
  const watched = panel.root ?? body;
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = watched.clientWidth;
    let lastH = watched.clientHeight;
    const ro = new ResizeObserver(() => {
      if (!root.isConnected) return ro.disconnect();
      if (Math.abs(watched.clientWidth - lastW) < 2 && Math.abs(watched.clientHeight - lastH) < 2) return;
      lastW = watched.clientWidth;
      lastH = watched.clientHeight;
      fit();
    });
    ro.observe(watched);
  }
}

export const game: PolskaGame<GeoTask> = {
  id: 'geo',
  title: { pl: 'Mapa Polski', ru: 'Карта Польши' },
  desc: 'Города, реки, горы и соседи: найди на карте, назови и скажи фразу',
  entry: 'map',
  plot: 'sad',
  kinds: ['geo'],
  layout: 'full',
  pool: geoPool,
  nextTask: (ctx: GameCtx, want: Want) => makeTask(ctx, want),
  render,
  check: (task: GeoTask, answer: unknown, ctx: GameCtx): GameCheck => checkTask(task, answer, ctx),
};
