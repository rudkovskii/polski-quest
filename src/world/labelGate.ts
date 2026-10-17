// Подпись над растением у героя вне мини-игры: показывается, когда герой встал лицом к растению, и гаснет через пару
// секунд, даже если он так и стоит (иначе висит над головой «залипшей» и после перезагрузки). В мини-игре подпись
// текущего задания держится, пока задание не сменится. Чистый TS без Phaser.

/** Сколько висит подпись растения, к которому герой повернулся, мс. */
export const PLANT_LABEL_MS = 2500;

export class LabelGate {
  private key = '';
  private since = 0;

  /** `key` — что подписываем сейчас (null — ничего), `sticky` — держать без таймера. true = показывать. */
  show(key: string | null, now: number, sticky = false): boolean {
    if (!key) {
      this.key = '';
      return false;
    }
    if (key !== this.key) {
      this.key = key;
      this.since = now;
    }
    return sticky || now - this.since < PLANT_LABEL_MS;
  }
}
