// Fotobudka (P-03, ПОЛИРОВКА §2 решение 1, research/05 §1.2): создание персонажа одним экраном.
// По умолчанию уже собран Дима, экран проходится одной кнопкой «Gotowe». Строки ‹ значение › с польской
// подписью и русской под ней: Cera, Włosy (+ kolor), Broda, Okulary, Ubranie (+ kolor); «Losuj»; имя.
// Управление: вверх/вниз — строка, влево/вправо — значение, A/Enter — «Gotowe» (на «Losuj» и имени — они);
// тапы по стрелкам; стрелки у превью поворачивают персонажа. Gotowe → вспышка → фото → сохранить.
// Внешность пишется в настройку `avatar` (LWW, src/systems/avatar.ts) и уходит в синк как любая настройка.
// Открыть: `openCreator({ mode })` → `ui:creator:show`; экран слушает событие после `mountCreator`.
import { bus as globalBus, type Bus } from '../systems/bus';
import {
  appearanceOf,
  AVATAR_KINDS,
  AVATAR_TURN,
  cycle,
  NAME_MAX,
  normalizeName,
  optionOf,
  randomAppearance,
  sameAppearance,
  setAppearance,
  type Appearance,
  type AvatarKind,
} from '../systems/avatar';
import { AVATAR_ART } from '../systems/avatarArt';
import { getSetting, type Progress } from '../systems/progress';
import type { BusEvents } from '../types/bus';
import type { Dir } from '../types/input';
import { avatarFrameEl, avatarPhotoEl } from './avatar';
import { el } from './dom';
import { attachKeyboard } from './keyboard';
import type { Overlay } from './overlay/host';

export type CreatorMode = 'new' | 'mirror';

export interface CreatorStore {
  progress: Progress;
  setProgress(p: Progress): boolean;
}

export interface CreatorDeps {
  overlay: Overlay;
  store: Promise<CreatorStore> | CreatorStore;
  clock: { now(): number };
  bus?: Bus<BusEvents>;
  /** Seed для «Losuj» (по умолчанию от часов). */
  seed?: () => number;
  /** Паузы вспышки и фото (тесты: мгновенно). */
  delay?: (ms: number) => Promise<void>;
  /** Масштаб превью (по умолчанию от высоты окна). */
  scale?: number;
}

export interface Creator {
  open(mode: CreatorMode): Promise<Appearance | null>;
  readonly isOpen: boolean;
  dispose(): void;
}

/** Открыть Fotobudka через шину. Экрана нет (не смонтирован) — сразу null. */
export function openCreator(opts: { mode: CreatorMode }, bus: Bus<BusEvents> = globalBus): Promise<Appearance | null> {
  return new Promise((resolve) => {
    let opened = false;
    bus.emit('ui:creator:show', { mode: opts.mode, done: resolve, opened: () => (opened = true) });
    if (!opened) resolve(null);
  });
}

/** Подписи строк: польская сверху, русская под ней. */
export const ROW_LABELS: Record<AvatarKind, { pl: string; ru: string; sub?: boolean }> = {
  skin: { pl: 'Cera', ru: 'Кожа' },
  hair: { pl: 'Włosy', ru: 'Волосы' },
  hairColor: { pl: 'kolor', ru: 'цвет волос', sub: true },
  beard: { pl: 'Broda', ru: 'Борода' },
  glasses: { pl: 'Okulary', ru: 'Очки' },
  top: { pl: 'Ubranie', ru: 'Одежда' },
  topColor: { pl: 'kolor', ru: 'цвет одежды', sub: true },
};

type Row = AvatarKind | 'name' | 'actions';
const ROWS: readonly Row[] = [...AVATAR_KINDS, 'name', 'actions'];

const css = `
.pq-creator-layer { justify-content: center; background:
  repeating-linear-gradient(90deg, #543c52 0 14px, #8f3e56 14px 18px, #543c52 18px 30px) ; }
.pq-creator { width: min(100% - 12px, 760px); max-height: calc(100% - 8px); box-sizing: border-box; padding: 8px 10px 10px;
  display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
.pq-creator .booth { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.pq-creator h2 { margin: 0; font-size: 22px; line-height: 1.1; color: #3b3643; letter-spacing: .12em; text-transform: uppercase; text-align: center; }
.pq-creator h2 small { display: block; font-size: 13px; letter-spacing: 0; text-transform: none; color: #695953; font-weight: 500; }
.pq-creator .stage { display: flex; align-items: center; gap: 10px; }
.pq-creator .preview { position: relative; display: flex; align-items: flex-end; justify-content: center; padding: 6px 14px 4px; border: 3px solid #3b3643; border-radius: 6px;
  background: linear-gradient(#b8dce5 0 78%, #8d977f 78% 100%); box-shadow: inset 0 0 0 3px #f2eaf1; }
.pq-creator .rows { display: flex; flex-direction: column; gap: 2px; }
.pq-creator .row { display: grid; grid-template-columns: minmax(84px, 1fr) 44px minmax(120px, 2fr) 44px; align-items: center; gap: 4px;
  padding: 0 4px; border-radius: 6px; border: 2px solid transparent; }
.pq-creator .row.sub { min-height: 0; }
.pq-creator .row.sel { border-color: #e89b2f; background: #fce2ca; }
.pq-creator .lbl b { display: block; font-size: 17px; line-height: 1.1; }
.pq-creator .lbl small { display: block; font-size: 12px; line-height: 1.1; color: #695953; }
.pq-creator .row.sub .lbl { padding-left: 14px; }
.pq-creator .row.sub .lbl b { font-size: 15px; font-weight: 600; }
.pq-creator .val { text-align: center; line-height: 1.1; display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; }
.pq-creator .val span { font-weight: 600; font-size: 16px; }
.pq-creator .val small { display: block; font-size: 12px; color: #695953; }
.pq-creator .sw { flex: none; width: 18px; height: 18px; border: 2px solid #3b3643; border-radius: 4px; }
.pq-creator .arrow { padding: 0; font-size: 20px; min-height: 40px; }
.pq-creator .turn { padding: 0; width: 40px; font-size: 18px; }
.pq-creator .name { grid-template-columns: minmax(84px, 1fr) minmax(0, 3fr); }
.pq-creator .name .pq-btn { min-height: 40px; padding: 4px 12px; text-align: left; }
.pq-creator .actions { display: flex; gap: 8px; }
.pq-creator .actions .pq-btn { line-height: 1.1; }
.pq-creator .actions .pq-btn small { display: block; font-size: 12px; font-weight: 500; }
.pq-creator .actions .go { flex: 1; font-size: 20px; min-height: 52px; }
.pq-creator .actions .pq-btn.pq-focus { outline: 3px solid #e89b2f; outline-offset: 2px; }
.pq-creator-flash { position: absolute; inset: 0; background: #fff; pointer-events: none; animation: pq-flash .45s ease-out forwards; }
@keyframes pq-flash { from { opacity: 1 } to { opacity: 0 } }
.pq-creator-photo { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.pq-creator-photo .card { background: #f4f8fb; padding: 10px 10px 8px; border: 3px solid #3b3643; box-shadow: 0 6px 0 rgba(20,27,27,.4);
  transform: rotate(-4deg); display: flex; flex-direction: column; align-items: center; gap: 6px; animation: pq-pop .35s; }
.pq-creator-photo .card canvas { background: #b8dce5; }
.pq-creator-photo .card b { font-size: 18px; }
.pq-creator-namebox { width: min(100% - 16px, 520px); margin: auto 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.pq-creator-namebox input { font: inherit; font-size: 20px; padding: 8px 10px; border: 3px solid #91522c; border-radius: 6px; }
@media (min-width: 720px) and (min-aspect-ratio: 1/1) {
  .pq-creator { display: grid; grid-template-columns: auto 1fr; grid-template-rows: 1fr auto; column-gap: 16px; }
  .pq-creator .booth { grid-row: 1 / 3; justify-content: center; }
}
@media (prefers-reduced-motion: reduce) { .pq-creator-flash, .pq-creator-photo .card { animation: none; } }
`;

function rgb(name: string | undefined): string {
  const c = name ? AVATAR_ART.palette[name] : undefined;
  return c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent';
}

/** Образец цвета для строк цвета и кожи. */
function swatchOf(kind: AvatarKind, id: string): string | null {
  if (kind !== 'skin' && kind !== 'hairColor' && kind !== 'topColor') return null;
  return rgb(optionOf(kind, id).ramp?.[0]);
}

export function mountCreator(deps: CreatorDeps): Creator {
  const bus = deps.bus ?? globalBus;
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let current: Promise<Appearance | null> | null = null;

  async function run(mode: CreatorMode): Promise<Appearance | null> {
    const store = await deps.store;
    const start = appearanceOf(store.progress);
    let a: Appearance = start;
    let row = 0;
    let turn = 0;
    let action: 'go' | 'losuj' = 'go';
    let busy = false;
    let seedN = 0;

    const layer = deps.overlay.open('pq-creator-layer');
    const doc = layer.el.ownerDocument;
    if (!doc.getElementById('pq-creator-style')) doc.head.append(el('style', { id: 'pq-creator-style' }, css));
    const scale = deps.scale ?? (typeof innerHeight === 'number' && innerHeight > 0 ? (innerHeight < 700 ? 3 : innerHeight < 900 ? 4 : 5) : 4);

    const preview = el('div', { class: 'preview', 'data-role': 'preview' });
    const rowEls = new Map<Row, HTMLElement>();
    const valEls = new Map<AvatarKind, HTMLElement>();
    const nameBtn = el('button', { type: 'button', class: 'pq-btn', 'data-act': 'name', 'aria-label': 'Имя' });
    const losujBtn = el('button', { type: 'button', class: 'pq-btn', 'data-act': 'losuj' }, el('span', { lang: 'pl' }, 'Losuj'), el('small', {}, 'Случайно'));
    const goBtn = el('button', { type: 'button', class: 'pq-btn primary go', 'data-act': 'gotowe', 'data-primary': true }, el('span', { lang: 'pl' }, 'Gotowe'), el('small', {}, 'Готово'));

    return new Promise((resolve) => {
      const finish = (res: Appearance | null): void => {
        layer.close();
        resolve(res);
      };

      const paint = (): void => {
        preview.replaceChildren(avatarFrameEl(a, AVATAR_TURN[turn]!, scale));
        for (const k of AVATAR_KINDS) {
          const o = optionOf(k, a[k]);
          const sw = swatchOf(k, o.id);
          valEls.get(k)!.replaceChildren(
            ...(sw ? [el('i', { class: 'sw', style: `background:${sw}` })] : []),
            el('div', {}, el('span', { lang: 'pl' }, o.pl), el('small', {}, o.ru)),
          );
          rowEls.get(k)!.dataset.value = o.id;
        }
        nameBtn.replaceChildren(el('span', { lang: 'pl' }, a.name), ' ✎');
        for (const [r, node] of rowEls) node.classList.toggle('sel', ROWS[row] === r);
        losujBtn.classList.toggle('pq-focus', ROWS[row] === 'actions' && action === 'losuj');
        goBtn.classList.toggle('pq-focus', ROWS[row] === 'actions' && action === 'go');
      };
      const select = (r: Row): void => {
        row = ROWS.indexOf(r);
        paint();
      };
      const change = (k: AvatarKind, d: number): void => {
        if (busy) return;
        a = cycle(a, k, d);
        select(k);
      };
      const losuj = (): void => {
        if (busy) return;
        const seed = deps.seed ? deps.seed() : Math.floor(deps.clock.now()) + ++seedN * 7919;
        a = randomAppearance(seed, a.name);
        paint();
      };
      const turnBy = (d: number): void => {
        turn = (turn + d + AVATAR_TURN.length) % AVATAR_TURN.length;
        paint();
      };

      const editName = (): void => {
        if (busy) return;
        select('name');
        const sub = deps.overlay.open('pq-creator-name');
        const input = el('input', { type: 'text', value: a.name, maxlength: NAME_MAX, 'aria-label': 'Imię', 'data-role': 'name-input' });
        let kb: ReturnType<typeof attachKeyboard> | null = null;
        const close = (save: boolean): void => {
          if (save) a = { ...a, name: normalizeName(input.value) };
          kb?.detach();
          sub.close();
          paint();
          nameBtn.focus({ preventScroll: true });
        };
        sub.el.append(
          el(
            'div',
            { class: 'pq-wood pq-creator-namebox', 'data-screen': 'creator-name' },
            el('div', { class: 'lbl' }, el('b', { lang: 'pl' }, 'Imię'), ' ', el('small', {}, 'Имя (в паспорте)')),
            input,
            el(
              'div',
              { class: 'pq-ex-actions', style: 'display:flex;gap:8px' },
              el('button', { type: 'button', class: 'pq-btn ghost', 'data-nav': true, onclick: () => close(false) }, 'Anuluj · Отмена'),
              el('span', { style: 'flex:1' }),
              el('button', { type: 'button', class: 'pq-btn primary', 'data-primary': true, 'data-nav': true, 'data-act': 'name-ok', onclick: () => close(true) }, 'OK'),
            ),
          ),
        );
        kb = attachKeyboard(input, { mode: getSetting(store.progress, 'keyboard.mode'), onEnter: () => close(true) });
        sub.handle({ cancel: () => (close(false), true) });
        input.focus();
        input.select?.();
      };

      const gotowe = async (): Promise<void> => {
        if (busy) return;
        busy = true;
        const card = layer.el.querySelector('.pq-creator') as HTMLElement;
        card.append(el('div', { class: 'pq-creator-flash', 'data-role': 'flash' }));
        await delay(300);
        card.append(el('div', { class: 'pq-creator-photo', 'data-role': 'photo' }, el('div', { class: 'card' }, avatarPhotoEl(a, 5), el('b', { lang: 'pl' }, a.name))));
        await delay(1100);
        // Новый мир: пишем всегда (это и есть «Fotobudka пройдена»); зеркало — только если что-то сменили.
        if (mode === 'new' || !sameAppearance(a, start)) {
          if (store.setProgress(setAppearance(store.progress, a, deps.clock.now()))) bus.emit('progress:changed', { kinds: ['settings'] });
        }
        finish(a);
      };

      const rowEl = (k: AvatarKind): HTMLElement => {
        const L = ROW_LABELS[k];
        const val = el('div', { class: 'val' });
        valEls.set(k, val);
        const node = el(
          'div',
          { class: `row${L.sub ? ' sub' : ''}`, 'data-row': k },
          el('div', { class: 'lbl' }, el('b', { lang: 'pl' }, L.pl), el('small', {}, L.ru)),
          el('button', { type: 'button', class: 'pq-btn arrow', 'data-act': 'prev', 'aria-label': `${L.ru}: предыдущий`, onclick: () => change(k, -1) }, '‹'),
          val,
          el('button', { type: 'button', class: 'pq-btn arrow', 'data-act': 'next', 'aria-label': `${L.ru}: следующий`, onclick: () => change(k, 1) }, '›'),
        );
        rowEls.set(k, node);
        return node;
      };

      nameBtn.addEventListener('click', editName);
      losujBtn.addEventListener('click', () => {
        row = ROWS.indexOf('actions');
        action = 'losuj';
        losuj();
      });
      goBtn.addEventListener('click', () => void gotowe());
      const nameRow = el('div', { class: 'row name', 'data-row': 'name' }, el('div', { class: 'lbl' }, el('b', { lang: 'pl' }, 'Imię'), el('small', {}, 'Имя')), nameBtn);
      rowEls.set('name', nameRow);
      const actions = el('div', { class: 'actions', 'data-row': 'actions' }, losujBtn, goBtn);
      rowEls.set('actions', actions);

      layer.el.append(
        el(
          'div',
          { class: 'pq-wood pq-creator', 'data-screen': 'creator', 'data-mode': mode },
          el(
            'div',
            { class: 'booth' },
            el('h2', { lang: 'pl' }, mode === 'mirror' ? 'Lustro' : 'Fotobudka', el('small', {}, mode === 'mirror' ? 'Zmień wygląd · сменить внешность' : 'Zdjęcie do paszportu · фото на паспорт')),
            el(
              'div',
              { class: 'stage' },
              el('button', { type: 'button', class: 'pq-btn turn', 'data-act': 'turn-left', 'aria-label': 'Повернуть влево', onclick: () => turnBy(-1) }, '⟲'),
              preview,
              el('button', { type: 'button', class: 'pq-btn turn', 'data-act': 'turn-right', 'aria-label': 'Повернуть вправо', onclick: () => turnBy(1) }, '⟳'),
            ),
          ),
          el('div', { class: 'rows' }, ...AVATAR_KINDS.map(rowEl), nameRow),
          actions,
        ),
      );

      layer.handle({
        move(dir: Dir) {
          if (busy) return true;
          const r = ROWS[row]!;
          if (dir === 'up' || dir === 'down') {
            row = Math.min(ROWS.length - 1, Math.max(0, row + (dir === 'down' ? 1 : -1)));
            if (ROWS[row] === 'actions') action = 'go';
            paint();
          } else if (r === 'actions') {
            action = dir === 'left' ? 'losuj' : 'go';
            paint();
          } else if (r === 'name') {
            turnBy(dir === 'left' ? -1 : 1);
          } else change(r, dir === 'left' ? -1 : 1);
          return true;
        },
        interact() {
          if (busy) return true;
          const r = ROWS[row];
          if (r === 'name') editName();
          else if (r === 'actions' && action === 'losuj') losuj();
          else void gotowe();
          return true;
        },
        cancel() {
          if (mode === 'mirror' && !busy) finish(null);
          return true;
        },
      });
      paint();
      goBtn.focus({ preventScroll: true });
    });
  }

  const offShow = bus.on('ui:creator:show', (p) => {
    p.opened?.();
    void creator.open(p.mode).then(p.done);
  });

  const creator: Creator = {
    open(mode) {
      if (current) return current.then(() => creator.open(mode));
      current = run(mode).finally(() => (current = null));
      return current;
    },
    get isOpen() {
      return current !== null;
    },
    dispose() {
      offShow();
    },
  };
  return creator;
}

