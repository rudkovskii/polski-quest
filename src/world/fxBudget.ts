// Запас по кадрам: эффекты не должны мешать играть. На полной частоте кадры долго идут медленнее `SLOW_MS` — один раз говорим
// сцене убрать движущееся (свет остаётся). Настройку игрока не трогаем: при следующем входе на карту эффекты пробуют снова.

/** Кадр дольше этого (около 28 кадров/с) считается медленным. */
export const SLOW_MS = 36;
/** Столько подряд идущих медленных «окон», прежде чем убирать. */
const WINDOWS = 3;
const WINDOW_FRAMES = 40;

export class FxBudget {
  private sum = 0;
  private n = 0;
  private bad = 0;
  private cut = false;

  /** Кадр: `delta` мс, `fps` — текущая цель. Вернёт true один раз, когда пора убрать движение. */
  tick(delta: number, fps: number): boolean {
    if (this.cut || fps < 30) {
      this.sum = 0;
      this.n = 0;
      return false;
    }
    this.sum += Math.min(delta, 200);
    if (++this.n < WINDOW_FRAMES) return false;
    const avg = this.sum / this.n;
    this.sum = 0;
    this.n = 0;
    this.bad = avg > SLOW_MS ? this.bad + 1 : 0;
    if (this.bad < WINDOWS) return false;
    this.cut = true;
    return true;
  }
}
