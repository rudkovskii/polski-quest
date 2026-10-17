// База A1 в игре: слова и фразы (content/a1, копия data/a1 без правок), темы с названиями, индексы.
import phrasesJson from '../../content/a1/phrases.json';
import wordsJson from '../../content/a1/words.json';
import type { Phrase, Topic, Word } from '../types/content';

export const WORDS: readonly Word[] = wordsJson as unknown as Word[];
export const PHRASES: readonly Phrase[] = phrasesJson as unknown as Phrase[];

/** Темы в порядке словаря (как в README базы). `rozmowa` — только у фраз. */
export const TOPICS: readonly Topic[] = [
  { id: 'powitania', pl: 'Powitania', ru: 'Приветствия' },
  { id: 'zaimki', pl: 'Zaimki', ru: 'Местоимения' },
  { id: 'ja_i_rodzina', pl: 'Ja i rodzina', ru: 'Я и семья' },
  { id: 'kraje_i_narodowosci', pl: 'Kraje', ru: 'Страны и языки' },
  { id: 'liczby', pl: 'Liczby', ru: 'Числа' },
  { id: 'czas', pl: 'Czas', ru: 'Время и дни' },
  { id: 'dom', pl: 'Dom', ru: 'Дом' },
  { id: 'jedzenie', pl: 'Jedzenie', ru: 'Еда и кафе' },
  { id: 'zakupy', pl: 'Zakupy', ru: 'Покупки' },
  { id: 'miasto', pl: 'Miasto', ru: 'Город' },
  { id: 'transport', pl: 'Transport', ru: 'Транспорт' },
  { id: 'cialo_i_zdrowie', pl: 'Ciało i zdrowie', ru: 'Тело и здоровье' },
  { id: 'praca', pl: 'Praca', ru: 'Работа' },
  { id: 'nauka', pl: 'Nauka', ru: 'Учёба' },
  { id: 'czas_wolny', pl: 'Czas wolny', ru: 'Досуг' },
  { id: 'pogoda_i_natura', pl: 'Pogoda i natura', ru: 'Погода и природа' },
  { id: 'ubrania', pl: 'Ubrania', ru: 'Одежда' },
  { id: 'kolory', pl: 'Kolory', ru: 'Цвета' },
  { id: 'telefon_i_internet', pl: 'Telefon i internet', ru: 'Телефон и интернет' },
  { id: 'przymiotniki', pl: 'Przymiotniki', ru: 'Прилагательные' },
  { id: 'przyslowki', pl: 'Przysłówki', ru: 'Наречия' },
  { id: 'przyimki_i_spojniki', pl: 'Przyimki i spójniki', ru: 'Предлоги и союзы' },
  { id: 'pytania', pl: 'Pytania', ru: 'Вопросы' },
  { id: 'uczucia', pl: 'Uczucia', ru: 'Чувства' },
  { id: 'czasowniki', pl: 'Czasowniki', ru: 'Глаголы' },
  { id: 'rozmowa', pl: 'Rozmowa', ru: 'Разговор' },
];

export const WORD_BY_ID: ReadonlyMap<string, Word> = new Map(WORDS.map((w) => [w.id, w]));
export const PHRASE_BY_ID: ReadonlyMap<string, Phrase> = new Map(PHRASES.map((p) => [p.id, p]));

export const isPhraseId = (id: string): boolean => id.startsWith('p.');

/** Польский текст элемента (слово или фраза). */
export function plOf(id: string): string {
  return WORD_BY_ID.get(id)?.pl ?? PHRASE_BY_ID.get(id)?.pl ?? id;
}

/** Без диакритики и регистра: поиск «zolw» найдёт «żółw», «ёж» — «еж». */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/ё/g, 'е')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
