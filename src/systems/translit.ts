// @ts-nocheck: порт сверен с ../a1/src/translit.py (data/rupl/check_translit.py, 0 расхождений); строгие индексы не правим, чтобы не сдвинуть логику.
// Польский -> кириллица по правилам §3.0. Порт ../a1/src/translit.py, логика та же (1:1).
// Проверка совпадения с Python: python3 -I check_translit.py (0 расхождений на базе A1).
// Без зависимостей, без DOM: работает в браузере, Node (>=22.6 --experimental-strip-types, в 24 из коробки), Deno, Bun.

type Tok = [typ: string, val: string, flag: boolean]; // typ: C согласная, V гласная, J j-перед-гласной, X съедена
type Item = [text: string, isVowel: boolean];

const ACUTE = '́';
const VOW = 'aeiouyóąę';
// ударение не на предпоследнем слоге: слово -> слог с конца (3 = третий с конца)
const STRESS: Record<string, number> = {
  matematyka: 3, gramatyka: 3, muzyka: 3, fizyka: 3, polityka: 3, informatyka: 3,
  gimnastyka: 3, Ameryka: 3, statystyka: 3, technika: 3, klasyka: 3,
};
const OVERRIDE: Record<string, string> = {
  'pięćdziesiąt': 'пеньдже́щонт',
  'weekend': 'уи́кэнт', 'mail': 'мэйл', 'hobby': 'хо́бы', 'pizza': 'пи́цца', 'kiosk': 'кьоск',
};
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const VOICED: Record<string, string> = {
  b: 'p', d: 't', g: 'k', z: 's', 'ź': 'ś', 'ż': 'sz', dz: 'c', 'dź': 'ć', 'dż': 'cz', w: 'f', rz: 'sz',
};
// {v: k for k, v in VOICED if k not in ('ż','rz')}, затем sz -> ż
const VOICELESS: Record<string, string> = {};
for (const [k, v] of Object.entries(VOICED)) if (k !== 'ż' && k !== 'rz') VOICELESS[v] = k;
VOICELESS['sz'] = 'ż';
const OBSTR = new Set<string>([...Object.keys(VOICED), ...Object.values(VOICED), 'ch', 'h', 'f', 't', 'k', 'p', 's', 'c', 'sz', 'cz', 'ć', 'ś']);
const NONTRIG = new Set<string>(['w', 'rz']); // звонкие, но не озвончают предыдущий

const isv = (c: string): boolean => c !== '' && VOW.includes(c);

function tokenize(w: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = w.length;
  const pal: Record<string, string> = { c: 'ć', s: 'ś', z: 'ź', n: 'ń' };
  while (i < n) {
    let c = w[i];
    const nxt = i + 1 < n ? w[i + 1] : '';
    const two = w.slice(i, i + 2);
    const three = w.slice(i, i + 3);
    if (three === 'dzi') {
      const j = i + 3;
      if (j < n && isv(w[j])) { toks.push(['C', 'dź', true]); i = j; continue; }
      toks.push(['C', 'dź', true]); toks.push(['V', 'i', false]); i = j; continue;
    }
    if (has(pal, c) && nxt === 'i') {
      const base = pal[c];
      const j = i + 2;
      if (j < n && isv(w[j])) { toks.push(['C', base, true]); i = j; continue; }
      toks.push(['C', base, true]); toks.push(['V', 'i', false]); i = j; continue;
    }
    if (two === 'dź') { toks.push(['C', 'dź', true]); i += 2; continue; }
    if (two === 'dż') { toks.push(['C', 'dż', false]); i += 2; continue; }
    if (two === 'dz') { toks.push(['C', 'dz', false]); i += 2; continue; }
    if (two === 'sz' || two === 'cz' || two === 'ch' || two === 'rz') { toks.push(['C', two, false]); i += 2; continue; }
    if ('ćśźń'.includes(c)) { toks.push(['C', c, true]); i += 1; continue; }
    if (c === 'j') {
      if (nxt && isv(nxt) && nxt !== 'y') { toks.push(['J', 'j', true]); i += 1; continue; }
      toks.push(['C', 'j', false]); i += 1; continue;
    }
    if (c === 'i') {
      // i как мягкий знак после твёрдого согласного перед гласной
      const last = toks.length ? toks[toks.length - 1] : null;
      if (last && last[0] === 'C' && !last[2] && nxt && isv(nxt) && !['sz', 'cz', 'rz', 'ż', 'dż', 'c', 'dz'].includes(last[1])) {
        last[2] = true; i += 1; continue;
      }
      toks.push(['V', 'i', false]); i += 1; continue;
    }
    if (isv(c)) {
      if (c === 'ó') c = 'u';
      toks.push(['V', c, false]); i += 1; continue;
    }
    if (c === 'h') { toks.push(['C', 'ch', false]); i += 1; continue; }
    if (c === 'q' || c === 'v' || c === 'x') {
      toks.push(['C', ({ q: 'k', v: 'w', x: 'ks' } as Record<string, string>)[c], false]); i += 1; continue;
    }
    toks.push(['C', c, false]); i += 1;
  }
  return toks;
}

function assimilate(toks: Tok[]): Tok[] {
  // s/z перед ć,ś,ź,dź -> ś/ź
  for (let k = 0; k < toks.length - 1; k++) {
    const a = toks[k], b = toks[k + 1];
    if (a[0] === 'C' && b[0] === 'C') {
      if (a[1] === 's' && (b[1] === 'ć' || b[1] === 'ś')) { a[1] = 'ś'; a[2] = true; }
      if (a[1] === 'z' && (b[1] === 'ź' || b[1] === 'dź')) { a[1] = 'ź'; a[2] = true; }
    }
  }
  // конец слова
  if (toks.length && toks[toks.length - 1][0] === 'C' && has(VOICED, toks[toks.length - 1][1])) {
    toks[toks.length - 1][1] = VOICED[toks[toks.length - 1][1]];
  }
  // регрессивная
  for (let k = toks.length - 2; k >= 0; k--) {
    const a = toks[k], b = toks[k + 1];
    if (a[0] !== 'C' || b[0] !== 'C' || !OBSTR.has(a[1])) continue;
    const bv = has(VOICED, b[1]) && !NONTRIG.has(b[1]);
    if (bv && has(VOICELESS, a[1]) && a[1] !== 'ch') {
      a[1] = VOICELESS[a[1]];
    } else if ((has(VOICELESS, b[1]) || b[1] === 'ch') && has(VOICED, a[1])) {
      a[1] = VOICED[a[1]];
    }
  }
  // прогрессивная: w, rz после глухого
  for (let k = 1; k < toks.length; k++) {
    const a = toks[k - 1], b = toks[k];
    if (a[0] === 'C' && b[0] === 'C' && NONTRIG.has(b[1]) &&
        (has(VOICELESS, a[1]) || ['ch', 'sz', 'cz', 'ć', 'ś'].includes(a[1]))) {
      b[1] = VOICED[b[1]];
    }
  }
  return toks;
}

const CONS: Record<string, string> = {
  p: 'п', b: 'б', t: 'т', d: 'д', k: 'к', g: 'г', f: 'ф', w: 'в', s: 'с', z: 'з', c: 'ц', dz: 'дз',
  sz: 'ш', cz: 'ч', 'ż': 'ж', rz: 'ж', 'dż': 'дж', ch: 'х', h: 'х', m: 'м', n: 'н', l: 'л', 'ł': 'ў', r: 'р', j: 'й', ks: 'кс',
};
const SOFT_PRE: Record<string, string> = { 'ć': 'чь', 'ś': 'щ', 'ź': 'жь', 'dź': 'джь', 'ń': 'нь' }; // перед согласной/в конце
const SOFT_V: Record<string, string> = { 'ć': 'ч', 'ś': 'щ', 'ź': 'ж', 'dź': 'дж', 'ń': 'н' };       // перед гласной
const VPLAIN: Record<string, string> = { a: 'а', e: 'э', i: 'и', o: 'о', u: 'у', y: 'ы' };
const VIOT: Record<string, string> = { a: 'я', e: 'е', i: 'и', o: 'ё', u: 'ю', y: 'ы' };
const VAFTER_CH: Record<string, string> = { a: 'а', e: 'е', i: 'и', o: 'о', u: 'у', y: 'ы' };

function lookup(table: Record<string, string>, k: string): string {
  if (!has(table, k)) throw new Error(`KeyError: ${k}`); // как KeyError в Python
  return table[k];
}

function render(toks: Tok[], word: string): Item[] {
  const out: Item[] = [];
  const n = toks.length;
  for (let k = 0; k < n; k++) {
    const t = toks[k];
    const typ = t[0], val = t[1];
    const prev = k > 0 ? toks[k - 1] : null;
    const nxt = k + 1 < n ? toks[k + 1] : null;
    if (typ === 'C') {
      if (has(SOFT_V, val)) {
        let s = nxt !== null && nxt[0] === 'V' ? SOFT_V[val] : SOFT_PRE[val];
        if (val === 'ń' && nxt !== null && nxt[0] === 'V') s = 'н';
        out.push([s, false]);
      } else {
        out.push([lookup(CONS, val), false]);
      }
    } else if (typ === 'J') {
      out.push(['', false]); // йотированную гласную выдаст следующая V
    } else if (typ === 'X') {
      continue;
    } else {
      let kind = 'plain';
      if (prev !== null) {
        if (prev[0] === 'J') kind = 'iot';
        else if (prev[0] === 'C') {
          if (prev[1] === 'ć' || prev[1] === 'ś') kind = 'ch';
          else if (prev[1] === 'ź' || prev[1] === 'dź' || prev[1] === 'ń') kind = 'iot';
          else if (prev[2]) kind = 'iot';
        }
      }
      if ('aeiouy'.includes(val)) {
        // au/eu в начале слова
        if ((val === 'a' || val === 'e') && nxt !== null && nxt[0] === 'V' && nxt[1] === 'u' && k === 0 &&
            (word.slice(0, 2) === 'au' || word.slice(0, 2) === 'eu')) {
          out.push([VPLAIN[val] + 'у', true]); toks[k + 1][0] = 'X'; continue;
        }
        let s: string;
        if (kind === 'iot') s = VIOT[val];
        else if (kind === 'ch') s = VAFTER_CH[val];
        else s = VPLAIN[val];
        if (val === 'e' && prev !== null && prev[0] === 'C' && prev[1] === 'ń') s = 'ье';
        if (val === 'e' && prev !== null && prev[0] === 'C' && prev[1] === 'l') s = 'е';
        out.push([s, true]);
      } else { // ą ę
        let nx = k + 1 < n && toks[k + 1][0] === 'C' ? toks[k + 1][1] : '';
        if (k + 1 < n && toks[k + 1][0] !== 'C') nx = '';
        const final = k + 1 >= n;
        let base = val === 'ą' ? 'о' : 'э';
        if (kind === 'iot') base = val === 'ą' ? 'ё' : 'е';
        if (kind === 'ch') base = val === 'ą' ? 'о' : 'е';
        let nas: string;
        if (final) nas = val === 'ą' ? 'ў' : '';
        else if (nx === 'l' || nx === 'ł') nas = '';
        else if (nx === 'p' || nx === 'b') nas = 'м';
        else if (nx === 'ć' || nx === 'ś' || nx === 'ź' || nx === 'dź') nas = nx !== 'ś' ? 'нь' : 'н';
        else if (['t', 'd', 'c', 'cz', 'dz', 'dż', 'k', 'g'].includes(nx)) nas = 'н';
        else nas = 'ў';
        if (val === 'ą' && final) nas = 'ў';
        out.push([base + nas, true]);
      }
    }
  }
  return out;
}

/** Одно польское слово -> кириллица с ударением. Не-польские символы: слово возвращается как есть. */
export function translitWord(word: string): string {
  const w = word.toLowerCase();
  if (/[^a-ząćęłńóśźż-]/.test(w)) return word;
  if (w === '-' || w === '') return word;
  const toks = assimilate(tokenize(w));
  const items = render(toks, w);
  const nuclei: number[] = [];
  items.forEach((it, i) => { if (it[1]) nuclei.push(i); });
  const n = nuclei.length;
  let st = -1;
  const key = has(STRESS, word) ? word : w;
  if (has(OVERRIDE, w)) return OVERRIDE[w];
  let back = has(STRESS, key) ? STRESS[key] : 2;
  if (/(liśmy|liście|łyśmy|łyście)$/.test(w) && n >= 3) back = 3; // как STRESS[w]=3 в Python
  if (n >= 2 && back <= n) st = nuclei[n - back];
  let text = '';
  items.forEach(([s0, ], i) => {
    let s = s0;
    if (i === st) {
      // ударение после первой гласной буквы (кроме ё)
      const m = s.search(/[аэиоуыяеюё]/);
      if (m >= 0 && s[m] !== 'ё') s = s.slice(0, m + 1) + ACUTE + s.slice(m + 1);
    }
    text += s;
  });
  return text.replace(/ьй/g, 'й').normalize('NFC');
}

/** Фраза/строка: слова транскрибируются по одному, знаки и пробелы остаются. Ассимиляции между словами нет. */
export function translit(phrase: string): string {
  const parts = phrase.split(/(\s+|[.,!?…:;()«»"'/–—+-])/);
  return parts.map((p) =>
    p !== undefined && p.trim() !== '' && /^[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+$/.test(p) ? translitWord(p) : p
  ).join('');
}
