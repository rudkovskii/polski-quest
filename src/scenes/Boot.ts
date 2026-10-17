import Phaser from 'phaser';
import type { WorldStart } from './World';

/** Boot: сразу в мир. Куда именно, решает склейка (`boot:start` в registry): сохранённая позиция или старт. */
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const start = this.registry.get('boot:start') as WorldStart | undefined;
    this.scene.start('World', start ?? {});
  }
}
