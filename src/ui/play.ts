// Склейка оверлея с миром (I-08): `world:interact` → диалог NPC, упражнение у объекта-слова,
// табличка, эффекты триггера; `ui:dialog:open`, `ui:lesson:start` → диалог и урок. Пока открыт
// оверлей, мир выключен (`world:input`, делает host.ts). Итог урока — `ui:lesson:end`, новые события
// журнала — `progress:changed` (его слушает синк).
import { bus as globalBus, type Bus } from '../systems/bus';
import type { Content } from '../systems/content';
import { condCtx, evaluator, lessonOfVariant, lessonVariant } from '../systems/conditions';
import { derive, deriveContent } from '../systems/derive';
import type { LogEvent } from '../systems/log';
import { lessonForToday, muteLines, paceCtxOf, stepGateOf } from '../systems/pace';
import { getSetting, giveItem, markChallenge, setFlag, type Progress } from '../systems/progress';
import { newContentLock } from '../systems/queue';
import { cardId } from '../systems/srs';
import { buildWordIndex, isFamiliar, tokenize, type WordIndex } from '../systems/words';
import type { BusEvents, LessonResult, WorldInteract } from '../types/bus';
import type { Condition, Effect, Lesson, LocationMap, Step, VocabEntry } from '../types/content';
import { runDialog, runLines, speechOfLine, type DialogDeps } from './dialog';
import type { WordPort } from './dialog/line';
import { el } from './dom';
import { runLesson, type LessonStore } from './lesson';
import { shuffled } from './exercises/options';
import { createOverlay, type Overlay } from './overlay/host';
import { openPassport, passportModel } from './passport';
import { openSoundMap, soundMapModel } from './soundMap';
import { audioButtons, btn, busAudio, type AudioPort, type PortraitFrame, type PortraitSource } from './overlay/kit';

export interface PlayStore extends LessonStore {
  /** Флаги, предметы, челленджи из эффектов. false — запись запрещена (только чтение). */
  setProgress?(p: Progress): boolean;
}

export interface PlayDeps {
  content: Content;
  store: PlayStore | Promise<PlayStore>;
  bus?: Bus<BusEvents>;
  audio?: AudioPort;
  /** Источник портретов; можно промис (атлас грузится по сети). */
  portraits?: PortraitSource | null | Promise<PortraitSource | null>;
  clock?: { now(): number; mono(): number };
  coarse?: boolean;
  typeMs?: number;
  /** Каждое записанное событие журнала (dev: консоль). */
  onEvent?(e: LogEvent): void;
  /**
   * Режиссёр забирает действие с объектом (I-13): цель шага, бит, грядка первого дня. true — склейка
   * (src/flow.ts) сама ведёт шаг, обработчик по умолчанию не нужен.
   */
  claim?(p: WorldInteract): boolean;
}

export interface Play {
  overlay: Overlay;
  /** Урок; `item` — только чанк этого слова (шаги с `item`, `introduces: [item]`, без итога): сцена дня 1 у забора (P-05). */
  openLesson(id: string, o?: { item?: string }): Promise<LessonResult | null>;
  openDialog(id: string): Promise<void>;
  /** Паспорт (§5.10, I-11); то же по `ui:screen:open { screen: 'passport' }`. */
  openPassport(): Promise<void>;
  interact(p: WorldInteract): Promise<void>;
  /** Эффекты контента (биты режиссёра, I-13). */
  effects(list: readonly Effect[]): Promise<void>;
  /** Реплики из story/lines.json модальным окном (бит с целью, I-13). */
  lines(ids: readonly string[]): Promise<void>;
  /** Диалог NPC, который ведёт к уроку `lessonId` (условия `if` истинны); нет — null. */
  dialogFor(npc: string, lessonId: string): string | null;
  /** Идёт диалог или урок. */
  readonly busy: boolean;
  dispose(): void;
}

export function mountPlay(root: HTMLElement, deps: PlayDeps): Play {
  const bus = deps.bus ?? globalBus;
  const overlay = createOverlay(root, { bus });
  const audio = deps.audio ?? busAudio(bus);
  const { content } = deps;
  const storeP = Promise.resolve(deps.store);
  let busy = 0;
  let wrote = 0;
  let portraitSrc: PortraitSource | null = null;
  void Promise.resolve(deps.portraits ?? null).then((p) => (portraitSrc = p));
  const portraits: PortraitSource = (id) => portraitSrc?.(id) ?? null;

  const onEvent = (e: LogEvent): void => {
    wrote++;
    deps.onEvent?.(e);
  };
  const flushChanged = (): void => {
    if (!wrote) return;
    wrote = 0;
    bus.emit('progress:changed', { kinds: ['cards'] });
  };

  /** Условие `if` (§3.9): все атомы через systems/conditions.ts (I-13); состояние выводится один раз на вызов. */
  const cond = (store: PlayStore): ((c: Condition) => boolean) => {
    let ev: ((c: Condition) => boolean) | null = null;
    return (c) => {
      if (!ev) {
        const now = deps.clock?.now() ?? Date.now();
        ev = evaluator(condCtx(content, derive(store.progress, deriveContent(content), now), store.progress.world, now));
      }
      return ev(c);
    };
  };

  const guard = async <T>(fn: (store: PlayStore) => Promise<T>): Promise<T | null> => {
    if (busy) return null;
    busy++;
    try {
      return await fn(await storeP);
    } finally {
      busy--;
      flushChanged();
    }
  };

  const lessonDeps = (store: PlayStore) => ({
    overlay,
    content,
    store,
    audio,
    portraits,
    onEvent,
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.coarse !== undefined ? { coarse: deps.coarse } : {}),
    ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
  });

  const lessonById = async (store: PlayStore, id: string, item?: string): Promise<LessonResult | null> => {
    const full = content.lessons.get(id)?.value;
    // Чанк одного слова (P-05): реплики сюжета идут между чанками, слово за словом.
    const chunk = full && item ? (full.steps ?? []).filter((s) => s.item === item) : [];
    const l0: Lesson | undefined = full && item && chunk.length ? { ...full, steps: chunk as [Step, ...Step[]], introduces: (full.introduces ?? []).filter((x) => x === item) } : full;
    if (!l0) {
      console.warn(`[ui] урока ${id} нет в контенте`);
      return null;
    }
    const now = deps.clock?.now() ?? Date.now();
    const d = derive(store.progress, deriveContent(content), now);
    // requires / skipIf / short (§3.5, §4.3, I-13): закрытый и пропущенный урок не играется, жёлтый кластер — короткая версия.
    const variant = lessonVariant(l0, condCtx(content, d, store.progress.world, now));
    const lv = lessonOfVariant(l0, variant);
    // P-06: шаги систем, которые сегодня рано (клавиатура с дня 3, «повтори вслух» с дня 4), и без звука —
    // задания на слух без транскрипции не играются.
    const silent = getSetting(store.progress, 'sound.mode') === 'off';
    const l = lv ? lessonForToday(lv, stepGateOf(content, paceCtxOf(content, d, store.progress.world.flags), silent)) : null;
    if (!l) {
      console.info(`[ui] урок ${id}: ${variant === 'skip' ? 'пропуск (skipIf)' : 'закрыт (requires)'}`);
      return null;
    }
    // Затор (§4.2): долг выше порога — сцены с новыми словами закрыты, Казик говорит «Zator.».
    const fresh = (l.introduces ?? []).filter((it) => !d.cards[cardId(it, 'rec')] && !d.cards[cardId(it, 'lis')]).length;
    if (newContentLock(d, now, content.tuning, fresh) === 'debt') {
      await runLines([speechOfLine('sys.kazik.jam', content.lines)], dialogDeps(store));
      return null;
    }
    const wasPassed = l.kind === 'boss' && d.bossResults[id]?.passedAt !== undefined;
    const result = await runLesson(l, lessonDeps(store), item ? { noSummary: true } : {});
    // Отрезок дня (§3.11 seg, I-13): сцена, босс, диагностика → `scene`; лекарство → `remedy`. Пишет тот, кто
    // знает, что урок закончен (не прерван): склейка оверлея. Режиссёр читает seg за сегодня.
    if (!result.cancelled && l.kind !== 'practice') {
      const r = store.append({ k: 'seg', ts: deps.clock?.now() ?? Date.now(), seg: l.kind === 'remedy' ? 'remedy' : 'scene' });
      if (r.ok) onEvent(r.event);
    }
    bus.emit('ui:lesson:end', { lessonId: id, result });
    // Турникет (P-06): карта звуков сразу, в том числе после выхода посреди проверки.
    if (l.kind === 'diag' && !result.cancelled) {
      const dots = soundMapModel(content, derive(store.progress, deriveContent(content), deps.clock?.now() ?? Date.now()));
      if (dots) await openSoundMap(overlay, linesOf(store), dots, { ...(result.exited ? { exited: true } : {}) });
    }
    // Первая сдача босса (§5.8, I-11): reward урока и module.onComplete (билет, флаг главы → печать биома, реплики).
    if (l.kind === 'boss' && result.passed && !wasPassed) {
      const mod = content.modules.get(content.lessons.get(id)?.module ?? '')?.module;
      for (const e of [...(l.reward ?? []), ...(mod?.boss === id ? (mod.onComplete ?? []) : [])]) await effect(store, e);
    }
    return result;
  };

  const applyProgress = (store: PlayStore, f: (p: Progress) => Progress, kind: 'world'): void => {
    const next = f(store.progress);
    if (next !== store.progress && store.setProgress?.(next)) bus.emit('progress:changed', { kinds: [kind] });
  };

  // Слова реплик (P-07): словарь строится один раз, «знакомо ли» — по карточкам на момент открытия диалога.
  let wordIndex: WordIndex | null = null;
  const nameWords = (name: string): string[] => tokenize(name).filter((t) => t.word && /^\p{Lu}/u.test(t.text)).map((t) => t.text);
  const names = new Set([...content.characters.values()].flatMap((c) => nameWords(c.name)));
  // Имя игрока меняется в Fotobudka (P-10a): «Andrzej» в реплике — имя, а не незнакомое слово.
  const isName = (w: string): boolean => names.has(w) || [...content.characters.values()].some((c) => c.kind === 'player' && nameWords(c.name).includes(w));
  const wordPort = (store: PlayStore): { port: WordPort; day: string } => {
    const now = deps.clock?.now() ?? Date.now();
    const d = derive(store.progress, deriveContent(content), now);
    wordIndex ??= buildWordIndex([...content.vocab.values()].map((x) => x.value));
    const vocab = (id: string): VocabEntry | undefined => content.vocab.get(content.renames.get(id) ?? id)?.value;
    return {
      day: d.today,
      port: {
        index: wordIndex,
        vocab,
        known: (id) => {
          const v = vocab(id);
          return !!v && isFamiliar(d.cards, v.id, v);
        },
        ignore: isName,
      },
    };
  };

  /** Без звука (P-06, СЮЖЕТ_v2 §7): реплики с вариантом `<id>.mute` подменяются им. */
  const linesOf = (store: PlayStore): Content => (getSetting(store.progress, 'sound.mode') === 'off' ? { ...content, lines: muteLines(content.lines) } : content);

  const dialogDeps = (store: PlayStore): DialogDeps => {
    const w = wordPort(store);
    return {
      overlay,
      content: linesOf(store),
      audio,
      portraits,
      words: w.port,
      seed: w.day,
      translations: getSetting(store.progress, 'translations'),
      ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
      ...(deps.coarse !== undefined ? { coarse: deps.coarse } : {}),
      cond: cond(store),
      runLesson: (id) => lessonById(store, id),
      effects: (e) => effect(store, e),
    };
  };

  /** Эффекты кроме `line` и `startLesson` (их ведёт диалог). Новые атомы — effects.ts (I-17). */
  async function effect(store: PlayStore, e: Effect): Promise<void> {
    const now = deps.clock?.now() ?? Date.now();
    if (e.setFlag) applyProgress(store, (p) => setFlag(p, e.setFlag!, now), 'world');
    if (e.give) applyProgress(store, (p) => giveItem(p, e.give!, now), 'world');
    if (e.challenge) applyProgress(store, (p) => markChallenge(p, e.challenge!, now), 'world');
    if (e.startDialogue) await dialogById(store, e.startDialogue);
    if (e.line) await runLines([speechOfLine(e.line, linesOf(store).lines)], dialogDeps(store));
    if (e.startLesson) await lessonById(store, e.startLesson);
    if (e.teleport) bus.emit('world:teleport', { location: e.teleport.to, spawn: e.teleport.spawn ?? 'default' });
    if (e.open === 'obchod' || e.open === 'express') bus.emit('ui:obchod:start', { mode: e.open === 'express' ? 'express' : 'day' });
    else if (e.open) bus.emit('ui:screen:open', { screen: e.open });
    if (e.toast) toast(root, e.toast.ru);
    if (e.reveal) {
      // Раскрыть элемент HUD навсегда (§4.12): флаг hud.<element> + анимация появления.
      const el2 = e.reveal;
      const before = store.progress;
      applyProgress(store, (p) => setFlag(p, `hud.${el2}`, now), 'world');
      if (store.progress !== before) bus.emit('guide:reveal', { element: el2 });
    }
  }

  async function dialogById(store: PlayStore, id: string): Promise<void> {
    const d = content.dialogues.get(id)?.value;
    if (!d) {
      await runLines([{ who: 'bobr', todo: id }], dialogDeps(store));
      return;
    }
    const out = await runDialog(d, dialogDeps(store));
    if (out.errorTags.length) console.info('[ui] теги ошибок диалога', d.id, out.errorTags);
  }

  async function interact(p: WorldInteract): Promise<void> {
    if (!busy && deps.claim?.(p)) return;
    // Грядка (I-12): полив ведёт оверлей петли дня (src/ui/day.ts); клетку → слово уже разобрала сцена.
    if (p.kind === 'plot') {
      bus.emit('ui:obchod:start', { mode: 'day', ...(p.item ? { fromItem: p.item } : {}) });
      return;
    }
    await guard(async (store) => {
      switch (p.kind) {
        case 'npc': {
          const ok = cond(store);
          const d = [...content.dialogues.values()].map((x) => x.value).find((x) => x.npc === p.id && (!x.if || ok(x.if)));
          if (d) await dialogById(store, d.id);
          else await runLines([{ who: p.id, todo: `npc.${p.id}` }], dialogDeps(store));
          return;
        }
        case 'word': {
          const v = p.item ? content.vocab.get(p.item)?.value : undefined;
          if (!v) return;
          // Заголовок без самого слова: у type/dictation он выдал бы ответ.
          const lesson: Lesson = { id: `word.${p.location}.${p.id}`, kind: 'practice', title: { ru: 'Слово' }, minutes: 1, steps: [wordStep(v, p.ex, content)] };
          await runLesson(lesson, lessonDeps(store), { drill: true, noSummary: true });
          return;
        }
        case 'sign': {
          const map = content.maps.get(p.location)?.value;
          const sign = map?.objects.find((o) => o.type === 'sign' && o.at[0] === p.tile[0] && o.at[1] === p.tile[1]);
          if (sign && sign.type === 'sign') await signPopup(overlay, audio, sign.pl, sign.ru, getSetting(store.progress, 'translations'));
          return;
        }
        case 'trigger': {
          const map: LocationMap | undefined = content.maps.get(p.location)?.value;
          const trig = map?.objects.find((o) => o.type === 'trigger' && o.id === p.id);
          if (!trig || trig.type !== 'trigger') return;
          if (trig.if && !cond(store)(trig.if)) return;
          for (const e of trig.do) await effect(store, e);
          return;
        }
        default:
          // board (банки, I-45), secret (Симба, I-29) — не оверлей I-08.
          console.info('[ui] world:interact без обработчика в I-08:', p.kind, p.key);
      }
    });
  }

  const offs = [
    bus.on('world:interact', (p) => void interact(p)),
    bus.on('ui:dialog:open', ({ dialogueId }) => void guard((s) => dialogById(s, dialogueId))),
    bus.on('ui:lesson:start', ({ lessonId }) => void guard((s) => lessonById(s, lessonId))),
    bus.on('ui:screen:open', ({ screen }) => {
      if (screen === 'passport') void guard((s) => passport(s));
    }),
  ];

  function passport(store: PlayStore): Promise<void> {
    const now = deps.clock?.now() ?? Date.now();
    const d = derive(store.progress, deriveContent(content), now);
    return openPassport(overlay, passportModel(content, store.progress, d, cond(store)));
  }

  /** Диалог NPC, в графе которого есть узел-урок `lessonId`, и его `if` истинно сейчас. */
  let storeNow: PlayStore | null = null;
  void storeP.then((s) => (storeNow = s));
  const dialogFor = (npc: string, lessonId: string): string | null => {
    if (!storeNow) return null;
    const ok = cond(storeNow);
    for (const { value: d } of content.dialogues.values()) {
      if (d.npc !== npc || (d.if && !ok(d.if))) continue;
      if (Object.values(d.nodes).some((n) => (n as { lesson?: string }).lesson === lessonId)) return d.id;
    }
    return null;
  };

  return {
    overlay,
    effects: async (list) => {
      await guard(async (s) => {
        for (const e of list) await effect(s, e);
      });
    },
    lines: async (ids) => {
      await guard((s) => runLines(ids.map((id) => speechOfLine(id, linesOf(s).lines)), dialogDeps(s)));
    },
    dialogFor,
    openLesson: (id, o) => guard((s) => lessonById(s, id, o?.item)).then((r) => r ?? null),
    openDialog: async (id) => {
      await guard((s) => dialogById(s, id));
    },
    openPassport: async () => {
      await guard((s) => passport(s));
    },
    interact,
    get busy() {
      return busy > 0;
    },
    dispose() {
      for (const off of offs) off();
      overlay.dispose();
    },
  };
}

/** Короткое упражнение у объекта-слова (§3.7 `ex`): шаг из vocab, по умолчанию выбор перевода. */
export function wordStep(v: VocabEntry, ex: string | undefined, content: Pick<Content, 'vocab'>): Step {
  const others = [...content.vocab.values()].map((x) => x.value).filter((x) => x.id !== v.id);
  switch (ex) {
    case 'listen':
      return { t: 'listen', say: v.pl, options: `auto:${v.tags?.[0] ?? v.pos}`, answer: 0, item: v.id };
    case 'type':
      return { t: 'type', prompt: v.ru, accept: [v.pl], item: v.id };
    case 'dictation':
      return { t: 'dictation', say: v.pl, accept: [v.pl], item: v.id };
    case 'order': {
      const words = v.pl.split(/\s+/).filter(Boolean);
      if (words.length >= 2) return { t: 'order', prompt: v.ru, tiles: words as [string, string, ...string[]], answer: words as [string, ...string[]], item: v.id };
      break;
    }
  }
  const wrong = shuffled(
    others.filter((x) => x.ru !== v.ru).map((x) => x.ru),
    `word:${v.id}`,
  ).slice(0, 2);
  const options = shuffled([v.ru, ...wrong], `word:${v.id}:opts`) as [string, string, ...string[]];
  return { t: 'choice', q: `${v.pl} — это…`, options: options as [string, string], answer: options.indexOf(v.ru), item: v.id };
}

/** Табличка (§5.4): `pl` крупно, перевод по тапу, ▶. */
function signPopup(overlay: Overlay, audio: AudioPort, pl: string, ru: string | undefined, translations: 'auto' | 'always' | 'never'): Promise<void> {
  const layer = overlay.open('pq-sign-layer');
  return new Promise((resolve) => {
    const close = (): void => {
      layer.close();
      resolve();
    };
    const ruLine = el('div', { class: 'pq-line-ru', lang: 'ru' }, translations === 'always' ? (ru ?? '') : '');
    const ruBtn = ru && translations !== 'always' ? btn('перевод', () => {
      ruLine.textContent = ru;
      ruBtn?.remove();
    }, 'icon ghost', { 'data-nav': true }) : null;
    layer.el.style.justifyContent = 'center';
    layer.el.append(
      el(
        'div',
        { class: 'pq-wood pq-signpop' },
        el('div', { class: 'pq-btn pq-sign pq-big', lang: 'pl' }, pl),
        ruLine,
        el('div', { class: 'pq-line-tools' }, ...(audio.has(pl) ? audioButtons(audio, pl) : []), ruBtn),
        btn('OK', close, 'primary', { 'data-primary': true, 'data-nav': true }),
      ),
    );
    layer.handle({ cancel: () => (close(), true) });
    if (audio.has(pl)) audio.play(pl);
  });
}

function toast(root: HTMLElement, text: string): void {
  const t = el('div', { class: 'pq-wood pq-toast', role: 'status' }, text);
  root.append(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Портреты из атласа (public/atlas): кадр `portrait.<id>/0`, иначе голова спрайта персонажа.

interface AtlasJson {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { size: { w: number; h: number }; image: string };
}
type SpritesJson = Record<string, { size: [number, number]; frames: string[]; anims: Record<string, string[]> }>;

export function portraitSourceFrom(atlas: AtlasJson, sprites: SpritesJson, base: string, content: Pick<Content, 'characters'>): PortraitSource {
  const url = `${base}atlas/${atlas.meta.image}`;
  const sheet: [number, number] = [atlas.meta.size.w, atlas.meta.size.h];
  return (charId) => {
    const ch = content.characters.get(charId);
    const keys = [`portrait.${ch?.portrait ?? charId}/0`];
    const sp = sprites[ch?.sprite ?? charId];
    if (sp) keys.push(sp.anims.idle_down?.[0] ?? sp.frames[0] ?? '');
    for (const k of keys) {
      const f = atlas.frames[k]?.frame;
      if (!f) continue;
      // Портрета нет: голова = верхний квадрат кадра (Дима 16×32 → 16×16).
      const h = k.startsWith('portrait.') ? f.h : Math.min(f.h, f.w);
      return { url, sheet, rect: [f.x, f.y, f.w, h] } satisfies PortraitFrame;
    }
    return null;
  };
}

export async function loadPortraits(content: Pick<Content, 'characters'>, base = import.meta.env.BASE_URL): Promise<PortraitSource | null> {
  try {
    const [atlas, sprites] = await Promise.all([
      fetch(`${base}atlas/custom.json`).then((r) => r.json() as Promise<AtlasJson>),
      fetch(`${base}atlas/sprites.json`).then((r) => r.json() as Promise<SpritesJson>),
    ]);
    return portraitSourceFrom(atlas, sprites, base, content);
  } catch (e) {
    console.warn('[ui] портреты не загрузились, рисую буквы', e);
    return null;
  }
}
