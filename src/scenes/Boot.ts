import Phaser from 'phaser';

/** Куда идти после Boot: по умолчанию Title; dev-маршрут `/?dev=world` кладёт сюда Location (I-07). */
export interface BootStart {
  scene: string;
  data?: object;
}

// Boot (ТЗ §5.1). Загрузка атласа, контента и прогресса появится в I-02…I-06.
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const start = this.registry.get('boot:start') as BootStart | undefined;
    if (start) this.scene.start(start.scene, start.data);
    else this.scene.start('Title');
  }
}
