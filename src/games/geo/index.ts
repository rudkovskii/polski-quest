// Игра 1: Geografia («Mapa Polski», ФЕРМА_v2.md §2). Экран во весь размер: пиксельная карта Польши на canvas 2D, города точками,
// реки линиями. Задания: «Pokaż na mapie» (тап или курсор + A: мини-герой бежит к месту и втыкает флажок, кот рядом),
// «Co to za miasto?», «Nad jaką rzeką leży…?», «Z kim graniczy Polska na zachodzie?» (сосед + форма «z Niemcami»), столица воеводства,
// сторона света, падежные формы и сборка фраз из плиток (`want.self`).
import type { GameCheck, GameCtx, GamePanel, PolskaGame, PolskaUnit, Want } from '../../types/polska';
import { el } from '../../ui/dom';
import { choiceGrid } from './choice';
import { createMap, type MapView } from './mapview';
import { checkTask, makeTask, statusOf, verdict, type DirAnswer, type GeoTask } from './tasks';
import { clusterOf, anchorOf, centroid, dist, MAP_H, MAP_W, type Pt } from './world';
import { prompt, tiles } from '../kit';

const CSS = `
.geo { display: flex; flex-direction: column; align-items: center; gap: 8px; }
@media (max-width: 519px) { .geo { margin: 0 -8px; } .geo-side { padding: 0 8px; box-sizing: border-box; } }
.geo.wide { flex-direction: row; align-items: flex-start; justify-content: center; gap: 12px; }
.geo-map { position: relative; display: block; padding: 0; margin: 0; border: 3px solid var(--pq-ink); border-radius: 4px; background: #9d9a94;
  box-shadow: 0 3px 0 var(--pq-ink); line-height: 0; flex: 0 0 auto; touch-action: manipulation; cursor: crosshair; font: inherit; }
.geo-map[hidden] { display: none; }
.geo-canvas { display: block; image-rendering: pixelated; }
.geo-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.geo-label { position: absolute; transform: translate(-50%, -100%); font: 700 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink);
  background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 3px; padding: 2px 4px; white-space: nowrap; }
.geo-side { flex: 1 1 0; min-width: 0; width: 100%; }
.geo.wide .geo-side { align-self: stretch; display: flex; flex-direction: column; justify-content: center; }
.geo-hint { font-size: 13px; opacity: .75; text-align: center; min-height: 18px; }
.geo-step { font-size: 17px; font-weight: 800; margin: 0 0 6px; overflow-wrap: break-word; }
.geo-back { margin-top: 6px; }
.geo-back[hidden] { display: none; }
.geo .pq-opts { width: 100%; }
`;

/** Место под варианты ответа (px) по виду задания: от него зависит, какой масштаб карты влезает. */
const OPTS_H = 152;
const TILES_H = 210;
/** Запас на строку результата движка (`.fb`), которая появляется под листом после ответа. */
const FB_H = 100;
const SIDE_W = 262;

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

const hasOptions = (t: GeoTask): boolean => t.t !== 'show';

function render(task: GeoTask, panel: GamePanel, ctx: GameCtx): void {
  const unit = ctx.unit(task.id);
  const hint = task.t === 'show' ? `${task.ru}. Тап по карте или стрелки и A` : task.ru;
  const promptEl = prompt(panel, task.q, hint, 'pl');
  const body = panel.body;
  const root = el('div', { class: 'geo', 'data-geo': task.t }, el('style', {}, CSS));
  body.append(root);

  // ——— место под карту ———
  const bodyW = body.clientWidth || 360;
  const bodyH = body.clientHeight || 640;
  const narrow = bodyW < 520;
  // На узком экране карта выходит на поля листа (отрицательный margin, 8 px с каждой стороны): на iPhone 375 иначе не влезает целый масштаб 1.
  const padX = narrow ? 0 : 24;
  const innerW = bodyW - padX - 6;
  const rows = task.t === 'build' ? 0 : Math.ceil((task.options?.length ?? 4) / 2);
  const wide = hasOptions(task) && task.t !== 'build' && innerW >= MAP_W + 12 + SIDE_W;
  const below = task.t === 'build' ? TILES_H : wide || task.t === 'show' ? FB_H + 24 : rows * (narrow ? 58 : 64) + (rows - 1) * 8 + 8;
  const top = promptEl.offsetHeight + (body.firstElementChild instanceof HTMLElement ? body.firstElementChild.offsetHeight : 0) + 24;
  const calcMax = (): { w: number; h: number } => ({
    w: Math.max(0, (body.clientWidth || bodyW) - padX - 6 - (wide ? SIDE_W + 12 : 0)),
    h: Math.max(0, (body.clientHeight || bodyH) - top - below - 6),
  });
  const m0 = calcMax();

  const stat = new Map(ctx.units.map((u) => [u.id, statusOf(ctx.info(u.id))] as const));
  const map: MapView = createMap({
    units: ctx.units,
    status: (id) => stat.get(id) ?? 'gray',
    maxW: m0.w,
    maxH: m0.h,
    mark: task.mark ? [task.mark] : [],
    hide: task.t === 'show' ? task.id : null,
    interactive: task.t === 'show',
  });
  root.append(map.el);
  const side = el('div', { class: 'geo-side' });
  if (wide) root.classList.add('wide');
  root.append(side);

  // Ширина окна изменилась (поворот телефона): пересчитать масштаб; высоту не трогаем, она «прыгает» от строки результата.
  let lastW = bodyW;
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!root.isConnected) return ro.disconnect();
      const w = body.clientWidth;
      if (Math.abs(w - lastW) < 4) return;
      lastW = w;
      const m = calcMax();
      map.layout(m.w, m.h);
    });
    ro.observe(body);
  }

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
      const hintEl = el('div', { class: 'geo-hint', 'data-hint': '' }, map.scale ? 'Тап по карте · стрелки и A: курсор' : 'Карта не поместилась: увеличь окно');
      const back = el('button', { type: 'button', class: 'pq-btn geo-back', 'data-nav': '', 'data-back': '', hidden: true, onclick: () => ((map.zoomOut(), (back.hidden = true), (hintEl.textContent = 'Тап по карте · стрелки и A: курсор'), map.unlock())) }, 'Cała mapa · Вся карта');
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
      if (!map.scale) {
        // Совсем нет места: карту не рисуем, остаётся «Не знаю» без флажка.
        side.append(el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', onclick: () => panel.submit({ x: -1, y: -1 }) }, 'Nie wiem · Не знаю'));
      }
      break;
    }
    case 'build':
      tiles(wrapped, task.tiles ?? []);
      break;
    default: {
      const first = task.options ?? [];
      const grid = (opts: string[], correct: string, onPick: (o: string) => void): HTMLElement => choiceGrid(opts, correct, onPick);
      const answerTo = (a: unknown, ok: boolean): void => {
        panel.submit(a);
        celebrate(ok);
      };
      if (task.t === 'dir' && task.form) {
        const f = task.form;
        let stepEl = grid(first, task.answer ?? '', (o) => {
          if (o !== task.answer) return answerTo({ nb: o } satisfies DirAnswer, false);
          // Сосед назван верно: теперь форма («Polska graniczy … Niemcy» → z Niemcami).
          const q = el('div', { class: 'geo-step', 'data-step2': '' }, f.q);
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
