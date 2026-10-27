// Игра «Hymn»: чтение текста (просьба Шэфа 27.10: «приходится наугад учить»). Экран выбора (`hub`) — гимн целиком по куплетам: строка
// по-польски с 🔊, транскрипция и перевод (переключатели), «Проверь себя» прикрывает строки (тап открывает), «Учить куплет» ведёт раунд
// только по нему, «Dalej» — обычный раунд. Обе кнопки отмечают показанный куплет прочитанным (`markSeen` строк). Новый куплет в раунде
// сначала показывается карточкой `stanzaCard` (до первого вопроса, как знакомство в Daty и Miesiące).
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import type { GameCtx, GamePanel, PolskaUnit } from '../../types/polska';
import { posOf, stanzaOf } from './tasks';

export const STANZAS = ['s1', 'ref', 's2', 's3', 's4'] as const;
const NAME: Record<string, { pl: string; ru: string }> = {
  s1: { pl: 'Zwrotka 1', ru: 'Куплет 1' },
  ref: { pl: 'Refren', ru: 'Припев' },
  s2: { pl: 'Zwrotka 2', ru: 'Куплет 2' },
  s3: { pl: 'Zwrotka 3', ru: 'Куплет 3' },
  s4: { pl: 'Zwrotka 4', ru: 'Куплет 4' },
};
export const READER_CSS = `
.hy-hub { display: flex; flex-direction: column; gap: 6px; }
.hy-hub .hy-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.hy-hub .hy-top b { font-size: 17px; } .hy-hub .hy-top small { font-size: 12px; opacity: .7; }
.hy-tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.pq-pg .pq-btn.hy-tab { color: var(--pq-ink); background: #fffaf0; padding: 5px 2px; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; min-width: 0; white-space: nowrap; }
.pq-pg .pq-btn.hy-tab.on { background: #f2dcae; outline: 3px solid var(--pq-accent); outline-offset: -2px; }
.hy-tab .dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: #cbbf9f; }
.hy-tab .dot.grow { background: #7fb04a; } .hy-tab .dot.done { background: #e0b020; }
.hy-tools { display: flex; gap: 4px; flex-wrap: wrap; }
.pq-pg .hy-tools .pq-btn { color: var(--pq-ink); background: #fffaf0; padding: 3px 7px; font-size: 12px; font-weight: 700; }
.pq-pg .hy-tools .pq-btn[aria-pressed="true"] { background: #d6efc0; }
.hy-text { display: flex; flex-direction: column; gap: 4px; }
.hy-line { position: relative; display: flex; align-items: flex-start; gap: 6px; padding: 4px 6px; border-radius: 6px; background: #fffaf0; border: 1px solid #e2d6b8; }
.hy-line .n { flex: 0 0 12px; font-size: 12px; opacity: .55; padding-top: 4px; }
.hy-line .txt { flex: 1 1 auto; min-width: 0; }
.hy-line .pl { font-size: 17px; font-weight: 800; line-height: 1.25; overflow-wrap: break-word; }
.hy-line .tr, .hy-line .ru { font-size: 13px; line-height: 1.2; opacity: .75; }
.hy-line .tr { font-style: italic; }
.hy-line.cur { border: 2px solid var(--pq-accent); background: #fdf1d4; }
.hy-line.hid .pl { color: transparent; text-shadow: 0 0 9px rgba(42, 20, 24, .55); user-select: none; }
.hy-line.hid .tr { visibility: hidden; }
.hy-line button.peek { all: unset; position: absolute; inset: 0; cursor: pointer; }
.hy-note { font-size: 12px; opacity: .75; }
@media (max-width: 520px), (max-height: 860px) { .hy-line .pl { font-size: 15px; } .hy-tab .long { display: none; } .hy-hub .hy-top b { font-size: 15px; } }
`;

/** Строки куплета по порядку. */
export function linesOf(ctx: GameCtx, stanza: string): PolskaUnit[] {
  return ctx.units.filter((u) => u.kind === 'hymn' && stanzaOf(u.id) === stanza).sort((a, b) => posOf(a.id) - posOf(b.id));
}

const stanzaState = (ctx: GameCtx, ids: readonly string[]): 'new' | 'grow' | 'done' => {
  const inf = ids.map((id) => ctx.info(id));
  if (inf.length && inf.every((i) => i.harvests > 0)) return 'done';
  return inf.some((i) => i.stage !== null || i.harvests > 0) ? 'grow' : 'new';
};

interface View {
  tr: boolean;
  ru: boolean;
  hide: boolean;
}

/** Текст куплета: строки с 🔊, транскрипцией и переводом; в режиме «Проверь себя» строки прикрыты, тап открывает одну. */
function stanzaText(lines: readonly PolskaUnit[], view: View, say: (t: string) => void, cur?: string): HTMLElement {
  const box = el('div', { class: 'hy-text', 'data-hy-text': '' });
  for (const u of lines) {
    const row = el(
      'div',
      { class: `hy-line${u.id === cur ? ' cur' : ''}${view.hide ? ' hid' : ''}`, 'data-line': u.id },
      el('span', { class: 'n' }, String(posOf(u.id))),
      el(
        'div',
        { class: 'txt' },
        el('div', { class: 'pl', lang: 'pl' }, u.pl),
        view.tr && u.tr ? el('div', { class: 'tr', lang: 'ru' }, u.tr) : null,
        view.ru ? el('div', { class: 'ru', lang: 'ru' }, u.ru) : null,
      ),
      sayButton(u.pl, say),
    );
    if (view.hide) {
      const peek = el('button', { type: 'button', class: 'peek', 'data-peek': u.id, 'aria-label': `Показать строку ${posOf(u.id)}` });
      peek.onclick = () => {
        row.classList.remove('hid');
        peek.remove();
        say(u.pl);
      };
      row.append(peek);
    }
    box.append(row);
  }
  return box;
}

const toggle = (label: string, on: boolean, attr: string, onclick: () => void): HTMLElement =>
  el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', [attr]: '', 'aria-pressed': String(on), onclick }, label);

/** Экран выбора: гимн для чтения, «Учить куплет», «Dalej». */
export function renderReader(panel: GamePanel, ctx: GameCtx, pool: () => string[], begin: (ids: readonly string[], size: number) => void, start?: string): void {
  const planted = new Set(pool());
  // Открыт на первом куплете, где ещё не всё собрано, — то, что сейчас учится.
  let at = start ?? STANZAS.find((s) => linesOf(ctx, s).some((u) => planted.has(u.id) && ctx.info(u.id).harvests === 0)) ?? 's1';
  const view: View = { tr: true, ru: true, hide: false };
  const root = el('div', { class: 'hy-hub', 'data-hymn-read': '' });
  panel.body.append(el('style', {}, READER_CSS), root);

  const paint = (): void => {
    const lines = linesOf(ctx, at);
    const go = (ids: readonly string[]): void => {
      markStanzaSeen(ctx, lines[0]!.id);
      begin(ids, 10);
    };
    const tabs = el('div', { class: 'hy-tabs' });
    for (const s of STANZAS) {
      const st = stanzaState(ctx, linesOf(ctx, s).map((u) => u.id));
      tabs.append(
        el(
          'button',
          { type: 'button', class: `pq-btn hy-tab${s === at ? ' on' : ''}`, 'data-nav': '', 'data-stanza': s, 'aria-pressed': String(s === at), onclick: () => ((at = s), (view.hide = false), paint()) },
          el('span', { lang: 'pl' }, s === 'ref' ? 'Refren' : el('span', { class: 'long' }, 'Zwrotka '), s === 'ref' ? null : s.slice(1)),
          el('span', { class: `dot ${st === 'new' ? '' : st}`.trim(), title: st === 'done' ? 'выучен' : st === 'grow' ? 'учится' : 'ещё не начат' }),
        ),
      );
    }
    const tools = el(
      'div',
      { class: 'hy-tools' },
      el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-say-stanza': '', onclick: () => panel.say(lines.map((u) => u.pl).join(' ')) }, '🔊 Весь куплет'),
      toggle('Транскрипция', view.tr, 'data-show-tr', () => {
        view.tr = !view.tr;
        paint();
      }),
      toggle('Перевод', view.ru, 'data-show-ru', () => {
        view.ru = !view.ru;
        paint();
      }),
      toggle('🙈 Проверь себя', view.hide, 'data-hide', () => {
        view.hide = !view.hide;
        paint();
      }),
    );
    root.replaceChildren(
      el('div', { class: 'hy-top' }, el('b', { lang: 'pl' }, 'Mazurek Dąbrowskiego'), el('small', {}, 'Józef Wybicki, 1797 · гимн Польши')),
      tabs,
      tools,
      stanzaText(lines, view, panel.say),
      el('div', { class: 'hy-note' }, at === 'ref' ? 'Припев поют после каждого куплета.' : view.hide ? 'Вспомни строку и коснись её — проверишь себя.' : 'Прочитай вслух вместе с 🔊, потом учи куплет в игре.'),
    );
    panel.foot.replaceChildren(
      el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-learn': at, onclick: () => go(lines.map((u) => u.id)) }, `Учить: ${NAME[at]!.ru}`),
      el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-hy-go': '', onclick: () => go(pool()) }, 'Dalej · Играть →'),
    );
  };
  paint();
}

/** Знакомство с куплетом в раунде: весь куплет текстом, текущая строка выделена. */
export function stanzaCard(ctx: GameCtx, id: string, say: (t: string) => void): HTMLElement {
  const s = stanzaOf(id);
  const lines = linesOf(ctx, s);
  return el(
    'div',
    { class: 'hy-hub', 'data-stanza-card': s },
    el('style', {}, READER_CSS),
    el('div', { class: 'hy-top' }, el('b', { lang: 'pl' }, `Nowa ${s === 'ref' ? 'część: Refren' : `zwrotka: ${NAME[s]!.pl}`}`), el('small', {}, `${NAME[s]!.ru} — сначала прочитай`)),
    stanzaText(lines, { tr: true, ru: true, hide: false }, say, id),
  );
}

/** Нужна ли карточка куплета перед заданием по строке: в куплете есть строки, которые игрок ещё не видел. */
export const needsCard = (ctx: GameCtx, id: string): boolean => id.startsWith('hymn.') && linesOf(ctx, stanzaOf(id)).some((u) => !ctx.seen(u.id));

export const markStanzaSeen = (ctx: GameCtx, id: string): void => {
  for (const u of linesOf(ctx, stanzaOf(id))) if (!ctx.seen(u.id)) ctx.markSeen(u.id);
};
