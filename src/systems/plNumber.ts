// Числа и цены по-польски (W-02, research/12_salad_story.md §4.2, уровень 9 Salad Story). Чисто, без рантайма.
//   plNumber(37) → «trzydzieści siedem»; zlotyForm(n) → złoty / złote / złotych; plPrice(37, 20) → полная форма
//   «trzydzieści siedem złotych dwadzieścia groszy» или кассовая «trzydzieści siedem dwadzieścia» (style: 'kasa').

const UNITS = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];

/** Количественное числительное 0–999 (именительный, мужской род: «dwa złote», «jeden złoty»). */
export function plNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new RangeError(`plNumber: ${n} вне 0–999`);
  if (n < 10) return UNITS[n]!;
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]!);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]!);
  else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) parts.push(TENS[t]!);
    if (u) parts.push(UNITS[u]!);
  }
  return parts.join(' ');
}

export type PlForm = 'one' | 'few' | 'many';

/** Форма существительного после числа: 1 → one; 2–4, 22–24, 32–34… (кроме 12–14) → few; остальное → many. */
export function plForm(n: number): PlForm {
  if (n === 1) return 'one';
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
  return 'many';
}

const ZLOTY: Record<PlForm, string> = { one: 'złoty', few: 'złote', many: 'złotych' };
const GROSZ: Record<PlForm, string> = { one: 'grosz', few: 'grosze', many: 'groszy' };

export const zlotyForm = (n: number): string => ZLOTY[plForm(n)];
export const groszForm = (n: number): string => GROSZ[plForm(n)];

/**
 * Сумма словами. `full`: «czterdzieści trzy złote», с грошами — «… złote dwadzieścia groszy».
 * `kasa` (как говорят на кассе): гроши без слов «złotych/groszy» — «trzydzieści siedem dwadzieścia»; без грошей — как full.
 */
export function plPrice(zl: number, gr = 0, style: 'full' | 'kasa' = 'full'): string {
  if (!Number.isInteger(gr) || gr < 0 || gr > 99) throw new RangeError(`plPrice: гроши ${gr} вне 0–99`);
  const z = `${plNumber(zl)} ${zlotyForm(zl)}`;
  if (!gr) return z;
  return style === 'kasa' ? `${plNumber(zl)} ${plNumber(gr)}` : `${z} ${plNumber(gr)} ${groszForm(gr)}`;
}

/** Цифрами для табло: «43 zł», «37,20 zł». */
export function priceDigits(zl: number, gr = 0): string {
  return gr ? `${zl},${String(gr).padStart(2, '0')} zł` : `${zl} zł`;
}

/**
 * Ловушки на слух (research §4.2, тег ph.teen_ty): -naście ↔ -dzieści (14 / 40), перестановка цифр (37 / 73),
 * соседний десяток. Возвращает до `n` разных сумм, не равных `zl`, в пределах 1–99.
 */
export function priceTraps(zl: number, n = 3): number[] {
  const out: number[] = [];
  const add = (x: number): void => {
    if (x >= 1 && x <= 99 && x !== zl && !out.includes(x)) out.push(x);
  };
  const t = Math.floor(zl / 10);
  const u = zl % 10;
  if (u === 0 && t >= 2) add(10 + t); // 40 → 14
  if (zl >= 13 && zl <= 19) add((zl - 10) * 10); // 14 → 40
  if (u && t) add(u * 10 + t); // 37 → 73
  if (t >= 2 && t <= 9 && u >= 3 && u <= 9) add(10 + u); // 43 → 13 (trzy-naście)
  add(zl + 10);
  add(zl - 10);
  add(zl + 1);
  return out.slice(0, n);
}
