// Диалог (ТЗ §3.6, §5.6, I-08): граф dialogues.json в окне реплики. Узел: реплика `pl/ru` →
// варианты `choices` или «дальше» → эффекты `do` → урок `lesson` → `next`, пока не `end`.
// Выбор с `ok: false` даёт тег ошибки и реакцию NPC (`react`), SRS не трогает. Реплики-заглушки:
// узел без текста и эффект `line` на `todo`-строку в dev показываются как `[todo: id]`, в игре
// пропускаются (P-01): узел идёт дальше, у узла с вариантами остаются только варианты.
// Прерывание (Esc, «B») закрывает диалог; при возврате он начнётся с `start` (диалоги короткие).
// P-07: реплика листается коробками (line.ts), варианты появляются на последней коробке, на экране не
// больше двух (выбор с проверкой перемешан по seed, P-01), вариант выбирается с первого тапа, даже если
// строка ещё печатается; перевод варианта — по «?» или долгому нажатию.
import { attachLongPress } from '../../input/press';
import type { Content } from '../../systems/content';
import { captionHidden, captionMode, matchWords, type CaptionMode } from '../../systems/words';
import type { LessonResult } from '../../types/bus';
import type { Condition, Dialogue, DialogueChoice, DialogueNode, Effect, Line, LineWord } from '../../types/content';
import { el } from '../dom';
import { shuffled } from '../exercises/options';
import type { Layer, Overlay } from '../overlay/host';
import { btn, react, type AudioPort, type PortraitSource, type React } from '../overlay/kit';
import { todoVisible } from '../todo';
import { lineBox, type LineStyle, type LineView, type WordPort } from './line';

export interface DialogDeps {
  overlay: Overlay;
  content: Pick<Content, 'characters' | 'lines'>;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  /** Настройка `translations` (P-07): always / auto / never; `tap` — старое значение, = auto. */
  translations?: CaptionMode | 'tap';
  /** Словарь и «знакомо ли слово» (P-07): гаснущая подпись и тап по слову. Нет — подпись видна всегда. */
  words?: WordPort | null;
  /** Добавка к seed перемешивания вариантов (игровой день, как у упражнений P-01). */
  seed?: string;
  typeMs?: number;
  /** Пауза на реакцию NPC после неверного выбора, мс (тесты: 0). */
  reactMs?: number;
  coarse?: boolean;
  /** Режим без звука (P-10b): реплики без ▶ и автозвука. */
  silent?: boolean;
  /** Игровой день главы (P-10b): до дня 7 у вариантов с проверкой русская подпись видна сразу. */
  day?: number;
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
  /** Разметка `words` (P-07). */
  words?: readonly LineWord[];
}

/** На экране не больше стольких вариантов (research/05 §6б п. 8). */
export const MAX_CHOICES = 2;

/** До этого игрового дня у вариантов с проверкой русская подпись видна сразу (P-10b), дальше гаснет по P-07. */
export const CHOICE_RU_UNTIL_DAY = 7;

/**
 * Подпись варианта видна сразу (P-10b, ПОЛИРОВКА §5 п. 9). Служебный ответ (узел без проверки: «Tak.», «Słucham!»,
 * «Bez dźwięku») — всегда. Вариант с проверкой — до дня 7 и пока его слова не знакомы по SRS; потом как подпись
 * реплики (P-07): гаснет, когда все значимые слова знакомы, остаётся «?». Настройка «никогда» — только «?».
 */
export function choiceRuShown(
  c: Pick<DialogueChoice, 'pl' | 'ru' | 'words'>,
  o: { test: boolean; translations?: CaptionMode | 'tap'; day?: number; words?: WordPort | null },
): boolean {
  if (!c.ru) return false;
  const mode = captionMode(o.translations);
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  if (!o.test || (o.day ?? 1) < CHOICE_RU_UNTIL_DAY || !o.words) return true;
  const w = o.words;
  const spans = matchWords(c.pl, w.index, c.words ? { refs: c.words } : {});
  return !captionHidden('auto', spans, (lx) => w.known(lx), { ...(c.words ? { refs: c.words } : {}), ...(w.ignore ? { ignore: w.ignore } : {}) });
}

/**
 * Варианты на экран (P-07): выбор с проверкой (есть `ok: false`) перемешан по seed, вкусовой — по порядку
 * контента; лишние отбрасываются (валидатор предупреждает), но верный вариант остаётся всегда.
 */
export function screenChoices<T extends { c: Pick<DialogueChoice, 'ok'> }>(list: readonly T[], seed: string): T[] {
  const test = list.some((x) => x.c.ok === false);
  const order = test ? shuffled(list, seed) : list.slice();
  if (order.length <= MAX_CHOICES) return order;
  const out = order.slice(0, MAX_CHOICES);
  if (test && !out.some((x) => x.c.ok !== false)) {
    const right = order.find((x) => x.c.ok !== false);
    if (right) out[MAX_CHOICES - 1] = right;
  }
  return out;
}

/**
 * Строка из story/lines.json для эффекта и узла `line` (I-11): pl + перевод `plRu` по тапу + русская
 * речь `ru` сразу; реплика только по-русски — одной строкой; todo — заглушка.
 */
export function speechOfLine(id: string, lines: ReadonlyMap<string, Line>): Speech {
  const l = lines.get(id);
  if (!l) return { who: 'bobr', todo: id };
  if (l.todo || (!l.pl && !l.ru)) return { who: l.who, todo: id };
  const w = l.words ? { words: l.words } : {};
  if (!l.pl) return { who: l.who, rus: l.ru!, ...w };
  return { who: l.who, pl: l.pl, ...(l.plRu ? { ru: l.plRu } : {}), ...(l.ru ? { rus: l.ru } : {}), ...w };
}

export function runDialog(dlg: Dialogue, deps: DialogDeps): Promise<DialogOutcome> {
  const layer = deps.overlay.open('pq-dialog-layer');
  const box = el('div', { class: 'pq-dlg', 'data-dialogue': dlg.id });
  layer.el.append(box);
  return playDialog(dlg, deps, layer, box).finally(() => layer.close());
}

/** Стиль окна (P-07): рассказчик без портрета, Казик (компаньон) своей рамкой, остальные — NPC. */
function styleOf(deps: DialogDeps, who: string): LineStyle {
  if (who === 'narrator') return 'narrator';
  return deps.content.characters.get(who)?.kind === 'companion' ? 'kazik' : 'npc';
}

/** Окно реплик на слое: показать реплику и дождаться «дальше» или выбора варианта. */
function speechUi(deps: DialogDeps, layer: Layer, box: HTMLElement) {
  const cond = deps.cond ?? (() => true);
  let view: LineView | null = null;
  let offPress: (() => void) | null = null;
  const speaker = (id: string): { id: string; name: string } => ({ id, name: deps.content.characters.get(id)?.name ?? id });

  /** Индекс выбранного варианта или -1 («дальше»). Отмена — исключение Cancelled. `key` — seed перемешивания. */
  const say = (sp: Speech, choices?: readonly DialogueChoice[], key = ''): Promise<number> => {
    const hideTodo = !!sp.todo && !todoVisible();
    // Заглушка без вариантов в игре не показывается: узел идёт дальше.
    if (hideTodo && !(choices ?? []).some((c) => !c.if || cond(c.if))) return Promise.resolve(-1);
    return new Promise<number>((resolve, reject) => {
      view?.dispose();
      offPress?.();
      offPress = null;
      const lv = lineBox({
        speaker: speaker(sp.who),
        ...(sp.pl ? { pl: sp.pl } : {}),
        ...(sp.ru ? { ru: sp.ru } : {}),
        ...(sp.todo && !hideTodo ? { todo: sp.todo } : {}),
        ...(sp.rus ? { rus: sp.rus } : {}),
        ...(sp.words ? { refs: sp.words } : {}),
        audio: deps.audio,
        portraits: deps.portraits ?? null,
        translations: deps.translations ?? 'auto',
        words: deps.words ?? null,
        style: styleOf(deps, sp.who),
        ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
        ...(deps.silent ? { silent: true } : {}),
        autoplay: true,
      });
      view = lv;
      const choiceBox = el('div', { class: 'pq-dlg-choices', role: 'group', hidden: true });
      const all = (choices ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !c.if || cond(c.if));
      const visible = screenChoices(all, `${key}${deps.seed ? `:${deps.seed}` : ''}`);
      let settled = false;
      const done = (v: number): void => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      const test = all.some(({ c }) => c.ok === false);
      const next = btn('▼', () => {
        if (lv.advance()) return;
        if (!visible.length) done(-1);
      }, 'icon pq-line-next', { 'aria-label': 'Дальше', 'data-primary': true, 'data-act': 'next' });
      if (visible.length) {
        for (const { c, i } of visible) {
          const shown = choiceRuShown(c, { test, ...(deps.translations ? { translations: deps.translations } : {}), ...(deps.day !== undefined ? { day: deps.day } : {}), words: deps.words ?? null });
          const ru = c.ru ? el('small', { class: 'ru', lang: 'ru', hidden: !shown, 'data-role': 'choice-ru' }, c.ru) : null;
          const reveal = (): void => {
            if (ru) ru.hidden = false;
            // Место «?» остаётся, чтобы кнопка не прыгала под пальцем.
            if (q) {
              q.style.visibility = 'hidden';
              q.disabled = true;
            }
          };
          // Первый тап выбирает (P-07): раньше тап, пока реплика печаталась, только допечатывал её,
          // и «Start» срабатывал со второго тапа. Теперь строка дописывается и вариант выбирается сразу.
          const b = btn(el('span', { class: 'pq-choice-l' }, el('span', { class: 'pl', lang: 'pl' }, c.pl), ru), () => {
            lv.finish();
            done(i);
          }, 'pq-choice', { 'data-nav': true, 'data-choice': String(i) });
          const q = c.ru && !shown ? btn('?', reveal, 'icon ghost pq-choice-q', { 'aria-label': `Перевод: ${c.pl}`, 'data-act': 'choice-ru', 'data-for': String(i) }) : null;
          (b as HTMLElement & { pqReveal?: () => void }).pqReveal = reveal;
          choiceBox.append(el('div', { class: 'pq-choice-row' }, q, b));
        }
        // Долгое нажатие на вариант — перевод, без выбора.
        offPress = attachLongPress(choiceBox, { selector: '[data-choice]', onLongPress: (item) => (item as HTMLElement & { pqReveal?: () => void }).pqReveal?.() });
      }
      lv.node.append(next);
      // Тап по коробке = «дальше» (допечатать, следующая коробка); на последней коробке с вариантами — ничего.
      lv.node.addEventListener('click', (e) => {
        if ((e.target as Element).closest('button')) return;
        if (lv.advance()) return;
        if (!visible.length) done(-1);
      });
      box.replaceChildren(choiceBox, lv.node);
      // Узел только с вариантами (реплика героя): пустую коробку не показываем, варианты — его слова.
      if (visible.length && !sp.pl && !sp.rus && !(sp.todo && !hideTodo)) lv.node.hidden = true;
      lv.onEnd(() => {
        if (!visible.length) return;
        choiceBox.hidden = false;
        next.hidden = true;
        if (!deps.coarse) queueMicrotask(() => (choiceBox.querySelector('[data-choice]') as HTMLElement | null)?.focus({ preventScroll: true }));
      });
      layer.handle({
        interact: () => lv.advance(),
        cancel: () => {
          if (!settled) {
            settled = true;
            reject(new Cancelled());
          }
          return true;
        },
      });
      if (!deps.coarse && choiceBox.hidden) queueMicrotask(() => next.focus({ preventScroll: true }));
    });
  };

  return {
    say,
    get view(): LineView | null {
      return view;
    },
    dispose(): void {
      view?.dispose();
      offPress?.();
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
      // Узел только с вариантами (реплика героя «Start») — варианты без строки, не заглушка.
      // Узел `line` — реплика из story/lines.json. Чистый `end` без who (I-11) молчит.
      const silent = !node.pl && !node.line && !node.lesson && !node.do?.length && !(node.end && node.who === undefined);
      if (node.pl || node.line || silent || node.todo || node.choices) {
        const who = node.who ?? 'bobr';
        const sp: Speech = node.line
          ? speechOfLine(node.line, deps.content.lines)
          : node.pl
            ? { who, pl: node.pl, ...(node.ru ? { ru: node.ru } : {}), ...(node.words ? { words: node.words } : {}) }
            : node.choices && !node.todo
              ? { who }
              : { who, todo: `${dlg.id}.${id}` };
        const pick = await ui.say(sp, node.choices, `${dlg.id}#${id}`);
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
  // В игре заглушки не показываются; если показывать нечего, окно не открываем.
  if (!todoVisible()) lines = lines.filter((l) => !l.todo);
  if (!lines.length) return true;
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
