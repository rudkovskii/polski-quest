// Склейка оверлея с миром (I-08): `world:interact` → диалог NPC, упражнение у объекта-слова,
// табличка, эффекты триггера; `ui:dialog:open`, `ui:lesson:start` → диалог и урок. Пока открыт
// оверлей, мир выключен (`world:input`, делает host.ts). Итог урока — `ui:lesson:end`, новые события
// журнала — `progress:changed` (его слушает синк).
import { bus as globalBus, type Bus } from '../systems/bus';
import type { Content } from '../systems/content';
import { derive, deriveContent } from '../systems/derive';
import type { LogEvent } from '../systems/log';
import { getSetting, giveItem, markChallenge, setFlag, type Progress } from '../systems/progress';
import type { BusEvents, LessonResult, WorldInteract } from '../types/bus';
import type { Condition, Effect, Lesson, LocationMap, Step, VocabEntry } from '../types/content';
import { runDialog, runLines, speechOfLine, type DialogDeps } from './dialog';
import { el } from './dom';
import { runLesson, type LessonStore } from './lesson';
import { shuffled } from './exercises/options';
import { createOverlay, type Overlay } from './overlay/host';
import { openPassport, passportModel } from './passport';
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
}

export interface Play {
  overlay: Overlay;
  openLesson(id: string): Promise<LessonResult | null>;
  openDialog(id: string): Promise<void>;
  /** Паспорт (§5.10, I-11); то же по `ui:screen:open { screen: 'passport' }`. */
  openPassport(): Promise<void>;
  interact(p: WorldInteract): Promise<void>;
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

  /** Условие `if` (§3.9) до conditions.ts (I-17): флаги, предметы, сданные уроки и боссы; прочие атомы ложны. */
  const condLite = (store: PlayStore): ((c: Condition) => boolean) => {
    let done: ReadonlySet<string> | null = null;
    const ev = (c: Condition): boolean => {
      if (c.always) return true;
      if (c.all) return c.all.every(ev);
      if (c.any) return c.any.some(ev);
      if (c.not) return !ev(c.not);
      if (c.flag !== undefined) return c.flag in store.progress.world.flags;
      if (c.item !== undefined) return c.item in store.progress.world.items;
      if (c.lessonDone !== undefined) {
        done ??= derive(store.progress, deriveContent(content), Date.now()).lessonsDone;
        return done.has(c.lessonDone);
      }
      if (c.bossPassed !== undefined) return derive(store.progress, deriveContent(content), Date.now()).bossResults[c.bossPassed]?.passedAt !== undefined;
      return false;
    };
    return ev;
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

  const lessonById = async (store: PlayStore, id: string): Promise<LessonResult | null> => {
    const l = content.lessons.get(id)?.value;
    if (!l) {
      console.warn(`[ui] урока ${id} нет в контенте`);
      return null;
    }
    const now = deps.clock?.now() ?? Date.now();
    const wasPassed = l.kind === 'boss' && derive(store.progress, deriveContent(content), now).bossResults[id]?.passedAt !== undefined;
    const result = await runLesson(l, lessonDeps(store));
    bus.emit('ui:lesson:end', { lessonId: id, result });
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

  const dialogDeps = (store: PlayStore): DialogDeps => ({
    overlay,
    content,
    audio,
    portraits,
    translations: getSetting(store.progress, 'translations'),
    ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
    ...(deps.coarse !== undefined ? { coarse: deps.coarse } : {}),
    cond: condLite(store),
    runLesson: (id) => lessonById(store, id),
    effects: (e) => effect(store, e),
  });

  /** Эффекты кроме `line` и `startLesson` (их ведёт диалог). Новые атомы — effects.ts (I-17). */
  async function effect(store: PlayStore, e: Effect): Promise<void> {
    const now = deps.clock?.now() ?? Date.now();
    if (e.setFlag) applyProgress(store, (p) => setFlag(p, e.setFlag!, now), 'world');
    if (e.give) applyProgress(store, (p) => giveItem(p, e.give!, now), 'world');
    if (e.challenge) applyProgress(store, (p) => markChallenge(p, e.challenge!, now), 'world');
    if (e.startDialogue) await dialogById(store, e.startDialogue);
    if (e.line) await runLines([speechOfLine(e.line, content.lines)], dialogDeps(store));
    if (e.startLesson) await lessonById(store, e.startLesson);
    if (e.teleport) bus.emit('world:teleport', { location: e.teleport.to, spawn: e.teleport.spawn ?? 'default' });
    if (e.open === 'obchod' || e.open === 'express') bus.emit('ui:obchod:start', { mode: e.open === 'express' ? 'express' : 'day' });
    else if (e.open) bus.emit('ui:screen:open', { screen: e.open });
    if (e.toast) toast(root, e.toast.ru);
    if (e.reveal) console.info('[ui] reveal (I-13):', e.reveal);
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
    await guard(async (store) => {
      switch (p.kind) {
        case 'npc': {
          const cond = condLite(store);
          const d = [...content.dialogues.values()].map((x) => x.value).find((x) => x.npc === p.id && (!x.if || cond(x.if)));
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
          if (trig.if && !condLite(store)(trig.if)) return;
          for (const e of trig.do) await effect(store, e);
          return;
        }
        default:
          // plot (обход, I-12), board (банки, I-45), secret (Симба, I-29) — не оверлей I-08.
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
    const d = derive(store.progress, deriveContent(content), deps.clock?.now() ?? Date.now());
    return openPassport(overlay, passportModel(content, store.progress, d));
  }

  return {
    overlay,
    openLesson: (id) => guard((s) => lessonById(s, id)).then((r) => r ?? null),
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
function signPopup(overlay: Overlay, audio: AudioPort, pl: string, ru: string | undefined, translations: 'tap' | 'always'): Promise<void> {
  const layer = overlay.open('pq-sign-layer');
  return new Promise((resolve) => {
    const close = (): void => {
      layer.close();
      resolve();
    };
    const ruLine = el('div', { class: 'pq-line-ru', lang: 'ru' }, translations === 'always' ? (ru ?? '') : '');
    const ruBtn = ru && translations === 'tap' ? btn('перевод', () => {
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
