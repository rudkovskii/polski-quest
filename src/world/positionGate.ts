// Когда писать позицию героя в сохранение (B3, тест 4): каждый раз, когда он стоит (не идёт, не держит стрелку, нет пути)
// на клетке или с поворотом, которых ещё не писали. Так клетка записывается и после ходьбы, и после автобега мини-игры,
// и после доигрыша очереди фермы. Чистый TS без Phaser.
import type { Dir } from '../types/input';
import type { Xy } from './ascii';

export interface HeroPos {
  location: string;
  x: number;
  y: number;
  facing: Dir;
}

export class PositionGate {
  private last = '';

  /** Кадр: `busy` — герой в движении или ещё будет двигаться (автобег, очередь). Вернёт позицию, если её пора записать. */
  tick(busy: boolean, location: string, tile: Xy, facing: Dir): HeroPos | null {
    if (busy) return null;
    const key = `${location}:${tile[0]},${tile[1]}:${facing}`;
    if (key === this.last) return null;
    this.last = key;
    return { location, x: tile[0], y: tile[1], facing };
  }

  /** Новая сцена: следующую стоянку записать в любом случае. */
  reset(): void {
    this.last = '';
  }
}
