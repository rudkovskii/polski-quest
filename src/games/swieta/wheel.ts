// Игра «Święta»: колесо года без DOM. Данные узлов — `swieta.json:wheel` (19 праздников колеса из ПМЖ/Собес/swieta-kolo: тип, справка RU/PL,
// картина и её автор) плюс праздники игры без пары в колесе (значок вместо картины). Узел указывает на единицу игры (`unit`), по которой
// идут вопросы, или `null` (только справка). Позиции — по дню года реального года (`ctx.date()`), Новый год наверху, как в колесе.
import type { PolskaUnit, UnitInfo } from '../../types/polska';
import { dayNo, dayOfYear, daysInYear, nextSpanOfWhen, shortName, spanOfWhen, type Span, type When } from './calendar';

export type HClass = 'state' | 'rel' | 'folk';
export const CLASSES: readonly HClass[] = ['state', 'rel', 'folk'];
/** Тип праздника: подпись и цвет (рамка значка и метка на кольце). */
export const CLASS_INFO: Readonly<Record<HClass, { pl: string; ru: string; color: string }>> = {
  state: { pl: 'Państwowe', ru: 'государственный', color: '#c0452f' },
  rel: { pl: 'Kościelne', ru: 'церковный', color: '#d9a32e' },
  folk: { pl: 'Ludowe', ru: 'народный', color: '#4f9a3c' },
};

export interface Credit {
  author: string;
  license: string;
  page: string;
  title: string;
}

export interface About {
  ru: string;
  pl: string[];
  key: string[];
}

export interface WheelNode {
  id: string;
  /** Единица игры (`hol.*`), по которой идут вопросы; null — только справка. */
  unit: string | null;
  when: When;
  cls: HClass;
  cls2: HClass | null;
  /** Выходной день. */
  off: boolean;
  pl: string;
  ru: string;
  /** Файл картины в `public/swieta/` или null. */
  img: string | null;
  /** Картина про саму единицу игры (false — вопрос «Co to za święto?» по картине не задаём: картина про соседний праздник). */
  pic: boolean;
  credit: Credit | null;
  intro: { ru: string[]; pl: string[] } | null;
  /** «О празднике»: контекст RU (3–4 предложения, `key` — польские слова жирным) и 2–3 простых польских предложения (у каждого своя 🔊). */
  about: About | null;
  phrase: { pl: string; tr: string; ru: string } | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
const asClass = (v: unknown): HClass | null => (v === 'state' || v === 'rel' || v === 'folk' ? v : null);

/** Узлы колеса: из `doc.wheel`, а праздникам игры, не попавшим ни в один узел, достаётся свой (без картины). Порядок — как в данных. */
export function parseWheel(doc: Readonly<Record<string, unknown>>, units: readonly PolskaUnit[]): WheelNode[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: WheelNode[] = [];
  for (const r of Array.isArray(doc.wheel) ? doc.wheel : []) {
    const x = obj(r);
    const id = str(x.id);
    if (!id) continue;
    const unitId = str(x.unit);
    const u = byId.get(unitId);
    const w = obj(x.when);
    const when = (Object.keys(w).length ? w : u ? obj(u.raw.when) : {}) as When;
    const c = obj(x.credit);
    const intro = obj(x.intro);
    const phrase = obj(x.phrase);
    const ab = obj(x.about);
    out.push({
      id,
      unit: u ? u.id : null,
      when,
      cls: asClass(x.class) ?? 'folk',
      cls2: asClass(x.class2),
      off: x.off === true || (x.off === undefined && u?.raw.free === true),
      pl: str(x.pl) || (u ? shortName(u) : id),
      ru: str(x.ru) || (u?.ru ?? ''),
      img: str(x.img) || null,
      pic: x.pic !== false,
      credit: c.author ? { author: str(c.author), license: str(c.license), page: str(c.page), title: str(c.title) } : null,
      intro: strs(intro.ru).length ? { ru: strs(intro.ru), pl: strs(intro.pl) } : null,
      about: str(ab.ru).trim() ? { ru: str(ab.ru), pl: strs(ab.pl), key: strs(ab.key) } : null,
      phrase: phrase.pl ? { pl: str(phrase.pl), tr: str(phrase.tr), ru: str(phrase.ru) } : null,
    });
  }
  const covered = new Set(out.map((n) => n.unit));
  for (const u of units) {
    if (covered.has(u.id)) continue;
    out.push({ id: u.id.replace(/^hol\./, ''), unit: u.id, when: obj(u.raw.when) as When, cls: 'folk', cls2: null, off: u.raw.free === true, pl: shortName(u), ru: u.ru, img: null, pic: false, credit: null, intro: null, about: null, phrase: null });
  }
  return out;
}

// ---------- раскладка ----------

/** Радиусы дорожек для значков в единицах холста (кольцо месяцев снаружи, центр внутри), поперечник значка и запас между значками. */
export const TRACKS: readonly number[] = [72, 57, 42, 27];
export const MARK_UNITS = 17;
const GAP_UNITS = 1.5;

export interface Marker {
  node: WheelNode;
  unit: PolskaUnit | null;
  /** Ближайшее вхождение узла (идёт сегодня или будет позже). */
  span: Span | null;
  /** Угол в градусах от 12 часов по часовой; день года реального года. */
  angle: number;
  doy: number;
  track: number;
  r: number;
  x: number;
  y: number;
  /** Дней до начала; 0 — идёт сегодня. */
  days: number;
}

const rad = (a: number): number => (a * Math.PI) / 180;
const angDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
/** Угол между центрами двух значков на дорожке `t`, при котором они не касаются. */
export const needAngle = (t: number): number => (2 * Math.asin((MARK_UNITS + GAP_UNITS) / (2 * TRACKS[t]!)) * 180) / Math.PI;

export const monthAngle = (y: number, m: number): number => ((dayOfYear(dayNo(y, m, 1)) - 1) / daysInYear(y)) * 360;

export function placeMarkers(nodes: readonly WheelNode[], units: readonly PolskaUnit[], date: { y: number; m: number; d: number }): { placed: Marker[]; undated: WheelNode[] } {
  const byId = new Map(units.map((u) => [u.id, u]));
  const today = dayNo(date.y, date.m, date.d);
  const total = daysInYear(date.y);
  const list: Marker[] = [];
  const undated: WheelNode[] = [];
  for (const node of nodes) {
    const here = spanOfWhen(node.when, date.y);
    if (!here) {
      undated.push(node);
      continue;
    }
    const next = nextSpanOfWhen(node.when, today);
    const doy = dayOfYear(here.start);
    const angle = ((doy - 0.5) / total) * 360;
    list.push({ node, unit: node.unit ? (byId.get(node.unit) ?? null) : null, span: next, angle, doy, track: 0, r: TRACKS[0]!, x: 0, y: 0, days: next ? Math.max(0, next.start - today) : Number.POSITIVE_INFINITY });
  }
  // Дорожки: самая внешняя, где рядом нет другого значка; не нашлась — та, где просвет больше.
  list.sort((a, b) => a.angle - b.angle);
  const taken: number[][] = TRACKS.map(() => []);
  for (const m of list) {
    let pick = -1;
    let bestGap = -1;
    let bestTrack = 0;
    for (let t = 0; t < TRACKS.length && pick < 0; t++) {
      const gap = Math.min(...taken[t]!.map((a) => angDist(a, m.angle)), 360);
      if (gap >= needAngle(t)) pick = t;
      else if (gap / needAngle(t) > bestGap) {
        bestGap = gap / needAngle(t);
        bestTrack = t;
      }
    }
    m.track = pick >= 0 ? pick : bestTrack;
    taken[m.track]!.push(m.angle);
    m.r = TRACKS[m.track]!;
    m.x = m.r * Math.sin(rad(m.angle));
    m.y = -m.r * Math.cos(rad(m.angle));
  }
  return { placed: list, undated };
}

/** Угол «сегодня» на кольце. */
export const todayAngle = (date: { y: number; m: number; d: number }): number => ((dayOfYear(dayNo(date.y, date.m, date.d)) - 0.5) / daysInYear(date.y)) * 360;

/** Метка единицы на колесе: если узлов несколько (Majówka — 1, 2 и 3 мая), то ближайшая по дате. */
export function markerOfUnit(ms: readonly Marker[], unitId: string): Marker | null {
  let best: Marker | null = null;
  for (const m of ms) if (m.unit?.id === unitId && (!best || m.days < best.days || (m.days === best.days && m.doy < best.doy))) best = m;
  return best;
}

export type Growth = 'new' | 'seed' | 'sprout' | 'bush' | 'ripe';
/** Прогресс единицы для метки: новое / семя / росток / кустик / выращено (хотя бы один урожай). */
export function growthOf(info: UnitInfo): Growth {
  if (info.harvests > 0 || info.stage === 'ripe') return 'ripe';
  if (!info.planted) return 'new';
  if (info.stage === 'seed' || info.stage === 'sprout' || info.stage === 'bush') return info.stage;
  return 'seed';
}

export const GROWTH_LABEL: Readonly<Record<Growth, string>> = {
  new: 'новое: сначала расскажу, потом спрошу',
  seed: 'семечко',
  sprout: 'росток',
  bush: 'кустик',
  ripe: 'выращено',
};
