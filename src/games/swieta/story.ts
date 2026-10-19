// Игра «Święta»: что показываем в рассказе («Poznaj święto») — чистые функции без DOM: первый ли раз, 2–4 предложения справки, ключевые польские
// слова в русском тексте, магазины и выходной, обычаи, которые видел игрок. Вопросы первого раунда берут ровно эти обычаи и эту картину.
import type { GameCtx, PolskaUnit } from '../../types/polska';
import { customsOf } from './tasks';

/** Игрок ещё не принял знакомство («Rozumiem · Понятно»): флага `seen` в сохранении нет — даже если ответы уже были. */
export const isFirst = (ctx: Pick<GameCtx, 'seen'>, id: string): boolean => !ctx.seen(id);

/** Предложения абзацев подряд. Делим по «. ! ? …» перед заглавной буквой, кавычкой или цифрой. */
export function sentences(paragraphs: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paragraphs) for (const s of p.split(/(?<=[.!?…»])\s+(?=[A-ZА-ЯЁŚŻŹŁĆŃÓĘĄ«„"“0-9])/u)) if (s.trim()) out.push(s.trim());
  return out;
}

/** Короткая справка: 2–4 предложения (четвёртое — если вместе не длиннее ~380 знаков). */
export function shortIntro(paragraphs: readonly string[]): string {
  const all = sentences(paragraphs);
  let n = Math.min(4, all.length);
  while (n > 2 && all.slice(0, n).join(' ').length > 380) n--;
  return all.slice(0, n).join(' ');
}

export interface Run {
  t: string;
  /** Польское слово или фраза латиницей — выделяется жирным. */
  b: boolean;
}

const LATIN = "A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż";
const WORD = `[${LATIN}][${LATIN}+\\-]*`;
const RUN = new RegExp(`${WORD}(?:\\s+${WORD})*`, 'gu');
const ROMAN = /^[IVXLCDM]+$/;

/** Куски русского текста: польские слова и фразы латиницей — жирным. Римские цифры («Урбан IV») и одиночные буквы не считаются. */
export function boldRuns(text: string): Run[] {
  const out: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(RUN)) {
    const words = m[0].split(/\s+/);
    const real = words.some((w) => w.length > 1 && !ROMAN.test(w));
    if (!real) continue;
    if (m.index > last) out.push({ t: text.slice(last, m.index), b: false });
    out.push({ t: m[0], b: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), b: false });
  return out;
}

/** Номера обычаев, которые видит игрок в карточке (и из которых потом берутся вопросы первого раунда). */
export const SHOWN_CUSTOMS = 3;
export const shownCustoms = (u: PolskaUnit): number[] => customsOf(u).slice(0, SHOWN_CUSTOMS).map((_, i) => i);

/** Магазины и выходной одной строкой по-польски и по-русски: заметка из данных, иначе по `shops`. */
export function shopsLine(u: PolskaUnit): { pl: string; ru: string } | null {
  const n = u.raw.shops_note;
  if (n && typeof n === 'object') {
    const pl = String((n as Record<string, unknown>).pl ?? '');
    const ru = String((n as Record<string, unknown>).ru ?? '');
    if (pl && ru) return { pl, ru };
  }
  switch (u.raw.shops) {
    case 'open':
      return { pl: 'Sklepy są otwarte.', ru: 'Магазины открыты.' };
    case 'closed':
      return { pl: 'Sklepy są zamknięte.', ru: 'Магазины закрыты.' };
    case 'short':
      return { pl: 'Sklepy są otwarte do czternastej.', ru: 'Магазины открыты до 14:00.' };
    default:
      return null;
  }
}
