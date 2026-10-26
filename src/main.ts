import Phaser from 'phaser';
import { startInput } from './input';
import { Boot } from './scenes/Boot';
import { BG_COLOR, World, type WorldStart } from './scenes/World';
import { backupDue, shouldRemind, withMark } from './systems/backup';
import { bus, type Bus } from './systems/bus';
import { createFarm } from './systems/farm';
import { GAMES, GAME_BY_ENTRY, GAME_BY_ID } from './games/registry';
import { inDays, nearestHoliday, shortName } from './games/swieta/calendar';
import { createEntryPoint } from './systems/entryPoint';
import { createPolska } from './systems/polska';
import { PLOT_NAME } from './systems/zagroda';
import { activeDecor, parseDecor } from './systems/decor';
import { MAPS, getMap } from './world/maps';
import { HOME_KEY, createBeaver } from './systems/beaver';
import { V2 } from './systems/v2content';
import type { PolskaEntry, PolskaGameId } from './types/polska';
import { audioContext, connectAudio } from './systems/platform/audio';
import { createMusicPlayer } from './systems/platform/music';
import { createClock } from './systems/platform/clock';
import { connectSfx } from './systems/platform/sfx';
import { recapBefore, wateredOn } from './systems/daygoal';
import { dayOf } from './systems/garden';
import { lastReloadAt, lastReloadFrom, registerPwa, reloadForUpdate, watchVersion } from './systems/platform/pwa';
import { GameStorage, memoryKV, parseProfile, type StorageOptions } from './systems/platform/storage';
import { exportFileName, exportSave, importSave, normalizeSave, type Save } from './systems/save';
import { guardStart } from './ui/crash';
import { staleBuild, updateAction } from './systems/update';
import type { BusEvents } from './types/bus';
import { mountAudioToast } from './ui/audioToast';
import { mountAssembleGap } from './ui/assembleGap';
import { mountBoard } from './ui/board';
import { createPlruLoader, createRuplLoader } from './systems/platform/rupl';
import { attachLongPress } from './input/press';
import { BASE_WORDS, WORDS, isA1, plOf } from './systems/content';
import { dailyDue, dailyLine, dailySeenDay, markDaily, pickDaily } from './systems/dailySeeds';
import { isCustomId } from './systems/customWords';
import { wordIndex, type WordIndex } from './systems/wordPick';
import { LONG_PRESS_MS, mountWordPick } from './ui/wordPick';
import { mountDictionary } from './ui/dictionary';
import { mountFloats } from './ui/float';
import { mountMinigame } from './ui/minigame';
import { mountMorning } from './ui/morning';
import { mountPantry } from './ui/pantry';
import { mountPlantCard } from './ui/plantCard';
import { mountSummary } from './ui/summary';
import { mountLevelUp, mountPath } from './ui/levelUp';
import { mountBeaver } from './ui/beaver';
import { mountDpad } from './ui/dpad';
import { mountHints } from './ui/hints';
import { mountGuide, type GuideStage } from './ui/hintsGuide';
import { createTips } from './ui/glossary';
import { mountHud } from './ui/hud';
import { mountRadio } from './ui/radio';
import { mountMusicHud } from './ui/radioHud';
import { mountSettings } from './ui/settings';
import { mountUpdateToast } from './ui/updateToast';
import { mountPolskaGame } from './ui/polskaGame';
import { mountPolskaHud } from './ui/polskaHud';
import { mountPolskaPlot } from './ui/polskaPlot';
import { passGate } from './ui/gate';
import { EDITION, LEVEL } from './systems/edition';
import { ONBOARDING_HINT, mountOnboarding, shouldShowOnboarding } from './ui/onboarding';

const params = new URLSearchParams(location.search);
// `?dev=<id>`: dev-режим (`window.__pq`) и отдельный профиль сохранения `polski-farm-<id>` (тесты не трогают игру Шэфа).
const devProfile = parseProfile(params.get('dev'));
const dev = devProfile !== null;
// Персональная версия (`edition.json`): своя база сохранения, dev-профиль поверх неё.
const profile = devProfile ?? EDITION.profile;
// Без звука вслух: `?mute=1` — `audio:play` только в консоль.
const mute = params.get('mute') === '1';

const storageOptions = (): StorageOptions => (params.get('mem') === '1' ? { kv: memoryKV(), ls: null } : profile ? { profile } : {});
/** Хранилище, когда оно уже создано: экран «Что-то сломалось» берёт сохранение из него, иначе читает с диска сам. */
let liveStore: GameStorage | null = null;

/** Текст файла сохранения для экрана ошибки: из памяти игры, иначе сырые данные хранилища (даже нечитаемые — как есть). */
async function crashSaveText(): Promise<string | null> {
  const st = liveStore ?? new GameStorage(storageOptions());
  const loaded = st.peek();
  if (loaded) return exportSave(loaded);
  const raw = await st.readRaw();
  if (raw === undefined) return null;
  const norm = normalizeSave(raw);
  return norm ? exportSave(norm) : `${JSON.stringify(raw, null, 1)}\n`;
}

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Шина для озвучки с выключателем: звук выкл — `audio:play` не доходит до плеера, но `done` вызывается. */
function gatedAudioBus(source: Bus<BusEvents>, enabled: () => boolean): Bus<BusEvents> {
  return {
    ...source,
    on(type, fn) {
      if (type !== 'audio:play') return source.on(type, fn);
      return source.on('audio:play', (p) => {
        if (enabled()) (fn as (p: BusEvents['audio:play']) => void)(p);
        else p.done?.('none');
      });
    },
  };
}

async function main(): Promise<void> {
  const overlay = document.getElementById('overlay');
  const parent = document.getElementById('game');
  if (!overlay || !parent) throw new Error('#overlay или #game не найден');
  if (EDITION.gate) await passGate(document.body, EDITION.id, EDITION.gate);

  const store = new GameStorage(storageOptions());
  liveStore = store;
  const { save, kept } = await store.load(Date.now());
  store.attachLifecycle();
  void store.requestPersist();

  // Звук: выключатель в настройках, `?mute=1` — вообще без звука.
  if (mute) bus.on('audio:play', ({ text, id, slow }) => console.info(`[audio] ${slow ? '(медленно) ' : ''}${id ?? ''} ${text ?? ''}`));
  else {
    connectAudio(gatedAudioBus(bus, () => store.save.settings.sound));
    connectSfx(bus, () => store.save.settings.sound, undefined, { mute, volume: () => store.save.settings.sfxVolume / 100 });
  }
  // Музыка (V11b): плеер HTMLAudio, по умолчанию выключена; `?mute=1` — аудио не создаётся, переключатели работают.
  const music = createMusicPlayer({
    mute,
    base: import.meta.env.BASE_URL,
    get: () => store.save.settings.music,
    set: (m) => store.update((s) => ({ ...s, settings: { ...s.settings, music: m } }), Date.now()),
    ctxOf: audioContext,
  });
  bus.on('world:location', ({ id }) => music.setLocation(id));
  // Мини-игра открыта: музыка тише.
  bus.on('farm:auto', ({ on }) => music.setDuck(on));
  mountAudioToast(overlay);
  mountUpdateToast(overlay);

  const settings = mountSettings(overlay, {
    muted: mute,
    version: __BUILD_ID__,
    ...(profile ? { profile } : {}),
    getSound: () => store.save.settings.sound,
    setSound: (on) => {
      if (!on) bus.emit('audio:stop', {});
      store.update((s) => ({ ...s, settings: { ...s.settings, sound: on } }), Date.now());
    },
    music,
    ...(EDITION.onboarding ? { onHowTo: () => onboarding.open() } : {}),
    getSfxVolume: () => store.save.settings.sfxVolume,
    setSfxVolume: (v) => store.update((s) => ({ ...s, settings: { ...s.settings, sfxVolume: v } }), Date.now()),
    lastSaved: () => store.lastSavedAt ?? store.save.updated,
    backupDue: () => backupDue(Date.now(), store.save.created, store.save.hints),
    exportSave: () => {
      const name = exportFileName(Date.now(), new Date().getTimezoneOffset());
      download(name, exportSave(store.save));
      store.update((s: Save) => ({ ...s, hints: withMark(s.hints, 'saved', Date.now()) }), Date.now());
      return name;
    },
    importSave: async (text) => {
      const r = importSave(text);
      if (!r.ok) return { ok: false, message: r.reason === 'version' ? 'Файл из более новой версии игры.' : 'Это не сохранение «Фермы».' };
      await store.replace(r.save, Date.now());
      setTimeout(() => location.reload(), 400);
      return { ok: true, message: 'Сохранение загружено, перезапускаю.' };
    },
    reset: async () => {
      download(exportFileName(Date.now(), new Date().getTimezoneOffset()), exportSave(store.save));
      await store.wipe();
      location.reload();
    },
  });

  // Ферма (F-03): огород, словарь, банки, мини-игры. Часы со сдвигом `?now=+1d` для проверки дней.
  const clock = createClock(params.get('now'));
  const farm = createFarm({
    bus,
    load: () => store.save.garden,
    save: (garden) => store.update((s: Save) => ({ ...s, garden }), clock.now()),
    now: () => clock.now(),
    tz: (t) => new Date(t).getTimezoneOffset(),
    say: (id, slow) => bus.emit('audio:play', { id, text: farm.word(id)?.pl ?? farm.phrase(id)?.pl ?? '', ...(slow ? { slow } : {}) }),
    // Свои слова («Moje słowa»): раздел Save.custom; озвучка — Web Speech pl-PL (в манифесте их нет), при ?mute=1 тишина.
    customs: { load: () => store.save.custom, save: (custom) => store.update((s: Save) => ({ ...s, custom }), clock.now()) },
  });
  // Узнаваемые слова (просьба Шэфа 19.10): любое польское слово в игре — тап (в тексте) или долгое нажатие/правый клик (на кнопке-ответе)
  // → лемма, перевод, 🔊, статус и «＋ В словарь». Словарь plru грузится при первом слове (не в precache).
  let wordIdx: WordIndex | null = null;
  const wordPick = mountWordPick(overlay, {
    api: farm,
    load: createPlruLoader({ url: `${import.meta.env.BASE_URL}dict/plru.json.gz` }),
    // База A1 и тема «Święta» (кроме версии «только язык») + названия из игр v2 (города, реки, воеводства с падежами).
    index: () =>
      (wordIdx ??= wordIndex(
        BASE_WORDS,
        (EDITION.languageOnly ? [] : V2.units).map((u) => ({ pl: u.pl, ru: u.ru, forms: Object.values((u.raw.forms ?? {}) as Record<string, unknown>).filter((x): x is string => typeof x === 'string') })),
      )),
    isA1,
    isCustom: isCustomId,
    say: (text, slow) => bus.emit('audio:play', { text, ...(slow ? { slow } : {}) }),
  });
  attachLongPress(overlay, { selector: '.pq-w', ms: LONG_PRESS_MS, onLongPress: (w) => void wordPick.open(w) });
  // Цель дня в HUD: «Сегодня: полито N · созреет завтра M» (верные ответы за календарный день + `ripeSoon`), тап открывает итог.
  const dayNow = (): number => {
    const t = clock.now();
    return dayOf(t, new Date(t).getTimezoneOffset());
  };
  const hud = mountHud(overlay, {
    onSettings: () => settings.open(),
    goal: () => {
      const r = farm.ripeSoon();
      return { watered: wateredOn(farm.garden.log, dayNow()), tomorrow: r.tomorrow, soon: r.soon };
    },
    onGoal: () => {
      if (!game.isOpen) summary.openBed();
    },
    onLevel: () => {
      if (!game.isOpen) pathScreen.open();
    },
  });
  mountLevelUp(overlay);
  // Бобёр (просьба Шэфа 19.10): карточка «Bóbr zamieszkał na farmie!» и пузырь «Bóbr · бобёр» с 🔊.
  mountBeaver(overlay);
  mountMusicHud(overlay, music);
  const radio = mountRadio(overlay, music);
  mountFloats(overlay);
  // Надёжное сохранение (V11a): галочка в углу после записи огорода, тост при сбое записи (хранилище само повторяет), раз в 7 дней — напоминание скачать копию.
  let shownGarden = store.save.garden;
  store.onWrite((e) => {
    if (e.type === 'error') return hud.setSaveError(true);
    hud.setSaveError(false);
    if (store.save.garden !== shownGarden) {
      shownGarden = store.save.garden;
      hud.flashSaved();
    }
  });
  // Сохранение не прочиталось, пришло из более новой версии или нашлось второе: копия уже лежит отдельно (`KEYS.kept`), игроку — сообщение и файл.
  if (kept.length) {
    const why = kept.some((k) => k.reason === 'broken')
      ? 'Старое сохранение не прочиталось — игра началась заново. Копия старого сохранена.'
      : kept.some((k) => k.reason === 'newer')
        ? 'Сохранение из более новой версии игры. Обновите страницу; копия сохранена.'
        : 'Нашлось второе сохранение. Копия отложена.';
    setTimeout(
      () =>
        hud.toast(why, {
          label: 'Скачать копию',
          run: () =>
            void store.keptCopies().then((list) => {
              const name = exportFileName(Date.now(), new Date().getTimezoneOffset()).replace('.json', '-kopia.json');
              download(name, `${JSON.stringify(list, null, 1)}\n`);
            }),
        }, 30_000),
      1500,
    );
  }
  if (shouldRemind(Date.now(), store.save.created, store.save.hints)) {
    store.update((s: Save) => ({ ...s, hints: withMark(s.hints, 'remind', Date.now()) }), Date.now());
    setTimeout(
      () =>
        hud.toast('Давно не было копии сохранения.', {
          label: 'Скачать',
          run: () => {
            download(exportFileName(Date.now(), new Date().getTimezoneOffset()), exportSave(store.save));
            store.update((s: Save) => ({ ...s, hints: withMark(s.hints, 'saved', Date.now()) }), Date.now());
          },
        }),
      4000,
    );
  }
  const hasHint = (h: string): boolean => store.save.hints.includes(h);
  const addHint = (h: string): void => {
    if (!hasHint(h)) store.update((s: Save) => ({ ...s, hints: [...s.hints, h] }), Date.now());
  };
  mountHints(overlay, { seen: hasHint, mark: addHint });
  // Где герой: указатель «Огород пуст» про грядки слов не показываем в Zagroda (там растут игры о Польше).
  let where = '';
  bus.on('world:location', ({ id }) => {
    where = id;
  });
  // Онбординг (`edition.onboarding`): первым при первом запуске, указатель первых шагов стартует после него; «Как играть» в настройках открывает снова.
  const onboarding = mountOnboarding(overlay, { level: LEVEL, seen: () => addHint(ONBOARDING_HINT) });
  const showOnboarding = EDITION.onboarding && shouldShowOnboarding({ enabled: true, hints: store.save.hints, planted: store.save.garden.planted.length, answered: store.save.garden.log.length });
  if (EDITION.onboarding && !showOnboarding) addHint(ONBOARDING_HINT);
  if (showOnboarding) {
    // Мир загружен (первая локация) → карточки; ввод героя на это время выключен самой панелью.
    const offLoc = bus.on('world:location', () => {
      offLoc();
      setTimeout(() => onboarding.open(), 350);
    });
  }
  // Первые шаги: к столу (до первого открытия словаря), потом к доске (до первой мини-игры). Игрок, который уже сажал
  // слова или отвечал, указателя не видит.
  const startGuide = (): void => void mountGuide(overlay, {
    stage: (): GuideStage | null => {
      const g = store.save.garden;
      if (!hasHint('guide:desk') && g.planted.length === 0) return 'desk';
      if (!hasHint('guide:board') && g.log.length === 0) return 'board';
      // Играл и вырастил всё: на грядках пусто и нет ждущих в мешке. «Огород пуст · Посади ещё слов за столом» гаснет после посадки (F5b).
      if (g.planted.length > 0 && g.log.length > 0 && where !== 'zagroda') {
        const s = farm.stats();
        if (s.growing === 0 && s.bag === 0) return 'replant';
      }
      return null;
    },
    done: (stage) => {
      if (stage !== 'replant') addHint(`guide:${stage}`);
    },
  });
  // Указатель ждёт, пока онбординг не закроют (подсказки после него, не поверх).
  if (showOnboarding) onboarding.onClose(startGuide);
  else startGuide();
  // Игры 3 и 4 с одной-двумя фразами: после ответа фраза отдыхает, а панель предлагает посадить ещё (F5b).
  const gapCard = mountAssembleGap(overlay, {
    gap: (mode) => farm.gap(mode),
    plant: (ids) => farm.plant(ids),
    restart: (mode) => game.start(mode),
    exit: () => game.stop(),
  });
  const game = mountMinigame(overlay, {
    next: (mode, only, opts) => {
      const q = farm.next(mode, only, opts);
      if (!q && !only) queueMicrotask(() => gapCard.check(mode));
      return q;
    },
    answer: (q, given) => farm.answer(q, given),
    say: (id) => farm.say(id),
  });
  // v2 «Игры о Польше»: свой огород (`Save.polska`), движок раундов, игры из `src/games/<id>/`, шкала «Wiedza o Polsce».
  const polska = createPolska({
    bus,
    load: () => store.save.polska,
    save: (p) => store.update((s: Save) => ({ ...s, polska: p }), clock.now()),
    now: () => clock.now(),
    tz: (t) => new Date(t).getTimezoneOffset(),
  });
  // Точка входа в игру и возврат к ней при выходе (`world:return`); после «Na pole!» — тост «Wróć».
  const entry = createEntryPoint(bus);
  // Герой уйдёт в Zagroda или к грядкам; в сохранении остаётся точка входа (вкладку закрыли посреди игры — вернёмся к мачте, а не в сад).
  entry.onStart((s) => store.update((save: Save) => ({ ...save, position: { map: s.map, x: s.x, y: s.y, facing: s.facing } }), clock.now()));
  entry.onPending((spot) => {
    if (spot) hud.toast('Идёшь в сад. Вернуться к месту входа?', { label: '↩ Wróć · Назад', run: () => void entry.back() }, 15_000);
  });
  const polskaGame = mountPolskaGame(overlay, {
    games: GAMES,
    polska,
    now: () => clock.now(),
    say: (text, slow) => bus.emit('audio:play', { text, ...(slow ? { slow } : {}) }),
  });
  const playPolska = (id: PolskaGameId, only?: string): void => {
    if (!game.isOpen) polskaGame.start(id, only);
  };
  const polskaPlot = mountPolskaPlot(overlay, {
    polska,
    play: playPolska,
    gameOf: (obj) => (obj.startsWith('sad_') ? 'geo' : obj.startsWith('hive_') ? 'hymn' : obj.startsWith('bed_') ? 'daty' : obj.startsWith('klumba_') ? 'swieta' : null),
  });
  const board = mountBoard(overlay, {
    counts: () => (farm.refresh(), farm.counts()),
    onPick: (mode) => game.start(mode),
    phraseHint: () => farm.phraseHint(),
    plant: (ids) => farm.plant(ids),
    ...(EDITION.languageOnly ? {} : { polska: {
      games: () =>
        GAMES.map((g) => {
          const p = polska.progress(g.id);
          const bar = polska.scale().games[g.id];
          return { id: g.id, title: g.title, desc: g.desc, progress: `выращено ${p.grown} из ${p.units}, растёт ${p.growing}`, where: `${PLOT_NAME[g.plot].pl} ${p.objDone}/${p.objTotal}`, pct: bar?.pct ?? 0, medal: bar?.medal ?? 0 };
        }),
      scale: () => {
        const s = polska.scale();
        return `${s.pl} · ${s.sub}/${s.of} · выращено ${s.grown} из ${s.total}`;
      },
      go: (id) => {
        const g = GAME_BY_ID.get(id as PolskaGameId);
        if (g) bus.emit('world:goto', { use: g.entry });
      },
      play: (id) => playPolska(id as PolskaGameId),
    } }),
  });
  // Шкала «Wiedza o Polsce» — часть блока v2; в версии «только язык» её нет.
  if (!EDITION.languageOnly) mountPolskaHud(overlay, { onTap: () => !game.isOpen && !polskaGame.isOpen && board.open('polska') });
  // Пояснения «банка» и «мешок»: один раз, при первом показе (флаги `tip:*` в `Save.hints`).
  const tips = createTips({ seen: hasHint, mark: addHint });
  const dictionary = mountDictionary(overlay, farm, undefined, tips, { loadDict: createRuplLoader({ url: `${import.meta.env.BASE_URL}dict/rupl.json.gz` }) });
  const pantry = mountPantry(overlay, farm, undefined, tips);
  const pathScreen = mountPath(overlay, farm);
  const summary = mountSummary(overlay, farm, undefined, tips, () => pathScreen.open());
  const plantCard = mountPlantCard(overlay, farm, { onReview: (id) => game.start(farm.reviewMode(id), id) });
  // Утро: первый вход в новый день — карточка «Вчера: …». День, для которого утро уже было, лежит одним флагом `morning:<день>` в `Save.hints`.
  const MORNING = 'morning:';
  // Случайные слова дня (`edition.dailyRandom`, версия Оли): в первый вход нового дня N новых слов базы садятся сами.
  // Только посадки — журнал и выращенное не трогаются; день отмечен флагом `daily:<день>` в `Save.hints`.
  const dailyNews = (day: number): string | null => {
    const n = EDITION.dailyRandom;
    if (!dailyDue({ n, day, seen: dailySeenDay(store.save.hints), started: farm.garden.planted.length > 0 })) return null;
    const ids = pickDaily(WORDS.filter((w) => farm.info(w.id).status === 'new').map((w) => w.id), n, day);
    store.update((s: Save) => ({ ...s, hints: markDaily(s.hints, day) }), clock.now());
    if (!ids.length) return null;
    const r = farm.plant(ids);
    return dailyLine(ids.map(plOf), r.bag);
  };
  mountMorning(overlay, {
    news: dailyNews,
    toast: (text) => hud.toast(text, undefined, 15_000),
    today: dayNow,
    recap: () => recapBefore(farm.garden.log, farm.state.grownByDay, dayNow()),
    ripeToday: () => farm.ripeSoon().today,
    ripeSoon: () => farm.ripeSoon().soon,
    seenDay: () => {
      const h = store.save.hints.find((x) => x.startsWith(MORNING));
      return h ? Number(h.slice(MORNING.length)) : null;
    },
    mark: (day) => store.update((s: Save) => ({ ...s, hints: [...s.hints.filter((x) => !x.startsWith(MORNING)), `${MORNING}${day}`] }), Date.now()),
    // Праздник сегодня или на неделе (Święta) — строкой в утренней карточке; украшение дня, если оно есть.
    polska: EDITION.languageOnly ? () => null : () => {
      const t = new Date(clock.now());
      const near = nearestHoliday(polska.units('swieta'), { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() });
      if (!near || near.days > 7) return null;
      const deco = (phaser.registry.get('decor') as string[] | undefined) ?? [];
      const extra = deco.includes('dec.znicze') ? ' · znicze przy ogrodzie' : deco.includes('dec.choinka') ? ' · choinka w domu' : deco.some((x) => x.startsWith('dec.flagi')) ? ' · flagi na domu' : '';
      return near.days === 0 ? `Dziś w Polsce: ${shortName(near.unit)}${extra}` : `Wkrótce: ${shortName(near.unit)} ${inDays(near.days)}`;
    },
  });
  bus.on('world:interact', ({ use, id }) => {
    if (game.isOpen || polskaGame.isOpen) return;
    // v2: точки входа (карта и календарь в доме, мачта и сезонная доска на ферме) и объекты участков Zagroda.
    const entry = GAME_BY_ENTRY.get(use as PolskaEntry);
    if (entry) return polskaGame.start(entry.id);
    if (use === 'zplot') return polskaPlot.open(id);
    if (use === 'desk') dictionary.open();
    else if (use === 'shelf') pantry.open();
    else if (use === 'bed') summary.openBed();
    else if (use === 'radio') radio.open();
    else if (use === 'bin') summary.openBin();
    else if (use === 'board') board.open();
    else if (use === 'plant') plantCard.open(id);
  });
  bus.on('world:location', ({ id }) => {
    if (id === 'farm') farm.refresh();
    if (id === 'zagroda') polska.refresh();
  });
  farm.refresh();
  polska.refresh();

  // Позиция героя и поворот: пишем, когда он остановился. Время — те же часы, что у огорода: при `?now=+1d` метка
  // `updated` не откатывается назад, и аварийная копия при уходе со страницы не проигрывает старой записи (B3).
  bus.on('world:position', ({ location: map, x, y, facing }) => {
    // Пока открыта мини-игра, клетка в Zagroda или у грядки точкой возврата не становится: сохранение остаётся на точке входа.
    if (entry.holding) return;
    store.update((s: Save) => ({ ...s, position: { map, x, y, facing } }), clock.now());
  });

  const start: WorldStart = save.position && MAPS[save.position.map] ? { map: save.position.map, spawn: [save.position.x, save.position.y], facing: save.position.facing } : {};
  const phaser = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: BG_COLOR,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    input: { activePointers: 2 },
    scene: [Boot, World],
  });
  phaser.registry.set('boot:start', start);
  // Украшения мира к реальной дате (часы игры, `?now=`): знич 1–2.11, флажки 2–3.05 и 11.11, ёлка 24.12–6.01, пальма и писанки к Пасхе.
  const today = new Date(clock.now());
  const decor0 = EDITION.languageOnly ? [] : activeDecor(parseDecor((V2.docs.swieta as { decor?: unknown }).decor), { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() });
  // Бобёр (`systems/beaver.ts`): гость на уровнях 0–9, с 10-го поселяется (хатка и пруд — ключ `beaver.home` в наборе украшений).
  // `?blvl=N` с `?dev=` подменяет уровень для проверок (профиль dev отдельный, чужие сохранения не трогаем).
  const devLevel = dev ? Number(params.get('blvl') ?? NaN) : NaN;
  const beaver = createBeaver({
    load: () => store.save.beaver,
    save: (b) => store.update((s: Save) => ({ ...s, beaver: b }), clock.now()),
    now: () => clock.now(),
    level: () => (Number.isFinite(devLevel) ? devLevel : farm.stats().path.sub),
    tz: (t) => new Date(t).getTimezoneOffset(),
  });
  phaser.registry.set('beaver', beaver);
  phaser.registry.set('decor', beaver.phase() === 'resident' ? [...decor0, HOME_KEY] : decor0);

  const world = (): World | null => {
    const s = phaser.scene.getScene('World') as World | null;
    return s && phaser.scene.isActive('World') ? s : null;
  };
  // Порядок важен: сначала d-pad (он слушает `input:dpad`), потом startInput.
  const dpad = mountDpad(document.body, bus);
  const input = startInput({
    dpad,
    mapControls: 'walk',
    // Касание уже было в прошлый раз: d-pad и A видны с первого кадра и после перезагрузки.
    touchSeen: hasHint('touch'),
    onTouch: () => addHint('touch'),
    pointer: { target: parent, tileAt: (x, y) => world()?.tileAt(x, y) ?? null },
  });
  bus.on('world:location', ({ controls }) => input.router.setMapControls(controls));

  // Новая сборка: service worker уже новый. Нет открытых экранов — тихая перезагрузка (прогресс дописан), иначе заметный тост.
  const reload = (): void => void reloadForUpdate(() => store.flush(), { from: __BUILD_ID__ });
  bus.on('app:reload', reload);
  let screenOpen = false;
  let updatePending = false;
  const needReload = (): void => {
    updatePending = true;
    const busy = screenOpen || game.isOpen || polskaGame.isOpen;
    if (updateAction({ busy, lastReloadAt: lastReloadAt(), now: Date.now(), lastReloadFrom: lastReloadFrom(), local: __BUILD_ID__ }) === 'reload') reload();
    else bus.emit('app:update', {});
  };
  // Экраны закрылись, а обновление ждёт: спросить политику снова.
  const retryUpdate = (): void => {
    if (updatePending && !screenOpen && !game.isOpen && !polskaGame.isOpen) needReload();
  };
  bus.on('world:input', ({ enabled }) => {
    screenOpen = !enabled;
    if (enabled) setTimeout(retryUpdate, 0);
  });
  bus.on('farm:auto', ({ on }) => {
    if (!on) setTimeout(retryUpdate, 0);
  });
  registerPwa({ onNeedReload: needReload });
  // Страница из старого кэша (HTTP-кэш index.html, встроенный браузер без SW): версия с сервера без кэша.
  watchVersion({ base: import.meta.env.BASE_URL, local: __BUILD_ID__, isStale: staleBuild, onStale: needReload });

  // Бобёр поселился: на ферме, когда ничего не открыто и карточка нового уровня уже погасла. Записываем один раз, хатку и пруд кладём в
  // реестр, сцена пересоздаётся (`World` слушает `beaver:settled`), карточка «Bóbr zamieszkał na farmie!».
  let holdSettle = 0;
  bus.on('hud:xp', ({ up }) => {
    if (up) holdSettle = Date.now() + 6500;
  });
  // Герой стоит там, где вырастут хатка и пруд (клетки и кольцо вокруг): ждём, пока отойдёт.
  const homeBox = getMap('farm').objects.flatMap((o) => (o.type === 'prop' && o.unlock === HOME_KEY ? [[o.at[0] - 1, o.at[1] - 1, (o.size?.[0] ?? 1) + 2, (o.size?.[1] ?? 1) + 2] as const] : []));
  let heroAt: readonly [number, number] | null = null;
  bus.on('world:position', (p) => {
    heroAt = p.location === 'farm' ? [p.x, p.y] : null;
  });
  const maybeSettle = (): void => {
    if (beaver.phase() === 'resident' || where !== 'farm' || screenOpen || game.isOpen || polskaGame.isOpen || Date.now() < holdSettle) return;
    if (heroAt && homeBox.some((r) => heroAt![0] >= r[0] && heroAt![1] >= r[1] && heroAt![0] < r[0] + r[2] && heroAt![1] < r[1] + r[3])) return;
    if (!beaver.trySettle()) return;
    phaser.registry.set('decor', [...decor0, HOME_KEY]);
    bus.emit('beaver:settled', {});
  };
  setInterval(maybeSettle, 2000);

  if (dev) (window as unknown as { __pq?: Record<string, unknown> }).__pq = { bus, game: phaser, store, world, settings, input, farm, minigame: game, clock, music, polska, polskaGame, beaver, wordPick };
}

// Запасной экран в index.html смотрит на этот флаг: модуль дошёл до запуска, дальше ошибки ловит guardStart.
(window as unknown as { __pqGuard?: boolean }).__pqGuard = true;
void guardStart(main, {
  saveText: crashSaveText,
  fileName: () => exportFileName(Date.now(), new Date().getTimezoneOffset()),
  download,
  reload: () => location.reload(),
});
