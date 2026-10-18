// Утро: при первом входе в новый календарный день маленькая карточка «Вчера: выращено N, полито M · Сегодня созреет: K»
// с кнопкой «Na pole!». Раз в день: показанный день пишет склейка (`mark`, флаг `morning:<день>` в `Save.hints`).
// Пока открыт экран или мини-игра, карточка ждёт: `world:input {enabled:true}` спросит снова.
import { bus as globalBus, type Bus } from '../systems/bus';
import { morningAction, morningRipeLines, type Recap } from '../systems/daygoal';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { createPanel, nav } from './panel';

export interface MorningDeps {
  bus?: Bus<BusEvents>;
  /** Номер текущего календарного дня. */
  today(): number;
  /** Итоги прошлой игры; null — играл впервые. */
  recap(): Recap | null;
  /** Сколько растений созреет сегодня одним верным ответом. */
  ripeToday(): number;
  /** Растущих, которым до урожая остаётся день (`ripeSoon().soon`): показываются, когда сегодня созревать нечему. */
  ripeSoon?(): number;
  /** Последний день, для которого утро уже было; null — не было. */
  seenDay(): number | null;
  /** Запомнить, что утро этого дня прошло. */
  mark(day: number): void;
  /** Строка о Польше на сегодня («Dziś: Wszystkich Świętych · znicze przy ogrodzie»), null — без неё. */
  polska?(): string | null;
  /** Пауза до первой проверки после загрузки мира, мс. */
  delayMs?: number;
}

export interface Morning {
  /** Проверить, пора ли показать утро (само вызывается при старте, возврате на вкладку и закрытии экранов). */
  check(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export function mountMorning(parent: HTMLElement, d: MorningDeps): Morning {
  const bus = d.bus ?? globalBus;
  const panel = createPanel({ title: 'Dzień dobry · Утро', bus });
  panel.root.setAttribute('data-morning', '');
  panel.root.querySelector<HTMLElement>('.pq-frame')!.style.width = 'min(340px, 100%)';
  const text = el('div', { class: 'pq-morning-text', style: 'display:flex;flex-direction:column;gap:6px;font-size:17px;line-height:1.35' });
  const go = el('button', { type: 'button', class: 'pq-btn', 'data-go': '', ...nav('go', 'v', 'go'), onclick: () => panel.close() }, 'Na pole!');
  panel.body.append(text, el('div', { style: 'margin-top:14px;display:flex' }, go));
  go.style.flex = '1';
  parent.append(panel.root);

  /** Мир принимает ввод (экраны закрыты) и сцена уже загружена. */
  let ready = false;
  let inputOn = true;
  const check = (): void => {
    if (!ready || !inputOn || panel.isOpen) return;
    const day = d.today();
    const recap = d.recap();
    const act = morningAction(day, d.seenDay(), recap);
    if (act === 'none') return;
    d.mark(day);
    if (act !== 'show' || !recap) return;
    const r = morningRipeLines(d.ripeToday(), d.ripeSoon?.() ?? 0);
    text.replaceChildren(
      el('div', {}, el('b', {}, `${recap.label}:`), ` выращено ${recap.grown}, полито ${recap.watered}`),
      el('div', {}, el('b', {}, r.label), r.value),
    );
    if (r.extra) text.append(el('div', { class: 'pq-morning-soon', 'data-soon': '' }, r.extra));
    const pl = d.polska?.() ?? null;
    if (pl) text.append(el('div', { class: 'pq-morning-polska', 'data-morning-polska': '', style: 'padding:6px 8px;background:#fffaf0;border:2px solid var(--pq-wood-dark);border-radius:8px;font-size:15px' }, pl));
    panel.open();
    panel.focus('go');
  };
  const offs = [
    bus.on('world:input', ({ enabled }) => {
      inputOn = enabled;
      if (enabled) setTimeout(check, 350);
    }),
  ];
  // Первая проверка — когда мир загружен (иначе сцена не услышит `world:input`).
  let first = true;
  offs.push(
    bus.on('world:location', () => {
      if (!first) return;
      first = false;
      setTimeout(() => {
        ready = true;
        check();
      }, d.delayMs ?? 700);
    }),
  );
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onVisible);
  return {
    check,
    get isOpen() {
      return panel.isOpen;
    },
    dispose() {
      for (const off of offs) off();
      document.removeEventListener('visibilitychange', onVisible);
      panel.dispose();
    },
  };
}
