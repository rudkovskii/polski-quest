import Phaser from 'phaser';
import { startInput } from './input';
import { Boot, type BootStart } from './scenes/Boot';
import { Location, type LocationData } from './scenes/Location';
import { Title } from './scenes/Title';
import { offlineRpc, startCloud, type CloudOptions } from './cloud';
import { startFlow } from './flow';
import { mountGuide } from './ui/guide';
import { bus } from './systems/bus';
import { connectAudio } from './systems/platform/audio';
import { getContent } from './systems/content';
import { mountUi } from './ui';
import { mountAudioToast } from './ui/audioToast';
import { loadPortraits, mountPlay, type PlayDeps } from './ui/play';
import { dpadLabelsOn, mountDpad } from './ui/dpad';
import { setTodoVisible } from './ui/todo';
import { startDay } from './day';
import { createClock } from './systems/platform/clock';
import { storedSecret } from './systems/platform/secret';
import { GameStorage, memoryKV } from './systems/platform/storage';
import { busAudio } from './ui/overlay/kit';

const params = new URLSearchParams(location.search);
const dev = params.get('dev');
/**
 * Dev-прогон всей игры (I-13): `?dev=play` (или `?reset=1` без dev) — Title → LinkSetup → режиссёр, но прогресс
 * в отдельной базе `polski-quest-play` и облако выключено (ничего не уходит в Supabase). `reset=1` стирает базу:
 * чистый профиль. Повторный запуск — `?dev=play&mute=1` (база сохранилась), `&now=+8d` — весна.
 */
const playDev = dev === 'play' || (!dev && params.get('reset') === '1');
// Dev-часы (I-12): `?now=<ISO>` или `?now=+1d` сдвигают время во всех deps; только вместе с `dev`.
const clock = createClock(dev || playDev ? params.get('now') : null);
// Без звука вслух (AGENTS.md): `?mute=1` — `audio:play` только в консоль.
const mute = params.get('mute') === '1';
// Реплики-заглушки `[todo: id]` (P-01): только dev-сервер с dev-режимом; в сборке никогда, `&todo=0` прячет.
const showTodo = import.meta.env.DEV && (!!dev || playDev) && params.get('todo') !== '0';
setTodoVisible(showTodo);

interface StartOptions {
  /** Хранилище без облака (dev=world): отдельная база, синк не запускается. */
  devStore?: Promise<GameStorage>;
  /** Опции синка (dev=play: своя база и облако выключено). */
  cloud?: CloudOptions;
}

// Склейка слоёв (ТЗ §2.1): DOM-оверлей, d-pad, ввод, Phaser. Порядок важен (I-03): сначала d-pad
// (он слушает `input:dpad`), потом startInput, тап по карте разбирает активная сцена Location.
function startGame(start?: BootStart, opts: StartOptions = {}): Phaser.Game {
  const overlay = document.getElementById('overlay');
  const parent = document.getElementById('game');
  if (!overlay || !parent) throw new Error('#overlay или #game не найден');
  mountUi(overlay);
  // Озвучка (I-09): `audio:play` из UI, разблокировка на Title и первом жесте, тост после фона.
  if (mute) bus.on('audio:play', ({ text, id, slow }) => console.info(`[audio] ${slow ? '(медленно) ' : ''}${id ?? ''} ${text ?? ''}`));
  else connectAudio(bus);
  mountAudioToast(overlay);
  const store = opts.devStore ?? startCloud({ dev: dev === '1', ...opts.cloud }).then((c) => c.storage);
  // Диалоги и упражнения (I-08): world:interact → оверлей, события журнала → хранилище синка.
  const content = getContent();
  const portraits = loadPortraits(content);
  const playDeps: PlayDeps = { content, store, portraits, clock };
  const play = mountPlay(overlay, playDeps);

  // Конфигурация из ТЗ §2.4. WorldMap добавится в I-11.
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#1a1c2c',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    input: { activePointers: 2 },
    scene: [Boot, Title, Location],
  });
  if (start) game.registry.set('boot:start', start);

  const location = (): Location | null => {
    const s = game.scene.getScene('Location') as Location | null;
    return s && game.scene.isActive('Location') ? s : null;
  };
  // Подписи «A · действие», «B · назад» первые дни (P-01).
  const dpad = mountDpad(document.body, bus, { labels: () => !storeNow || dpadLabelsOn(storeNow.progress.log.events) });
  const input = startInput({
    dpad,
    // До первой локации (Title, экраны) d-pad не нужен: режим как у tap-локации, его сменит `world:location`.
    mapControls: 'tap',
    pointer: { target: parent, tileAt: (x, y) => location()?.tileAt(x, y) ?? null },
  });
  // Режим локации (`map.controls`, ТЗ §2.7): walk = все источники, tap = только тап, d-pad скрыт.
  bus.on('world:location', ({ controls }) => input.router.setMapControls(controls));
  // Петля дня (I-12): грядки, обход, экспресс, итог дня, настройки, позиция, таймер сессии.
  let storeNow: GameStorage | null = null;
  void store.then((s) => (storeNow = s));
  const day = startDay({
    root: overlay,
    overlay: play.overlay,
    content,
    store,
    audio: busAudio(bus),
    clock,
    router: input.router,
    hasLink: () => !!storeNow && !!storedSecret(storeNow),
    build: __BUILD_ID__,
  });
  // Режиссёр (I-13): строка «Сейчас», пузырь Казика, подсветка цели, запуск сразу в шаг, первый день.
  const guide = mountGuide(overlay, { bus, content, portraits, coarse: () => matchMedia('(pointer: coarse)').matches, dev: showTodo });
  const flow = startFlow({
    content,
    store,
    clock,
    play,
    day,
    audio: busAudio(bus),
    portraits,
    hasLink: () => !!storeNow && !!storedSecret(storeNow),
  });
  playDeps.claim = (p) => flow.claim(p);
  if (dev || playDev) (window as unknown as { __pq?: Record<string, unknown> }).__pq = { bus, game, play, day, store, clock, content, flow, guide };
  return game;
}

if (dev === 'audio') {
  // Dev-страница озвучки без Phaser (I-09).
  void import('./dev/audio').then((m) => m.mountAudioDev(document.body));
} else if (dev === 'input') {
  // Dev-страница без Phaser (I-03).
  void import('./dev/input').then((m) => m.mountInputDev(document.body));
} else if (dev === 'lesson') {
  // `/?dev=lesson&id=<lessonId>[&dlg=<dialogueId>][&days=N]`: урок или диалог без мира, журнал в консоль (I-08).
  void import('./dev/lesson').then((m) => m.mountLessonDev(params));
} else if (dev === 'world') {
  // `/?dev=world&map=ch01.metro[&spawn=from_dzialka]`: сразу в локацию, события мира в консоль (I-07).
  // I-12: `&now=<ISO>|+1d` — часы; `&mute=1` — без звука; `&reset=1` — журнал в памяти; `&plant=lx.a,lx.b` —
  // посадить слова (dev-событие intro, как после сцены). Прогресс в отдельной базе polski-quest-dev, без облака.
  const data: LocationData = { location: params.get('map') ?? 'ch01.metro' };
  const spawn = params.get('spawn');
  if (spawn) data.spawn = spawn;
  const devStore = (async (): Promise<GameStorage> => {
    const s = new GameStorage(params.get('reset') ? { kv: memoryKV(), ls: null } : { dbName: 'polski-quest-dev', ls: null });
    await s.load(clock.now());
    for (const item of (params.get('plant') ?? '').split(',').filter(Boolean)) {
      if (s.progress.log.events.some((e) => e.k === 'intro' && e.item === item)) continue;
      s.append({ k: 'intro', ts: clock.now(), item, lesson: 'dev.plant', ok: ['lis', 'rec'] });
    }
    return s;
  })();
  startGame({ scene: 'Location', data }, { devStore });
  for (const ev of ['world:interact', 'world:exit', 'world:location', 'world:position'] as const)
    bus.on(ev, (p) => console.info(`[${ev}]`, JSON.stringify(p)));
  bus.on('world:marks', (m) => console.info('[world:marks]', JSON.stringify({ location: m.location, due: m.dueItems, cells: m.plots.flatMap((p) => p.cells.filter((c) => c.item).map((c) => `${c.item}:${c.stage}/${c.interval}${c.due ? '!' : ''}${c.wilted ? '~' : ''}`)) })));
  if (clock.offsetMs) console.info('[clock] now =', new Date(clock.now()).toString());
} else if (playDev) {
  const dbName = 'polski-quest-play';
  const reset = params.get('reset') === '1';
  if (reset) {
    // Стираем один раз: перезагрузка вкладки (в том числе HMR) продолжает тот же мир, а не чистый.
    params.delete('reset');
    if (!params.get('dev')) params.set('dev', 'play');
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  }
  const fresh = reset ? new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }) : Promise.resolve();
  void fresh.then(() => {
    startGame(undefined, { cloud: { storage: new GameStorage({ dbName, ls: null }), rpc: offlineRpc } });
    if (clock.offsetMs) console.info('[clock] now =', new Date(clock.now()).toString());
  });
} else startGame();
