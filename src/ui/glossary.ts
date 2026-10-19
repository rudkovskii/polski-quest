// Словарь терминов игры для новичка: названия мини-игр по-русски (польское мелко), стадии роста с подписью и значком,
// короткие пояснения «банка» и «мешок» при первом показе. Чистые данные и маленький помощник подсказок, без Phaser.
import type { GameMode, Stage } from '../types/farm';
import { el } from './dom';
import type { IconKey } from './stageIcon';

/** Название мини-игры: главное по-русски, польская запись мелко. */
export const MODE_NAME: Record<GameMode, { ru: string; pl: string }> = {
  1: { ru: 'Польское слово → перевод', pl: 'Polski → Rosyjski' },
  2: { ru: 'Перевод → польское слово', pl: 'Rosyjski → Polski' },
  3: { ru: 'Собери фразу по-польски', pl: 'Złóż zdanie po polsku' },
  4: { ru: 'Собери фразу по-русски', pl: 'Złóż zdanie po rosyjsku' },
  5: { ru: 'Собери слово', pl: 'Ułóż słowo' },
};

/** Значок игры на доске. */
export const MODE_ICON: Record<GameMode, string> = { 1: '📖', 2: '🎯', 3: '🧩', 4: '🔁', 5: '🔤' };

/** Стадии роста: русская подпись, значок атласа и пояснение в одну строку. */
export const STAGE_INFO: Record<Stage, { ru: string; icon: IconKey; hint: string }> = {
  seed: { ru: 'семечко', icon: 'icon_seed', hint: 'только посажено' },
  sprout: { ru: 'росток', icon: 'icon_sprout', hint: 'слово уже знакомо' },
  bush: { ru: 'кустик', icon: 'icon_bush', hint: 'почти выучено' },
  ripe: { ru: 'урожай', icon: 'icon_ripe', hint: 'выучено, уходит в банку' },
  overripe: { ru: 'перезрело — повтори', icon: 'icon_overripe', hint: 'пора повторить' },
};

export type TipId = 'jar' | 'bag';

export const TIP_TEXT: Record<TipId, string> = {
  jar: 'Банка = выученное слово.',
  bag: 'Мешок = семена, которым не хватило грядки.',
};

export interface TipsDeps {
  seen(id: string): boolean;
  mark(id: string): void;
}

export interface Tips {
  /** Заметка-пояснение, если игрок её ещё не видел; иначе null. Помечается показанной, когда экран закроется (`commit`). */
  note(id: TipId): HTMLElement | null;
  /** Экран закрыт: всё показанное больше не показывать. */
  commit(): void;
}

export function createTips(deps: TipsDeps): Tips {
  const shown = new Set<TipId>();
  return {
    note(id) {
      if (deps.seen(`tip:${id}`)) return null;
      shown.add(id);
      return el('div', { class: 'pq-tip', 'data-tip': id }, `💡 ${TIP_TEXT[id]}`);
    },
    commit() {
      for (const id of shown) deps.mark(`tip:${id}`);
      shown.clear();
    },
  };
}

export const TIP_CSS = `
.pq-tip { background: #ffe9c2; border: 2px dashed var(--pq-accent); border-radius: 6px; padding: 6px 9px; font-size: 14px; font-weight: 600; }
`;
