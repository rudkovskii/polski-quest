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

/**
 * Salad Story (W-02, research/12_salad_story.md §5, §6.4): слова лестницы уровней, тема `jedzenie`, по уровням 1–10.
 * Карточки: `rec` у всех, `lis` у того, что говорит кассир, `pro` у того, что говорит Дима. Слова главы 1 и тренажёра
 * (woda, Poproszę, ser, sok, na miejscu, na wynos, jajka, pomidor, Smacznego!, Może być, Zgadza się…) не дублируются: их id берёт меню.
 */
type SaladWord = Omit<VocabEntry, 'srs' | 'tags'>;
const W = (id: string, pl: string, ru: string, tr: string, pos: VocabEntry['pos'], more: Partial<SaladWord> = {}): SaladWord => ({ id, pl, ru, tr, pos, ...more });
const SAY: VocabEntry['cards'] = ['rec', 'lis'];
const ANSWER: VocabEntry['cards'] = ['rec', 'pro'];
export const SALAD_WORDS: SaladWord[] = [
  // 1. Witryna
  W('lx.salatka', 'sałatka', 'салат', 'саўа́тка', 'noun', { gender: 'f', forms: { acc: 'sałatkę' }, ex: { pl: 'Poproszę sałatkę Cezar.', ru: 'Салат «Цезарь», пожалуйста.' } }),
  W('lx.kurczak', 'kurczak', 'курица', 'ку́рчак', 'noun', { gender: 'm' }),
  W('lx.losos', 'łosoś', 'лосось', 'ўо́сощ', 'noun', { gender: 'm', forms: { gen: 'łososia' } }),
  W('lx.awokado', 'awokado', 'авокадо', 'авока́до', 'noun', { gender: 'n' }),
  W('lx.ogorek', 'ogórek', 'огурец', 'огу́рэк', 'noun', { gender: 'm' }),
  // 2. Poproszę sałatkę
  W('lx.co_podac', 'Co podać?', 'Что подать? (что вам?)', 'цо по́дачь', 'phrase', { cards: SAY }),
  // 3. Rozmiar
  W('lx.normalna', 'normalna', 'обычная (порция)', 'норма́льна', 'adj', { forms: { acc: 'normalną' } }),
  W('lx.powiekszona', 'powiększona', 'увеличенная (порция)', 'повьенкшо́на', 'adj', { forms: { acc: 'powiększoną' } }),
  W('lx.porcja', 'porcja', 'порция', 'по́рцъя', 'noun', { gender: 'f', cards: SAY }),
  // 4. Dressing
  W('lx.dressing', 'dressing', 'заправка (соус к салату)', 'дрэ́синк', 'noun', { gender: 'm', cards: SAY }),
  W('lx.sos', 'sos', 'соус', 'сос', 'noun', { gender: 'm' }),
  W('lx.jaki_dressing', 'Jaki dressing?', 'Какую заправку?', 'я́ки дрэ́синк', 'phrase', { cards: SAY }),
  W('lx.jogurtowy', 'jogurtowy', 'йогуртовый', 'йогурто́вы', 'adj'),
  W('lx.fistaszkowy', 'fistaszkowy', 'арахисовый', 'фисташко́вы', 'adj'),
  W('lx.musztardowo_miodowy', 'musztardowo-miodowy', 'медово-горчичный', 'муштардо́во-мьодо́вы', 'adj', { cards: SAY }),
  W('lx.osobno', 'osobno', 'отдельно', 'осо́бно', 'adv'),
  W('lx.wymieszac', 'wymieszać', 'перемешать', 'вымье́шачь', 'verb'),
  // 5. Do tego?
  W('lx.do_tego', 'Do tego?', 'К этому? (что-то к этому?)', 'до тэ́го', 'phrase', { cards: SAY }),
  W('lx.paluch', 'paluch', 'хлебная палочка', 'па́лух', 'noun', { gender: 'm' }),
  W('lx.buraczkowy', 'buraczkowy', 'свекольный', 'бурачко́вы', 'adj'),
  W('lx.z_ziarnami', 'z ziarnami', 'с семенами', 'з жьярна́ми', 'phrase'),
  W('lx.cos_do_picia', 'Coś do picia?', 'Что-нибудь попить?', 'цощ до пи́чя', 'phrase', { cards: SAY }),
  W('lx.nie_dziekuje', 'Nie, dziękuję.', 'Нет, спасибо.', 'нье, джьенку́йэ', 'phrase', { cards: ANSWER }),
  // 6. Piszę sam
  W('lx.chcialbym', 'Chciałbym…', 'Я хотел бы…', 'хьчя́ўбым', 'phrase', { cards: ANSWER }),
  W('lx.tunczyk', 'tuńczyk', 'тунец', 'ту́ньчык', 'noun', { gender: 'm' }),
  W('lx.mango', 'mango', 'манго', 'ма́нго', 'noun', { gender: 'n', cards: SAY }),
  W('lx.tofu', 'tofu', 'тофу', 'то́фу', 'noun', { gender: 'n', cards: SAY }),
  W('lx.wolowina', 'wołowina', 'говядина', 'воўови́на', 'noun', { gender: 'f' }),
  // 7. Bez bekonu + kartka
  W('lx.ze_wszystkim', 'Ze wszystkim?', 'Со всем?', 'зэ фшы́стким', 'phrase', { cards: SAY }),
  W('lx.bekon', 'bekon', 'бекон', 'бэ́кон', 'noun', { gender: 'm', forms: { gen: 'bekonu' } }),
  W('lx.grzanki', 'grzanki', 'гренки', 'гжа́нки', 'noun', { gender: 'nmp', forms: { gen: 'grzanek' } }),
  W('lx.bez_bekonu', 'bez bekonu', 'без бекона', 'бэз бэко́ну', 'phrase', { cards: ANSWER }),
  W('lx.bez_grzanek', 'bez grzanek', 'без гренок', 'бэз гжа́нэк', 'phrase', { cards: ANSWER }),
  W('lx.bez_cebuli', 'bez cebuli', 'без лука', 'бэз цэбу́ли', 'phrase', { cards: ANSWER }),
  W('lx.dla_kolegi', 'dla kolegi', 'для коллеги', 'дла колэ́ги', 'phrase', { cards: ANSWER }),
  W('lx.nie_tylko', 'nie …, tylko …', 'не …, а …', 'нье …, ты́лько', 'phrase', { cards: ANSWER }),
  // 8. Stwórz własną
  W('lx.stworz_wlasna', 'Stwórz własną', 'Собери свой (салат)', 'стфуж вўа́сноў', 'phrase', { cards: SAY }),
  W('lx.jaka_baza', 'Jaka baza?', 'Какая основа?', 'я́ка ба́за', 'phrase', { cards: SAY }),
  W('lx.mix_salat', 'mix sałat', 'микс салатов', 'микс са́ўат', 'phrase'),
  W('lx.szpinak', 'szpinak', 'шпинат', 'шпи́нак', 'noun', { gender: 'm' }),
  W('lx.rukola', 'rukola', 'руккола', 'руко́ла', 'noun', { gender: 'f' }),
  W('lx.jakie_bialko', 'Jakie białko?', 'Какой белок?', 'я́кье бья́ўко', 'phrase', { cards: SAY }),
  W('lx.dodatki', 'dodatki', 'добавки', 'дода́тки', 'noun', { gender: 'nmp', cards: SAY }),
  W('lx.ziemniaki', 'ziemniaki pieczone', 'печёный картофель', 'жьемня́ки пьечо́нэ', 'phrase'),
  W('lx.niestety_nie_ma', 'Niestety, nie ma…', 'К сожалению, нет…', 'ньесьтэ́ты, нье ма', 'phrase', { cards: SAY }),
  W('lx.to_poprosze', 'To poproszę…', 'Тогда дайте…', 'то попро́шэ', 'phrase', { cards: ANSWER }),
  // 9. Kasa
  W('lx.ma_pan_aplikacje', 'Ma pan aplikację?', 'У вас есть приложение?', 'ма пан аплика́цъйэ', 'phrase', { cards: SAY }),
  W('lx.zeskanowac_kod', 'Proszę zeskanować kod.', 'Отсканируйте код.', 'про́шэ зэскано́вачь кот', 'phrase', { cards: SAY }),
  W('lx.razem', 'razem', 'итого; вместе', 'ра́зэм', 'adv', { cards: SAY }),
  W('lx.karta_narz', 'kartą', 'картой', 'ка́ртоў', 'phrase'),
  W('lx.blikiem', 'BLIKiem', 'через BLIK (с телефона)', 'бли́кьем', 'phrase', { cards: ANSWER }),
  W('lx.przylozyc', 'Proszę przyłożyć.', 'Прикладывайте (карту).', 'про́шэ пшыўо́жычь', 'phrase', { cards: SAY }),
  W('lx.zlote', 'złote', 'злотых (после 2, 3, 4)', 'зўо́тэ', 'noun', { cards: SAY }),
  W('lx.zlotych', 'złotych', 'злотых (после 5–21, 25…)', 'зўо́тых', 'noun', { cards: SAY }),
  W('lx.dwadziescia', 'dwadzieścia', 'двадцать', 'двадже́щчя', 'num', { cards: SAY }),
  W('lx.trzydziesci', 'trzydzieści', 'тридцать', 'тшыдже́щчи', 'num', { cards: SAY }),
  W('lx.czterdziesci', 'czterdzieści', 'сорок', 'чтэрдже́щчи', 'num', { cards: SAY }),
  W('lx.piecdziesiat', 'pięćdziesiąt', 'пятьдесят', 'пеньчдже́щёнт', 'num', { cards: SAY }),
  // 10. Pora lunchu
  W('lx.to_co_zwykle', 'To co zwykle?', 'Как обычно?', 'то цо зві́клэ', 'phrase', { cards: SAY }),
  W('lx.dynia', 'dynia', 'тыква', 'ды́нья', 'noun', { gender: 'f', ff: { ru: 'дыня', means: 'тыква' } }),
  W('lx.na_nip', 'Na NIP?', 'На фирму (чек с NIP)?', 'на нип', 'phrase', { cards: SAY }),
];

/** Формы слов главы 1 и тренажёра, нужные Salad Story (винительный после poproszę). */
const SALAD_FORMS: Record<string, Record<string, string>> = { 'lx.woda': { acc: 'wodę' } };

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
  // Salad Story (W-02): слова лестницы уровней — в конце, в порядке уровней. Дубль по pl или id — ошибка таблицы.
  const saladTheme = THEMES.find((t) => t.place === 'salad')!.id;
  for (const w of SALAD_WORDS) {
    const key = plKey(w.pl);
    const have = byKey.get(key);
    // То же слово уже пришло из словарей с тем же id (тренажёр с прошлой версии) — таблица Salad Story главнее.
    if (have && have.id !== w.id) throw new Error(`build_wola_vocab: слово Salad Story "${w.pl}" уже есть в словарях (${have.id}) — бери его id`);
    if (!have && [...byKey.values()].some((e) => e.id === w.id)) throw new Error(`build_wola_vocab: id ${w.id} уже занят`);
    byKey.set(key, { ...w, ...(!w.ex && have?.ex ? { ex: have.ex } : {}), srs: true, tags: [saladTheme], _day: 99, _ord: ord++ });
    const at = food.indexOf(key);
    if (at >= 0) food.splice(at, 1);
    food.push(key);
  }
  for (const [id, forms] of Object.entries(SALAD_FORMS)) {
    const e = [...byKey.values()].find((x) => x.id === id);
    if (!e) throw new Error(`build_wola_vocab: SALAD_FORMS: нет слова ${id}`);
    e.forms = { ...e.forms, ...forms };
  }
  const order = [...head, ...tail, ...food];

  const vocab = order.map((k) => {
    const { _day, _ord, ...e } = byKey.get(k)!;
    // Поля в порядке схемы — дифф читается.
    const out: VocabEntry = { id: e.id, pl: e.pl, ru: e.ru, ...(e.tr ? { tr: e.tr } : {}), pos: e.pos, srs: true };
    if (e.cards) out.cards = e.cards;
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
