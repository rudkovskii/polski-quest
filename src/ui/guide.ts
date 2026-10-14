// Ведение игрока в оверлее (ТЗ §4.12, КОНЦЕПТ §5б, I-13, P-02). Без единого экрана-инструкции:
//   • строка «Сейчас: …» — одна UI-подпись текущего шага режиссёра (тап = действие цели, если она здесь).
//     Первые 3 игровых дня (`step.nowHidden`) её нет: ведёт Казик; появляется при 10 с бездействия;
//   • пузырь Казика — реплика шага из story/lines.json над его спрайтом в мире (`world:anchor`), не модальный:
//     до 2 строк на страницу, страницы листаются сами, пузырь гаснет через N секунд или когда Дима пошёл.
//     Говорит не Казик или его нет на карте — пузырь с портретом в углу, как раньше;
//   • подсказка управления: только при первом входе на карту с ходьбой (шаг с `moveHint`) и только если 3 с
//     нет ввода. Mac — пиктограмма «стрелки / WASD — идти, E / Пробел — действие», телефон — пульс d-pad и «A»;
//   • раскрытие HUD: элемент с `data-hud="<element>"` появляется с анимацией (флаг hud.* ставит склейка);
//   • «ещё 3 минуты повторений» — ссылкой в строке «Сейчас», когда день закрыт.
// Данные приходят шиной: `guide:step`, `guide:reveal`, `world:anchor`; действия уходят `guide:act`, `guide:more3`.
import type { Bus } from '../systems/bus';
import type { Content } from '../systems/content';
import type { BusEvents, GuideStepView } from '../types/bus';
import { speechOfLine } from './dialog';
import { el } from './dom';
import { portrait, type PortraitSource } from './overlay/kit';

export interface GuideDeps {
  bus: Bus<BusEvents>;
  content: Pick<Content, 'lines' | 'characters'>;
  portraits?: PortraitSource | null | Promise<PortraitSource | null>;
  /** Сенсорный экран: подсказка управления пульсом d-pad, а не пиктограммой клавиш. */
  coarse?: () => boolean;
  /** Сколько держать подсказку управления, мс. */
  hintMs?: number;
  /** Сколько ждать без ввода до подсказки управления, мс (исследование §6в п. 7: 3 с). */
  hintIdleMs?: number;
  /** Сколько ждать без ввода до строки «Сейчас», когда она спрятана, мс (ПОЛИРОВКА §2 р. 11: 10 с). */
  nowIdleMs?: number;
  /** Пузырь не гаснет от шага раньше этого, мс: реплику успевают начать читать. */
  bubbleMinMs?: number;
  /** Dev: реплики-заглушки (`todo`) видны как `[todo: id]`; в игре такой пузырь не показывается (§3.8). */
  dev?: boolean;
}

export interface GuideUi {
  /** Текущий шаг (для тестов и dev). */
  readonly step: GuideStepView | null;
  dispose(): void;
}

/** Страница пузыря: до 2 строк. */
export interface BubblePage {
  pl?: string;
  /** Подпись к польской строке (мелко). */
  plRu?: string;
  /** Русская речь (Казик говорит по-русски). */
  rus?: string;
  todo?: string;
}

/** Символов в строке пузыря в мире (≈ 250 px при 15 px шрифте, пузырь до 280 px). */
export const BUBBLE_LINE_CHARS = 30;

/**
 * Реплика → страницы по 2 строки (ПОЛИРОВКА §2 р. 7: коробка до 2 строк). Польская строка с подписью — своя
 * страница; русская речь режется по предложениям, длинное предложение — по словам.
 */
export function bubblePages(sp: { pl?: string; ru?: string; rus?: string; todo?: string }, lineChars = BUBBLE_LINE_CHARS): BubblePage[] {
  if (sp.todo) return [{ todo: sp.todo }];
  const pages: BubblePage[] = [];
  if (sp.pl) pages.push({ pl: sp.pl, ...(sp.ru ? { plRu: sp.ru } : {}) });
  if (sp.rus) {
    const max = lineChars * 2;
    const words = sp.rus.split(/\s+/).filter(Boolean);
    let cur = '';
    const flush = (): void => {
      if (cur) pages.push({ rus: cur });
      cur = '';
    };
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > max) {
        flush();
        cur = w;
      } else cur = next;
      // Конец предложения во второй половине страницы — хорошее место перевернуть.
      if (/[.!?…]$/.test(w) && cur.length > lineChars) flush();
    }
    flush();
  }
  return pages;
}

/** Сколько держать страницу пузыря, мс: 2,5 с + чтение. */
export function pageMs(p: BubblePage): number {
  const chars = (p.pl ?? '').length + (p.plRu ?? '').length + (p.rus ?? '').length + (p.todo ?? '').length;
  return 2500 + chars * 50;
}

const css = `
.pq-now { position: absolute; top: calc(6px + env(safe-area-inset-top)); left: calc(8px + env(safe-area-inset-left)); right: calc(56px + env(safe-area-inset-right));
  display: flex; justify-content: center; pointer-events: none; z-index: 4; }
.pq-now[hidden] { display: none; }
.pq-now .bar { pointer-events: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; max-width: 560px; min-height: 40px;
  padding: 6px 14px; border-radius: 20px; background: rgba(20,27,27,.78); color: #f4f4f4; font-size: 16px; line-height: 1.3; border: 2px solid #73eff7; box-shadow: 0 2px 0 #141b1b; }
.pq-now .bar.here { cursor: pointer; }
.pq-now .bar b { color: #73eff7; font-weight: 700; }
.pq-now .more3 { pointer-events: auto; background: none; border: 0; padding: 0 2px; min-height: 32px; color: #ffcd75; text-decoration: underline; font: inherit; font-size: 15px; cursor: pointer; }
.pq-bubble { position: absolute; top: calc(56px + env(safe-area-inset-top)); left: calc(8px + env(safe-area-inset-left)); max-width: min(440px, calc(100% - 150px));
  display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; z-index: 4; cursor: pointer; animation: pq-bubble-in .25s ease-out; }
.pq-bubble[hidden] { display: none; }
.pq-bubble .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pq-bubble .pl { font-size: 18px; font-weight: 700; }
.pq-bubble .plru { font-size: 15px; color: #543c52; }
.pq-bubble .rus { font-size: 16px; color: #3a2c38; }
.pq-bubble .todo { font-family: ui-monospace, Menlo, monospace; color: #8f3e56; font-size: 15px; }
.pq-bubble .pq-portrait { flex: none; }
@media (max-width: 560px) {
  /* Телефон, говорит не Казик в мире: пузырь внизу, над d-pad, на всю ширину. */
  .pq-bubble:not(.world) { top: auto; bottom: calc(176px + env(safe-area-inset-bottom)); right: calc(8px + env(safe-area-inset-right)); max-width: none; }
}
/* Пузырь над спрайтом в мире (P-02): маленький, хвостик к говорящему, мир под ним живой. */
.pq-bubble.world { position: fixed; top: 0; left: 0; width: max-content; max-width: 280px; padding: 6px 10px 7px; border-width: 3px; gap: 0;
  box-shadow: 0 0 0 2px #3b3643, 0 4px 0 2px rgba(20,27,27,.35); animation: pq-bubble-pop .18s ease-out; }
.pq-bubble.world .pl { font-size: 16px; line-height: 1.25; }
.pq-bubble.world .plru, .pq-bubble.world .rus { font-size: 15px; line-height: 1.3; }
.pq-bubble.world::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -10px; width: 0; height: 0; transform: translateX(-50%);
  border: 7px solid transparent; border-top: 8px solid #91522c; border-bottom: 0; }
.pq-bubble.world.below::after { bottom: auto; top: -10px; border-top: 0; border-bottom: 8px solid #91522c; border-top-color: transparent; }
.pq-bubble.world .more { position: absolute; right: 4px; bottom: 1px; font-size: 11px; color: #91522c; }
@keyframes pq-bubble-in { from { transform: translateY(-8px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes pq-bubble-pop { from { opacity: 0; } to { opacity: 1; } }
.pq-movehint { position: absolute; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 18px; align-items: flex-end;
  pointer-events: none; z-index: 4; animation: pq-hint 1s ease-in-out infinite alternate; padding: 10px 14px; border-radius: 12px; background: rgba(20,27,27,.72); }
.pq-movehint .grp { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.pq-movehint .cap { color: #f4f4f4; font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap; }
.pq-movehint .or { color: #94b0c2; font: 600 13px/1 -apple-system, sans-serif; align-self: center; margin-bottom: 18px; }
.pq-movehint .keys { display: grid; grid-template-columns: repeat(3, 30px); grid-template-rows: repeat(2, 30px); gap: 4px; }
.pq-movehint .row { display: flex; gap: 6px; }
.pq-movehint .k { display: flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 6px; box-sizing: border-box; border-radius: 6px; background: #f4f4f4; color: #141b1b;
  font: 700 15px/1 -apple-system, sans-serif; border: 2px solid #141b1b; box-shadow: 0 3px 0 #566c86; }
.pq-movehint .k.u { grid-column: 2; grid-row: 1; } .pq-movehint .k.l { grid-column: 1; grid-row: 2; } .pq-movehint .k.d { grid-column: 2; grid-row: 2; } .pq-movehint .k.r { grid-column: 3; grid-row: 2; }
.pq-movehint.touch { bottom: calc(150px + env(safe-area-inset-bottom)); width: max-content; max-width: calc(100% - 32px); box-sizing: border-box; }
.pq-movehint.touch .cap { white-space: normal; text-align: center; line-height: 1.35; }
@keyframes pq-hint { from { opacity: .7; } to { opacity: 1; } }
.pq-dpad.pq-dpad-pulse .pq-dpad-cross, .pq-dpad.pq-dpad-pulse .pq-dpad-a { animation: pq-dpad-pulse .6s ease-in-out infinite alternate; }
@keyframes pq-dpad-pulse { from { transform: scale(1); filter: none; } to { transform: scale(1.12); filter: drop-shadow(0 0 6px #73eff7); } }
[data-hud].pq-reveal { animation: pq-reveal .7s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes pq-reveal { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .pq-bubble, .pq-movehint, [data-hud].pq-reveal, .pq-dpad.pq-dpad-pulse .pq-dpad-cross, .pq-dpad.pq-dpad-pulse .pq-dpad-a { animation: none; } }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-guide-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-guide-style';
  s.textContent = css;
  doc.head.append(s);
}

type Timer = ReturnType<typeof setTimeout>;

export function mountGuide(root: HTMLElement, deps: GuideDeps): GuideUi {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  ensureStyle(doc);
  const { bus, content } = deps;
  const hintIdleMs = deps.hintIdleMs ?? 3000;
  const nowIdleMs = deps.nowIdleMs ?? 10_000;
  const bubbleMinMs = deps.bubbleMinMs ?? 1500;
  let portraitSrc: PortraitSource | null = null;
  void Promise.resolve(deps.portraits ?? null).then((p) => (portraitSrc = p));

  let step: GuideStepView | null = null;
  let inWorld = false;
  let worldOn = true;
  let location = '';
  let controls: 'walk' | 'tap' = 'tap';
  const shownLines = new Set<string>();
  const queue: { id: string; key: string }[] = [];

  // ── Бездействие: строка «Сейчас» (10 с, когда спрятана) и подсказка управления (3 с).
  let nowIdle = false;
  let nowTimer: Timer | null = null;
  function armNowIdle(): void {
    if (nowTimer) clearTimeout(nowTimer);
    nowTimer = null;
    if (!step?.nowHidden || !inWorld || !worldOn) return;
    nowTimer = setTimeout(() => {
      nowIdle = true;
      paintBar();
    }, nowIdleMs);
  }

  // ── «Сейчас: …»
  const bar = el('div', { class: 'bar', role: 'status', 'aria-live': 'polite', 'data-hud': 'now' });
  const now = el('div', { class: 'pq-now', hidden: true }, bar);
  bar.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.more3')) return;
    if (step?.here) bus.emit('guide:act', { key: step.key });
  });

  // ── Пузырь
  const bubble = el('div', { class: 'pq-wood pq-bubble', hidden: true, role: 'note', 'data-bubble': '' });
  bubble.addEventListener('click', () => nextPage());
  let bubbleTimer: Timer | null = null;
  let pages: BubblePage[] = [];
  let page = 0;
  let shownAt = 0;
  let who = '';
  let anchor: { x: number; y: number } | null = null;

  root.append(now, bubble);

  function paintBar(): void {
    now.hidden = !inWorld || !worldOn || !step || (!!step.nowHidden && !nowIdle);
    if (!step) return;
    bar.classList.toggle('here', step.here);
    bar.dataset.kind = step.kind;
    bar.replaceChildren(el('span', {}, 'Сейчас: ', el('b', {}, step.label)));
    if (step.more3) {
      bar.append(
        el(
          'button',
          {
            type: 'button',
            class: 'more3',
            'data-act': 'more3',
            onclick: () => bus.emit('guide:more3', {}),
          },
          'ещё 3 минуты повторений',
        ),
      );
    }
  }

  function hideBubble(): void {
    bubble.hidden = true;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = null;
    queueMicrotask(nextBubble);
  }

  function nextBubble(): void {
    if (!bubble.hidden || !inWorld || !worldOn) return;
    const q = queue.shift();
    if (!q) return;
    showLine(q.id);
  }

  /** Казик говорит, и он виден на карте: пузырь над ним; иначе — угловой с портретом. */
  const inWorldBubble = (): boolean => who === 'bobr' && anchor !== null;

  function place(): void {
    if (bubble.hidden) return;
    const world = inWorldBubble();
    bubble.classList.toggle('world', world);
    if (!world || !anchor) {
      bubble.style.removeProperty('transform');
      bubble.style.removeProperty('--tail');
      bubble.classList.remove('below');
      return;
    }
    const vw = win?.innerWidth ?? 800;
    const r = bubble.getBoundingClientRect();
    const w = r.width || 200;
    const h = r.height || 48;
    const margin = 8;
    const x = Math.min(Math.max(anchor.x - w / 2, margin), Math.max(margin, vw - w - margin));
    // Над головой; не влезает под строку «Сейчас» — под ногами.
    let y = anchor.y - h - 12;
    const below = y < 56;
    if (below) y = anchor.y + 44;
    bubble.classList.toggle('below', below);
    bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    bubble.style.setProperty('--tail', `${Math.round(Math.min(Math.max(anchor.x - x, 12), w - 12))}px`);
  }

  function paintPage(): void {
    const p = pages[page];
    if (!p) return;
    const txt = el('div', { class: 'txt' });
    if (p.todo) txt.append(el('span', { class: 'todo' }, `[todo: ${p.todo}]`));
    if (p.pl) txt.append(el('span', { class: 'pl', lang: 'pl' }, p.pl));
    if (p.plRu) txt.append(el('span', { class: 'plru' }, p.plRu));
    if (p.rus) txt.append(el('span', { class: 'rus' }, p.rus));
    const name = content.characters.get(who)?.name ?? who;
    const more = page < pages.length - 1 ? el('span', { class: 'more', 'aria-hidden': 'true' }, '▸') : null;
    bubble.replaceChildren(...(inWorldBubble() ? [] : [portrait({ id: who, name }, portraitSrc, 40)]), txt, ...(more ? [more] : []));
    bubble.dataset.page = String(page);
    place();
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(nextPage, pageMs(p));
  }

  function nextPage(): void {
    if (bubble.hidden) return;
    if (page < pages.length - 1) {
      page++;
      paintPage();
    } else hideBubble();
  }

  function showLine(id: string): void {
    const sp = speechOfLine(id, content.lines);
    who = sp.who;
    pages = bubblePages(sp);
    page = 0;
    if (!pages.length) return;
    bubble.dataset.line = id;
    bubble.dataset.who = who;
    bubble.hidden = false;
    shownAt = Date.now();
    paintPage();
  }

  function say(id: string, key: string): void {
    if (!deps.dev && (content.lines.get(id)?.todo ?? !content.lines.has(id))) return;
    const k = `${key}#${id}`;
    if (shownLines.has(k)) return;
    shownLines.add(k);
    queue.push({ id, key });
    nextBubble();
  }

  // ── Подсказка управления: первый вход на карту с ходьбой, только после 3 с без ввода.
  let hint: HTMLElement | null = null;
  let hintOffTimer: Timer | null = null;
  let hintIdleTimer: Timer | null = null;
  /** Карта, на которой подсказка ждёт бездействия; '' — не ждёт. */
  let hintArmed = '';
  const hintedMaps = new Set<string>();

  function armHint(): void {
    if (!step?.moveHint || controls !== 'walk' || !inWorld || hintedMaps.has(location)) return;
    if (hintArmed !== location) hintArmed = location;
    restartHintIdle();
  }

  function restartHintIdle(): void {
    if (hintIdleTimer) clearTimeout(hintIdleTimer);
    hintIdleTimer = null;
    if (!hintArmed || !worldOn || !inWorld) return;
    hintIdleTimer = setTimeout(showHint, hintIdleMs);
  }

  /** Игрок сам пошёл или нажал действие: подсказка на этой карте не нужна. */
  function disarmHint(): void {
    if (hintArmed) hintedMaps.add(hintArmed);
    hintArmed = '';
    if (hintIdleTimer) clearTimeout(hintIdleTimer);
    hintIdleTimer = null;
    hideHint();
  }

  function hideHint(): void {
    if (hintOffTimer) clearTimeout(hintOffTimer);
    hintOffTimer = null;
    hint?.remove();
    hint = null;
    doc.querySelector<HTMLElement>('.pq-dpad')?.classList.remove('pq-dpad-pulse');
  }

  function showHint(): void {
    hintIdleTimer = null;
    if (!hintArmed || !worldOn) return;
    hintedMaps.add(hintArmed);
    hintArmed = '';
    const ms = deps.hintMs ?? 4000;
    const k = (cls: string, t: string): HTMLElement => el('div', { class: `k ${cls}` }, t);
    if (deps.coarse?.() ?? false) {
      // Телефон: пульсируют крестовина и «A»; подпись — тем же языком, что на экране.
      doc.querySelector<HTMLElement>('.pq-dpad')?.classList.add('pq-dpad-pulse');
      hint = el('div', { class: 'pq-movehint touch', 'data-hint': 'move', 'data-mode': 'touch' }, el('div', { class: 'cap' }, 'Крестовина — идти · A — действие · или нажми, куда идти'));
    } else {
      hint = el(
        'div',
        { class: 'pq-movehint', 'data-hint': 'move', 'data-mode': 'keys' },
        el('div', { class: 'grp' }, el('div', { class: 'keys' }, k('u', '↑'), k('l', '←'), k('d', '↓'), k('r', '→')), el('div', { class: 'cap' }, 'идти')),
        el('div', { class: 'or' }, 'или'),
        el('div', { class: 'grp' }, el('div', { class: 'keys' }, k('u', 'W'), k('l', 'A'), k('d', 'S'), k('r', 'D')), el('div', { class: 'cap' }, 'идти')),
        el('div', { class: 'grp' }, el('div', { class: 'row' }, k('', 'E'), k('', 'Пробел')), el('div', { class: 'cap' }, 'действие')),
      );
    }
    root.append(hint);
    hintOffTimer = setTimeout(hideHint, ms);
  }

  const offs = [
    bus.on('guide:step', ({ step: s }) => {
      const changed = s?.key !== step?.key;
      step = s;
      if (changed) {
        queue.length = 0;
        if (!bubble.hidden) hideBubble();
      }
      if (!s?.nowHidden) nowIdle = false;
      paintBar();
      armNowIdle();
      if (s?.line) say(s.line, s.key);
      armHint();
    }),
    bus.on('guide:reveal', ({ element, line }) => {
      for (const n of doc.querySelectorAll<HTMLElement>(`[data-hud="${element}"]`)) {
        n.classList.remove('pq-reveal');
        void n.offsetWidth;
        n.classList.add('pq-reveal');
      }
      if (line) say(line, `reveal.${element}`);
    }),
    bus.on('world:location', ({ id, controls: c }) => {
      inWorld = true;
      if (hintArmed && hintArmed !== id) disarmHint();
      location = id;
      controls = c;
      bubble.dataset.controls = c;
      nowIdle = false;
      paintBar();
      armNowIdle();
      armHint();
      nextBubble();
    }),
    bus.on('world:anchor', ({ id, at }) => {
      if (id !== 'bobr') return;
      const was = inWorldBubble();
      anchor = at;
      if (bubble.hidden) return;
      if (was !== inWorldBubble()) paintPage();
      else place();
    }),
    bus.on('world:input', ({ enabled }) => {
      worldOn = enabled;
      nowIdle = false;
      paintBar();
      armNowIdle();
      if (!enabled) {
        if (hintIdleTimer) clearTimeout(hintIdleTimer);
        hintIdleTimer = null;
        hideHint();
      } else restartHintIdle();
      // Открылся диалог или урок: пузырь прячется и вернётся, когда мир снова доступен.
      if (!enabled && !bubble.hidden) {
        bubble.hidden = true;
        if (bubbleTimer) clearTimeout(bubbleTimer);
        bubbleTimer = null;
        const id = bubble.dataset.line;
        if (id && step) queue.unshift({ id, key: step.key });
      }
      if (enabled) nextBubble();
    }),
    bus.on('input:intent', (i) => {
      // Любой ввод сбрасывает бездействие: строка «Сейчас» снова прячется, ожидание подсказки — заново.
      if (nowIdle) {
        nowIdle = false;
        paintBar();
      }
      armNowIdle();
      if (i.to !== 'world') return;
      const acts = (i.type === 'move' && i.held) || i.type === 'goto' || i.type === 'interact';
      if (acts && (hintArmed || hint)) disarmHint();
      // Дима пошёл: пузырь Казика в мире гаснет (не раньше, чем его начали читать).
      if ((i.type === 'move' && i.held) || i.type === 'goto') {
        if (!bubble.hidden && inWorldBubble() && Date.now() - shownAt >= bubbleMinMs) hideBubble();
      }
    }),
  ];

  return {
    get step() {
      return step;
    },
    dispose() {
      for (const off of offs) off();
      now.remove();
      bubble.remove();
      hideHint();
      for (const t of [bubbleTimer, nowTimer, hintIdleTimer]) if (t) clearTimeout(t);
    },
  };
}
