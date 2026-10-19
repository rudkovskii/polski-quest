// «＋ Своё слово»: Шэф пишет русское слово, игра предлагает польские варианты (офлайн-словарь rupl), он правит и сажает.
// Часть словаря на столе (`ui/dictionary.ts`, вкладка «＋ Своё»). Системная клавиатура телефона, экранная раскладка не нужна.
import { CUSTOM_LIMIT, GENDER_RU, MAX_EX, MAX_PL, MAX_RU, POS_RU, lookupRu, type Hit, type RuplDb, type Variant } from '../systems/customWords';
import { translit } from '../systems/translit';
import type { Pos, Word } from '../types/content';
import type { CustomApi, FarmApi } from '../types/farm';
import { el } from './dom';
import { nav } from './panel';
import { sayButton, type SayFn } from './sayButton';

export const CUSTOM_CSS = `
.dict [hidden] { display: none !important; }
.cw { display: flex; flex-direction: column; gap: 10px; }
.cw-ask { display: flex; gap: 8px; align-items: center; }
.cw-ask input { flex: 1 1 auto; min-width: 0; height: 44px; font: inherit; font-size: 18px; padding: 0 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #fffaf0; color: var(--pq-ink); box-sizing: border-box; }
.cw-ask .pq-btn { flex: 0 0 auto; height: 44px; }
.cw-lead { font-size: 14px; opacity: .8; }
.cw-msg { font-size: 15px; }
.cw-msg.warn { background: #ffe9c2; border: 2px dashed var(--pq-accent); border-radius: 6px; padding: 7px 9px; }
.cw-msg.ok { background: #e3f0c8; border: 2px solid var(--pq-wood-dark); border-radius: 6px; padding: 8px 10px; }
.cw-h { font-size: 14px; font-weight: 700; opacity: .85; margin-top: 2px; }
.cw-list { display: flex; flex-direction: column; gap: 6px; }
.cw-var { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1px 8px; align-items: center; text-align: left; font: inherit; color: var(--pq-ink); background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 6px; padding: 8px 10px; min-height: 52px; cursor: pointer; box-sizing: border-box; }
.cw-varrow { display: flex; align-items: center; gap: 8px; } .cw-varrow > .cw-var { flex: 1 1 auto; min-width: 0; }
.cw-base .plrow { grid-column: 1; display: flex; align-items: center; gap: 8px; min-width: 0; } .cw-base .plrow .pl { flex: 0 1 auto; }
.cw-var .pl { font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
.cw-var .meta { grid-column: 1; font-size: 13px; opacity: .75; overflow-wrap: anywhere; }
.cw-var .go { grid-row: 1 / span 2; grid-column: 2; font-size: 20px; opacity: .6; }
.cw-base { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; background: #e3f0c8; border: 2px solid var(--pq-wood-dark); border-radius: 6px; padding: 8px 10px; }
.cw-base .pl { font-size: 19px; font-weight: 700; overflow-wrap: anywhere; }
.cw-base .ru { grid-column: 1; font-size: 14px; opacity: .8; overflow-wrap: anywhere; }
.cw-base .act { grid-row: 1 / span 2; grid-column: 2; font-size: 14px; }
.cw-form { display: flex; flex-direction: column; gap: 8px; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; padding: 12px; }
.cw-form label { display: flex; flex-direction: column; gap: 3px; font-size: 13px; opacity: .9; }
.cw-form input { font: inherit; font-size: 17px; height: 42px; padding: 0 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #fff; color: var(--pq-ink); box-sizing: border-box; min-width: 0; }
.cw-form .tr { font-style: italic; opacity: .75; min-height: 20px; }
.cw-form .opt { display: grid; grid-template-columns: 1fr; gap: 6px; }
.cw-form .btns { display: flex; flex-wrap: wrap; gap: 8px; }
.cw-form .err { color: #a02a2a; font-size: 14px; min-height: 18px; }
.cw-count { font-size: 12px; opacity: .6; }
`;

export interface CustomPaneOpts {
  api: FarmApi & { custom: CustomApi };
  /** Озвучка польского текста кнопкой 🔊 (варианты перевода, слова базы). Нет — кнопок нет. */
  sayText?: SayFn;
  /** Загрузка словаря (platform/rupl). Нет — только ручной ввод. */
  loadDict?: () => Promise<RuplDb | null>;
  /** Содержимое пане перерисовано: панели вернуть фокус (на элемент с ключом `key`, если он есть). */
  refocus(key?: string): void;
  /** Слово исправлено (режим правки): словарь возвращается к списку. */
  onEdited(id: string): void;
  /** Закрыть правку без изменений. */
  onCancel(): void;
}

export interface CustomPane {
  readonly root: HTMLElement;
  /** Вкладка открыта: чистое поле ввода (если не правка). */
  show(): void;
  /** Править своё слово. */
  edit(id: string): void;
  /** Поле ввода в фокус (экран с физической клавиатурой). */
  focusInput(): void;
}

type Status = 'idle' | 'loading' | 'result';
interface FormInit {
  id?: string;
  pl: string;
  ru: string;
  pos?: Pos;
  gender?: Word['gender'];
  exPl?: string;
  exRu?: string;
}

const variantMeta = (v: Variant): string => {
  const bits = [v.tr, v.name ? 'имя' : POS_RU[v.pos]];
  if (v.gender) bits.push(GENDER_RU[v.gender]);
  if (v.aspect) bits.push(v.aspect === 'pf' ? 'сов.' : 'несов.');
  return bits.filter(Boolean).join(' · ');
};

export function createCustomPane(o: CustomPaneOpts): CustomPane {
  const { api } = o;
  const cu = api.custom;

  const input = el('input', {
    type: 'text',
    class: 'cw-input',
    'data-cw-input': '',
    lang: 'ru',
    placeholder: 'Русское слово…',
    'aria-label': 'Русское слово',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    maxlength: MAX_RU,
    ...nav('cw', 'v', 'cw:input'),
  });
  // Нажатие на поле через навигацию (Enter) ставит туда курсор.
  input.addEventListener('click', () => input.focus());
  const findBtn = el('button', { type: 'submit', class: 'pq-btn', 'data-cw-find': '', ...nav('cw', 'v', 'cw:find') }, 'Найти');
  const ask = el('form', { class: 'cw-ask', 'data-cw-ask': '', onsubmit: (e: Event) => (e.preventDefault(), void search()) }, input, findBtn);
  const out = el('div', { class: 'cw', 'data-cw-out': '' });
  const lead = el('div', { class: 'cw-lead' }, 'Напиши русское слово, игра предложит перевод. Потом можно поправить и посадить.');
  // Лицензия словаря (CC BY-SA 4.0) требует указать источник там, где он используется.
  const credit = el(
    'div',
    { class: 'cw-count', 'data-cw-credit': '' },
    'Переводы: Викисловарь (ru.wiktionary.org, pl.wiktionary.org, участники проекта), ',
    el('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/deed.ru', target: '_blank', rel: 'noopener noreferrer' }, 'CC BY-SA 4.0'),
    '. Их не вычитывал носитель: проверь и поправь руками.',
  );
  const root = el('div', { class: 'cw', 'data-custom': '', hidden: true }, lead, ask, out, credit);

  let token = 0;
  let editing: string | null = null;

  const say = (kids: (Node | string)[], cls = 'cw-msg'): HTMLElement => el('div', { class: cls, role: 'status' }, ...kids);
  const draw = (...nodes: Node[]): void => {
    out.replaceChildren(...nodes);
    o.refocus();
  };

  // ---- форма слова (новое и правка)
  function form(init: FormInit, hint?: string): HTMLElement {
    const pl = el('input', { type: 'text', 'data-cw-pl': '', lang: 'pl', value: init.pl, maxlength: MAX_PL, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Польское слово', ...nav('cwf', 'v', 'cwf:pl') });
    const tr = el('div', { class: 'tr', 'data-cw-tr': '' }, init.pl ? translit(init.pl) : '');
    const ru = el('input', { type: 'text', 'data-cw-ru': '', lang: 'ru', value: init.ru, maxlength: MAX_RU, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Перевод', ...nav('cwf', 'v', 'cwf:ru') });
    const exPl = el('input', { type: 'text', 'data-cw-expl': '', lang: 'pl', value: init.exPl ?? '', maxlength: MAX_EX, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Пример по-польски', placeholder: 'Mam nowy samochód.', ...nav('cwf', 'v', 'cwf:expl') });
    const exRu = el('input', { type: 'text', 'data-cw-exru': '', lang: 'ru', value: init.exRu ?? '', maxlength: MAX_EX, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Перевод примера', placeholder: 'У меня новая машина.', ...nav('cwf', 'v', 'cwf:exru') });
    for (const i of [pl, ru, exPl, exRu]) i.addEventListener('click', () => i.focus());
    pl.addEventListener('input', () => {
      tr.textContent = pl.value.trim() ? translit(pl.value.trim()) : '';
    });
    const err = el('div', { class: 'err', role: 'alert', 'data-cw-err': '' });
    const fail = (m: string, at: HTMLInputElement): void => {
      err.textContent = m;
      at.focus();
    };
    const read = () => ({
      pl: pl.value.trim(),
      ru: ru.value.trim(),
      ...(exPl.value.trim() ? { ex: { pl: exPl.value.trim(), ru: exRu.value.trim() } } : {}),
    });
    const check = (): ReturnType<typeof read> | null => {
      const v = read();
      if (!v.pl) return void fail('Впиши польское слово', pl), null;
      if (!v.ru) return void fail('Впиши перевод', ru), null;
      return v;
    };
    const add = (plantIt: boolean): void => {
      const v = check();
      if (!v) return;
      const r = cu.add({ ...v, ...(init.pos ? { pos: init.pos } : {}), ...(init.gender ? { gender: init.gender } : {}) });
      if (!r.ok) return void (err.textContent = r.reason === 'limit' ? `Своих слов уже ${CUSTOM_LIMIT}, больше не помещается` : 'Впиши слово и перевод');
      const planted = plantIt ? api.plant([r.id]) : null;
      done(r.id, v.pl, v.ru, r.existed, planted);
    };
    const save = (): void => {
      const v = check();
      if (!v || !init.id) return;
      if (!cu.update(init.id, { pl: v.pl, ru: v.ru, ex: v.ex ?? null })) return void (err.textContent = 'Не получилось сохранить');
      o.onEdited(init.id);
    };
    const btns = init.id
      ? el(
          'div',
          { class: 'btns' },
          el('button', { type: 'submit', class: 'pq-btn', 'data-cw-save': '', ...nav('cwf', 'v', 'cwf:save') }, 'Сохранить'),
          el('button', { type: 'button', class: 'pq-btn small', 'data-cw-cancel': '', ...nav('cwf', 'v', 'cwf:cancel'), onclick: () => ((editing = null), o.onCancel()) }, 'Отмена'),
        )
      : el(
          'div',
          { class: 'btns' },
          el('button', { type: 'submit', class: 'pq-btn', 'data-cw-plant': '', ...nav('cwf', 'v', 'cwf:plant') }, 'Posadź · Посадить'),
          el('button', { type: 'button', class: 'pq-btn small', 'data-cw-store': '', ...nav('cwf', 'v', 'cwf:store'), onclick: () => add(false) }, 'Только в словарь'),
          el('button', { type: 'button', class: 'pq-btn small', 'data-cw-back': '', ...nav('cwf', 'v', 'cwf:back'), onclick: () => (token++, draw()) }, 'Отмена'),
        );
    const f = el(
      'form',
      { class: 'cw-form', 'data-cw-form': '', onsubmit: (e: Event) => (e.preventDefault(), init.id ? save() : add(true)) },
      hint ? say([hint], 'cw-lead') : null,
      el('label', {}, 'Польское слово (можно исправить)', pl),
      tr,
      el('label', {}, 'Перевод', ru),
      el('div', { class: 'opt' }, el('label', {}, 'Пример (необязательно)', exPl), el('label', {}, 'Перевод примера', exRu)),
      err,
      btns,
    );
    return f;
  }

  /** Слово сохранено (и посажено): итог и чистое поле для следующего. */
  function done(id: string, pl: string, ru: string, existed: boolean, planted: { planted: number; bag: number; skipped: number } | null): void {
    const status = api.info(id).status;
    const line =
      planted === null
        ? existed
          ? 'Это слово у тебя уже есть.'
          : 'Сохранено в «Moje słowa», посадить можно потом из списка.'
        : planted.planted > 0
          ? 'Посажено на грядку.'
          : planted.bag > 0
            ? 'Посажено, но грядки заняты: слово ждёт в мешке.'
            : status === 'grown'
              ? 'Уже в банке.'
              : 'Оно уже растёт.';
    const say1 = el('button', { type: 'button', class: 'pq-btn small', 'data-cw-say': '', 'aria-label': 'Озвучить', ...nav('cw', 'v', 'cw:say'), onclick: () => api.say(id) }, '▶');
    input.value = '';
    draw(say([el('strong', {}, '✓ '), el('strong', { 'data-cw-done': id }, pl), ` — ${ru}. ${line} `, say1], 'cw-msg ok'), el('div', { class: 'cw-lead' }, 'Напиши следующее слово.'));
    focusAsk();
  }

  /** «Напиши следующее слово»: курсор обратно в поле (с клавиатурой; на касании — нет, чтобы экранная клавиатура не выскакивала сама). */
  function focusAsk(): void {
    if (root.closest('.pq-panel')?.classList.contains('touch')) return;
    input.focus({ preventScroll: true });
  }

  // ---- поиск
  function variantButton(v: Variant, h: Hit): HTMLElement {
    return el(
      'button',
      {
        type: 'button',
        class: 'cw-var',
        'data-cw-variant': v.pl,
        ...nav('cwv', 'v', `cwv:${v.pl}`),
        onclick: () => {
          draw(
            form(
              { pl: v.pl, ru: h.lemma, pos: v.pos, ...(v.gender ? { gender: v.gender } : {}) },
              h.viaForm ? `«${h.query}» — форма слова «${h.lemma}»: перевод дан для него, поправь, если нужна другая форма.` : undefined,
            ),
          );
          (out.querySelector<HTMLInputElement>('[data-cw-pl]') ?? input).focus();
          o.refocus('cwf:pl');
        },
      },
      el('span', { class: 'pl' }, v.pl),
      el('span', { class: 'go', 'aria-hidden': 'true' }, '›'),
      el('span', { class: 'meta' }, variantMeta(v)),
    );
  }

  /** Вариант перевода с 🔊 рядом (кнопка внутри кнопки невозможна): послушать слово до выбора. */
  function variantRow(v: Variant, h: Hit): HTMLElement {
    const b = variantButton(v, h);
    return o.sayText ? el('div', { class: 'cw-varrow' }, b, sayButton(v.pl, o.sayText, { attrs: nav('cwv', 'h', `cwvs:${v.pl}`) })) : b;
  }

  function baseRow(w: Word): HTMLElement {
    const st = api.info(w.id).status;
    return el(
      'div',
      { class: 'cw-base', 'data-cw-base': w.id },
      o.sayText ? el('span', { class: 'plrow' }, el('span', { class: 'pl' }, w.pl), sayButton(w.pl, o.sayText, { attrs: nav('cwb', 'v', `cwbs:${w.id}`) })) : el('span', { class: 'pl' }, w.pl),
      el('span', { class: 'ru' }, `${w.ru} · ${w.tr}`),
      st === 'new'
        ? el('button', { type: 'button', class: 'pq-btn small', 'data-cw-plant-base': w.id, ...nav('cwb', 'v', `cwb:${w.id}`), onclick: () => (api.plant([w.id]), showBase(w, api.info(w.id).status === 'bag' ? 'Посажено, грядки заняты: слово ждёт в мешке.' : 'Посажено на грядку.')) }, 'Посадить')
        : el('span', { class: 'act' }, st === 'grown' ? '✓ в банке' : '✓ растёт'),
    );
  }
  /** После посадки слова базы: то же место, строка и подпись. */
  function showBase(w: Word, line: string): void {
    draw(say([el('strong', {}, '✓ '), el('strong', { 'data-cw-done': w.id }, w.pl), ` — ${w.ru}. ${line} `], 'cw-msg ok'), el('div', { class: 'cw-lead' }, 'Напиши следующее слово.'));
    input.value = '';
    focusAsk();
  }

  const manualBtn = (label: string, init: FormInit): HTMLElement =>
    el('button', { type: 'button', class: 'pq-btn small', 'data-cw-manual': '', ...nav('cwm', 'v', 'cwm:manual'), onclick: () => (draw(form(init)), (out.querySelector<HTMLInputElement>('[data-cw-pl]') ?? input).focus(), o.refocus('cwf:pl')) }, label);

  async function search(): Promise<void> {
    const q = input.value.trim();
    if (!q) return;
    const seq = ++token;
    draw(say(['Ищу…']));
    const db = o.loadDict ? await o.loadDict() : null;
    if (seq !== token) return;
    const hit = db ? lookupRu(db, q) : null;
    const base = cu.base(q, ...(hit ? [hit.lemma] : []));
    const nodes: Node[] = [];
    if (base.length) {
      nodes.push(say(['Это слово уже есть в базе:'], 'cw-h'), el('div', { class: 'cw-list' }, ...base.map(baseRow)));
    }
    if (hit) {
      nodes.push(
        say([base.length ? 'Или добавь своё слово. ' : '', hit.viaForm ? `«${hit.query}» — форма слова «${hit.lemma}». ` : '', 'Выбери вариант:'], 'cw-h'),
        el('div', { class: 'cw-list', 'data-cw-variants': '' }, ...hit.variants.map((v) => variantRow(v, hit))),
        manualBtn('Свой вариант…', { pl: '', ru: hit.lemma }),
      );
    } else {
      const cyr = /[а-яё]/i.test(q);
      nodes.push(
        say(
          [
            !cyr
              ? 'Напиши слово по-русски. Польские слова ищутся в списке «Słowa». '
              : !db && o.loadDict
                ? 'Словарь не загрузился (нужен интернет один раз). '
                : `В словаре нет «${q}». `,
            'Введи польское слово сам, транскрипция появится сама.',
          ],
          'cw-msg warn',
        ),
        form({ pl: '', ru: cyr ? q : '' }),
      );
    }
    draw(...nodes);
    // Не нашли: сразу в польское поле (клавиатура остаётся открытой).
    if (!hit) {
      out.querySelector<HTMLInputElement>('[data-cw-pl]')?.focus();
      o.refocus('cwf:pl');
    }
  }

  function edit(id: string): void {
    const w = cu.list().find((x) => x.id === id);
    if (!w) return o.onCancel();
    editing = id;
    token++;
    lead.textContent = 'Правка слова. Транскрипция пересчитается сама.';
    ask.hidden = true;
    draw(form({ id, pl: w.pl, ru: w.ru, ...(w.ex ? { exPl: w.ex.pl, exRu: w.ex.ru } : {}) }));
    out.querySelector<HTMLInputElement>('[data-cw-pl]')?.focus();
    o.refocus('cwf:pl');
  }

  function show(): void {
    editing = null;
    token++;
    ask.hidden = false;
    lead.textContent = 'Напиши русское слово, игра предложит перевод. Потом можно поправить и посадить.';
    out.replaceChildren();
    o.refocus();
  }

  return {
    root,
    show,
    edit,
    focusInput: () => {
      if (!editing) input.focus();
    },
  };
}
