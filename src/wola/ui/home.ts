// «Mój dom» (W-01, ВОЛЯ.md пп. 5–6): пиксельная комната без ходьбы, активные предметы — тап или стрелки + Enter.
//   • ноутбук на столе → «Słowniczek», дневная порция (5) новых слов;
//   • книжная полка «Słownik» → темы-наборы, взять ещё 5 сверх порции; выше потолка дня — предупреждение, не запрет;
//   • полка с банками → собранные в огороде слова (банку пора проверить — «!»);
//   • кровать → итог дня и «Do jutra».
import { deriveContent } from '../../systems/derive';
import { retrievalSince } from '../../systems/session';
import { activeToday, summaryMin } from '../../ui/daySummary';
import { el } from '../../ui/dom';
import { runObchod } from '../../ui/obchod';
import { btn, type PlLabel } from '../../ui/overlay/kit';
import { dayCap, LAPTOP_LESSON, overCap, portion, shelf, shelfLesson, wolaDay, wolaGarden, type ShelfTheme } from '../systems/wola';
import { boxOf, changed, derived, openPlace, panel, stat, words, write, type WolaDeps } from './kit';
import { laptopRest, runSlowniczek } from './laptop';
import { fitScale, roomEl, spriteEl, T, type Room } from './pix';

/** Комната 10×7: стена, окно, полка с банками, стеллаж, стол с ноутбуком, кровать, ковёр. */
export const HOME_ROOM: Room = {
  rows: [
    'WWWWWWWWWW',
    'WRWOWWJJWW',
    'FrFFLBFFbc',
    'FFFFFFFFFF',
    'FFFddFFFFF',
    'FFFddFFFFF',
    'FFFFFFFFFF',
  ],
  legend: {
    W: 'wall', F: 'hall', R: 'w_regal_g', r: 'w_regal_d', O: 'w_okno', J: 'w_polka', L: 'w_biurko_l', B: 'w_biurko_r',
    b: 'w_lozko_l', c: 'w_lozko_r', d: 'w_dywan',
  },
  under: 'hall',
};

export type HomeSpot = 'laptop' | 'slownik' | 'sloiki' | 'lozko';
/** Предметы: клетки [x, y, w, h], подпись (польская + русская), где подпись (над/под). */
export const HOME_SPOTS: { id: HomeSpot; at: [number, number, number, number]; label: PlLabel; tag: 'top' | 'bottom' }[] = [
  { id: 'laptop', at: [4, 2, 2, 1], label: { pl: 'Słowniczek', ru: 'ноутбук: новые слова' }, tag: 'bottom' },
  { id: 'slownik', at: [1, 1, 1, 2], label: { pl: 'Słownik', ru: 'полка: темы' }, tag: 'top' },
  { id: 'sloiki', at: [6, 1, 2, 1], label: { pl: 'Słoiki', ru: 'банки урожая' }, tag: 'top' },
  { id: 'lozko', at: [8, 2, 2, 1], label: { pl: 'Łóżko', ru: 'итог дня' }, tag: 'bottom' },
];

const WARN: PlLabel = { pl: 'Dużo na dziś', ru: 'много на сегодня' };

/** Экран дома. Возвращается, когда игрок нажал «Wola» (или Esc). */
export async function runHome(deps: WolaDeps): Promise<void> {
  const frame = openPlace(deps, 'dom', { pl: 'Mój dom', ru: 'Мой дом' });
  let busy = false;
  const act = async (id: HomeSpot): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      if (id === 'laptop') await laptop(deps);
      else if (id === 'slownik') await slownik(deps);
      else if (id === 'sloiki') await sloiki(deps);
      else await lozko(deps, frame.close);
    } finally {
      busy = false;
      if (!frame.layer.closed) paint();
    }
  };
  const paint = (): void => {
    const d = derived(deps);
    const now = deps.clock.now();
    const p = portion(deps.store.progress, deps.book, d);
    const g = wolaGarden(d, now, deps.content.tuning, deps.store.progress.world.flags);
    const box = boxOf(frame.stage);
    const k = fitScale(10, 7, box.w - 8, box.h - 40);
    // Мелкий масштаб (телефон): подписи компактнее, без русской строки — не закрывают соседние предметы.
    const scene = el('div', { class: `wl-scene${k < 3 ? ' small' : ''}`, 'data-k': k });
    scene.append(roomEl(deps.atlas, HOME_ROOM, k));
    // Банки на полке: до 8 штук, остальное числом.
    g.jars.slice(0, 8).forEach((_, i) => {
      const s = spriteEl(deps.atlas, 'plant_jar/0', Math.max(1, Math.floor(k / 2)));
      s.style.position = 'absolute';
      s.style.left = `${(6 * T + 1 + (i % 4) * 7.5) * k}px`;
      s.style.top = `${(1 * T + (i < 4 ? -1 : 7)) * k}px`;
      scene.append(s);
    });
    const counts: Record<HomeSpot, { text: string; due?: boolean } | null> = {
      laptop: p.left ? { text: `новых слов: ${p.left}` } : null,
      slownik: null,
      sloiki: g.jars.length ? { text: `банок: ${g.jars.length}${g.jars.some((j) => j.dueCard) ? ' · !' : ''}`, due: g.jars.some((j) => j.dueCard) } : null,
      lozko: null,
    };
    for (const s of HOME_SPOTS) {
      const [x, y, w, h] = s.at;
      const c = counts[s.id];
      const hot = el(
        'button',
        {
          type: 'button',
          class: 'wl-hot',
          'data-nav': true,
          'data-spot': s.id,
          'aria-label': `${s.label.pl} — ${s.label.ru}`,
          style: `left:${x * T * k}px;top:${y * T * k}px;width:${w * T * k}px;height:${h * T * k}px`,
          onclick: () => void act(s.id),
        },
        el('span', { class: `wl-tag ${s.tag}` }, el('span', { lang: 'pl' }, s.label.pl), el('small', {}, s.label.ru), c ? el('span', { class: `cnt${c.due ? ' due' : ''}`, 'data-count': s.id }, c.text) : null),
      );
      scene.append(hot);
    }
    frame.stage.replaceChildren(scene);
  };
  paint();
  const onResize = (): void => paint();
  const win = frame.layer.el.ownerDocument.defaultView;
  win?.addEventListener('resize', onResize);
  queueMicrotask(() => frame.stage.querySelector<HTMLElement>('[data-spot="laptop"]')?.focus({ preventScroll: true }));
  await frame.closed;
  win?.removeEventListener('resize', onResize);
}

/** Мягкий потолок (ВОЛЯ.md п. 6): выше — предупреждение «огород не справится», решает игрок. */
export async function capOk(deps: WolaDeps, n: number): Promise<boolean> {
  const c = dayCap(deps.store.progress, derived(deps));
  if (!overCap(c, n)) return true;
  const a = await panel(
    deps.overlay,
    WARN,
    [
      el('div', { class: 'note', 'data-warn': 'cap' }, 'Много на сегодня, огород не справится.'),
      el('div', {}, `Сегодня уже ${words(c.today)}, потолок — ${c.cap} (меняется в настройках). Новые слова завтра придут на удобрение все разом.`),
    ],
    [
      { act: 'no', label: 'Не сейчас', primary: true },
      { act: 'yes', label: 'Всё равно взять' },
    ],
    'no',
    { 'data-panel': 'cap' },
  );
  return a === 'yes';
}

async function laptop(deps: WolaDeps): Promise<void> {
  const p = portion(deps.store.progress, deps.book, derived(deps));
  if (!p.left) {
    const all = !deps.book.home.some((v) => !(derived(deps).cards[`${v.id}#rec`]));
    await laptopRest(deps, all ? ['Wszystkie słowa w ogródku!', 'Все слова словаря уже в огороде.'] : [`Na dziś wszystko. На сегодня порция (${p.size}) добавлена.`, 'Хочешь ещё — возьми тему с полки «Słownik».']);
    return;
  }
  if (!(await capOk(deps, p.next.length))) return;
  await runSlowniczek(deps, { words: p.next, lesson: LAPTOP_LESSON, title: { pl: 'Słowniczek', ru: `новые слова дня · ${p.done + 1}–${p.done + p.next.length}` }, after: 'Ещё слова — на полке «Słownik».' });
}

/** Полка «Słownik»: темы, сколько взято, «взять 5». */
export async function slownik(deps: WolaDeps): Promise<void> {
  for (;;) {
    const list = shelf(deps.book, derived(deps));
    const c = dayCap(deps.store.progress, derived(deps));
    const rows = list.map((s) => themeRow(s));
    const pick = await panel<string>(
      deps.overlay,
      { pl: 'Słownik', ru: 'словарь: взять ещё 5 слов темы' },
      [el('div', { class: 'list', 'data-today': c.today }, `Сегодня новых: ${c.today} из ${c.cap}.`), ...rows],
      [{ act: 'close', label: 'OK', primary: true }],
      'close',
      { 'data-panel': 'slownik' },
    );
    if (pick === 'close') return;
    const s = list.find((x) => x.theme.id === pick);
    if (!s || !s.next.length) continue;
    if (!(await capOk(deps, s.next.length))) continue;
    await runSlowniczek(deps, { words: s.next, lesson: shelfLesson(s.theme.id), title: { pl: `Słownik · ${s.theme.pl}`, ru: s.theme.ru } });
  }

  function themeRow(s: ShelfTheme): HTMLElement {
    const pct = s.total ? Math.round((s.taken / s.total) * 100) : 0;
    // Кнопка темы отвечает панели своим id (`data-pick`).
    const b = btn('', () => undefined, 'wl-theme', { 'data-nav': true, 'data-pick': s.theme.id, 'data-theme': s.theme.id, ...(s.next.length ? {} : { disabled: true }) });
    b.replaceChildren(
      el('span', { class: 't' }, el('b', { lang: 'pl' }, s.theme.pl), el('small', {}, s.theme.ru)),
      el('span', { class: 'meter' }, el('i', { style: `width:${pct}%` })),
      el('span', { class: 'n', 'data-taken': `${s.taken}/${s.total}` }, s.next.length ? `${s.taken}/${s.total} · +${s.next.length}` : `${s.taken}/${s.total} ✓`),
    );
    return b;
  }
}

/** Полка с банками: собранные слова; банку, которую пора проверить, — тапом на повтор. */
async function sloiki(deps: WolaDeps): Promise<void> {
  for (;;) {
    const d = derived(deps);
    const g = wolaGarden(d, deps.clock.now(), deps.content.tuning, deps.store.progress.world.flags);
    const jars = g.jars.map((j) => btn('', () => undefined, 'wl-jar', { 'data-nav': true, 'data-jar': j.item, ...(j.dueCard ? { 'data-pick': `jar:${j.item}` } : {}) }));
    g.jars.forEach((j, i) => {
      const v = deps.content.vocab.get(j.item)?.value;
      jars[i]!.replaceChildren(spriteEl(deps.atlas, 'plant_jar/0', 2), el('b', { lang: 'pl' }, v?.pl ?? j.item), el('small', {}, v?.ru ?? ''), ...(j.dueCard ? [el('span', { class: 'due' }, '! проверить')] : []));
    });
    const a = await panel<string>(
      deps.overlay,
      { pl: 'Słoiki', ru: 'банки: собранный урожай' },
      g.jars.length ? [el('div', { class: 'wl-jars' }, ...jars)] : [el('div', { class: 'list' }, 'Пока пусто. Слово дозревает в огороде за 3–4 недели повторов: интервал ≥ 21 дня — «Zbiór», и банка здесь.')],
      [{ act: 'close', label: 'OK', primary: true }],
      'close',
      { 'data-panel': 'sloiki' },
    );
    if (!a.startsWith('jar:')) return;
    await runObchod({ ...deps }, { mode: 'day', fromItem: a.slice(4), nawoz: true, limit: 1 });
  }
}

/** Кровать: итог дня и «Do jutra» (пишет `session` и `seg: sleep`, как «Dobranoc» основной игры). */
async function lozko(deps: WolaDeps, leave: () => void): Promise<void> {
  const now = deps.clock.now();
  const s = wolaDay(deps.store.progress, deriveContent(deps.content), now, deps.tz);
  const d = derived(deps);
  const pl = (id: string): string => deps.content.vocab.get(id)?.value.pl ?? id;
  const active = deps.activeMs ? activeToday(deps.store.progress.log.events, d.todayStart, deps.activeMs()) : undefined;
  const body = s.empty
    ? [el('div', { class: 'list', 'data-empty': true }, 'Сегодня ещё ничего: добавь пару слов на ноутбуке или удобри огород.')]
    : [
        stat('Добавлено слов', String(s.added.length), 'added'),
        s.added.length ? el('div', { class: 'list', lang: 'pl' }, s.added.map(pl).join(', ')) : null,
        stat('Удобрено растений', String(s.fertilized), 'fertilized'),
        stat('Выросло', String(s.grewWola.length), 'grew'),
        stat('Собрано в банки', String(s.harvestedToday.length), 'harvested'),
        s.harvestedToday.length ? el('div', { class: 'list', lang: 'pl' }, s.harvestedToday.map(pl).join(', ')) : null,
        stat('Минуты в заданиях', `${summaryMin(s.retrievalMs)} мин`, 'retrieval'),
        active !== undefined ? stat('Всего в игре', `${summaryMin(Math.max(active, s.retrievalMs))} мин`, 'active') : null,
        stat('Завтра к удобрению', String(s.tomorrowPlants), 'tomorrow'),
      ];
  const a = await panel(
    deps.overlay,
    { pl: 'Łóżko', ru: 'итог дня' },
    body,
    [
      { act: 'stay', label: 'Ещё поиграю' },
      { act: 'sleep', label: { pl: 'Do jutra', ru: 'до завтра' }, primary: true },
    ],
    'stay',
    { 'data-panel': 'lozko', 'data-summary': s.day },
  );
  if (a !== 'sleep') return;
  const ts = deps.clock.now();
  const since = deps.sessionStart?.() ?? 0;
  write(deps, { k: 'session', ts, mode: 'day', ms: Math.round(deps.activeMs?.() ?? 0), retrievalMs: retrievalSince(deps.store.progress.log.events, since) });
  write(deps, { k: 'seg', ts, seg: 'sleep' });
  deps.onSession?.();
  changed(deps);
  leave();
}
