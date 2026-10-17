import Phaser from 'phaser';
import { startInput } from './input';
import { Boot } from './scenes/Boot';
import { BG_COLOR, World, type WorldStart } from './scenes/World';
import { bus, type Bus } from './systems/bus';
import { connectAudio } from './systems/platform/audio';
import { lastReloadAt, registerPwa, reloadForUpdate, watchVersion } from './systems/platform/pwa';
import { GameStorage, memoryKV } from './systems/platform/storage';
import { exportFileName, exportSave, importSave, type Save } from './systems/save';
import { staleBuild, updateAction } from './systems/update';
import type { BusEvents } from './types/bus';
import { mountAudioToast } from './ui/audioToast';
import { mountBubble } from './ui/bubble';
import { mountDpad } from './ui/dpad';
import { mountHud } from './ui/hud';
import { mountSettings } from './ui/settings';
import { mountUpdateToast } from './ui/updateToast';

const params = new URLSearchParams(location.search);
const dev = params.get('dev') === '1';
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

  const store = new GameStorage(params.get('mem') === '1' ? { kv: memoryKV(), ls: null } : {});
  const { save } = await store.load(Date.now());
  store.attachLifecycle();
  void store.requestPersist();

  // Звук: выключатель в настройках, `?mute=1` — вообще без звука.
  if (mute) bus.on('audio:play', ({ text, id, slow }) => console.info(`[audio] ${slow ? '(медленно) ' : ''}${id ?? ''} ${text ?? ''}`));
  else connectAudio(gatedAudioBus(bus, () => store.save.settings.sound));
  mountAudioToast(overlay);
  mountUpdateToast(overlay);
  mountBubble(overlay);

  const settings = mountSettings(overlay, {
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

  // Позиция героя и поворот: пишем, когда он остановился.
  bus.on('world:position', ({ location: map, x, y, facing }) => {
    store.update((s: Save) => ({ ...s, position: { map, x, y, facing } }), Date.now());
  });

  const start: WorldStart = save.position ? { map: save.position.map, spawn: [save.position.x, save.position.y], facing: save.position.facing } : {};
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: BG_COLOR,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    input: { activePointers: 2 },
    scene: [Boot, World],
  });
  game.registry.set('boot:start', start);

  const world = (): World | null => {
    const s = game.scene.getScene('World') as World | null;
    return s && game.scene.isActive('World') ? s : null;
  };
  // Порядок важен: сначала d-pad (он слушает `input:dpad`), потом startInput.
  const dpad = mountDpad(document.body, bus);
  const input = startInput({
    dpad,
    mapControls: 'walk',
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

  if (dev) (window as unknown as { __pq?: Record<string, unknown> }).__pq = { bus, game, store, world, settings, input };
}

void main();
