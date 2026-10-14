import Phaser from 'phaser';
import { bus } from '../systems/bus';

// Title (ТЗ §5.2). Текст рисует DOM-оверлей, сцена даёт фон и ждёт тапа.
export class Title extends Phaser.Scene {
  private stars?: Phaser.GameObjects.Graphics;

  constructor() {
    super('Title');
  }

  create(): void {
    this.stars = this.add.graphics();
    this.drawBackground();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.drawBackground, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.drawBackground, this);
    });

    const offStart = bus.once('title:start', () => {
      // Дальше LinkSetup (cloud.ts) и шаг режиссёра (src/flow.ts, I-13): он шлёт world:teleport.
      this.cameras.main.flash(200, 26, 28, 44);
    });
    // Запуск сразу в шаг (§5.2, I-13): режиссёр выбрал локацию — уходим в неё, меню нет.
    let going = false;
    const offTeleport = bus.on('world:teleport', ({ location, spawn, facing }) => {
      if (going) return;
      going = true;
      this.cameras.main.fadeOut(150, 26, 28, 44);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Location', { location, spawn, ...(facing ? { facing } : {}) }));
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offStart();
      offTeleport();
    });

    bus.emit('ui:title:show', { build: __BUILD_ID__ });
  }

  private drawBackground(): void {
    const g = this.stars;
    if (!g) return;
    const { width, height } = this.scale;
    g.clear();
    // Детерминированные «звёзды» и полоса земли: пиксельный фон без ассетов.
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle(0x333c57, 1);
    for (let i = 0; i < 60; i++) g.fillRect(Math.floor(rnd() * width), Math.floor(rnd() * height * 0.7), 2, 2);
    const ground = Math.floor(height * 0.8);
    g.fillStyle(0x257179, 1).fillRect(0, ground, width, height - ground);
    g.fillStyle(0x38b764, 1).fillRect(0, ground, width, 6);
  }
}
