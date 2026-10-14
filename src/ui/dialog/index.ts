// Диалог (ТЗ §3.6, §5.6, I-08): граф dialogues.json в окне реплики. Узел: реплика `pl/ru` →
// варианты `choices` или «дальше» → эффекты `do` → урок `lesson` → `next`, пока не `end`.
// Выбор с `ok: false` даёт тег ошибки и реакцию NPC (`react`), SRS не трогает. Реплики-заглушки:
// узел без текста и эффект `line` на `todo`-строку показываются как `[todo: id]`.
// Прерывание (Esc, «B») закрывает диалог; при возврате он начнётся с `start` (диалоги короткие).
import type { Content } from '../../systems/content';
import type { LessonResult } from '../../types/bus';
import type { Condition, Dialogue, DialogueChoice, DialogueNode, Effect, Line } from '../../types/content';
import { el } from '../dom';
import type { Layer, Overlay } from '../overlay/host';
import { btn, react, type AudioPort, type PortraitSource, type React } from '../overlay/kit';
import { lineBox, type LineView } from './line';

export interface DialogDeps {
  overlay: Overlay;
  content: Pick<Content, 'characters' | 'lines'>;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  translations?: 'tap' | 'always';
  typeMs?: number;
  /** Пауза на реакцию NPC после неверного выбора, мс (тесты: 0). */
  reactMs?: number;
  coarse?: boolean;
  /** Условие `if` у варианта (ТЗ §3.9). Без вычислителя (до I-17) — всё истинно. */
  cond?(c: Condition): boolean;
  /** Запуск урока узла `lesson` и эффекта `startLesson`. */
  runLesson?(lessonId: string): Promise<LessonResult | null>;
  /** Остальные эффекты (`setFlag`, `give`, `teleport`, `open`, `toast`, …): решает склейка. */
  effects?(e: Effect): void | Promise<void>;
}

export interface DialogOutcome {
  /** Дошли до `end`. */
  ended: boolean;
  cancelled: boolean;
  /** Узлы по порядку прохождения. */
  path: string[];
  /** Теги ошибок выборов `ok: false`. */
  errorTags: string[];
  lessons: { id: string; result: LessonResult | null }[];
}

/** Предохранитель от петли `next` без выхода (валидатор её ловит, но рантайм не должен зависнуть). */
const MAX_NODES = 200;

class Cancelled extends Error {}

interface Speech {
  who: string;
  pl?: string;
  /** Перевод pl (скрыт до тапа). */
  ru?: string;
  /** Русская речь персонажа рядом с польской (реплики Казика, `line.ru` при `line.pl`): видна сразу. */
  rus?: string;
  todo?: string;
}

/**
 * Строка из story/lines.json для эффекта и узла `line` (I-11): pl + перевод `plRu` по тапу + русская
 * речь `ru` сразу; реплика только по-русски — одной строкой; todo — заглушка.
 */
export function speechOfLine(id: string, lines: ReadonlyMap<string, Line>): Speech {
  const l = lines.get(id);
  if (!l) return { who: 'bobr', todo: id };
  if (l.todo || (!l.pl && !l.ru)) return { who: l.who, todo: id };
  if (!l.pl) return { who: l.who, rus: l.ru! };
  return { who: l.who, pl: l.pl, ...(l.plRu ? { ru: l.plRu } : {}), ...(l.ru ? { rus: l.ru } : {}) };
}

export function runDialog(dlg: Dialogue, deps: DialogDeps): Promise<DialogOutcome> {
  const layer = deps.overlay.open('pq-dialog-layer');
  const box = el('div', { class: 'pq-dlg', 'data-dialogue': dlg.id });
  layer.el.append(box);
  return playDialog(dlg, deps, layer, box).finally(() => layer.close());
}

/** Окно реплик на слое: показать реплику и дождаться «дальше» или выбора варианта. */
function speechUi(deps: DialogDeps, layer: Layer, box: HTMLElement) {
  const cond = deps.cond ?? (() => true);
  let view: LineView | null = null;
  const speaker = (id: string): { id: string; name: string } => ({ id, name: deps.content.characters.get(id)?.name ?? id });

  /** Индекс выбранного варианта или -1 («дальше»). Отмена — исключение Cancelled. */
  const say = (sp: Speech, choices?: readonly DialogueChoice[]): Promise<number> =>
    new Promise<number>((resolve, reject) => {
      view?.dispose();
      const lv = lineBox({
        speaker: speaker(sp.who),
        ...(sp.pl ? { pl: sp.pl } : {}),
        ...(sp.ru ? { ru: sp.ru } : {}),
        ...(sp.todo ? { todo: sp.todo } : {}),
        ...(sp.rus ? { rus: sp.rus } : {}),
        audio: deps.audio,
        portraits: deps.portraits ?? null,
        translations: deps.translations ?? 'tap',
        ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
        autoplay: true,
      });
      view = lv;
      const choiceBox = el('div', { class: 'pq-dlg-choices', role: 'group' });
      const visible = (choices ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !c.if || cond(c.if));
      let settled = false;
      const done = (v: number): void => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      const next = btn('▼', () => {
        if (lv.skip()) return;
        done(-1);
      }, 'icon pq-line-next', { 'aria-label': 'Дальше', 'data-primary': true, 'data-act': 'next' });
      if (visible.length) {
        for (const { c, i } of visible) {
          choiceBox.append(
            btn(
              el('span', {}, el('span', { lang: 'pl' }, c.pl), c.ru && deps.translations === 'always' ? el('small', {}, c.ru) : null),
              () => {
                if (lv.skip()) return;
                done(i);
              },
              '',
              { 'data-nav': true, 'data-choice': String(i) },
            ),
          );
        }
      } else lv.node.append(next);
      // Тап по рамке без вариантов = «дальше» (или допечатать строку).
      lv.node.addEventListener('click', (e) => {
        if (visible.length || (e.target as Element).closest('button')) return;
        if (!lv.skip()) done(-1);
      });
      box.replaceChildren(...(visible.length ? [choiceBox] : []), lv.node);
      layer.handle({
        interact: () => lv.skip(),
        cancel: () => {
          if (!settled) {
            settled = true;
            reject(new Cancelled());
          }
          return true;
        },
      });
      if (!deps.coarse) queueMicrotask(() => (visible.length ? (choiceBox.querySelector('button') as HTMLElement | null) : next)?.focus({ preventScroll: true }));
    });

  return {
    say,
    get view(): LineView | null {
      return view;
    },
    dispose(): void {
      view?.dispose();
      layer.handle(null);
    },
  };
}

async function playDialog(dlg: Dialogue, deps: DialogDeps, layer: Layer, box: HTMLElement): Promise<DialogOutcome> {
  const out: DialogOutcome = { ended: false, cancelled: false, path: [], errorTags: [], lessons: [] };
  const ui = speechUi(deps, layer, box);

  const lesson = async (id: string): Promise<void> => {
    box.hidden = true;
    const result = deps.runLesson ? await deps.runLesson(id) : null;
    out.lessons.push({ id, result });
    box.hidden = false;
    if (result?.cancelled) throw new Cancelled();
  };
  const runEffect = async (e: Effect): Promise<void> => {
    if (e.line) await ui.say(speechOfLine(e.line, deps.content.lines));
    else if (e.startLesson) await lesson(e.startLesson);
    else await deps.effects?.(e);
  };

  try {
    let id: string | undefined = dlg.start;
    for (let guard = 0; id !== undefined && guard < MAX_NODES; guard++) {
      const node: DialogueNode | undefined = dlg.nodes[id];
      if (!node) break;
      out.path.push(id);
      let nextId: string | undefined = node.next;
      // Узел без текста, урока и эффектов (или с `todo: true`) — заглушка `[todo: <dlg>.<узел>]`.
      // Узел `line` — реплика из story/lines.json. Чистый `end` без who (I-11) молчит.
      const silent = !node.pl && !node.line && !node.lesson && !node.do?.length && !(node.end && node.who === undefined);
      if (node.pl || node.line || silent || node.todo || node.choices) {
        const who = node.who ?? 'bobr';
        const sp: Speech = node.line
          ? speechOfLine(node.line, deps.content.lines)
          : node.pl
            ? { who, pl: node.pl, ...(node.ru ? { ru: node.ru } : {}) }
            : { who, todo: `${dlg.id}.${id}` };
        const pick = await ui.say(sp, node.choices);
        const ch: DialogueChoice | undefined = pick >= 0 ? node.choices?.[pick] : undefined;
        if (ch) {
          const reaction = ch.ok === false ? (ch.react ?? 'confused') : ch.react;
          if (ch.ok === false && ch.errorTag) out.errorTags.push(ch.errorTag);
          if (reaction) {
            // Реакция NPC видна, пока реплика не сменилась (СЮЖЕТ §1 правило 3: смешно, не стыдно).
            reactTo(ui.view, reaction);
            const ms = deps.reactMs ?? 650;
            if (ms > 0) await pause(ms);
          }
          for (const e of ch.do ?? []) await runEffect(e);
          nextId = ch.next;
        }
      }
      for (const e of node.do ?? []) await runEffect(e);
      if (node.lesson) await lesson(node.lesson);
      if (node.end) {
        out.ended = true;
        break;
      }
      id = nextId;
    }
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
    out.cancelled = true;
  } finally {
    ui.dispose();
  }
  return out;
}

function reactTo(view: LineView | null, kind: React): void {
  react(view?.portrait, kind);
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Реплики вне графа (эффект `line` триггера, `[todo]` у NPC без диалога). false — прервали. */
export async function runLines(lines: readonly Speech[], deps: DialogDeps): Promise<boolean> {
  const layer = deps.overlay.open('pq-dialog-layer');
  const box = el('div', { class: 'pq-dlg' });
  layer.el.append(box);
  const ui = speechUi(deps, layer, box);
  try {
    for (const l of lines) await ui.say(l);
    return true;
  } catch (e) {
    if (e instanceof Cancelled) return false;
    throw e;
  } finally {
    ui.dispose();
    layer.close();
  }
}

export type { Speech };
