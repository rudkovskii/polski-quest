// Склейка режиссёра (I-13, ТЗ §4.12, §5.0, §5.2): «пришёл, и игра сама повела». Как cloud.ts и day.ts,
// вызывается из main.ts одной строкой. Делает:
//   • запуск сразу в шаг: после Title и LinkSetup (`link:ready`) — `nextStep`; новый мир → вступление F1
//     (src/ui/intro.ts), иначе телепорт в локацию шага (`local.position`, если шаг в той же локации) и,
//     для прерванного урока, сразу урок;
//   • после любого изменения прогресса шаг пересчитывается: `guide:step` (строка «Сейчас», реплика бобра),
//     `guide:target` (подсветка, бобр-указатель), раскрытие HUD по `reveals` (флаги hud.*);
//   • действие шага: тап по цели (play.claim) или по строке «Сейчас» (`guide:act`) запускает урок, обход,
//     вечер, итог дня, бит; флаги первого дня `beat.first.f1…f6` и `beat.first_day_done` ставятся здесь.
// Отрезки `seg`: water/express/more3/evening — обход (ui/obchod.ts), scene/remedy — конец урока (ui/play.ts),
// sleep — «Dobranoc» (ui/daySummary.ts).
import { bus } from './systems/bus';
import type { Content } from './systems/content';
import { derive, deriveContent, isPlayedDay, type Derived } from './systems/derive';
import {
  diagDone,
  directorInput,
  FIRST_DAY,
  FIRST_DAY_DONE,
  FIRST_REPAIR_FLAG,
  firstFlag,
  hudFlag,
  nextStep,
  reddestCluster,
  springFlag,
  stepKey,
  type DirectorStep,
} from './systems/director';
import type { LogEvent } from './systems/log';
import type { Clock } from './systems/platform/clock';
import { entryOf, lineFor, sysFlag } from './systems/pace';
import { getSetting, setFlag, type Progress } from './systems/progress';
import type { PaceSystem } from './types/content';
import { appearanceOf, hasAppearance } from './systems/avatar';
import type { GuideStepView, WorldInteract } from './types/bus';
import type { Lesson } from './types/content';
import type { DayGlue } from './day';
import type { DayStore } from './ui/day';
import { withAvatarAtlas } from './ui/avatar';
import { openCreator } from './ui/creator';
import { loadIntroAtlas, runIntro } from './ui/intro';
import type { AudioPort, PortraitSource } from './ui/overlay/kit';
import { STAMP_FIRST } from './ui/passport';
import type { Play } from './ui/play';
import { gardenItems, plantOnCell } from './world/dzialka';

/** Сколько первых игровых дней строка «Сейчас» спрятана: ведёт Казик (ПОЛИРОВКА §2 р. 11). */
export const NOW_HIDDEN_DAYS = 3;

/** Номер игрового дня: засчитанные дни до сегодня + 1 (сегодняшний день — текущий, даже если ещё не засчитан). */
export function gameDayNo(d: Pick<Derived, 'days' | 'today'>): number {
  return Object.entries(d.days).filter(([day, st]) => day < d.today && isPlayedDay(st)).length + 1;
}

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
        text =
          s.f === 'f1'
            ? 'вступление'
            : s.f === 'f2'
              ? `полей грядку «${word(s.target.item)}»`
              : s.f === 'f3'
                ? 'спустись в метро к турникету'
                : s.f === 'f4'
                  ? lesson?.kind === 'diag'
                    ? 'турникет метро'
                    : `сцена: ${title}`
                  : s.f === 'f5'
                    ? 'вечер: звуки у реки'
                    : 'альтанка: спать';
        break;
      case 'resume':
        text = `продолжить: ${title}`;
        break;
      case 'spring':
        text = 'весна: полей грядки';
        break;
      case 'beat':
        text = s.target.object === 'skrzynka' ? 'почтовый ящик у калитки' : `поговори: ${npcName(s.target.npc) || 'Kazik'}`;
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
        text = s.choose ? 'вечер: рыбалка или табличка' : 'вечер: звуки у реки';
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

  /** Без звука (P-06): реплика `<id>.mute`, если есть. */
  const say = (id: string): string => lineFor(id, !!storeNow && getSetting(storeNow.progress, 'sound.mode') === 'off', content.lines);

  function view(s: DirectorStep): GuideStepView {
    const here = s.target.screen === 'intro' || (s.target.location === location && s.kind !== 'done');
    return {
      key: stepKey(s),
      kind: s.kind,
      ...(s.f ? { f: s.f } : {}),
      label: label(s),
      // Бит с персонажем-целью: реплика прозвучит в окне диалога по тапу, пузырём её не дублируем.
      ...(s.line && !(s.kind === 'beat' && (s.target.npc || s.target.object)) ? { line: say(s.line) } : {}),
      here,
      ...(s.kind === 'done' && s.more3 ? { more3: true } : {}),
      // Подсказка управления (при 3 с бездействия): первая локация — działka в F2, первый вход в метро — F3 и
      // диагностика F4.
      ...(s.f === 'f2' || s.f === 'f3' || (s.f === 'f4' && content.lessons.get(s.lesson ?? '')?.value.kind === 'diag') ? { moveHint: true } : {}),
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
      // F3 выполнен, как только Дима в метро.
      if (next.kind === 'intro' && next.f === 'f3' && location === next.target.location) {
        if (s.setProgress(setFlag(s.progress, firstFlag('f3'), now))) {
          bus.emit('progress:changed', { kinds: ['world'] });
          continue;
        }
      }
      const hide = gameDayNo(input.derived) <= NOW_HIDDEN_DAYS;
      const changed = !step || stepKey(step) !== stepKey(next) || step.reason !== next.reason || hide !== nowHidden;
      nowHidden = hide;
      step = next;
      if (changed) {
        publish();
        // Следующие коробки реплики шага (P-06): той же очередью пузыря.
        if (!(next.kind === 'beat' && (next.target.npc || next.target.object))) for (const l of next.lines ?? []) bus.emit('guide:reveal', { element: 'say', line: say(l) });
      }
      // Бит без цели-персонажа: реплика пузырём и эффекты сразу (когда не открыт урок или диалог).
      if (next.kind === 'beat' && !next.target.npc && !next.target.object && !play.busy && !day.ui.busy && !running) void runBeat(next);
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

  async function firstDayLesson(s: DirectorStep): Promise<void> {
    if (!s.lesson) return;
    const isDiag = content.lessons.get(s.lesson)?.value.kind === 'diag';
    await lessonFlow(s.lesson);
    const st = await o.store;
    const d = derive(st.progress, deriveContent(content), clock.now());
    if (isDiag) {
      if (!diagDone(d)) return; // прервали диагностику
      // §5.0 F4: активных минут меньше порога → сначала ремонтная сцена самого красного кластера.
      const red = reddestCluster(d);
      const repair = red ? content.phonetics.clusters.find((c) => c.id === red)?.repairLesson : undefined;
      if (repair && activeMin() < content.tuning.director.firstDayRepairIfActiveMinLt && !d.lessons[repair]) await flag(FIRST_REPAIR_FLAG);
      else await flag(firstFlag('f4'));
    } else if (d.lessons[s.lesson]) await flag(firstFlag('f4'));
  }

  async function sleepFlow(s: DirectorStep): Promise<void> {
    await day.ui.summary();
    const st = await o.store;
    const d = derive(st.progress, deriveContent(content), clock.now());
    const slept = d.days[d.today]?.segs.includes('sleep');
    if (!slept || s.kind !== 'intro') return;
    await flag(firstFlag('f6'), FIRST_DAY_DONE);
    // F6: мир создан на этом устройстве и ссылка ещё не сохранена → экран «Сохрани свою ссылку» (§5.2).
    if (o.hasLink?.() && !(LINK_SAVED in st.progress.world.flags)) bus.emit('ui:screen:open', { screen: 'link' });
  }

  /** Система расписания показана (P-06): флаг `sys.<запись>` — с сегодняшнего дня она открыта. */
  async function shown(sys: PaceSystem | undefined): Promise<void> {
    const e = sys ? entryOf(content.director.schedule ?? [], sys) : undefined;
    const st = await o.store;
    if (e && !(sysFlag(e.system) in st.progress.world.flags)) await flag(sysFlag(e.system));
  }

  async function runBeat(s: DirectorStep): Promise<void> {
    if (!s.beat) return;
    const b = content.director.beats.find((x) => x.id === s.beat);
    const st = await o.store;
    const fl = `beat.${s.beat}${b?.once === false ? `.${derive(st.progress, deriveContent(content), clock.now()).today.replace(/-/g, '_')}` : ''}`;
    if (fl in st.progress.world.flags) return;
    await flag(fl); // сначала флаг: бит не повторится, даже если окно закроют
    await shown(s.system);
    if (s.target.npc || s.target.object) {
      if (s.line) await play.lines([s.line]);
      if (s.do?.length) await play.effects(s.do);
      return;
    }
    // Без цели: реплики пузырём (и реплики-эффекты тоже, по очереди), остальные эффекты — как обычно.
    if (s.line) bus.emit('guide:reveal', { element: `beat.${s.beat}`, line: say(s.line) });
    const rest = (s.do ?? []).filter((e) => {
      if (e.line && Object.keys(e).length === 1) {
        bus.emit('guide:reveal', { element: `beat.${s.beat}`, line: say(e.line) });
        return false;
      }
      return true;
    });
    if (rest.length) await play.effects(rest);
  }

  async function perform(s: DirectorStep): Promise<void> {
    switch (s.kind) {
      case 'intro':
        switch (s.f) {
          case 'f1':
            return introFlow();
          case 'f2':
            await day.ui.obchod({ mode: 'day', fromItem: s.target.item ?? FIRST_DAY.introItem, practice: true });
            return flag(firstFlag('f2'));
          case 'f4':
            return firstDayLesson(s);
          case 'f5':
            await day.ui.obchod({ mode: 'phonetic', ...(s.limit ? { limit: s.limit } : {}), ...(s.cluster ? { cluster: s.cluster } : {}) });
            return flag(firstFlag('f5'));
          case 'f6':
            return sleepFlow(s);
          default:
            return; // F3: идти ногами
        }
      case 'spring': {
        const st = await o.store;
        const now = clock.now();
        const input = directorInput(st.progress, content, now, { local: st.local });
        if (input.lastPlayedDay) await flag(springFlag(input.lastPlayedDay));
        await day.ui.obchod({ mode: 'day' });
        return;
      }
      case 'water':
        await shown(s.system);
        await day.ui.obchod({ mode: 'day', ...(s.target.item ? { fromItem: s.target.item } : {}) });
        return;
      case 'resume':
        // Прерванный урок — сразу урок с того же шага, без обёртки-диалога (§4.12).
        if (s.lesson) await play.openLesson(s.lesson);
        return;
      case 'remedy':
      case 'scene':
      case 'boss':
        await shown(s.system);
        if (s.lesson) await lessonFlow(s.lesson);
        return;
      case 'evening':
        // Вечер — день 5, выбор вечера (рыбалка или табличка) — день 6 (P-06).
        await shown(s.system);
        if (s.system === 'eveningChoice') await shown('evening');
        await day.ui.obchod({ mode: 'phonetic', ...(s.choose ? { choose: true } : {}), ...(s.limit ? { limit: s.limit } : {}), ...(s.cluster ? { cluster: s.cluster } : {}) });
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
    if (!hit) return false;
    void act();
    return true;
  }

  async function introFlow(): Promise<void> {
    const st = await o.store;
    // P-03: новый мир → Fotobudka до вступления (`ui:creator:show`; бит дня 1 встроит режиссёр P-06).
    if (!hasAppearance(st.progress)) await openCreator({ mode: 'new' });
    await runIntro({
      overlay: play.overlay,
      content,
      store: st,
      audio: o.audio,
      portraits: await Promise.resolve(o.portraits ?? null),
      clock,
      atlas: withAvatarAtlas(loadIntroAtlas(), appearanceOf(st.progress)),
      onStamp: () => void flag(STAMP_FIRST),
      ...(o.onEvent ? { onEvent: o.onEvent } : {}),
    });
    bus.emit('progress:changed', { kinds: ['cards'] });
    await flag(firstFlag('f1'));
    bus.emit('world:teleport', { location: FIRST_DAY.dzialka, spawn: 'default' });
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
    if (s.kind === 'intro' && s.f === 'f1') {
      running = true;
      try {
        await introFlow();
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
    bus.emit('world:teleport', { location: loc, spawn });
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
