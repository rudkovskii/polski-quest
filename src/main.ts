import Phaser from 'phaser';
import { startInput } from './input';
import { Boot } from './scenes/Boot';
import { BG_COLOR, World, type WorldStart } from './scenes/World';
import { bus, type Bus } from './systems/bus';
import { createFarm } from './systems/farm';
import { connectAudio } from './systems/platform/audio';
import { createClock } from './systems/platform/clock';
import { connectSfx } from './systems/platform/sfx';
import { lastReloadAt, registerPwa, reloadForUpdate, watchVersion } from './systems/platform/pwa';
import { GameStorage, memoryKV, parseProfile } from './systems/platform/storage';
import { exportFileName, exportSave, importSave, type Save } from './systems/save';
import { staleBuild, updateAction } from './systems/update';
import type { BusEvents } from './types/bus';
import { mountAudioToast } from './ui/audioToast';
import { mountBoard } from './ui/board';
import { mountDictionary } from './ui/dictionary';
import { mountFloats } from './ui/float';
import { mountMinigame } from './ui/minigame';
import { mountPantry } from './ui/pantry';
import { mountPlantCard } from './ui/plantCard';
import { mountSummary } from './ui/summary';
import { mountDpad } from './ui/dpad';
import { mountHints } from './ui/hints';
import { mountGuide, type GuideStage } from './ui/hintsGuide';
import { mountHud } from './ui/hud';
import { mountSettings } from './ui/settings';
import { mountUpdateToast } from './ui/updateToast';

const params = new URLSearchParams(location.search);
// `?dev=<id>`: dev-режим (`window.__pq`) и отдельный профиль сохранения `polski-farm-<id>` (тесты не трогают игру Шэфа).
const profile = parseProfile(params.get('dev'));
const dev = profile !== null;
// Без звука вслух: `?mute=1` — `audio:play` только в консоль.
const mute = params.get('mute') === '1';

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

  const store = new GameStorage(params.get('mem') === '1' ? { kv: memoryKV(), ls: null } : profile ? { profile } : {});
  const { save } = await store.load(Date.now());
  store.attachLifecycle();
  void store.requestPersist();

  // Звук: выключатель в настройках, `?mute=1` — вообще без звука.
  if (mute) bus.on('audio:play', ({ text, id, slow }) => console.info(`[audio] ${slow ? '(медленно) ' : ''}${id ?? ''} ${text ?? ''}`));
  else {
    connectAudio(gatedAudioBus(bus, () => store.save.settings.sound));
    connectSfx(bus, () => store.save.settings.sound);
  }
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
    exportSave: () => {
      const name = exportFileName(Date.now(), new Date().getTimezoneOffset());
      download(name, exportSave(store.save));
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
  mountHud(overlay, { onSettings: () => settings.open() });

  // Ферма (F-03): огород, словарь, банки, мини-игры. Часы со сдвигом `?now=+1d` для проверки дней.
  const clock = createClock(params.get('now'));
  const farm = createFarm({
    bus,
    load: () => store.save.garden,
    save: (garden) => store.update((s: Save) => ({ ...s, garden }), clock.now()),
    now: () => clock.now(),
    tz: (t) => new Date(t).getTimezoneOffset(),
    say: (id, slow) => bus.emit('audio:play', { id, text: farm.word(id)?.pl ?? farm.phrase(id)?.pl ?? '', ...(slow ? { slow } : {}) }),
  });
  mountFloats(overlay);
  const hasHint = (h: string): boolean => store.save.hints.includes(h);
  const addHint = (h: string): void => {
    if (!hasHint(h)) store.update((s: Save) => ({ ...s, hints: [...s.hints, h] }), Date.now());
  };
  mountHints(overlay, { seen: hasHint, mark: addHint });
  // Первые шаги: к столу (до первого открытия словаря), потом к доске (до первой мини-игры). Игрок, который уже сажал
  // слова или отвечал, указателя не видит.
  mountGuide(overlay, {
    stage: (): GuideStage | null => {
      const g = store.save.garden;
      if (!hasHint('guide:desk') && g.planted.length === 0) return 'desk';
      if (!hasHint('guide:board') && g.log.length === 0) return 'board';
      return null;
    },
    done: (stage) => addHint(`guide:${stage}`),
  });
  const game = mountMinigame(overlay, {
    next: (mode, only) => farm.next(mode, only),
    answer: (q, given) => farm.answer(q, given),
    say: (id) => farm.say(id),
  });
  const board = mountBoard(overlay, { counts: () => (farm.refresh(), farm.counts()), onPick: (mode) => game.start(mode) });
  const dictionary = mountDictionary(overlay, farm);
  const pantry = mountPantry(overlay, farm);
  const summary = mountSummary(overlay, farm);
  const plantCard = mountPlantCard(overlay, farm, { onReview: (id) => game.start(farm.reviewMode(id), id) });
  bus.on('world:interact', ({ use, id }) => {
    if (game.isOpen) return;
    if (use === 'desk') dictionary.open();
    else if (use === 'shelf') pantry.open();
    else if (use === 'bed') summary.openBed();
    else if (use === 'bin') summary.openBin();
    else if (use === 'board') board.open();
    else if (use === 'plant') plantCard.open(id);
  });
  bus.on('world:location', ({ id }) => {
    if (id === 'farm') farm.refresh();
  });
  farm.refresh();

  // Позиция героя и поворот: пишем, когда он остановился.
  bus.on('world:position', ({ location: map, x, y, facing }) => {
    store.update((s: Save) => ({ ...s, position: { map, x, y, facing } }), Date.now());
  });

  const start: WorldStart = save.position ? { map: save.position.map, spawn: [save.position.x, save.position.y], facing: save.position.facing } : {};
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

  // Новая сборка: service worker уже новый — на старте перезагрузка сразу, в игре тост «Есть обновление».
  const startedAt = Date.now();
  const reload = (): void => void reloadForUpdate(() => store.flush());
  bus.on('app:reload', reload);
  const needReload = (): void => (updateAction({ started: Date.now() - startedAt > 3000, lastReloadAt: lastReloadAt(), now: Date.now() }) === 'reload' ? reload() : bus.emit('app:update', {}));
  registerPwa({ onNeedReload: needReload });
  // Страница из старого кэша (HTTP-кэш index.html, встроенный браузер без SW): версия с сервера без кэша.
  watchVersion({ base: import.meta.env.BASE_URL, local: __BUILD_ID__, isStale: staleBuild, onStale: needReload });

  if (dev) (window as unknown as { __pq?: Record<string, unknown> }).__pq = { bus, game: phaser, store, world, settings, input, farm, minigame: game, clock };
}

void main();
