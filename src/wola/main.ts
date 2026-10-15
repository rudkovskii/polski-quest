// Склейка короткой версии «Wola» (W-01, ../ВОЛЯ.md): отдельная точка входа `/polski-quest/wola/`.
//   • улица Воли — карта `wola.hub` с ходьбой на движке Location (d-pad, стрелки/WASD, тап = дойти, правила A);
//     без бобра, режиссёра, вокзала и фотобудки; Дима по умолчанию;
//   • вход в дверь (`place:<id>`) открывает экран места без ходьбы: дом (ноутбук, полка, банки, кровать), огород,
//     Salad Story (заглушка до W-02); «Wola» возвращает на улицу к той же двери;
//   • своё сохранение: IndexedDB `polski-quest-wola`, localStorage с пространством `wola:` — прогресс основной игры
//     не трогается; облака нет (копия файлом в настройках);
//   • звук: озвучка слов как в основной игре, «без звука» только в настройках; `?mute=1` — ничего вслух.
// Dev (только `npm run dev`): `?now=+1d` — часы, `?reset=1` — стереть сохранение Wola, `window.__wola` — состояние.
import Phaser from 'phaser';
import { startInput } from '../input';
import { Boot } from '../scenes/Boot';
import { Location, type LocationData } from '../scenes/Location';
import { bus } from '../systems/bus';
import { useContent } from '../systems/content';
import { derive, deriveContent } from '../systems/derive';
import { connectAudio } from '../systems/platform/audio';
import { createClock } from '../systems/platform/clock';
import { lastReloadAt, registerPwa, reloadForUpdate, watchVersion } from '../systems/platform/pwa';
import { connectSfx } from '../systems/platform/sfx';
import { GameStorage } from '../systems/platform/storage';
import { getSetting } from '../systems/progress';
import { activeMsAt, activityReset, activityStart, activityTouch, activityVisible, type Activity } from '../systems/session';
import { isSilent, setSoundUnavailable } from '../systems/sound';
import { staleBuild, updateAction } from '../systems/update';
import { mountAudioToast } from '../ui/audioToast';
import { mountDpad } from '../ui/dpad';
import { createOverlay } from '../ui/overlay/host';
import { busAudio } from '../ui/overlay/kit';
import { runSettings } from '../ui/settings';
import { mountUpdateToast } from '../ui/updateToast';
import { wolaContent } from './content';
import { HUB_MAP, placeOf, type PlaceId } from './systems/places';
import { routePlaces } from './places';
import { hubCounters, wolaBook, type HubCounters } from './systems/wola';
import { runGarden } from './ui/garden';
import { runHome } from './ui/home';
import { mountHub } from './ui/hub';
import type { WolaDeps } from './ui/kit';
import { loadPixAtlas } from './ui/pix';
import { runSalad } from './ui/salad';

export const WOLA_DB = 'polski-quest-wola';
export const WOLA_LS = 'wola:';

const params = new URLSearchParams(location.search);
const devServer = import.meta.env.DEV;
const clock = createClock(devServer || params.get('dev') ? params.get('now') : null);
const mute = params.get('mute') === '1';

async function start(): Promise<void> {
  const overlayRoot = document.getElementById('overlay');
  const parent = document.getElementById('game');
  if (!overlayRoot || !parent) throw new Error('#overlay или #game не найден');

  if (devServer && params.get('reset') === '1') {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(WOLA_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    params.delete('reset');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params.toString()}` : ''}${location.hash}`);
  }

  const { content, vocab } = wolaContent();
  useContent(content);
  const book = wolaBook(vocab);

  // Озвучка (I-09) и звук клавиш: `?mute=1` — только в консоль, задания на слух читаются.
  if (mute) {
    bus.on('audio:play', ({ text, id, slow }) => console.info(`[audio] ${slow ? '(медленно) ' : ''}${id ?? ''} ${text ?? ''}`));
    setSoundUnavailable(true);
  } else connectAudio(bus);
  bus.on('audio:state', ({ state }) => {
    if (mute) return;
    if (state === 'none') setSoundUnavailable(true);
    else if (state === 'playing') setSoundUnavailable(false);
  });
  mountAudioToast(overlayRoot);
  mountUpdateToast(overlayRoot);

  const store = new GameStorage({ dbName: WOLA_DB, lsNamespace: WOLA_LS });
  await store.load(clock.now());
  store.attachLifecycle();
  if (!mute) connectSfx(bus, { volume: () => getSetting(store.progress, 'sfxVolume'), enabled: () => !isSilent(store.progress) });

  // Новая сборка: тост «Есть обновление» (титула нет — сразу перезагружать посреди слов нельзя).
  const reload = (): void => void reloadForUpdate(() => store.flush());
  bus.on('app:reload', reload);
  const needReload = (): void => (updateAction({ started: true, lastReloadAt: lastReloadAt(), now: Date.now() }) === 'reload' ? reload() : bus.emit('app:update', {}));
  registerPwa({ onNeedReload: needReload });
  watchVersion({ base: import.meta.env.BASE_URL, local: __BUILD_ID__, isStale: staleBuild, onStale: needReload });

  const overlay = createOverlay(overlayRoot, { bus });
  const atlas = await loadPixAtlas(import.meta.env.BASE_URL, (url) => fetch(url).then((r) => r.json() as Promise<unknown>));

  // Активное время (§4.8) для итога дня, как src/day.ts.
  let act: Activity = activityStart(clock.mono(), document.visibilityState !== 'hidden');
  let sessionStart = clock.now();
  const touch = (): void => {
    act = activityTouch(act, clock.mono());
  };
  document.addEventListener('pointerdown', touch, { capture: true, passive: true });
  document.addEventListener('keydown', touch, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => (act = activityVisible(act, document.visibilityState !== 'hidden', clock.mono())));
  bus.on('input:intent', touch);

  const audio = busAudio(bus);
  const deps: WolaDeps = {
    overlay,
    content,
    book,
    store,
    bus,
    audio,
    atlas,
    clock,
    coarse: matchMedia('(pointer: coarse)').matches,
    activeMs: () => activeMsAt(act, clock.mono()),
    sessionStart: () => sessionStart,
    onSession: () => {
      act = activityReset(act, clock.mono());
      sessionStart = clock.now();
    },
    onEvent: (e) => devServer && console.info('[log]', JSON.stringify(e)),
  };

  // ── Улица: Phaser + Location (ходьба), без бобра.
  const hubMap = content.maps.get(HUB_MAP)?.value;
  if (!hubMap) throw new Error(`Wola: нет карты ${HUB_MAP}`);
  const pos = store.local.position;
  const data: LocationData = { location: HUB_MAP, ...(pos && pos.location === HUB_MAP ? { spawn: [pos.x, pos.y] as [number, number] } : {}) };
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#1a1c2c',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    input: { activePointers: 2 },
    scene: [Boot, Location],
  });
  game.registry.set('world:companion', false);
  game.registry.set('boot:start', { scene: 'Location', data });
  const location_ = (): Location | null => {
    const s = game.scene.getScene('Location') as Location | null;
    return s && game.scene.isActive('Location') ? s : null;
  };
  const dpad = mountDpad(document.body, bus, { labels: () => false });
  const input = startInput({ dpad, mapControls: 'walk', pointer: { target: parent, tileAt: (x, y) => location_()?.tileAt(x, y) ?? null } });
  bus.on('world:location', ({ controls }) => input.router.setMapControls(controls));
  const applyControls = (): void => input.router.setControls({ dpad: getSetting(store.progress, 'controls.dpad'), dpadSide: getSetting(store.progress, 'controls.dpadSide') });
  applyControls();
  bus.on('progress:changed', ({ kinds }) => kinds.includes('settings') && applyControls());
  bus.on('world:position', ({ location: loc, x, y }) => {
    const p = store.local.position;
    if (p && p.location === loc && p.x === x && p.y === y) return;
    store.setLocal({ ...store.local, position: { location: loc, x, y } });
  });

  // ── Подписи мест и счётчики.
  const counters = (): HubCounters => {
    const now = clock.now();
    const d = derive(store.progress, deriveContent(content), now);
    return hubCounters(store.progress, book, d, now, content.tuning);
  };
  let busy = false;
  const doors = new Map<PlaceId, [number, number]>();
  for (const o of hubMap.objects) if (o.type === 'exit') {
    const p = placeOf(o.to);
    if (p) doors.set(p, [o.at[0], o.at[1]]);
  }
  const settings = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await runSettings({ overlay, store, bus, clock, build: __BUILD_ID__, wola: true });
    } finally {
      busy = false;
      hub.refresh();
    }
  };
  const hub = mountHub(overlayRoot, {
    bus,
    counters,
    settings: () => void settings(),
    goTo: (id) => {
      const at = doors.get(id);
      if (at && !busy) bus.emit('input:intent', { type: 'goto', tile: at, to: 'world', source: 'pointer' });
    },
  });

  // ── Вход в место: экран без ходьбы поверх улицы; Дима сразу встаёт у двери (сцена перезапускается под экраном).
  const places = routePlaces(bus, {
    run: (id) => (id === 'dom' ? runHome(deps) : id === 'ogrod' ? runGarden(deps) : runSalad(deps)),
    onBusy: (b) => (busy = b),
    after: () => {
      hub.refresh();
      void store.flush();
    },
  });
  const open = places.open;

  if (devServer) {
    (window as unknown as { __wola?: Record<string, unknown> }).__wola = { bus, game, store, clock, content, book, overlay, open, counters };
    if (clock.offsetMs) console.info('[clock] now =', new Date(clock.now()).toString());
  }
}

void start();
