// Spiżarnia · Кладовая: полка с банками по темам. Банка наполнена по доле собранного, тап открывает слова темы.
import type { Bus } from '../systems/bus';
import { framesOf, lookOf } from '../systems/plantLook';
import { atlasIcon } from './atlasIcon';
import type { BusEvents } from '../types/bus';
import type { FarmApi } from '../types/farm';
import { el } from './dom';
import { TIP_CSS, type Tips } from './glossary';
import { createPanel, nav } from './panel';

const css = `
${TIP_CSS}
.pantry-sum { font-size: 17px; font-weight: 600; margin-bottom: 10px; }
.pantry-shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 14px 10px; padding-bottom: 6px; }
.jar-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; font: inherit; color: var(--pq-ink); background: none; border: 0; border-bottom: 6px solid var(--pq-wood);
  padding: 4px 2px 6px; cursor: pointer; border-radius: 4px; }
.jar { position: relative; width: 58px; height: 78px; }
.jar .lid { position: absolute; left: 8px; right: 8px; top: 0; height: 11px; background: var(--pq-wood); border: 2px solid var(--pq-ink); border-radius: 3px; z-index: 2; }
.jar .glass { position: absolute; left: 2px; right: 2px; top: 9px; bottom: 0; border: 3px solid var(--pq-ink); border-radius: 8px 8px 12px 12px; background: rgba(255, 255, 255, .45); overflow: hidden; }
.jar .fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--jar); border-top: 2px solid var(--pq-ink); }
.jar .shine { position: absolute; left: 5px; top: 6px; width: 5px; height: 26px; background: rgba(255, 255, 255, .55); border-radius: 3px; z-index: 1; }
.jar-btn.empty .jar { opacity: .4; }
.jar-btn .name { font-size: 14px; font-weight: 700; text-align: center; line-height: 1.1; }
.jar-btn .cnt { font-size: 13px; opacity: .75; }
.pantry-back { margin-bottom: 10px; }
.pantry-list { display: flex; flex-direction: column; gap: 5px; }
.pantry-item { display: flex; align-items: center; gap: 8px; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 6px; padding: 6px 8px; }
.pantry-item .txt { flex: 1 1 auto; min-width: 0; }
.pantry-item .pq-aico { margin: -2px 0; }
.pantry-item .pl { font-size: 19px; font-weight: 700; overflow-wrap: anywhere; }
.pantry-item .ru { font-size: 14px; opacity: .8; overflow-wrap: anywhere; }
.pantry-item .over { font-size: 12px; color: #a8453a; font-weight: 600; }
.pantry-empty { opacity: .7; padding: 10px 2px; }
`;

export interface PantryScreen {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Мини-предмет слова в банке (тот же, что рос на кусте: машинка, ягода); у куста и фразы — ничего. */
function itemIcon(id: string, item: { pl: string; ru?: string; pos?: string; topic?: string } | undefined): HTMLElement | null {
  if (!item) return null;
  const held = framesOf(lookOf(id, item)).held;
  return held ? atlasIcon(held, 2) : null;
}

export function mountPantry(parent: HTMLElement, api: FarmApi, bus?: Bus<BusEvents>, tips?: Tips): PantryScreen {
  const panel = createPanel({
    title: 'Spiżarnia · Кладовая',
    bus,
    // Esc/B в списке банки возвращает к полке; на самой полке закрывает.
    onCancel: () => {
      if (!current) return false;
      current = null;
      renderAll();
      panel.body.scrollTop = 0;
      panel.focus();
      return true;
    },
  });
  const content = el('div', {});
  panel.body.append(el('style', {}, css), content);
  parent.append(panel.root);

  /** Сколько всего в каждой теме: считается при показе полки, свои слова («Moje słowa») появляются и удаляются на лету. */
  const totals = (): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of [...api.words, ...api.phrases]) m.set(x.topic, (m.get(x.topic) ?? 0) + 1);
    return m;
  };
  const hue = (idx: number): number => (idx * 47 + 20) % 360;

  let current: string | null = null; // открытая банка

  function renderShelf(): void {
    const taken = new Map(api.pantry().map((p) => [p.topic, p.ids]));
    const total = totals();
    const all = [...taken.values()].flat();
    const phrases = all.filter((id) => id.startsWith('p.')).length;
    const jars = api.topics.map((t, idx) => {
      const n = taken.get(t.id)?.length ?? 0;
      const tot = total.get(t.id) ?? 0;
      const pct = tot > 0 ? Math.min(100, Math.round((n / tot) * 100)) : 0;
      return el(
        'button',
        { type: 'button', class: n ? 'jar-btn' : 'jar-btn empty', 'data-jar': t.id, ...nav('jars', 'h', `jar:${t.id}`), onclick: () => openJar(t.id), 'aria-label': `${t.pl}: ${n} из ${tot}` },
        el(
          'div',
          { class: 'jar' },
          el('div', { class: 'lid' }),
          el('div', { class: 'glass' }, el('div', { class: 'fill', style: `height:${pct}%;--jar:hsl(${hue(idx)} 62% 58%)` }), el('div', { class: 'shine' })),
        ),
        el('div', { class: 'name' }, t.pl),
        el('div', { class: 'cnt' }, `${n} / ${tot}`),
      );
    });
    content.replaceChildren(
      el('div', { class: 'pantry-sum', 'data-sum': '' }, `Собрано: ${all.length - phrases} слов, ${phrases} фраз`),
      ...[tips?.note('jar')].filter((n): n is HTMLElement => !!n),
      el('div', { class: 'pantry-shelf' }, ...jars),
    );
  }

  function renderJar(topicId: string): void {
    const t = api.topics.find((x) => x.id === topicId);
    const ids = api.pantry().find((p) => p.topic === topicId)?.ids ?? [];
    const rows = ids.map((id) => {
      const item = api.word(id) ?? api.phrase(id);
      const over = api.info(id).status === 'growing';
      return el(
        'div',
        { class: 'pantry-item', 'data-id': id },
        itemIcon(id, item),
        el('div', { class: 'txt' }, el('div', { class: 'pl' }, item?.pl ?? id), el('div', { class: 'ru' }, item?.ru ?? ''), over ? el('div', { class: 'over' }, 'перезрело, на грядке') : null),
        el('button', { type: 'button', class: 'pq-btn small', 'aria-label': 'Озвучить', ...nav('items', 'v', `say:${id}`), onclick: () => api.say(id) }, '▶'),
      );
    });
    content.replaceChildren(
      el('button', { type: 'button', class: 'pq-btn small pantry-back', 'data-back': '', ...nav('back', 'v', 'back'), onclick: () => ((current = null), renderAll()) }, '← К полке'),
      el('div', { class: 'pantry-sum' }, t ? `${t.pl} · ${t.ru}` : topicId),
      rows.length ? el('div', { class: 'pantry-list', 'data-jar-list': '' }, ...rows) : el('div', { class: 'pantry-empty' }, 'В этой банке пока пусто. Вырасти слова этой темы, и они окажутся здесь.'),
    );
  }

  function renderAll(): void {
    if (current) renderJar(current);
    else renderShelf();
    panel.syncFocus();
  }
  function openJar(id: string): void {
    current = id;
    renderJar(id);
    panel.body.scrollTop = 0;
    panel.focus();
  }

  let off: (() => void) | null = null;
  panel.onClose(() => {
    off?.();
    off = null;
    tips?.commit();
  });
  return {
    open() {
      if (panel.isOpen) return;
      current = null;
      panel.open();
      off = api.onChange(() => panel.isOpen && renderAll());
      renderAll();
      panel.focus();
    },
    close() {
      panel.close();
    },
    get isOpen() {
      return panel.isOpen;
    },
  };
}
