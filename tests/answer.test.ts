import { describe, expect, it } from 'vitest';
import { checkAnswer, levenshtein, matches, norm, ortho, stripDia, type Lenient, type Verdict } from '../src/systems/answer';

type Row = [input: string, accept: string | string[], verdict: Verdict, score: number, tags?: string[], lenient?: Lenient];

const R10 = (...k: string[]) => ['R10', ...k.map((x) => `orth.${x}`)];
const DIA = ['orth.diacritics'];

// Таблица §10.1 + диктанты гл. 1 + случаи из тренажёра (norm/stripDia/matches).
const TABLE: Row[] = [
  // точные и нормализация
  ['przepraszam.', 'przepraszam', 'exact', 1],
  ['Przepraszam', 'przepraszam', 'exact', 1],
  ['  Dzień   dobry  ', 'Dzień dobry', 'exact', 1],
  ['Dzień dobry!', 'Dzień dobry', 'exact', 1],
  ['dzień dobry?!', 'Dzień dobry.', 'exact', 1],
  ['Do widzenia…', 'Do widzenia', 'exact', 1],
  ['„Dzień dobry”', 'Dzień dobry', 'exact', 1],
  ['«Cześć»', 'Cześć', 'exact', 1],
  ['"Dobranoc"', 'Dobranoc', 'exact', 1],
  ['tak, proszę', 'tak proszę', 'exact', 1],
  ['Tak proszę', 'Tak, proszę.', 'exact', 1],
  ['MÓJ', 'mój', 'exact', 1],
  ['mój', 'mój', 'exact', 1], // NFD с iOS → NFC
  ['dziękuję', 'dziękuję', 'exact', 1],
  ['Dzień dobry', 'Dzień dobry', 'exact', 1],
  // диакритика (тренажёр: matches по stripDia)
  ['dziekuje', 'dziękuję', 'diacritics', 0.75, DIA],
  ['szesc', 'sześć', 'diacritics', 0.75, DIA],
  ['dzien dobry', 'Dzień dobry', 'diacritics', 0.75, DIA],
  ['dobry wieczor', 'Dobry wieczór', 'diacritics', 0.75, DIA],
  ['dziekuje', 'dziękuję', 'diacritics', 1, DIA, { diacritics: 'ok' }],
  ['dziekuje', 'dziękuję', 'diacritics', 0, DIA, { diacritics: 'fail' }],
  ['źle', 'żle', 'diacritics', 0.75, DIA],
  // орфография R10
  ['żeka', 'rzeka', 'ortho', 0.5, R10('rz_z')],
  ['zeka', 'rzeka', 'ortho', 0.5, [...R10('rz_z'), 'orth.diacritics']],
  ['gura', 'góra', 'ortho', 0.5, R10('o_u')],
  ['hleb', 'chleb', 'ortho', 0.5, R10('ch_h')],
  ['hur', 'chór', 'ortho', 0.5, R10('o_u', 'ch_h')],
  ['rzona', 'żona', 'ortho', 0.5, R10('rz_z')],
  ['cherbata', 'herbata', 'ortho', 0.5, R10('ch_h')],
  ['muj', 'mój', 'ortho', 0.5, R10('o_u')],
  ['kżesło', 'krzesło', 'ortho', 0.5, R10('rz_z')],
  ['gura', 'góra', 'wrong', 0, [], { ortho: false }],
  ['zeka', 'rzeka', 'diacritics', 0, [...R10('rz_z'), 'orth.diacritics'], { diacritics: 'fail' }],
  // диктанты гл. 1
  ['cześć', 'cześć', 'exact', 1],
  ['czesc', 'cześć', 'diacritics', 0.75, DIA],
  ['przepraszam', 'przepraszam', 'exact', 1],
  ['pszepraszam', 'przepraszam', 'wrong', 0],
  ['ręka', 'ręka', 'exact', 1],
  ['reka', 'ręka', 'diacritics', 0.75, DIA],
  ['mały', 'mały', 'exact', 1],
  ['maly', 'mały', 'diacritics', 0.75, DIA],
  ['chleb', 'chleb', 'exact', 1],
  ['środa', 'środa', 'exact', 1],
  ['sroda', 'środa', 'diacritics', 0.75, DIA],
  ['wszystko', 'wszystko', 'exact', 1],
  ['wsystko', 'wszystko', 'wrong', 0],
  ['krzesło', 'krzesło', 'exact', 1],
  ['krzeslo', 'krzesło', 'diacritics', 0.75, DIA],
  ['kszesło', 'krzesło', 'wrong', 0],
  ['góra', 'góra', 'exact', 1],
  ['gora', 'góra', 'diacritics', 0.75, DIA],
  ['rzeka', 'rzeka', 'exact', 1],
  ['żona', 'żona', 'exact', 1],
  ['zona', 'żona', 'diacritics', 0.75, DIA],
  ['herbata', 'herbata', 'exact', 1],
  ['mój', 'mój', 'exact', 1],
  ['moj', 'mój', 'diacritics', 0.75, DIA],
  // несколько accept: берётся лучший
  ['dzieki', ['dziękuję', 'dzięki'], 'diacritics', 0.75, DIA],
  ['dzięki', ['dziękuję', 'dzięki'], 'exact', 1],
  ['hura', ['góra', 'chóra'], 'ortho', 0.5, R10('o_u', 'ch_h')],
  ['gora', ['gura', 'góra'], 'diacritics', 0.75, DIA],
  // опечатка: только при флаге и длине ≥ 8
  ['przeprasam', 'przepraszam', 'typo', 0.5, ['orth.typo'], { typo: true }],
  ['przeprasam', 'przepraszam', 'wrong', 0],
  ['dzien dobyr', 'Dzień dobry', 'wrong', 0, [], { typo: true }], // перестановка = 2 правки
  ['dzien dobr', 'Dzień dobry', 'typo', 0.5, ['orth.typo'], { typo: true }],
  ['chlab', 'chleb', 'wrong', 0, [], { typo: true }],
  // мимо
  ['', 'cześć', 'wrong', 0],
  ['   ', 'cześć', 'wrong', 0],
  ['kawa', 'herbata', 'wrong', 0],
];

describe('answer: таблица', () => {
  it(`в таблице ≥ 40 случаев (${TABLE.length})`, () => expect(TABLE.length).toBeGreaterThanOrEqual(40));

  for (const [input, accept, verdict, score, tags = [], lenient] of TABLE) {
    const acc = Array.isArray(accept) ? accept : [accept];
    it(`${JSON.stringify(input)} ↔ ${acc.join(' | ')} → ${verdict} ${score}`, () => {
      const r = checkAnswer(input, acc, lenient);
      expect(r.verdict).toBe(verdict);
      expect(r.score).toBe(score);
      expect(r.tags).toEqual(tags);
      expect(acc).toContain(r.best);
    });
  }
});

describe('answer: детали', () => {
  it('wrong несёт теги шага, остальное — свои', () => {
    expect(checkAnswer('kawa', ['herbata'], {}, ['R4', 'gr.case']).tags).toEqual(['R4', 'gr.case']);
    expect(checkAnswer('gura', ['góra'], {}, ['R4']).tags).toEqual(R10('o_u'));
  });

  it('best — вариант, давший лучший результат', () => {
    expect(checkAnswer('dzieki', ['dziękuję', 'dzięki']).best).toBe('dzięki');
    expect(checkAnswer('cokolwiek', ['a', 'b']).best).toBe('a');
  });

  it('norm и stripDia как в тренажёре', () => {
    expect(norm('  Dzień   dobry.  ')).toBe('dzień dobry');
    expect(norm(undefined)).toBe('');
    expect(norm('¿Co?')).toBe('co');
    expect(stripDia('ąćęłńóśźż')).toBe('acelnoszz');
    expect(ortho('rzeka chór')).toBe('żeka hur');
    expect(matches('Dzien dobry!', 'Dzień dobry')).toBe(true);
    expect(matches('gura', 'góra')).toBe(false);
  });

  it('levenshtein', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('przeprasam', 'przepraszam')).toBe(1);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
});
