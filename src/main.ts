import Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { Title } from './scenes/Title';
import { mountUi } from './ui';

function startGame(): void {
  const overlay = document.getElementById('overlay');
  if (!overlay) throw new Error('#overlay not found');
  mountUi(overlay);

  // Конфигурация из ТЗ §2.4. WorldMap и Location добавятся в I-06 и I-14.
  new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#1a1c2c',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    input: { activePointers: 2 },
    scene: [Boot, Title],
  });
}

// Dev-страницы без Phaser: `/?dev=input` (I-03).
const dev = new URLSearchParams(location.search).get('dev');
if (dev === 'input') void import('./dev/input').then((m) => m.mountInputDev(document.body));
else startGame();
