// Подпись над растением у героя вне мини-игры: показывается, когда герой встал лицом к растению, и гаснет через пару
// секунд, даже если он так и стоит (иначе висит над головой «залипшей» и после перезагрузки). В мини-игре подпись
// текущего задания держится, пока задание не сменится. Чистый TS без Phaser.

/** Сколько висит подпись растения, к которому герой повернулся, мс. */
export const PLANT_LABEL_MS = 2500;

export class LabelGate {
  private key = '';
  private since = 0;
  /** Ждём первую цель после выхода из экрана/мини-игры/старта: её подпись не показываем, пока герой не отойдёт и не вернётся. */
  private armed = false;
  private muted = '';

  /** Сбросить подпись (закрылся экран, вышли из мини-игры, сцена началась): растение, у которого герой стоит сейчас, молчит. */
  arm(): void {
    this.key = '';
    this.muted = '';
    this.armed = true;
  }

  /** `key` — что подписываем сейчас (null — ничего), `sticky` — держать без таймера. true = показывать. */
  show(key: string | null, now: number, sticky = false): boolean {
    if (!key) {
      this.key = '';
      this.muted = '';
      this.armed = false;
      return false;
    }
    if (sticky) this.armed = false;
    else {
      if (this.armed) {
        this.armed = false;
        this.muted = key;
      }
      if (key === this.muted) return false;
    }
    if (key !== this.key) {
      this.key = key;
      this.since = now;
    }
    return sticky || now - this.since < PLANT_LABEL_MS;
  }
}
