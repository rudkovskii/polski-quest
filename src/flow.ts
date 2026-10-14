// Склейка режиссёра (I-13, ТЗ §4.12, §5.0, §5.2): «пришёл, и игра сама повела». Как cloud.ts и day.ts,
// вызывается из main.ts одной строкой. Делает:
//   • запуск сразу в шаг: после Title и LinkSetup (`link:ready`) — `nextStep`; новый мир → карточка рассказчика
//     (src/ui/intro.ts) и зал Warszawa Wschodnia, иначе телепорт в локацию шага (`local.position`, если шаг в той же
//     локации) и, для прерванного урока, сразу урок;
//   • после любого изменения прогресса шаг пересчитывается: `guide:step` (строка «Сейчас», реплика бобра),
//     `guide:target` (подсветка, бобр-указатель), раскрытие HUD по `reveals` (флаги hud.*);
//   • действие шага: тап по цели (play.claim) или по строке «Сейчас» (`guide:act`) запускает урок, обход,
//     вечер, итог дня, бит;
//   • день 1 (P-05): биты `d01.*` из director.json по порядку — сцены на картах. Бит без цели-объекта играется сам,
//     как только Дима на его карте; у бита с `act` своё действие (фотобудка, лоток и паспорт, полив, урок у забора,
//     посадка руками, сон). Флаги `beat.d01.*` и `beat.first_day_done` ставятся здесь.
// Отрезки `seg`: water/express/more3/evening — обход (ui/obchod.ts), scene/remedy — конец урока (ui/play.ts),
// sleep — «Dobranoc» (ui/daySummary.ts).
import { bus } from './systems/bus';
import type { Content } from './systems/content';
import { derive, deriveContent, isPlayedDay, type Derived } from './systems/derive';
import {
  D01,
  directorInput,
  FIRST_DAY,
  FIRST_DAY_DONE,
  firstFlag,
  hudFlag,
  nextStep,
  SOUND_FLAGS,
  springFlag,
  stepKey,
  type DirectorStep,
} from './systems/director';
import type { LogEvent } from './systems/log';
import type { Clock } from './systems/platform/clock';
import { getSetting, setFlag, setSetting, type Progress } from './systems/progress';
import { appearanceOf, hasAppearance } from './systems/avatar';
import type { GuideStepView, WorldInteract } from './types/bus';
import type { Lesson, MapObject } from './types/content';
import type { DayGlue } from './day';
import type { DayStore } from './ui/day';
import { withAvatarAtlas } from './ui/avatar';
import { openCreator } from './ui/creator';
import { loadIntroAtlas, runCaption, runNight, runPassport, runTiles } from './ui/intro';
import type { AudioPort, PortraitSource } from './ui/overlay/kit';
import { STAMP_FIRST } from './ui/passport';
import type { Play } from './ui/play';
import { gardenItems, plantOnCell, seedFlag } from './world/dzialka';

/** Сколько первых игровых дней строка «Сейчас» спрятана: ведёт Казик (ПОЛИРОВКА §2 р. 11). */
export const NOW_HIDDEN_DAYS = 3;

/** Номер игрового дня: засчитанные дни до сегодня + 1 (сегодняшний день — текущий, даже если ещё не засчитан). */
export function gameDayNo(d: Pick<Derived, 'days' | 'today'>): number {
  return Object.entries(d.days).filter(([day, st]) => day < d.today && isPlayedDay(st)).length + 1;
}

/** Карты, на которых в день 1 показывается подсказка управления (первая ходьба). */
const MOVE_HINT_MAPS = new Set(['ch01.dworzec', 'ch01.peron']);

/** Бит дня 1 без цели в мире: играется сам, когда Дима на его карте. */
export const isAutoBeat = (s: DirectorStep): boolean => s.kind === 'intro' && !s.act && !s.target.npc && !s.target.object && !s.target.plot && !s.target.screen;

/** Флаг «Я сохранил ссылку» (тот же, что LINK_SAVED_FLAG в cloud.ts). */
const LINK_SAVED = 'link.saved';

export interface FlowStore extends DayStore {
  setProgress(p: Progress): boolean;
}

export interface FlowOptions {
  content: Content;
  store: Promise<FlowStore>;
  clock: Clock;
  play: Play;
  day: DayGlue;
  audio: AudioPort;
  portraits?: PortraitSource | null | Promise<PortraitSource | null>;
  hasLink?: () => boolean;
  onEvent?(e: LogEvent): void;
}

export interface Flow {
  /** Текущий шаг режиссёра (dev). */
  readonly step: DirectorStep | null;
  /** Забрать действие с объектом мира, если это цель шага (play.claim). */
  claim(p: WorldInteract): boolean;
  /** Пересчитать шаг сейчас. */
  refresh(): Promise<DirectorStep | null>;
  /** Сделать текущий шаг (как тап по цели). */
  act(): Promise<void>;
}

export function startFlow(o: FlowOptions): Flow {
  const { content, clock, play } = o;
  const day = o.day;
  let step: DirectorStep | null = null;
  let location: string | null = null;
  let running = false;
  let launched = false;
  let pendingResume: string | null = null;
  let nowHidden = false;
  let storeNow: FlowStore | null = null;
  void o.store.then((s) => (storeNow = s));

  const activeMin = (): number => day.activeMs() / 60_000;
  const isMap = (id: string): boolean => content.maps.has(id);

  const flag = async (...names: string[]): Promise<void> => {
    const s = await o.store;
    let p = s.progress;
    for (const n of names) p = setFlag(p, n, clock.now());
    if (p !== s.progress && s.setProgress(p)) bus.emit('progress:changed', { kinds: ['world'] });
  };

  // ── Подпись шага (UI, не реплика).
  function label(s: DirectorStep): string {
    const lesson = s.lesson ? content.lessons.get(s.lesson)?.value : undefined;
    const title = lesson ? (lesson.title.ru ?? lesson.title.pl ?? lesson.id) : '';
    const npcName = (id?: string): string => (id ? (content.characters.get(id)?.name ?? id) : '');
    const word = (id?: string): string => (id ? (content.vocab.get(id)?.value.pl ?? id) : '');
    let text: string;
    switch (s.kind) {
      case 'intro':
        text = introLabel(s);
        break;
      case 'resume':
        text = `продолжить: ${title}`;
        break;
      case 'spring':
        text = 'весна: полей грядки';
        break;
      case 'beat':
        text = `поговори: ${npcName(s.target.npc) || 'Kazik'}`;
        break;
      case 'water':
        text = 'полей грядки';
        break;
      case 'remedy':
        text = `подбить сваю: ${title}`;
        break;
      case 'scene':
        text = `${npcName(lesson?.npc)} · ${title}`;
        break;
      case 'boss':
        text = `босс: ${title}`;
        break;
      case 'evening':
        text = 'вечер: звуки у реки';
        break;
      case 'sleep':
        text = 'альтанка: спать';
        break;
      default:
        text = 'до завтра';
    }
    const there = s.target.location !== location && isMap(s.target.location) && s.kind !== 'done';
    return there ? `${text} → ${content.maps.get(s.target.location)?.value.title.pl ?? s.target.location}` : text;
  }

  /** Подпись шага дня 1 (строка «Сейчас» спрятана первые дни и всплывает при бездействии). */
  function introLabel(s: DirectorStep): string {
    const t = s.target;
    const npcName = (id: string): string => content.characters.get(id)?.name ?? id;
    switch (s.act) {
      case 'card':
        return 'вступление';
      case 'fotobudka':
        return 'фотобудка: фото на документы';
      case 'water':
        return `полей грядку «${content.vocab.get(t.item ?? FIRST_DAY.introItem)?.value.pl ?? ''}»`;
      case 'plant':
        return 'посади семена: к грядке и A';
      case 'sleep':
        return 'хатка Казика: спать';
      default:
        if (t.npc) return `подойди: ${npcName(t.npc)}`;
        if (t.object) return t.object === 'tablica_bazar' ? 'прочитай табличку' : 'иди дальше';
        return `иди: ${content.maps.get(t.location)?.value.title.pl ?? t.location}`;
    }
  }

  function view(s: DirectorStep): GuideStepView {
    const here = s.target.screen === 'intro' || (s.target.location === location && s.kind !== 'done');
    return {
      key: stepKey(s),
      kind: s.kind,
      ...(s.f ? { f: s.f } : {}),
      label: label(s),
      // Бит с персонажем-целью: реплика прозвучит в окне диалога по тапу, пузырём её не дублируем.
      ...(s.line && !(s.kind === 'beat' && (s.target.npc || s.target.object)) ? { line: s.line } : {}),
      here,
      ...(s.kind === 'done' && s.more3 ? { more3: true } : {}),
      // Подсказка управления (при 3 с бездействия): первые карты с ходьбой дня 1 — зал вокзала и перрон.
      ...(s.kind === 'intro' && MOVE_HINT_MAPS.has(s.target.location) ? { moveHint: true } : {}),
      ...(nowHidden ? { nowHidden: true } : {}),
      ...(s.kind === 'spring' ? { spring: true } : {}),
      reason: s.reason,
    };
  }

  // ── Пересчёт.
  let computing: Promise<DirectorStep | null> | null = null;
  let again = false;
  async function compute(): Promise<DirectorStep | null> {
    if (computing) {
      again = true;
      return computing;
    }
    computing = (async () => {
      do {
        again = false;
        await computeOnce();
      } while (again);
      return step;
    })();
    try {
      return await computing;
    } finally {
      computing = null;
    }
  }

  async function computeOnce(): Promise<void> {
    const s = await o.store;
    // Каждый круг либо ставит флаг (раскрытие HUD, F3), либо публикует шаг: флаги только растут, круг конечен.
    for (let guard = 0; guard < 8; guard++) {
      const now = clock.now();
      const input = directorInput(s.progress, content, now, { local: s.local, activeMin: activeMin() });
      const next = nextStep(input);
      // Раскрытие HUD (§4.12): флаг + анимация + реплика бобра.
      if (next.reveal?.length) {
        let p = s.progress;
        for (const e of next.reveal) p = setFlag(p, hudFlag(e), now);
        if (s.setProgress(p)) {
          bus.emit('progress:changed', { kinds: ['world'] });
          for (const e of next.reveal) {
            const line = content.director.reveals.find((r) => r.element === e)?.line;
            bus.emit('guide:reveal', { element: e, ...(line ? { line } : {}) });
          }
          continue;
        }
      }
      const hide = gameDayNo(input.derived) <= NOW_HIDDEN_DAYS;
      const changed = !step || stepKey(step) !== stepKey(next) || step.reason !== next.reason || hide !== nowHidden;
      nowHidden = hide;
      step = next;
      if (changed) publish();
      // Бит без цели-персонажа: реплика пузырём и эффекты сразу.
      if (next.kind === 'beat' && !next.target.npc && !next.target.object) void runBeat(next);
      // День 1: сцена без цели в мире играется, как только Дима на её карте (реплики Казика при входе).
      if (isAutoBeat(next) && location === next.target.location) queueMicrotask(() => void act());
      return;
    }
  }

  function publish(): void {
    if (!step) return;
    bus.emit('guide:step', { step: view(step) });
    const t = step.target;
    bus.emit('guide:target', { target: t.screen || !isMap(t.location) ? null : { location: t.location, ...(t.npc ? { npc: t.npc } : {}), ...(t.object ? { object: t.object } : {}), ...(t.plot ? { plot: t.plot } : {}), ...(t.item ? { item: t.item } : {}) } });
  }

  let queued = false;
  const schedule = (): void => {
    if (queued || running) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void compute();
    });
  };

  // ── Действия шага.

  /** Урок шага: через диалог NPC, который к нему ведёт (обёртка сцены), иначе сам урок. */
  async function lessonFlow(lessonId: string): Promise<void> {
    const l: Lesson | undefined = content.lessons.get(lessonId)?.value;
    const dlg = l?.npc ? play.dialogFor(l.npc, lessonId) : null;
    if (dlg) await play.openDialog(dlg);
    else await play.openLesson(lessonId);
  }

  async function sleepFlow(s: DirectorStep): Promise<void> {
    const first = s.kind === 'intro';
    // День 1: итог одной карточкой (СЮЖЕТ_v2 d01.s8), Казик уже сказал «Idziemy spać» у хатки.
    await day.ui.summary(first ? { bobr: null, lines: [D01.summary, D01.summaryUmiem], hook: D01.hook } : undefined);
    const st = await o.store;
    const d = derive(st.progress, deriveContent(content), clock.now());
    const slept = d.days[d.today]?.segs.includes('sleep');
    if (!slept || s.kind !== 'intro') return;
    await flag(firstFlag(s.f ?? 'd01.sen'), FIRST_DAY_DONE);
    await runNight({ ...introDeps(st), atlas: withAvatarAtlas(loadIntroAtlas(), appearanceOf(st.progress)) });
    // F6: мир создан на этом устройстве и ссылка ещё не сохранена → экран «Сохрани свою ссылку» (§5.2).
    if (o.hasLink?.() && !(LINK_SAVED in st.progress.world.flags)) bus.emit('ui:screen:open', { screen: 'link' });
  }

  async function runBeat(s: DirectorStep): Promise<void> {
    if (!s.beat) return;
    const b = content.director.beats.find((x) => x.id === s.beat);
    const st = await o.store;
    const fl = `beat.${s.beat}${b?.once === false ? `.${derive(st.progress, deriveContent(content), clock.now()).today.replace(/-/g, '_')}` : ''}`;
    if (fl in st.progress.world.flags) return;
    await flag(fl); // сначала флаг: бит не повторится, даже если окно закроют
    if (s.target.npc || s.target.object) {
      if (s.line) await play.lines([s.line]);
    } else if (s.line) bus.emit('guide:reveal', { element: `beat.${s.beat}`, line: s.line });
    if (s.do?.length) await play.effects(s.do);
  }

  async function perform(s: DirectorStep): Promise<void> {
    switch (s.kind) {
      case 'intro':
        return day1(s);
      case 'spring': {
        const st = await o.store;
        const now = clock.now();
        const input = directorInput(st.progress, content, now, { local: st.local });
        if (input.lastPlayedDay) await flag(springFlag(input.lastPlayedDay));
        await day.ui.obchod({ mode: 'day' });
        return;
      }
      case 'water':
        await day.ui.obchod({ mode: 'day', ...(s.target.item ? { fromItem: s.target.item } : {}) });
        return;
      case 'resume':
        // Прерванный урок — сразу урок с того же шага, без обёртки-диалога (§4.12).
        if (s.lesson) await play.openLesson(s.lesson);
        return;
      case 'remedy':
      case 'scene':
      case 'boss':
        if (s.lesson) await lessonFlow(s.lesson);
        return;
      case 'evening':
        await day.ui.obchod({ mode: 'phonetic' });
        return;
      case 'sleep':
        return sleepFlow(s);
      case 'beat':
        return runBeat(s);
      default:
        return;
    }
  }

  async function act(): Promise<void> {
    if (running || play.busy || day.ui.busy) return;
    const s = step ?? (await compute());
    if (!s) return;
    running = true;
    try {
      await perform(s);
    } finally {
      running = false;
      await compute();
    }
  }

  /**
   * Посадка руками (P-02): A или тап по пустой клетке грядки — первое семя из кармана растёт на этой клетке.
   * Семян нет — ничего (сцена такую клетку целью не делает).
   */
  async function plant(p: WorldInteract): Promise<void> {
    const st = await o.store;
    const now = clock.now();
    const d = derive(st.progress, deriveContent(content), now);
    const f = plantOnCell(st.progress.world.flags, gardenItems(d, now, content.tuning).map((g) => g.item), p.tile);
    if (f) await flag(f);
  }

  /** Тап по объекту мира: если это цель шага — шаг делает режиссёр. */
  function claim(p: WorldInteract): boolean {
    if (p.kind === 'plot' && !p.item) {
      if (!running) void plant(p);
      return true;
    }
    const s = step;
    if (!s || running || p.location !== s.target.location) return false;
    const t = s.target;
    let hit = false;
    if (t.plot && p.kind === 'plot') hit = s.mode === 'practice' || s.kind === 'spring' || (s.kind === 'intro' && !!t.item);
    else if (t.object && p.id === t.object) hit = true;
    else if (t.npc && p.kind === 'npc' && p.id === t.npc && !t.plot) hit = true;
    if (!hit && p.kind === 'npc' && p.id === 'bobr' && s.line) {
      // Тап по Казику не по делу: он повторяет, что сейчас делать.
      void play.lines([s.line]);
      return true;
    }
    if (!hit && p.kind === 'npc' && p.id === 'bobr' && s.kind === 'intro') {
      // День 1: Казик ведёт сам, его сцены идут по порядку; не по делу — «Kłoda!» (просто встретил).
      void play.lines([D01.idleKazik]);
      return true;
    }
    if (!hit) return false;
    void act();
    return true;
  }

  // ── День 1 (P-05, СЮЖЕТ_v2 §4 d01): сцены на картах по битам `d01.*`.

  const lines = (ids: readonly string[]): Promise<void> => play.lines(ids);

  /** Бит дня 1: действие `act` или эффекты `do` (реплики, диалог), потом флаг `beat.<id>`. */
  async function day1(s: DirectorStep): Promise<void> {
    const id = s.f ?? s.beat ?? '';
    switch (s.act) {
      case 'card':
        await runCaption(introDeps(await o.store));
        await flag(firstFlag(id));
        teleportTo(FIRST_DAY.start, FIRST_DAY.startSpawn, await compute()); // лицом к фотобудке
        return;
      case 'fotobudka': {
        await lines([D01.fotobudka]);
        const st = await o.store;
        const a = await openCreator({ mode: hasAppearance(st.progress) ? 'mirror' : 'new' });
        if (!a && !hasAppearance(st.progress)) return; // экрана нет или закрыли: будка ждёт
        await lines([D01.fotoNarr]);
        return flag(firstFlag(id));
      }
      case 'bazar':
        return bazarScene(id);
      case 'water': {
        await day.ui.obchod({ mode: 'day', fromItem: s.target.item ?? FIRST_DAY.introItem, practice: true });
        await flag(firstFlag(id));
        return lines([D01.watered]);
      }
      case 'brzechwa':
        return plotScene(id);
      case 'plant':
        return; // сажает Дима руками: A по пустой клетке грядки (claim → plant)
      case 'sleep':
        return sleepFlow(s);
      default:
        break;
    }
    // Сцена без цели (реплики при входе на карту): флаг сразу — второй раз не сыграет, даже если окно закроют;
    // то, что появляется в этой сцене (шляпа и Брзехва), видно уже во время реплик.
    if (isAutoBeat(s)) await flag(firstFlag(id));
    if (s.do?.length) await play.effects(s.do);
    if (s.act === 'sound') {
      // Выбор звука (d01.s2, СЮЖЕТ_v2 §7): флаг варианта → настройка sound.mode. Окно закрыли до выбора — сцена ждёт.
      if (!(await applySound())) return;
    }
    if (!isAutoBeat(s)) await flag(firstFlag(id));
  }

  /** Флаги выбора «Z dźwiękiem / Bez dźwięku» → настройка `sound.mode` (последний выбор). */
  async function applySound(): Promise<boolean> {
    const st = await o.store;
    const f = st.progress.world.flags;
    const on = f[SOUND_FLAGS.on];
    const mute = f[SOUND_FLAGS.mute];
    if (on === undefined && mute === undefined) return false;
    const mode = (mute ?? -1) > (on ?? -1) ? 'mute' : 'sound';
    if (getSetting(st.progress, 'sound.mode') !== mode && st.setProgress(setSetting(st.progress, 'sound.mode', mode, clock.now())))
      bus.emit('progress:changed', { kinds: ['settings'] });
    return true;
  }

  function introDeps(st: FlowStore): Parameters<typeof runCaption>[0] {
    return { overlay: play.overlay, content, audio: o.audio, portraits: portraitsNow, clock };
  }
  let portraitsNow: PortraitSource | null = null;
  void Promise.resolve(o.portraits ?? null).then((p) => (portraitsNow = p));

  /** Лоток пани Хели (d01.s4): «Tak?» → плитки → ящик, книжечка → паспорт крупно → печать → Казик про печати. */
  async function bazarScene(id: string): Promise<void> {
    await lines([D01.helaTak]);
    const st = await o.store;
    await runTiles({ ...introDeps(st), store: st, ...(o.onEvent ? { onEvent: o.onEvent } : {}) });
    bus.emit('progress:changed', { kinds: ['cards'] });
    await lines([D01.helaHello, D01.goscMowi, D01.umiem, D01.zaDarmo, D01.teZaDarmo, D01.prawieKloda]);
    await runPassport({ ...introDeps(st), appearance: appearanceOf(st.progress), onStamp: () => void flag(STAMP_FIRST) });
    await flag(firstFlag(id));
    await lines([D01.stampKazik, D01.passportWho, D01.praga, D01.notK]);
  }

  /**
   * Забор działki (d01.s7): «Dziękuję!» → чанк 1 → шёпот Казика → чанк 2 → знакомство → чанк 3. Каждое слово сразу
   * семенем в карман (`seed.<item>`, до урока: на грядке оно не мелькнёт), сажает Дима сам. Прервал — с того же чанка.
   */
  async function plotScene(id: string): Promise<void> {
    const lesson = content.lessons.get(FIRST_DAY.plotLesson)?.value;
    const items = lesson?.introduces ?? [];
    const st = await o.store;
    const known = (item: string): boolean => st.progress.log.events.some((e) => e.k === 'intro' && e.item === item);
    const chunk = async (item: string | undefined, before: () => Promise<void>): Promise<boolean> => {
      if (!item || known(item)) return true;
      await flag(seedFlag(item)); // семя в карман до урока: на грядке слово не мелькнёт; порядок семян = порядок слов
      await before();
      const r = await play.openLesson(FIRST_DAY.plotLesson, { item });
      return !!r && !r.cancelled;
    };
    if (!(await chunk(items[0], () => lines([D01.dziekuje])))) return;
    if (!(await chunk(items[1], () => lines([D01.proszeHint])))) return;
    if (!(await chunk(items[2], () => play.openDialog(FIRST_DAY.plotDialogue)))) return;
    await flag(firstFlag(id)); // Брзехва уходит по бульвару
    await lines([D01.seeds, D01.pierogi, D01.pierogi2]);
  }

  /** Телепорт в локацию шага: спавн у цели, лицом к ней. */
  function teleportTo(loc: string, spawn: string | [number, number], s: DirectorStep | null | undefined): void {
    const facing = s ? facingTo(loc, spawn, s) : undefined;
    bus.emit('world:teleport', { location: loc, spawn, ...(facing ? { facing } : {}) });
  }

  /** Куда смотреть со спавна, чтобы цель шага была впереди (A сработает без поворота). */
  function facingTo(locId: string, spawn: string | [number, number], s: DirectorStep): 'up' | 'down' | 'left' | 'right' | undefined {
    const map = content.maps.get(locId)?.value;
    const obj = map ? targetObject(map, s) : undefined;
    const at = typeof spawn === 'string' ? map?.spawns[spawn] : spawn;
    if (!obj || !at) return undefined;
    const size = 'size' in obj && obj.size ? obj.size : [1, 1];
    const cx = Math.max(obj.at[0], Math.min(at[0]!, obj.at[0] + size[0]! - 1));
    const cy = Math.max(obj.at[1], Math.min(at[1]!, obj.at[1] + size[1]! - 1));
    const dx = cx - at[0]!;
    const dy = cy - at[1]!;
    if (!dx && !dy) return undefined;
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
  }

  function targetObject(map: { objects: readonly MapObject[] }, s: DirectorStep): MapObject | undefined {
    const t = s.target;
    return map.objects.find((x) => (t.npc && x.type === 'npc' && x.id === t.npc) || (t.object && 'id' in x && x.id === t.object) || (t.plot && x.type === 'plot' && x.id === t.plot));
  }

  /** Спавн локации, ближайший к цели шага. */
  function spawnFor(locId: string, s: DirectorStep): string | [number, number] {
    const map = content.maps.get(locId)?.value;
    if (!map) return 'default';
    const t = s.target;
    const obj = map.objects.find((x) => (t.npc && x.type === 'npc' && x.id === t.npc) || (t.object && 'id' in x && x.id === t.object) || (t.plot && x.type === 'plot' && x.id === t.plot));
    if (!obj) return 'default';
    let best = 'default';
    let bestD = Infinity;
    for (const [name, xy] of Object.entries(map.spawns)) {
      const dd = Math.abs(xy[0] - obj.at[0]) + Math.abs(xy[1] - obj.at[1]);
      if (dd < bestD) {
        bestD = dd;
        best = name;
      }
    }
    return best;
  }

  /** Запуск сразу в шаг (§5.2): после Title и LinkSetup. */
  async function launch(): Promise<void> {
    if (launched) return;
    launched = true;
    const s = await compute();
    if (!s) return;
    if (s.kind === 'intro' && s.act === 'card') {
      running = true;
      try {
        await day1(s);
      } finally {
        running = false;
      }
      await compute();
      return;
    }
    const st = await o.store;
    const pos = st.local.position;
    const loc = isMap(s.target.location) ? s.target.location : (pos?.location ?? content.world.start.location);
    // local.position — только если шаг не требует другой локации.
    const spawn: string | [number, number] = pos && pos.location === loc && isMap(loc) ? [pos.x, pos.y] : spawnFor(loc, s);
    if (s.kind === 'resume' && s.lesson) pendingResume = s.lesson;
    teleportTo(loc, spawn, s);
  }

  bus.on('link:ready', () => void launch());
  bus.on('world:location', ({ id }) => {
    location = id;
    if (step) publish(); // подпись и цель «здесь / там» зависят от локации
    void compute();
    if (pendingResume) {
      // Прерванный урок открывается сразу (§4.12 «resume открывает урок сразу»).
      pendingResume = null;
      void act();
    }
  });
  bus.on('progress:changed', schedule);
  bus.on('progress:merged', schedule);
  // Оверлей закрылся (урок прерван — resume в local, диалог без событий): шаг мог смениться.
  bus.on('world:input', ({ enabled }) => {
    if (enabled) schedule();
  });
  bus.on('guide:act', () => void act());
  bus.on('guide:more3', () => {
    if (!step || step.kind !== 'done' || running) return;
    running = true;
    void (step.more3 === 'phonetic' ? day.ui.obchod({ mode: 'phonetic' }) : day.ui.obchod({ mode: 'express', more3: true })).finally(() => {
      running = false;
      void compute();
    });
  });
  // Сессия стала длинной: пересчёт раз в минуту (активные минуты решают F4, мягкий потолок).
  setInterval(() => {
    if (!running && storeNow) void compute();
  }, 60_000);

  return {
    get step() {
      return step;
    },
    claim,
    refresh: compute,
    act,
  };
}
