import Phaser from 'phaser';
import { startInput } from './input';
import { Boot, type BootStart } from './scenes/Boot';
import { Location, type LocationData } from './scenes/Location';
import { Title } from './scenes/Title';
import { startCloud } from './cloud';
import { bus } from './systems/bus';
import { mountUi } from './ui';
import { mountDpad } from './ui/dpad';

// Склейка слоёв (ТЗ §2.1): DOM-оверлей, d-pad, ввод, Phaser. Порядок важен (I-03): сначала d-pad
// (он слушает `input:dpad`), потом startInput, тап по карте разбирает активная сцена Location.
function startGame(start?: BootStart): Phaser.Game {
  const overlay = document.getElementById('overlay');
  const parent = document.getElementById('game');
  if (!overlay || !parent) throw new Error('#overlay или #game не найден');
  mountUi(overlay);
  void startCloud({ dev: new URLSearchParams(window.location.search).get('dev') === '1' });

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
  const dpad = mountDpad(document.body);
  const input = startInput({
    dpad,
    // До первой локации (Title, экраны) d-pad не нужен: режим как у tap-локации, его сменит `world:location`.
    mapControls: 'tap',
    pointer: { target: parent, tileAt: (x, y) => location()?.tileAt(x, y) ?? null },
  });
  // Режим локации (`map.controls`, ТЗ §2.7): walk = все источники, tap = только тап, d-pad скрыт.
  bus.on('world:location', ({ controls }) => input.router.setMapControls(controls));
  return game;
}

const params = new URLSearchParams(location.search);
const dev = params.get('dev');
if (dev === 'input') {
  // Dev-страница без Phaser (I-03).
  void import('./dev/input').then((m) => m.mountInputDev(document.body));
} else if (dev === 'world') {
  // `/?dev=world&map=ch01.metro[&spawn=from_dzialka]`: сразу в локацию, события мира в консоль (I-07).
  const data: LocationData = { location: params.get('map') ?? 'ch01.metro' };
  const spawn = params.get('spawn');
  if (spawn) data.spawn = spawn;
  const game = startGame({ scene: 'Location', data });
  for (const ev of ['world:interact', 'world:exit', 'world:location'] as const)
    bus.on(ev, (p) => console.info(`[${ev}]`, JSON.stringify(p)));
  (window as unknown as { __pq?: unknown }).__pq = { bus, game };
} else startGame();
