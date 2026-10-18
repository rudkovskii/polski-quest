// Słownik · Словарь: книга на столе дома. Слова и фразы, темы, поиск без диакритики, фильтр по стадии, карточка, посадка.
import { fold } from '../systems/content';
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { Phrase, Word } from '../types/content';
import type { FarmApi, ItemInfo } from '../types/farm';
import { el } from './dom';
import { STAGE_INFO, TIP_CSS, type Tips } from './glossary';
import { createPanel, nav } from './panel';
import { iconKeyOf, stageIcon, STAGE_ICON_CSS } from './stageIcon';

type Tab = 'words' | 'phrases';
type Filter = 'all' | 'new' | 'growing' | 'grown';

const PAGE = 200;
const FILTERS: [Filter, string][] = [
  ['all', 'Все'],
  ['new', 'Не посажено'],
  ['growing', 'Растёт'],
  ['grown', 'Выращено'],
];
const GENDER: Record<NonNullable<Word['gender']>, string> = { m: 'м. р.', f: 'ж. р.', n: 'ср. р.', pl: 'мн. ч.' };

const css = `
${STAGE_ICON_CSS}
${TIP_CSS}
.dict-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; opacity: .85; align-items: center; }
.dict-legend span { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
.dict { display: flex; flex-direction: column; gap: 10px; }
.dict-head { position: sticky; top: -12px; z-index: 3; margin: -12px -12px 0; padding: 12px 12px 8px; background: var(--pq-cream); display: flex; flex-direction: column; gap: 8px; border-bottom: 2px solid var(--pq-wood-dark); }
.dict-scope { font-size: 13px; opacity: .8; padding: 0 2px 4px; }
.dict-cols.nocard { grid-template-columns: 150px minmax(0, 1fr); }
.dict-tabs, .dict-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.dict-tabs .pq-btn { flex: 1 1 0; font-size: 17px; }
.dict-search { flex: 1 1 180px; min-width: 0; font-family: inherit; font-size: 16px; padding: 9px 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #fffaf0; color: var(--pq-ink); box-sizing: border-box; }
.dict-cols { display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1.1fr); gap: 10px; height: min(58vh, 520px); }
.dict-cols > div { overflow-y: auto; overflow-x: hidden; min-height: 0; }
.dict-topics { display: flex; flex-direction: column; gap: 4px; }
.dict-topic { text-align: left; font-family: inherit; font-weight: 600; font-size: 14px; line-height: 1.15; color: var(--pq-ink); background: #efe0bb; border: 2px solid var(--pq-wood-dark); border-radius: 6px; padding: 7px 8px; cursor: pointer; }
.dict-topic small { display: block; font-weight: 400; opacity: .7; }
.dict-topic.on { background: var(--pq-wood); color: var(--pq-cream); }
.dict-list { display: flex; flex-direction: column; gap: 4px; }
.dict-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 6px; text-align: left; font: inherit; color: var(--pq-ink); background: #fffaf0;
  border: 2px solid var(--pq-wood-dark); border-radius: 6px; padding: 7px 9px; cursor: pointer; }
.dict-row.sel { background: #f2d9a0; }
.dict-row .pl { font-size: 18px; font-weight: 700; overflow-wrap: anywhere; }
.dict-row .ru { grid-column: 1; font-size: 14px; opacity: .8; overflow-wrap: anywhere; }
.dict-row .st { grid-row: 1 / span 2; grid-column: 2; font-size: 18px; min-width: 32px; min-height: 32px; display: flex; align-items: center; justify-content: center; }
.dict-empty { opacity: .7; padding: 12px 4px; }
.dict-card { background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; align-content: start; }
.dict-card .big { font-size: 28px; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.dict-card .ru { font-size: 19px; }
.dict-card .tr { font-style: italic; opacity: .75; }
.dict-card .ex { border-left: 4px solid var(--pq-accent); padding-left: 8px; }
.dict-card .ex .pl { font-size: 17px; font-weight: 600; }
.dict-card .ff { background: #ffe9c2; border: 2px dashed var(--pq-accent); border-radius: 6px; padding: 7px 9px; font-size: 14px; }
.dict-card .lock { background: #eadfc4; border-radius: 6px; padding: 8px 10px; font-size: 14px; }
.dict-card .lock ul { margin: 4px 0 0; padding-left: 18px; }
.dict-card .status { font-size: 14px; }
.dict-card .btns { display: flex; flex-wrap: wrap; gap: 8px; }
.dict-more { align-self: stretch; margin-top: 4px; }
@media (max-width: 640px) {
  .dict-cols { display: block; height: auto; }
  .dict-cols > div { overflow: visible; }
  .dict-topics { flex-direction: row; overflow-x: auto !important; padding-bottom: 6px; margin-bottom: 8px; }
  .dict-topic { flex: 0 0 auto; white-space: nowrap; }
  .dict-list { max-height: 38dvh; overflow-y: auto !important; margin-bottom: 10px; }
  .dict-filters .pq-btn { flex: 1 1 auto; }
}
`;

export interface DictionaryScreen {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

interface Entry {
  id: string;
  pl: string;
  ru: string;
  topic: string;
  fpl: string;
  fru: string;
}

export function mountDictionary(parent: HTMLElement, api: FarmApi, bus?: Bus<BusEvents>, tips?: Tips): DictionaryScreen {
  const panel = createPanel({ title: 'Słownik · Словарь', wide: true, bus });
  const mkEntries = (xs: readonly (Word | Phrase)[]): Entry[] => xs.map((x) => ({ id: x.id, pl: x.pl, ru: x.ru, topic: x.topic, fpl: fold(x.pl), fru: fold(x.ru) }));
  const entries: Record<Tab, Entry[]> = { words: mkEntries(api.words), phrases: mkEntries(api.phrases) };
  const topicsOf = (tab: Tab) => {
    const used = new Set(entries[tab].map((e) => e.topic));
    return api.topics.filter((t) => used.has(t.id));
  };

  let tab: Tab = 'words';
  let topic = '';
  let filter: Filter = 'all';
  let query = '';
  let selected: string | null = null;
  let limit = PAGE;

  const tabBtns = (['words', 'phrases'] as Tab[]).map((t) =>
    el('button', { type: 'button', class: 'pq-btn', 'data-tab': t, ...nav('tabs', 'h', `tab:${t}`), onclick: () => setTab(t) }, t === 'words' ? 'Słowa' : 'Frazy'),
  );
  const search = el('input', { type: 'search', class: 'dict-search', placeholder: 'Поиск: kot, кот, zolw…', 'aria-label': 'Поиск', 'data-search': '', ...nav('search', 'v', 'search'), autocomplete: 'off' });
  search.addEventListener('input', () => {
    query = search.value;
    limit = PAGE;
    renderTabs();
    renderList();
    renderBulk();
    panel.syncFocus();
  });
  // Нажатие на поле через навигацию (Enter) ставит туда курсор.
  search.addEventListener('click', () => search.focus());
  const filterBtns = FILTERS.map(([f, label]) =>
    el('button', { type: 'button', class: 'pq-btn small', 'data-filter': f, ...nav('filters', 'h', `filter:${f}`), onclick: () => ((filter = f), (limit = PAGE), renderAll()) }, label),
  );
  const bulk = el('button', { type: 'button', class: 'pq-btn small', 'data-bulk': '', hidden: true, ...nav('filters', 'h', 'bulk'), onclick: () => plantTopic() });
  const topicsCol = el('div', { class: 'dict-topics' });
  // Легенда стадий: значок и русская подпись («кустик» вместо жаргона «куст»).
  const legend = el(
    'div',
    { class: 'dict-legend', 'data-legend': '' },
    ...(['seed', 'sprout', 'bush', 'ripe', 'overripe'] as const).map((st) => {
      const stIco = stageIcon(STAGE_INFO[st].icon, import.meta.env.BASE_URL);
      return el('span', { title: STAGE_INFO[st].hint, 'data-stage': st }, stIco, STAGE_INFO[st].ru);
    }),
  );
  const listCol = el('div', { class: 'dict-list' });
  const cardCol = el('div', { class: 'dict-card', 'data-card': '' });
  const cardWrap = el('div', { hidden: true }, cardCol);
  const cols = el('div', { class: 'dict-cols nocard', 'data-cols': '' }, topicsCol, el('div', {}, listCol), cardWrap);
  const note = el('span', { role: 'status', 'data-note': '' });
  panel.footer.append(note);
  panel.body.append(
    el('style', {}, css),
    el(
      'div',
      { class: 'dict' },
      el('div', { class: 'dict-head' }, el('div', { class: 'dict-tabs' }, ...tabBtns), search),
      el('div', { class: 'dict-filters' }, ...filterBtns, bulk),
      legend,
      cols,
    ),
  );
  parent.append(panel.root);

  const say = (msg: string): void => {
    note.textContent = msg;
    panel.footer.hidden = !msg;
  };

  // ---- данные
  const infoOf = new Map<string, ItemInfo>();
  const info = (id: string): ItemInfo => {
    let i = infoOf.get(id);
    if (!i) infoOf.set(id, (i = api.info(id)));
    return i;
  };
  const locked = (id: string): boolean => tab === 'phrases' && info(id).status === 'new' && api.missingWords(id).length > 0;
  const group = (i: ItemInfo): Filter => (i.status === 'new' ? 'new' : i.status === 'grown' ? 'grown' : 'growing');

  /** Тема в деле: пока вводят поиск, чип темы не режет выдачу (поиск по всем темам). */
  const topicNow = (): string => (query.trim() ? '' : topic);
  const matches = (): Entry[] => {
    const q = fold(query.trim());
    return entries[tab].filter((e) => {
      if (topicNow() && e.topic !== topicNow()) return false;
      if (q && !e.fpl.includes(q) && !e.fru.includes(q)) return false;
      if (filter !== 'all' && group(info(e.id)) !== filter) return false;
      return true;
    });
  };
  /** Что сажает «Посадить всю тему»: новые элементы темы на текущей вкладке (фразы — только доступные). */
  const plantable = (): string[] => (topicNow() ? entries[tab].filter((e) => e.topic === topicNow() && info(e.id).status === 'new' && !locked(e.id)).map((e) => e.id) : []);

  // ---- отрисовка
  /** Значок стадии: семя, росток, куст, урожай (в банке), перезревшее; в мешке — тусклое семя. */
  const statusIcon = (id: string): Node | string => {
    if (locked(id)) return '🔒';
    const i = info(id);
    const k = iconKeyOf(i);
    return k ? stageIcon(k, import.meta.env.BASE_URL, i.status === 'bag') : '';
  };

  function renderTabs(): void {
    for (const b of tabBtns) b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    for (const b of filterBtns) b.classList.toggle('on', b.getAttribute('data-filter') === filter);
    // Чип темы подсвечивается по выбранной теме (раньше оставался на «Все»).
    for (const b of topicsCol.querySelectorAll<HTMLElement>('.dict-topic')) b.classList.toggle('on', b.getAttribute('data-topic') === topicNow());
  }

  function renderTopics(): void {
    const mk = (id: string, pl: string, ru?: string): HTMLButtonElement =>
      el(
        'button',
        { type: 'button', class: topicNow() === id ? 'dict-topic on' : 'dict-topic', 'data-topic': id, ...nav('topics', 'v', `topic:${id}`), onclick: () => ((topic = id), (query = ''), (search.value = ''), (limit = PAGE), say(''), renderAll()) },
        pl,
        ru ? el('small', {}, ru) : null,
      );
    topicsCol.replaceChildren(mk('', 'Все'), ...topicsOf(tab).map((t) => mk(t.id, t.pl, t.ru)));
  }

  function renderBulk(): void {
    const n = plantable().length;
    bulk.hidden = n === 0;
    bulk.textContent = `Посадить всю тему (${n})`;
  }

  function renderList(): void {
    infoOf.clear();
    const all = matches();
    const shown = all.slice(0, limit);
    const rows: HTMLElement[] = shown.map((e) =>
      el(
        'button',
        {
          type: 'button',
          class: e.id === selected ? 'dict-row sel' : 'dict-row',
          'data-id': e.id,
          ...nav('rows', 'v', `row:${e.id}`),
          onclick: () => select(e.id),
        },
        el('span', { class: 'pl' }, e.pl),
        el('span', { class: 'st', 'aria-hidden': 'true' }, statusIcon(e.id)),
        el('span', { class: 'ru' }, e.ru),
      ),
    );
    if (!rows.length) rows.push(el('div', { class: 'dict-empty' }, query || filter !== 'all' ? 'Ничего не найдено' : 'Здесь пока пусто'));
    if (query.trim() && topic) rows.unshift(el('div', { class: 'dict-scope', 'data-scope': '' }, 'Поиск по всем темам'));
    if (all.length > shown.length) {
      rows.push(
        el('button', { type: 'button', class: 'pq-btn small dict-more', 'data-more': '', ...nav('rows', 'v', 'more'), onclick: () => ((limit += PAGE), renderList(), panel.syncFocus()) }, `Показать ещё (${all.length - shown.length})`),
      );
    }
    listCol.replaceChildren(...rows);
  }

  /** Подпись стадии: значок и русское слово. */
  const stageLabel = (st: NonNullable<ItemInfo['stage']>): HTMLElement =>
    el('span', { class: 'stg', 'data-stage-label': st }, stageIcon(STAGE_INFO[st].icon, import.meta.env.BASE_URL), ` ${STAGE_INFO[st].ru}`);

  function statusLine(i: ItemInfo, lock: boolean): (Node | string)[] {
    if (lock) return ['Закрыто: фраза откроется позже.'];
    switch (i.status) {
      case 'new':
        return ['Не посажено.'];
      case 'bag':
        return ['В мешке: ждёт свободную грядку.'];
      case 'growing':
        return i.stage === 'overripe'
          ? ['На грядке: ', stageLabel('overripe'), '. Вернулось повторить.']
          : ['На грядке: ', i.stage ? stageLabel(i.stage) : 'растёт', `, капель 💧${i.drops}.${i.next ? ` Дальше: ${i.next}.` : ''}`];
      case 'grown':
        return [`В банке${i.harvests ? ` (собрано раз: ${i.harvests})` : ''}.`];
    }
  }

  function renderCard(): void {
    const id = selected;
    const w = id ? api.word(id) : undefined;
    const p = id && !w ? api.phrase(id) : undefined;
    const item = w ?? p;
    // Пустую карточку не показываем: пока ничего не выбрано, колонка скрыта (список занимает её место).
    cardWrap.hidden = !item;
    cols.classList.toggle('nocard', !item);
    if (!id || !item) {
      cardCol.replaceChildren();
      return;
    }
    const i = info(id);
    const lock = !!p && i.status === 'new' && api.missingWords(id).length > 0;
    const kids: Node[] = [el('div', { class: 'big', 'data-pl': '' }, item.pl), el('div', { class: 'ru' }, item.ru), el('div', { class: 'tr' }, item.tr)];
    if (w?.gender) kids.push(el('div', { class: 'status' }, GENDER[w.gender]));
    if (w?.ex) kids.push(el('div', { class: 'ex' }, el('div', { class: 'pl' }, w.ex.pl), el('div', { class: 'ru' }, w.ex.ru)));
    if (w?.ff) kids.push(el('div', { class: 'ff' }, `Не путать: похоже на «${w.ff.ru}», а значит: ${w.ff.note}`));
    kids.push(
      el(
        'div',
        { class: 'btns' },
        el('button', { type: 'button', class: 'pq-btn small', 'data-say': '', 'aria-label': 'Озвучить', ...nav('card', 'v', 'say'), onclick: () => api.say(id) }, '▶'),
        el('button', { type: 'button', class: 'pq-btn small', 'data-say-slow': '', ...nav('card', 'v', 'slow'), onclick: () => api.say(id, true) }, '▶ медленно'),
      ),
    );
    if (lock) {
      const miss = api.missingWords(id);
      kids.push(
        el(
          'div',
          { class: 'lock', 'data-lock': '' },
          '🔒 Откроется, когда эти слова вырастут до стадии «кустик»:',
          el(
            'ul',
            {},
            ...miss.map((m) => {
              const mw = api.word(m);
              return el('li', {}, mw ? `${mw.pl} — ${mw.ru}` : m);
            }),
          ),
        ),
      );
    }
    kids.push(el('div', { class: 'status', 'data-status': '' }, ...statusLine(i, lock)));
    const tipId = i.status === 'bag' ? 'bag' : i.status === 'grown' ? 'jar' : null;
    const tip = tipId ? tips?.note(tipId) : null;
    if (tip) kids.push(tip);
    if (i.status === 'new') {
      kids.push(
        el('button', { type: 'button', class: 'pq-btn', 'data-plant': '', disabled: lock, ...nav('card', 'v', 'plant'), onclick: () => plantOne(id) }, 'Posadź · Посадить'),
      );
    }
    cardCol.replaceChildren(...kids);
  }

  function renderAll(): void {
    renderTabs();
    renderList();
    renderBulk();
    renderCard();
    panel.syncFocus();
  }

  // ---- действия
  function select(id: string): void {
    selected = id;
    say('');
    for (const r of listCol.querySelectorAll<HTMLElement>('.dict-row')) r.classList.toggle('sel', r.getAttribute('data-id') === id);
    renderCard();
    // Шапка (вкладки и поиск) прилипает сверху: карточка прокручивается под неё, а не уводит шапку из кадра.
    if (typeof cardCol.scrollIntoView === 'function') {
      cardCol.style.scrollMarginTop = `${(search.parentElement?.offsetHeight ?? 0) + 8}px`;
      cardCol.scrollIntoView({ block: 'nearest' });
    }
  }

  function setTab(t: Tab): void {
    if (t === tab) return;
    tab = t;
    if (topic && !topicsOf(tab).some((x) => x.id === topic)) topic = '';
    selected = null;
    limit = PAGE;
    say('');
    renderTopics();
    renderAll();
  }

  function plantOne(id: string): void {
    const r = api.plant([id]);
    say(r.bag > 0 ? 'В мешке: грядки заняты' : r.planted > 0 ? 'Посажено на грядку' : 'Уже посажено');
    const bagTip = r.bag > 0 ? tips?.note('bag') : null;
    if (bagTip) note.append(' ', bagTip);
    renderAll();
  }

  function plantTopic(): void {
    const ids = plantable();
    if (!ids.length) return;
    const r = api.plant(ids);
    say(`Посажено: ${r.planted}${r.bag > 0 ? `, в мешке (грядки заняты): ${r.bag}` : ''}`);
    // Тема остаётся выбранной; фильтр «Не посажено» после посадки пуст, поэтому возвращаем «Все».
    if (filter === 'new') filter = 'all';
    const bagTip = r.bag > 0 ? tips?.note('bag') : null;
    if (bagTip) note.append(' ', bagTip);
    renderAll();
  }

  // ---- жизненный цикл
  let off: (() => void) | null = null;
  panel.onClose(() => {
    off?.();
    off = null;
    tips?.commit();
  });

  return {
    open() {
      if (panel.isOpen) return;
      say('');
      panel.open();
      off?.();
      off = api.onChange(() => {
        if (!panel.isOpen) return;
        renderAll();
      });
      renderTopics();
      renderAll();
      const first = listCol.querySelector<HTMLElement>('[data-nav]');
      if (first) panel.focus(first);
    },
    close() {
      panel.close();
    },
    get isOpen() {
      return panel.isOpen;
    },
  };
}
