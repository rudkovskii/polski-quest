// Słownik · Словарь: книга на столе дома. Слова и фразы, темы, поиск без диакритики, фильтр по стадии, карточка, посадка.
import { fold } from '../systems/content';
import { isCustomId, type RuplDb } from '../systems/customWords';
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { Phrase, Word } from '../types/content';
import type { FarmApi, ItemInfo } from '../types/farm';
import { CUSTOM_CSS, createCustomPane } from './customWord';
import { el } from './dom';
import { STAGE_INFO, TIP_CSS, type Tips } from './glossary';
import { createPanel, nav } from './panel';
import { sayButton, SAY_CSS, type SayFn } from './sayButton';
import { iconKeyOf, stageIcon, STAGE_ICON_CSS } from './stageIcon';

type Tab = 'words' | 'phrases' | 'add';
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
${CUSTOM_CSS}
${SAY_CSS}
.dict-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; opacity: .85; align-items: center; }
.dict-legend span { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
.dict { display: flex; flex-direction: column; gap: 10px; }
/* B1 (тест 4): вкладки и поиск в одну строку, высота шапки ≈ 60 px (≤ 90 на iPhone); поле не растягивается по высоте. */
.dict-head { position: sticky; top: -12px; z-index: 3; margin: -12px -12px 0; padding: 10px 12px 8px; background: var(--pq-cream); display: flex; flex-direction: column; gap: 6px; border-bottom: 2px solid var(--pq-wood-dark); max-height: 120px; box-sizing: border-box; }
/* F5a: в липкой шапке три ряда: вкладки с поиском, чипы тем (телефон), кнопки посадки темы. */
.dict-headrow { display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 8px; }
.dict-bulkrow { display: flex; gap: 6px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.dict-bulkrow::-webkit-scrollbar { display: none; }
.dict-bulkrow[hidden], .dict-bulkrow:not(:has(:not([hidden]))) { display: none; }
.dict-bulkrow .pq-btn { flex: 0 0 auto; white-space: nowrap; }
.dict-scope { font-size: 13px; opacity: .8; padding: 0 2px 4px; }
.dict-cols.nocard { grid-template-columns: 150px minmax(0, 1fr); }
.dict-tabs, .dict-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.dict-headrow .dict-tabs { flex: 0 0 auto; flex-wrap: nowrap; gap: 6px; }
.dict-tabs .pq-btn { flex: 0 0 auto; font-size: 16px; height: 40px; padding: 0 12px; }
.dict-search { flex: 1 1 auto; align-self: center; height: 40px; min-height: 40px; max-height: 40px; line-height: 20px; width: auto; min-width: 0; font-family: inherit; font-size: 16px; padding: 0 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #fffaf0; color: var(--pq-ink); box-sizing: border-box; }
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
.dict-card .exrow { display: flex; align-items: flex-start; gap: 8px; } .dict-card .exrow > .pl { flex: 1 1 auto; min-width: 0; }
.dict-card .ex .pl { font-size: 17px; font-weight: 600; }
.dict-card .ff { background: #ffe9c2; border: 2px dashed var(--pq-accent); border-radius: 6px; padding: 7px 9px; font-size: 14px; }
.dict-card .lock { background: #eadfc4; border-radius: 6px; padding: 8px 10px; font-size: 14px; }
.dict-card .lock ul { margin: 4px 0 0; padding-left: 18px; }
.dict-card .status { font-size: 14px; }
.dict-card .btns { display: flex; flex-wrap: wrap; gap: 8px; }
/* F5a: место под «Посадить» занято всегда: после посадки кнопка уходит, а высота карточки не меняется. */
.dict-card .plant-slot { min-height: 46px; display: flex; align-items: center; }
.dict-card .plant-slot .done { font-size: 14px; opacity: .75; }
.dict-more { align-self: stretch; margin-top: 4px; }
@media (max-width: 640px) {
  .dict-cols { display: block; height: auto; }
  .dict-cols > div { overflow: visible; }
  /* F5a: чипы тем — в липкой шапке, одна строка с горизонтальной прокруткой. */
  .dict-head .dict-topics { flex-direction: row; overflow-x: auto !important; gap: 6px; padding: 0; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .dict-head .dict-topics::-webkit-scrollbar { display: none; }
  .dict-head .dict-topic { flex: 0 0 auto; white-space: nowrap; padding: 3px 10px; height: 30px; font-size: 14px; box-sizing: border-box; display: flex; align-items: center; }
  .dict-head .dict-topic small { display: none; }
  .dict-head { padding: 5px 12px; gap: 4px; }
  .dict-head .dict-tabs .pq-btn, .dict-head .dict-search { height: 36px; min-height: 36px; max-height: 36px; }
  /* Три вкладки («＋ Своё») и поиск в одну строку на 375 px: вкладки уже, поиск не сжимается в щель. */
  .dict-head .dict-tabs .pq-btn { padding: 0 8px; font-size: 14px; }
  .dict-headrow { gap: 6px; }
  .dict-head .dict-search { min-width: 90px; }
  .dict-bulkrow .pq-btn.small { padding: 4px 9px; font-size: 13px; height: 30px; box-sizing: border-box; }
  .dict-legend { display: none; }
  /* Телефон: строка слова в одну линию (польское, перевод мельче с многоточием, значок). Список листает сама панель:
     карточка слова прилипает к низу и не сдвигает строки (F5a), поэтому у строк отступ под шапку и карточку. */
  .dict-list { margin-bottom: 10px; gap: 3px; }
  .dict-row { scroll-margin-top: 130px; scroll-margin-bottom: 240px; }
  .dict-cardwrap { position: sticky; bottom: -4px; z-index: 2; }
  .dict-cardwrap .dict-card { height: 230px; box-sizing: border-box; overflow-y: auto; box-shadow: 0 -6px 8px -4px rgba(42, 20, 24, .25); padding: 10px; gap: 6px; }
  /* Главное сверху: слово, перевод, озвучка и «Посадить» видны без прокрутки карточки; подробности ниже. */
  .dict-card > * { order: 3; }
  .dict-card > .big, .dict-card > .ru, .dict-card > .tr { order: 0; }
  .dict-card > .btns { order: 1; }
  .dict-card > .plant-slot { order: 2; }
  .dict-card .big { font-size: 24px; }
  .dict-card .ru { font-size: 17px; }
  .dict-row { grid-template-columns: auto minmax(0, 1fr) auto; padding: 4px 8px; min-height: 40px; box-sizing: border-box; }
  .dict-row .pl { font-size: 17px; overflow-wrap: break-word; hyphens: none; }
  .dict-row .ru { grid-column: 2; grid-row: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Высота строки фиксирована: значок стадии (32 px) не раздувает её, когда слово посадили. */
  .dict-row { height: 40px; }
  .dict-row .st { grid-row: 1; grid-column: 3; width: 32px; min-width: 32px; height: 28px; min-height: 0; overflow: visible; }
  .dict-filters { gap: 4px; flex-wrap: nowrap; }
  .dict-filters .pq-btn { flex: 1 1 auto; min-width: 0; padding: 6px 3px; font-size: 12px; white-space: nowrap; }
  /* Подпись внизу («Посажено…») занимает место всегда: появление строки не сдвигает карточку. */
  .pq-foot[data-dict][hidden] { display: block !important; visibility: hidden; box-sizing: border-box; min-height: 26px; }
}
`;

export interface DictionaryScreen {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Тема больше этого — мягкий выбор «Посадить 7 (быстрее урожай)» / «Всю тему (N)» (P4a: целая тема не даёт урожаев). */
export const TOPIC_SOFT_MAX = 8;
/** Сколько слов сажает быстрая кнопка: первые по частоте. */
export const TOPIC_QUICK = 7;

interface Entry {
  id: string;
  /** Ранг частоты (меньше — чаще): freq, потом порядок в базе. Фразы — по уровню. */
  rank: number;
  pl: string;
  ru: string;
  topic: string;
  fpl: string;
  fru: string;
}

export interface DictionaryExtras {
  /** Словарь «русский → польский» для вкладки «＋ Своё» (platform/rupl). Нет — только ручной ввод. */
  loadDict?: () => Promise<RuplDb | null>;
}

export function mountDictionary(parent: HTMLElement, api: FarmApi, bus?: Bus<BusEvents>, tips?: Tips, extras: DictionaryExtras = {}): DictionaryScreen {
  const panel = createPanel({ title: 'Słownik · Словарь', wide: true, bus });
  panel.footer.setAttribute('data-dict', '');
  const rankOf = (x: Word | Phrase, i: number): number => ('freq' in x ? x.freq * 1e5 + x.order : x.level * 1e5 + i);
  const mkEntries = (xs: readonly (Word | Phrase)[]): Entry[] =>
    xs.map((x, i) => ({ id: x.id, rank: rankOf(x, i), pl: x.pl, ru: x.ru, topic: x.topic, fpl: fold(x.pl), fru: fold(x.ru) }));
  const entries: Record<'words' | 'phrases', Entry[]> = { words: mkEntries(api.words), phrases: mkEntries(api.phrases) };
  /** Свои слова добавляются и меняются на лету: список слов пересобирается, когда их набор изменился. */
  const customSig = (): string => (api.custom ? api.custom.list().map((w) => `${w.id}:${w.pl}:${w.ru}`).join('|') : '');
  let seenCustom = customSig();
  const topicsOf = (t: 'words' | 'phrases') => {
    const used = new Set(entries[t].map((e) => e.topic));
    return api.topics.filter((x) => used.has(x.id));
  };
  /** Вкладка со списком: «＋ Своё» списка не имеет, под ней остаются слова. */
  const listTab = (): 'words' | 'phrases' => (tab === 'phrases' ? 'phrases' : 'words');

  let tab: Tab = 'words';
  let topic = '';
  let filter: Filter = 'all';
  let query = '';
  let selected: string | null = null;
  /** Слово, на удаление которого ждём подтверждения (растущее своё слово). */
  let confirmDel: string | null = null;
  let limit = PAGE;

  const tabBtns = ((api.custom ? ['words', 'phrases', 'add'] : ['words', 'phrases']) as Tab[]).map((t) =>
    el(
      'button',
      { type: 'button', class: 'pq-btn', 'data-tab': t, ...(t === 'add' ? { 'aria-label': 'Своё слово', title: 'Добавить своё слово' } : {}), ...nav('tabs', 'h', `tab:${t}`), onclick: () => setTab(t) },
      t === 'words' ? 'Słowa' : t === 'phrases' ? 'Frazy' : '＋ Своё',
    ),
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
  // Тема больше TOPIC_SOFT_MAX: первая кнопка сажает 7 самых частых, вторая — всю тему.
  const bulk = el('button', { type: 'button', class: 'pq-btn small', 'data-bulk': '', hidden: true, ...nav('bulk', 'h', 'bulk'), onclick: () => plantTopic(true) });
  const bulkAll = el('button', { type: 'button', class: 'pq-btn small', 'data-bulk-all': '', hidden: true, ...nav('bulk', 'h', 'bulk-all'), onclick: () => plantTopic(false) });
  const bulkRow = el('div', { class: 'dict-bulkrow', 'data-bulkrow': '' }, bulk, bulkAll);
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
  const cardWrap = el('div', { class: 'dict-cardwrap', hidden: true }, cardCol);
  const cols = el('div', { class: 'dict-cols nocard', 'data-cols': '' }, topicsCol, el('div', {}, listCol), cardWrap);
  // «＋ Своё слово»: русское слово → варианты из словаря → правка → посадка (ui/customWord.ts).
  /** Озвучка произвольного польского текста (пример, вариант перевода): тот же `audio:play`, что у ▶. */
  const sayText: SayFn = (text, slow) => (bus ?? globalBus).emit('audio:play', { text, ...(slow ? { slow: true } : {}) });
  const pane = api.custom
    ? createCustomPane({
        sayText,
        api: api as FarmApi & { custom: NonNullable<FarmApi['custom']> },
        ...(extras.loadDict ? { loadDict: extras.loadDict } : {}),
        refocus: (key) => (key ? panel.focus(key) : panel.syncFocus()),
        onEdited: (id) => {
          say('Исправлено');
          tab = 'words';
          topic = api.word(id)?.topic ?? '';
          query = '';
          search.value = '';
          filter = 'all';
          limit = PAGE;
          selected = id;
          afterCustomChange();
        },
        onCancel: () => {
          tab = 'words';
          afterCustomChange();
        },
      })
    : null;
  const note = el('span', { role: 'status', 'data-note': '' });
  const filtersRow = el('div', { class: 'dict-filters' }, ...filterBtns);
  // Липкая шапка: вкладки и поиск, на телефоне ещё чипы тем, и кнопки «Посадить 7 / Всю тему».
  const head = el('div', { class: 'dict-head', 'data-head': '' }, el('div', { class: 'dict-headrow' }, el('div', { class: 'dict-tabs' }, ...tabBtns), search), bulkRow);
  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 640px)') : null;
  /** Телефон: чипы тем живут в липкой шапке; шире — слева от списка. */
  const placeTopics = (): void => {
    if (mql?.matches) head.insertBefore(topicsCol, bulkRow);
    else cols.prepend(topicsCol);
  };
  mql?.addEventListener?.('change', placeTopics);
  placeTopics();
  panel.footer.append(note);
  panel.body.append(
    el('style', {}, css),
    el(
      'div',
      { class: 'dict' },
      head,
      filtersRow,
      legend,
      cols,
      pane?.root,
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
    return entries[listTab()].filter((e) => {
      if (topicNow() && e.topic !== topicNow()) return false;
      if (q && !e.fpl.includes(q) && !e.fru.includes(q)) return false;
      if (filter !== 'all' && group(info(e.id)) !== filter) return false;
      return true;
    });
  };
  /** Что сажает «Посадить всю тему»: новые элементы темы на текущей вкладке (фразы — только доступные). */
  /** Новые (и доступные) слова выбранной темы, частые первыми. */
  const plantable = (): string[] =>
    topicNow()
      ? entries[listTab()]
          .filter((e) => e.topic === topicNow() && info(e.id).status === 'new' && !locked(e.id))
          .sort((a, b) => a.rank - b.rank)
          .map((e) => e.id)
      : [];

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
    topicsCol.replaceChildren(mk('', 'Все'), ...topicsOf(listTab()).map((t) => mk(t.id, t.pl, t.ru)));
  }

  function renderBulk(): void {
    const n = tab === 'add' ? 0 : plantable().length;
    const soft = n > TOPIC_SOFT_MAX;
    bulk.hidden = n === 0;
    bulk.textContent = soft ? `Посадить ${TOPIC_QUICK} (быстрее урожай)` : `Посадить всю тему (${n})`;
    bulkAll.hidden = !soft;
    bulkAll.textContent = `Всю тему (${n})`;
  }

  /** Какие слова сейчас нарисованы в списке (id через пробел) и с каким предисловием: если не изменились, строки не пересобираем. */
  let listSig = '';
  function renderList(): void {
    infoOf.clear();
    const all = matches();
    const shown = all.slice(0, limit);
    // F5a: посадка (и любое изменение стадии) меняет только значок своей строки: список не пересобирается, не прыгает,
    // тап по соседнему слову попадает в то слово, по которому тапнули.
    const sig = `${shown.map((e) => e.id).join(' ')}|${all.length - shown.length}|${query.trim() && topic ? 's' : ''}`;
    if (sig === listSig && shown.length) {
      for (const r of listCol.querySelectorAll<HTMLElement>('.dict-row')) {
        const id = r.getAttribute('data-id')!;
        r.classList.toggle('sel', id === selected);
        r.querySelector('.st')?.replaceChildren(statusIcon(id));
      }
      return;
    }
    listSig = sig;
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

  /** Свои слова: «Изменить» и «Удалить» (растущее — с подтверждением, нерастущее — без вопросов). */
  function customBar(id: string, i: ItemInfo): HTMLElement {
    if (confirmDel === id) {
      return el(
        'div',
        { class: 'lock', 'data-confirm-del': '' },
        `${i.status === 'grown' ? 'Слово выучено и лежит в банке.' : 'Слово уже растёт.'} Удалить вместе с прогрессом?`,
        el(
          'div',
          { class: 'btns', style: 'margin-top:6px' },
          el('button', { type: 'button', class: 'pq-btn small', 'data-del-yes': '', ...nav('card', 'v', 'del-yes'), onclick: () => removeCustom(id) }, 'Да, удалить'),
          el('button', { type: 'button', class: 'pq-btn small', 'data-del-no': '', ...nav('card', 'v', 'del-no'), onclick: () => ((confirmDel = null), renderCard(), panel.syncFocus()) }, 'Оставить'),
        ),
      );
    }
    return el(
      'div',
      { class: 'btns', 'data-custom-bar': '' },
      el('button', { type: 'button', class: 'pq-btn small', 'data-edit': '', ...nav('card', 'v', 'edit'), onclick: () => editCustom(id) }, '✎ Изменить'),
      el('button', { type: 'button', class: 'pq-btn small', 'data-del': '', ...nav('card', 'v', 'del'), onclick: () => askRemove(id) }, '🗑 Удалить'),
    );
  }
  function editCustom(id: string): void {
    tab = 'add';
    selected = null;
    confirmDel = null;
    pane?.edit(id);
    renderAll();
  }
  function askRemove(id: string): void {
    // Ещё не посажено: удаляем сразу. Растёт или в банке: сначала спрашиваем.
    if (info(id).status === 'new') return removeCustom(id);
    confirmDel = id;
    renderCard();
    panel.focus('del-no');
  }
  function removeCustom(id: string): void {
    confirmDel = null;
    if (selected === id) selected = null;
    api.custom?.remove(id);
    say('Слово удалено');
    afterCustomChange();
  }

  function renderCard(): void {
    cardCol.scrollTop = 0;
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
    if (w?.ex)
      kids.push(
        el('div', { class: 'ex' }, el('div', { class: 'exrow' }, el('div', { class: 'pl' }, w.ex.pl), sayButton(w.ex.pl, sayText, { attrs: nav('card', 'v', 'say-ex') })), el('div', { class: 'ru' }, w.ex.ru)),
      );
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
          '🔒 Откроется, когда эти слова подрастут до ростка:',
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
    if (w && api.custom && isCustomId(w.id)) kids.push(customBar(w.id, i));
    // Место под кнопку занято всегда: после посадки на её месте строка того же размера, карточка не меняет высоту.
    kids.push(
      el(
        'div',
        { class: 'plant-slot', 'data-plant-slot': '' },
        i.status === 'new'
          ? el('button', { type: 'button', class: 'pq-btn', 'data-plant': '', disabled: lock, ...nav('card', 'v', 'plant'), onclick: () => plantOne(id) }, 'Posadź · Посадить')
          : el('span', { class: 'done', 'data-planted': '' }, i.status === 'grown' ? '✓ Уже в банке' : '✓ Посажено'),
      ),
    );
    cardCol.replaceChildren(...kids);
  }

  function renderAll(): void {
    renderTabs();
    // «＋ Своё слово» заменяет список: поиск, фильтры, легенда и колонки прячутся, живёт только панель добавления.
    const adding = tab === 'add';
    for (const n of [search, filtersRow, legend, cols, topicsCol]) n.hidden = adding;
    if (pane) pane.root.hidden = !adding;
    if (!adding) {
      renderList();
      renderCard();
    }
    renderBulk();
    panel.syncFocus();
  }

  /** Набор своих слов изменился (добавили, поправили, удалили): список и чипы тем пересобираем. */
  function syncCustom(): void {
    const sig = customSig();
    if (sig === seenCustom) return;
    seenCustom = sig;
    entries.words = mkEntries(api.words);
    if (topic && !topicsOf(listTab()).some((x) => x.id === topic)) topic = '';
    listSig = '';
    renderTopics();
  }
  function afterCustomChange(): void {
    syncCustom();
    renderTopics();
    listSig = '';
    renderAll();
    const row = selected ? listCol.querySelector(`[data-nav="row:${selected}"]`) : null;
    if (row) panel.focus(`row:${selected}`);
  }

  // ---- действия
  function select(id: string): void {
    selected = id;
    confirmDel = null;
    say('');
    for (const r of listCol.querySelectorAll<HTMLElement>('.dict-row')) r.classList.toggle('sel', r.getAttribute('data-id') === id);
    renderCard();
    // Телефон: карточка прилипает к низу панели, прокручивать ничего не нужно (список не должен ехать под пальцем).
    // Шире: колонки со своей прокруткой; шапка прилипает сверху, карточка прокручивается под неё.
    if (!mql?.matches && typeof cardCol.scrollIntoView === 'function') {
      cardCol.style.scrollMarginTop = `${(head.offsetHeight ?? 0) + 8}px`;
      cardCol.scrollIntoView({ block: 'nearest' });
    }
  }

  function setTab(t: Tab): void {
    if (t === tab) return;
    tab = t;
    if (t === 'add') {
      selected = null;
      confirmDel = null;
      say('');
      pane?.show();
      renderAll();
      pane?.focusInput();
      return;
    }
    if (topic && !topicsOf(listTab()).some((x) => x.id === topic)) topic = '';
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
    // Кнопка «Посадить» исчезла: фокус на строку слова, а не на соседнюю «▶ медленно» (на тач-устройствах рамки нет, см. panel.ts).
    if (listCol.querySelector(`[data-nav="row:${id}"]`)) panel.focus(`row:${id}`);
  }

  function plantTopic(quick: boolean): void {
    const all = plantable();
    const ids = quick && all.length > TOPIC_SOFT_MAX ? all.slice(0, TOPIC_QUICK) : all;
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
        syncCustom();
        renderAll();
      });
      // Свои слова могли появиться, пока экран был закрыт.
      if (tab === 'add') tab = 'words';
      syncCustom();
      confirmDel = null;
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
