// Онбординг (флаг `onboarding` в edition.json): 7 коротких карточек «Дальше / Назад / Начать» при первом запуске и по пункту «Как играть»
// в настройках. Показано-флаг лежит в `Save.hints` (`onboarding`), как у других подсказок. Тексты сверены с экранами: Słownik (вкладки
// Słowa / Frazy / ＋ Своё), Spiżarnia, Tablica (`MODE_NAME`), Skrzynka, Łóżko, путь уровней (`ui/levelUp.ts`).
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { GameMode } from '../types/farm';
import { el } from './dom';
import { MODE_ICON, MODE_NAME } from './glossary';
import { createPanel, nav } from './panel';

/** Флаг в `Save.hints`: онбординг уже показан. */
export const ONBOARDING_HINT = 'onboarding';

/** Строка карточки: простой текст или «жирное начало + продолжение». */
export type OnboardingItem = string | readonly [string, string];

export interface OnboardingCard {
  icon: string;
  title: string;
  items: readonly OnboardingItem[];
}

/** Нужно ли показать онбординг при запуске: флаг включён, ещё не показывали и игрок не начинал (уже сажал или отвечал — сам разобрался). */
export function shouldShowOnboarding(o: { enabled: boolean; hints: readonly string[]; planted: number; answered: number }): boolean {
  return o.enabled && !o.hints.includes(ONBOARDING_HINT) && o.planted === 0 && o.answered === 0;
}

const GAMES: readonly GameMode[] = [1, 2, 3, 4, 5];

/** Карточки по порядку. `level` — цель пути из edition (`LEVEL`, «B1»). */
export function onboardingCards(level: string): OnboardingCard[] {
  return [
    {
      icon: '🌱',
      title: 'Привет! Это «Ферма»',
      items: ['Польские слова здесь растут как овощи: сажаешь слово, отвечаешь на вопросы, и оно вырастает.', 'Покажу главное за минуту. Потом это можно открыть снова: Настройки → «Как играть».'],
    },
    {
      icon: '🚶',
      title: 'Как ходить',
      items: [
        ['Компьютер: ', 'стрелки или W A S D.'],
        ['Телефон: ', 'экранные стрелки (d-pad) слева внизу или просто тап по месту, куда идти.'],
        ['Действие: ', 'кнопка A, клавиша E или Пробел. На телефоне можно тапнуть по предмету: герой подойдёт сам.'],
      ],
    },
    {
      icon: '🏡',
      title: 'Что где',
      items: [
        ['Дом: ', 'стол со словарём (Słownik), полка-кладовая (Spiżarnia), кровать (итог дня).'],
        ['Ферма: ', 'грядки, доска с мини-играми (Tablica), коробка урожая (Skrzynka).'],
        'Кот Rudy ходит рядом, ему можно не мешать.',
      ],
    },
    {
      icon: '📖',
      title: 'Как наполнить словарь',
      items: [
        'Подойди к столу в доме и открой Słownik.',
        ['Слова: ', 'выбери тему и нажми «＋» у слова, оно сядет на грядку.'],
        ['Фразы (Frazy): ', 'открываются, когда их слова подросли до ростка.'],
        ['＋ Своё: ', 'можно добавить любое своё слово.'],
      ],
    },
    {
      icon: '🎮',
      title: 'Как учить',
      items: [
        'Выйди на ферму, подойди к доске и выбери мини-игру:',
        ...GAMES.map((m): OnboardingItem => [`${MODE_ICON[m]} ${MODE_NAME[m].ru}`, '']),
        'Отвечаешь, а герой сам поливает грядки.',
      ],
    },
    {
      icon: '🌾',
      title: 'Как растут слова',
      items: [
        'Растения растут по дням: семечко, росток, кустик, урожай. За один день всё не вырастет.',
        'Урожай даёт слово, которое ты один раз собрал сам («Собери слово»).',
        'Выращенное слово попадает в банку на полке. Перезревшее («повтори») лучше освежить в игре.',
      ],
    },
    {
      icon: '🏁',
      title: `Цель: ${level}`,
      items: [
        `Уровни ведут к ${level}: полоска вверху экрана, тап по ней открывает путь.`,
        'Никаких лимитов и таймеров. Хватит 10–15 минут в день, главное приходить каждый день.',
      ],
    },
  ];
}

const css = `
.pq-ob { display: flex; flex-direction: column; gap: 10px; }
.pq-ob-icon { font-size: 38px; line-height: 1; text-align: center; }
.pq-ob-title { margin: 0; font-size: 21px; text-align: center; }
.pq-ob-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 16px; line-height: 1.35; }
.pq-ob-list li { padding: 7px 10px; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; }
.pq-ob-dots { display: flex; justify-content: center; gap: 6px; }
.pq-ob-dots i { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--pq-ink); background: #fffaf0; }
.pq-ob-dots i.on { background: var(--pq-accent); }
.pq-ob-nav { display: flex; gap: 8px; }
.pq-ob-nav .pq-btn { flex: 1; }
`;

export interface Onboarding {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  readonly index: number;
  /** Подписка на закрытие (любым способом: «Начать», ✕, Esc, тап мимо). */
  onClose(fn: () => void): () => void;
  dispose(): void;
}

export interface OnboardingDeps {
  bus?: Bus<BusEvents>;
  /** Цель пути («B1»). */
  level: string;
  /** Панель закрыта: записать флаг `onboarding` в сохранение. */
  seen(): void;
}

export function mountOnboarding(parent: HTMLElement, deps: OnboardingDeps): Onboarding {
  const bus = deps.bus ?? globalBus;
  const cards = onboardingCards(deps.level);
  const panel = createPanel({ title: 'Как играть', bus });
  panel.root.setAttribute('data-onboarding', '');
  panel.root.querySelector<HTMLElement>('.pq-frame')!.style.width = 'min(420px, 100%)';
  parent.append(el('style', {}, css), panel.root);
  let i = 0;
  const render = (): void => {
    const c = cards[i]!;
    const last = i === cards.length - 1;
    const list = el('ul', { class: 'pq-ob-list' });
    for (const it of c.items) list.append(typeof it === 'string' ? el('li', {}, it) : el('li', {}, el('b', {}, it[0]), it[1]));
    const dots = el('div', { class: 'pq-ob-dots', 'aria-label': `Карточка ${i + 1} из ${cards.length}` });
    cards.forEach((_, k) => dots.append(el('i', k === i ? { class: 'on' } : {})));
    const back = el('button', { type: 'button', class: 'pq-btn', 'data-ob': 'back', disabled: i === 0, ...nav('ob', 'h', 'back'), onclick: () => ((i = Math.max(0, i - 1)), render(), panel.focus('next')) }, 'Назад');
    const next = el('button', { type: 'button', class: 'pq-btn', 'data-ob': 'next', ...nav('ob', 'h', 'next'), onclick: () => (last ? api.close() : ((i += 1), render(), panel.focus('next'))) }, last ? 'Начать' : 'Дальше');
    panel.body.replaceChildren(el('div', { class: 'pq-ob', 'data-card': String(i) }, el('div', { class: 'pq-ob-icon', 'aria-hidden': 'true' }, c.icon), el('h3', { class: 'pq-ob-title' }, c.title), list, dots, el('div', { class: 'pq-ob-nav' }, back, next)));
    panel.body.scrollTop = 0;
  };
  // Любое закрытие (✕, Esc, «Начать») = онбординг пройден.
  panel.onClose(() => deps.seen());
  const api: Onboarding = {
    open() {
      if (panel.isOpen) return;
      i = 0;
      render();
      panel.open();
      panel.focus('next');
    },
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
    get index() {
      return i;
    },
    onClose: (fn) => panel.onClose(fn),
    dispose: () => panel.dispose(),
  };
  return api;
}
