// Словарь короткой версии «Wola» (W-01, ../ВОЛЯ.md решение 9): content/wola/vocab.json из словаря главы 1
// (content/modules/ch01/vocab.json, 80 слов) и старого тренажёра (`Изучение польского/app/data/vocab.js`,
// 274 карточки: [день, pl, ru, tr, пример PL, пример RU]).
//
//   npx tsx tools/build_wola_vocab.ts [--trainer <путь к vocab.js>] [--check]
//
// Что делает: NFC и trim всех строк; дубли по нормализованному pl (регистр, «?!.…» в конце) склеивает — слово
// главы 1 главнее (его id, tr с ударением, кластеры), пример берётся у тренажёра, если своего нет; имена и
// служебные слова главы 1 для фонетики (Warszawa, prosię, ci…) не берёт; раскладывает по темам (tags[0] = id темы);
// задаёт порядок дневных порций: порядок массива `vocab` = порядок порций (сначала приветствия и «выживание»
// в Варшаве, дальше темы по кругу в порядке дней тренажёра). Тема `jedzenie` (еда и заказ) — для Salad Story (W-02):
// у темы `place: "salad"`, дома её нет. id слов стабильны: `lx.<slug>` из pl; уже выданный id не меняется
// (сверка с текущим content/wola/vocab.json: id прошлой версии по тому же pl сохраняется).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { isMain, ROOT } from './lib/files';
import type { VocabEntry, WolaTheme, WolaVocab } from '../src/types/content';

export type { WolaTheme };
/** Файл content/wola/vocab.json (схема content/schema/wola.schema.json). */
export type WolaVocabFile = WolaVocab;

export const OUT = join(ROOT, 'content', 'wola', 'vocab.json');
const CH01 = join(ROOT, 'content', 'modules', 'ch01', 'vocab.json');
const TRAINER_DEFAULT = join(ROOT, '..', '..', 'Изучение польского', 'app', 'data', 'vocab.js');

export const THEMES: [WolaTheme, ...WolaTheme[]] = [
  { id: 'powitania', pl: 'Powitania', ru: 'приветствия и вежливость' },
  { id: 'rozmowa', pl: 'Rozmowa', ru: 'фразы для разговора' },
  { id: 'ludzie', pl: 'Ludzie', ru: 'я и люди' },
  { id: 'miasto', pl: 'Miasto', ru: 'город и транспорт' },
  { id: 'liczby', pl: 'Liczby', ru: 'числа' },
  { id: 'zakupy', pl: 'Zakupy', ru: 'магазин и деньги' },
  { id: 'czas', pl: 'Czas', ru: 'время и дни' },
  { id: 'czasowniki', pl: 'Czasowniki', ru: 'глаголы и просьбы' },
  { id: 'dom', pl: 'Dom', ru: 'дом и услуги' },
  { id: 'praca', pl: 'Praca', ru: 'работа и документы' },
  { id: 'zdrowie', pl: 'Zdrowie', ru: 'здоровье и аптека' },
  { id: 'wolny', pl: 'Czas wolny', ru: 'досуг и погода' },
  { id: 'jedzenie', pl: 'Jedzenie', ru: 'еда и заказ (Salad Story)', place: 'salad' },
];

/** Тема по дню тренажёра. */
const DAY_THEME: Record<number, string> = {
  1: 'powitania', 2: 'liczby', 3: 'zakupy', 4: 'ludzie', 5: 'czasowniki', 6: 'miasto', 7: 'czas',
  8: 'miasto', 9: 'zdrowie', 10: 'praca', 11: 'jedzenie', 12: 'dom', 13: 'wolny', 14: 'rozmowa',
};

/** Тема по ключу pl (нормализованному), когда день тренажёра не подходит. */
const PL_THEME: Record<string, string> = {
  kawa: 'jedzenie', herbata: 'jedzenie', woda: 'jedzenie', 'poproszę': 'jedzenie', 'na wynos': 'jedzenie', 'coś jeszcze': 'jedzenie',
  'złoty': 'zakupy', 'ile to kosztuje': 'zakupy', 'płacę kartą': 'zakupy',
  chleb: 'jedzenie', mleko: 'jedzenie', 'masło': 'jedzenie', ser: 'jedzenie', jajka: 'jedzenie', owoce: 'jedzenie',
  warzywa: 'jedzenie', 'jabłko': 'jedzenie', pomidor: 'jedzenie',
  'czy mogę prosić o': 'rozmowa', 'dla mnie': 'jedzenie', bez: 'jedzenie',
  'dzisiaj': 'czas', jutro: 'czas', 'oczywiście': 'rozmowa', 'nie rozumiem': 'powitania',
};

/** Слова главы 1: тема или null — не брать (имена, однокоренные с русским, служебные слова для фонетики). */
const CH01_THEME: Record<string, string | null> = {
  'lx.maly': 'zakupy', 'lx.slucham': 'jedzenie', 'lx.stol': 'dom', 'lx.wyjscie': 'miasto', 'lx.woda': 'jedzenie',
  'lx.kawa': 'jedzenie', 'lx.telefon': null, 'lx.teatr': null, 'lx.problem': null, 'lx.warszawa': null,
  'lx.herbata': 'jedzenie', 'lx.chleb': 'jedzenie', 'lx.ile': 'zakupy', 'lx.cena': 'zakupy', 'lx.krakow': null,
  'lx.my': 'ludzie', 'lx.mi': null, 'lx.lazienka': 'dom', 'lx.mleko': 'jedzenie', 'lx.przepraszam': 'powitania',
  'lx.czas': 'czas', 'lx.moze': 'rozmowa', 'lx.krzeslo': 'dom', 'lx.rzeka': 'wolny', 'lx.trzy': 'liczby',
  'lx.czy_q': 'rozmowa', 'lx.czesc': 'powitania', 'lx.dzien_dobry': 'powitania', 'lx.dzien': 'czas',
  'lx.ciasto': 'jedzenie', 'lx.siedem': 'liczby', 'lx.sroda': 'czas', 'lx.nic': 'rozmowa', 'lx.wejscie': 'miasto',
  'lx.dworzec': 'miasto', 'lx.kasa': 'zakupy', 'lx.toaleta': 'miasto', 'lx.peron': 'miasto', 'lx.informacja': 'miasto',
  'lx.centrum': null, 'lx.kasza': 'jedzenie', 'lx.kasia': null, 'lx.prosie': null, 'lx.ci': null,
  'lx.dziekuje': 'powitania', 'lx.prosze': 'powitania', 'lx.reka': 'zdrowie', 'lx.piatek': 'czas', 'lx.sa': null,
  'lx.zab': 'zdrowie', 'lx.nie': 'powitania', 'lx.miasto': 'miasto', 'lx.pies': 'ludzie', 'lx.siostra': 'ludzie',
  'lx.przystanek': 'miasto', 'lx.wszystko': 'rozmowa', 'lx.twoj': 'ludzie', 'lx.swietokrzyska': null, 'lx.gora': 'wolny',
  'lx.zona': 'ludzie', 'lx.moj': 'ludzie', 'lx.morze': 'wolny', 'lx.otwarte': 'miasto', 'lx.zamkniete': 'miasto',
  'lx.sklep': 'zakupy', 'lx.pchac': 'miasto', 'lx.ciagnac': 'miasto', 'lx.apteka': 'zdrowie', 'lx.piekarnia': 'zakupy',
  'lx.ulica': 'miasto', 'lx.plac': 'miasto', 'lx.rondo': 'miasto', 'lx.zabka': 'zakupy', 'lx.imie': 'ludzie',
  'lx.nazwisko': 'ludzie', 'lx.jak_to_sie_pisze': 'rozmowa', 'lx.prosze_przeliterowac': 'rozmowa',
  'lx.nie_rozumiem': 'powitania', 'lx.prosze_powtorzyc': 'rozmowa', 'lx.prosze_wolniej': 'rozmowa', 'lx.co_to_znaczy': 'rozmowa',
};

/**
 * Первые порции (по 5): то, что нужно в Варшаве с первого дня. Ключи — нормализованный pl.
 * Остальное идёт после по кругу тем (в порядке дней тренажёра).
 */
export const PRIORITY: string[] = [
  'dzień dobry', 'cześć', 'dziękuję', 'proszę', 'przepraszam',
  'tak', 'nie', 'nie rozumiem', 'do widzenia', 'dobry wieczór',
  'proszę powtórzyć', 'proszę wolniej', 'co to znaczy', 'nie mówię po polsku', 'mam na imię',
  'ja', 'jestem', 'pan', 'pani', 'miło mi',
  'gdzie', 'gdzie jest…', 'ulica', 'przystanek', 'tramwaj',
  'metro', 'bilet', 'wejście', 'wyjście', 'prosto',
  'lewo', 'prawo', 'tu / tutaj', 'tam', 'blisko',
  'jeden', 'dwa', 'trzy', 'ile to kosztuje', 'płacę kartą',
  'sklep', 'żabka', 'apteka', 'paragon', 'to wszystko',
  'dzisiaj', 'jutro', 'teraz', 'godzina', 'która godzina',
];

/** Правки примеров тренажёра (ошибки в польском). Ключ — нормализованный pl. */
const FIXES: Record<string, Partial<{ ex: { pl: string; ru: string }; ru: string }>> = {
  dwa: { ex: { pl: 'Dwie kawy, proszę.', ru: 'Два кофе, пожалуйста.' } },
};

/** id вручную, где slug совпал бы у разных слов (gotówką / gotówka). */
const ID_OVERRIDE: Record<string, string> = { 'gotówką': 'lx.gotowka_narz' };

const NUM = new Set(['jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć', 'sto']);
const ADV = new Set(['tu / tutaj', 'tam', 'lewo', 'prawo', 'prosto', 'blisko', 'daleko', 'dzisiaj', 'jutro', 'wczoraj', 'teraz', 'rano', 'dobrze', 'źle', 'trochę', 'bardzo', 'też', 'pojutrze', 'zimno', 'ciepło', 'gorąco', 'oczywiście', 'gotówką']);
const ADJ = new Set(['duży', 'mały', 'następny', 'zepsuty', 'pyszne']);
const PRON = new Set(['ja', 'ty', 'on', 'ona', 'my', 'to', 'kto', 'co', 'gdzie', 'jak', 'pan', 'pani']);
const PREP = new Set(['bez']);

const nfc = (s: string): string => s.normalize('NFC').trim();
/** Ключ дубля: регистр, «?!.…» в конце, лишние пробелы. */
export const plKey = (pl: string): string => nfc(pl).toLowerCase().replace(/[?!.]+$/u, '').replace(/\s+/g, ' ').trim();

const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
export function slug(pl: string): string {
  const s = plKey(pl).replace(/[ąćęłńóśźż]/g, (c) => FOLD[c] ?? c).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `lx.${s || 'x'}`;
}

type TrainerRow = [number, string, string, string, string, string];

export function readTrainer(path: string): TrainerRow[] {
  const src = readFileSync(path, 'utf8');
  const rows = runInNewContext(`${src}\n;VOCAB`, {}, { timeout: 1000 }) as unknown;
  if (!Array.isArray(rows)) throw new Error(`${path}: нет массива VOCAB`);
  return rows as TrainerRow[];
}

function posOf(day: number, key: string): VocabEntry['pos'] {
  if (NUM.has(key)) return 'num';
  if (PRON.has(key)) return 'pron';
  if (ADV.has(key)) return 'adv';
  if (ADJ.has(key)) return 'adj';
  if (PREP.has(key)) return 'prep';
  if (key.includes(' ') || key.includes('…') || /[?]$/.test(key)) return 'phrase';
  if (day === 5 || /(ć|ąć)$/.test(key)) return 'verb';
  return 'noun';
}

export interface BuildInput {
  ch01: VocabEntry[];
  trainer: TrainerRow[];
  /** Прошлая версия файла: id слов не меняются. */
  prev?: WolaVocabFile | null;
}

export function buildWolaVocab({ ch01, trainer, prev }: BuildInput): WolaVocabFile {
  const prevId = new Map<string, string>();
  for (const v of prev?.vocab ?? []) prevId.set(plKey(v.pl), v.id);
  const byKey = new Map<string, VocabEntry & { _day: number; _ord: number }>();
  const used = new Set<string>();
  let ord = 0;

  for (const v of ch01) {
    const theme = CH01_THEME[v.id];
    if (theme === undefined) throw new Error(`build_wola_vocab: слова главы 1 ${v.id} нет в CH01_THEME — реши, в какую тему`);
    if (theme === null) continue;
    const key = plKey(v.pl);
    const { cards: _c, legacy: _l, voice: _v, ...rest } = v;
    const e = { ...rest, pl: nfc(v.pl), ru: nfc(v.ru), srs: true, tags: [theme], _day: 0, _ord: ord++ };
    if (v.tr) e.tr = nfc(v.tr);
    byKey.set(key, e);
    used.add(v.id);
  }

  for (const [day, plRaw, ruRaw, trRaw, exPl, exRu] of trainer) {
    const pl = nfc(plRaw);
    const key = plKey(pl);
    const fix = FIXES[key] ?? {};
    const ex = fix.ex ?? (exPl && exRu ? { pl: nfc(exPl), ru: nfc(exRu) } : undefined);
    const have = byKey.get(key);
    if (have) {
      // Дубль: слово уже есть (из главы 1 или с раннего дня тренажёра). Добавляем пример и tr, если их нет.
      if (!have.ex && ex) have.ex = ex;
      if (!have.tr && trRaw) have.tr = nfc(trRaw);
      if (have._day === 0 && !have._ord) have._day = day;
      continue;
    }
    const theme = PL_THEME[key] ?? DAY_THEME[day];
    if (!theme) throw new Error(`build_wola_vocab: нет темы для дня ${day}`);
    let id = prevId.get(key) ?? ID_OVERRIDE[key] ?? slug(pl);
    for (let n = 2; used.has(id) && !prevId.has(key); n++) id = `${slug(pl)}_${n}`;
    used.add(id);
    const e: VocabEntry & { _day: number; _ord: number } = {
      id,
      pl,
      ru: nfc(fix.ru ?? ruRaw),
      tr: nfc(trRaw),
      pos: posOf(day, key),
      srs: true,
      ...(ex ? { ex } : {}),
      tags: [theme],
      _day: day,
      _ord: ord++,
    };
    byKey.set(key, e);
  }
  // Прошлые id по pl: слово главы 1 сохраняет свой id всегда, слова тренажёра — id прошлой версии.
  for (const [key, e] of byKey) {
    const was = prevId.get(key);
    if (was && was !== e.id && !ch01.some((v) => v.id === e.id)) e.id = was;
  }

  const salad = new Set(THEMES.filter((t) => t.place).map((t) => t.id));
  const all = [...byKey.entries()];
  const head: string[] = [];
  for (const k of PRIORITY) {
    const e = byKey.get(k);
    if (!e) throw new Error(`build_wola_vocab: слова приоритета "${k}" нет в словарях`);
    if (salad.has(e.tags![0]!)) throw new Error(`build_wola_vocab: "${k}" в теме ${e.tags![0]} (Salad Story), не в дневных порциях`);
    head.push(k);
  }
  const headSet = new Set(head);
  // Остальное: по темам в порядке THEMES, внутри темы — день тренажёра (слова главы 1 без дня — по смыслу темы, в начале),
  // затем круг по темам: из каждой по слову. Так порции смешанные, а не «20 слов про аптеку подряд».
  const rest = new Map<string, string[]>();
  for (const t of THEMES) if (!t.place) rest.set(t.id, []);
  const sorted = all.filter(([k, e]) => !headSet.has(k) && !salad.has(e.tags![0]!)).sort(([, a], [, b]) => a._day - b._day || a._ord - b._ord);
  for (const [k, e] of sorted) rest.get(e.tags![0]!)!.push(k);
  const tail: string[] = [];
  for (let more = true; more; ) {
    more = false;
    for (const list of rest.values()) {
      const k = list.shift();
      if (k) {
        tail.push(k);
        more = true;
      }
    }
  }
  const food = all.filter(([, e]) => salad.has(e.tags![0]!)).sort(([, a], [, b]) => a._day - b._day || a._ord - b._ord).map(([k]) => k);
  const order = [...head, ...tail, ...food];

  const vocab = order.map((k) => {
    const { _day, _ord, ...e } = byKey.get(k)!;
    // Поля в порядке схемы — дифф читается.
    const out: VocabEntry = { id: e.id, pl: e.pl, ru: e.ru, ...(e.tr ? { tr: e.tr } : {}), pos: e.pos, srs: true };
    if (e.gender) out.gender = e.gender;
    if (e.forms) out.forms = e.forms;
    if (e.ex) out.ex = e.ex;
    if (e.ff) out.ff = e.ff;
    if (e.clusters) out.clusters = e.clusters;
    out.tags = e.tags!;
    return out;
  });
  return {
    schema: 1,
    note: 'Собран tools/build_wola_vocab.ts из content/modules/ch01/vocab.json и старого тренажёра. Руками не править: правь словари-источники или таблицы в скрипте и пересобери. Порядок vocab = порядок дневных порций (темы с place — не дома). tags[0] = тема.',
    themes: THEMES,
    vocab,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (isMain(import.meta.url)) {
  const trainerPath = resolve(arg('--trainer') ?? process.env.PQ_TRAINER_VOCAB ?? TRAINER_DEFAULT);
  if (!existsSync(trainerPath)) {
    console.error(`build_wola_vocab: нет словаря тренажёра ${trainerPath} (укажи --trainer <путь к vocab.js>)`);
    process.exit(1);
  }
  const prev = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as WolaVocabFile) : null;
  const file = buildWolaVocab({ ch01: JSON.parse(readFileSync(CH01, 'utf8')) as VocabEntry[], trainer: readTrainer(trainerPath), prev });
  const text = `${JSON.stringify(file, null, 1)}\n`;
  if (process.argv.includes('--check')) {
    const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === text;
    console.log(same ? 'build_wola_vocab: ok' : 'build_wola_vocab: content/wola/vocab.json устарел');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  const home = file.vocab.filter((v) => !THEMES.find((t) => t.id === v.tags?.[0])?.place).length;
  console.log(`build_wola_vocab: ${file.vocab.length} слов (дома ${home}, Salad Story ${file.vocab.length - home}), тем ${file.themes.length} → content/wola/vocab.json`);
}
