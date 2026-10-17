// База A1 (content/a1/*.json, копия data/a1 из F-02 без правок): слова и фразы.

export type Pos = 'noun' | 'verb' | 'adj' | 'adv' | 'num' | 'pron' | 'prep' | 'conj' | 'part' | 'intj' | 'phrase';

export interface Word {
  /** `w.<латиница>`. */
  id: string;
  pl: string;
  ru: string;
  /** Транскрипция кириллицей с ударением. */
  tr: string;
  pos: Pos;
  /** Только у существительных: m f n pl. */
  gender?: 'm' | 'f' | 'n' | 'pl';
  forms: Record<string, string>;
  topic: string;
  freq: number;
  /** 1 = A0.5 (1–400), 2 = A0.8 (401–800), 3 = остальное. */
  band: 1 | 2 | 3;
  order: number;
  /** Ложный друг: что похоже по-русски и что на самом деле. */
  ff: { ru: string; note: string } | null;
  ex: { pl: string; ru: string } | null;
}

export interface Phrase {
  /** `p.<латиница>`. */
  id: string;
  pl: string;
  ru: string;
  tr: string;
  /** id слов из words.json, из которых состоит фраза. */
  words: string[];
  tiles_pl: string[];
  tiles_ru: string[];
  distract_pl: string[];
  distract_ru: string[];
  topic: string;
  level: 1 | 2 | 3;
}

export interface Topic {
  id: string;
  pl: string;
  ru: string;
}
