import Phaser from 'phaser';

// Boot (ТЗ §5.1). Загрузка атласа, контента и прогресса появится в I-02…I-06.
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Title');
  }
}
