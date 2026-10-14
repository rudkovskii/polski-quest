// Ведение игрока в оверлее (ТЗ §4.12, КОНЦЕПТ §5б, I-13). Без единого экрана-инструкции:
//   • строка «Сейчас: …» — одна UI-подпись текущего шага режиссёра (тап = действие цели, если она здесь);
//   • пузырь Казика — реплика шага из story/lines.json, один раз за шаг, не модальный (мир не стоит);
//   • подсказка управления в первой walk-локации (F3): 3 с пиктограмма стрелок/WASD или пульс d-pad;
//   • раскрытие HUD: элемент с `data-hud="<element>"` появляется с анимацией (флаг hud.* ставит склейка);
//   • «ещё 3 минуты повторений» — ссылкой в строке «Сейчас», когда день закрыт.
// Данные приходят шиной: `guide:step`, `guide:reveal`; действия уходят `guide:act`, `guide:more3`.
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
  /** Сколько держать подсказку управления, мс (§5.0 F3: 3 с). */
  hintMs?: number;
  /** Dev: реплики-заглушки (`todo`) видны как `[todo: id]`; в игре такой пузырь не показывается (§3.8). */
  dev?: boolean;
}

export interface GuideUi {
  /** Текущий шаг (для тестов и dev). */
  readonly step: GuideStepView | null;
  dispose(): void;
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
  /* Телефон: пузырь внизу, над d-pad, на всю ширину — не закрывает HUD справа и цель на карте. */
  .pq-bubble { top: auto; bottom: calc(176px + env(safe-area-inset-bottom)); right: calc(8px + env(safe-area-inset-right)); max-width: none; }
  /* tap-локация (działka): d-pad нет — к самому низу, под карту. */
  .pq-bubble[data-controls="tap"] { bottom: calc(8px + env(safe-area-inset-bottom)); }
}
@keyframes pq-bubble-in { from { transform: translateY(-8px); opacity: 0; } to { transform: none; opacity: 1; } }
.pq-movehint { position: absolute; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 22px; align-items: flex-end;
  pointer-events: none; z-index: 4; animation: pq-hint 1s ease-in-out infinite alternate; }
.pq-movehint .keys { display: grid; grid-template-columns: repeat(3, 34px); grid-template-rows: repeat(2, 34px); gap: 4px; }
.pq-movehint .k { display: flex; align-items: center; justify-content: center; border-radius: 6px; background: #f4f4f4; color: #141b1b; font: 700 17px/1 -apple-system, sans-serif;
  border: 2px solid #141b1b; box-shadow: 0 3px 0 #566c86; }
.pq-movehint .k.u { grid-column: 2; grid-row: 1; } .pq-movehint .k.l { grid-column: 1; grid-row: 2; } .pq-movehint .k.d { grid-column: 2; grid-row: 2; } .pq-movehint .k.r { grid-column: 3; grid-row: 2; }
.pq-movehint .k.sp { width: 120px; height: 34px; }
@keyframes pq-hint { from { opacity: .55; } to { opacity: 1; } }
.pq-dpad.pq-dpad-pulse .pq-dpad-cross { animation: pq-dpad-pulse .6s ease-in-out infinite alternate; }
@keyframes pq-dpad-pulse { from { transform: scale(1); filter: none; } to { transform: scale(1.12); filter: drop-shadow(0 0 6px #73eff7); } }
[data-hud].pq-reveal { animation: pq-reveal .7s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes pq-reveal { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .pq-bubble, .pq-movehint, [data-hud].pq-reveal, .pq-dpad.pq-dpad-pulse .pq-dpad-cross { animation: none; } }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-guide-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-guide-style';
  s.textContent = css;
  doc.head.append(s);
}

export function mountGuide(root: HTMLElement, deps: GuideDeps): GuideUi {
  const doc = root.ownerDocument;
  ensureStyle(doc);
  const { bus, content } = deps;
  let portraitSrc: PortraitSource | null = null;
  void Promise.resolve(deps.portraits ?? null).then((p) => (portraitSrc = p));

  let step: GuideStepView | null = null;
  let inWorld = false;
  let worldOn = true;
  let controls: 'walk' | 'tap' = 'tap';
  const shownLines = new Set<string>();
  const queue: { id: string; key: string }[] = [];

  // ── «Сейчас: …»
  const bar = el('div', { class: 'bar', role: 'status', 'aria-live': 'polite', 'data-hud': 'now' });
  const now = el('div', { class: 'pq-now', hidden: true }, bar);
  bar.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.more3')) return;
    if (step?.here) bus.emit('guide:act', { key: step.key });
  });

  // ── Пузырь Казика
  const bubble = el('div', { class: 'pq-wood pq-bubble', hidden: true, role: 'note', 'data-bubble': '' });
  bubble.addEventListener('click', () => hideBubble());
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

  root.append(now, bubble);

  function paintBar(): void {
    now.hidden = !inWorld || !worldOn || !step;
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

  function showLine(id: string): void {
    const sp = speechOfLine(id, content.lines);
    const who = sp.who;
    const name = content.characters.get(who)?.name ?? who;
    const txt = el('div', { class: 'txt' });
    if (sp.todo) txt.append(el('span', { class: 'todo' }, `[todo: ${sp.todo}]`));
    else {
      if (sp.pl) txt.append(el('span', { class: 'pl', lang: 'pl' }, sp.pl));
      if (sp.ru) txt.append(el('span', { class: 'plru' }, sp.ru));
      if (sp.rus) txt.append(el('span', { class: 'rus' }, sp.rus));
    }
    bubble.replaceChildren(portrait({ id: who, name }, portraitSrc, 40), txt);
    bubble.dataset.line = id;
    bubble.hidden = false;
    // Пузырь не модальный: живёт, пока шаг не сменился, или 12 с (длинная реплика — дольше).
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, 12_000);
  }

  function say(id: string, key: string): void {
    if (!deps.dev && (content.lines.get(id)?.todo ?? !content.lines.has(id))) return;
    const k = `${key}#${id}`;
    if (shownLines.has(k)) return;
    shownLines.add(k);
    queue.push({ id, key });
    nextBubble();
  }

  // ── Подсказка управления (F3)
  let hint: HTMLElement | null = null;
  let hintShownFor = '';
  function moveHint(): void {
    if (!step?.moveHint || controls !== 'walk' || hintShownFor === step.key) return;
    hintShownFor = step.key;
    const ms = deps.hintMs ?? 3000;
    const dpad = doc.querySelector<HTMLElement>('.pq-dpad');
    if (deps.coarse?.() ?? false) {
      dpad?.classList.add('pq-dpad-pulse');
      setTimeout(() => dpad?.classList.remove('pq-dpad-pulse'), ms);
      return;
    }
    const k = (cls: string, t: string): HTMLElement => el('div', { class: `k ${cls}` }, t);
    hint = el(
      'div',
      { class: 'pq-movehint', 'aria-hidden': 'true', 'data-hint': 'move' },
      el('div', { class: 'keys' }, k('u', '↑'), k('l', '←'), k('d', '↓'), k('r', '→')),
      el('div', { class: 'keys' }, k('u', 'W'), k('l', 'A'), k('d', 'S'), k('r', 'D')),
      k('sp', '␣'),
    );
    root.append(hint);
    const h = hint;
    setTimeout(() => {
      h.remove();
      if (hint === h) hint = null;
    }, ms);
  }

  const offs = [
    bus.on('guide:step', ({ step: s }) => {
      const changed = s?.key !== step?.key;
      step = s;
      if (changed) {
        queue.length = 0;
        if (!bubble.hidden) hideBubble();
      }
      paintBar();
      if (s?.line) say(s.line, s.key);
      moveHint();
    }),
    bus.on('guide:reveal', ({ element, line }) => {
      for (const n of doc.querySelectorAll<HTMLElement>(`[data-hud="${element}"]`)) {
        n.classList.remove('pq-reveal');
        void n.offsetWidth;
        n.classList.add('pq-reveal');
      }
      if (line) say(line, `reveal.${element}`);
    }),
    bus.on('world:location', ({ controls: c }) => {
      inWorld = true;
      controls = c;
      bubble.dataset.controls = c;
      paintBar();
      moveHint();
      nextBubble();
    }),
    bus.on('world:input', ({ enabled }) => {
      worldOn = enabled;
      paintBar();
      // Открылся диалог или урок: пузырь прячется и вернётся, когда мир снова доступен.
      if (!enabled && !bubble.hidden) {
        bubble.hidden = true;
        const id = bubble.dataset.line;
        if (id && step) queue.unshift({ id, key: step.key });
      }
      if (enabled) nextBubble();
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
      hint?.remove();
      if (bubbleTimer) clearTimeout(bubbleTimer);
    },
  };
}
