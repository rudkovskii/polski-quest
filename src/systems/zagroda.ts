// Zagroda (v2): какая единица растёт у какого объекта новой локации (карта `content/maps/zagroda.json`).
// Чистая часть: сад (16 яблонь = 16 воеводств), пасека (5 ульев = 4 куплета + припев; символы у улья припева), огород месяцев
// (12 грядок), клумба праздников (21 место). Вид объекта по прогрессу (`PlotView`) рисует `scenes/zagrodaLayer.ts`.
import type { PlotView, PolskaUnit, ZPlot } from '../types/polska';
import type { Stage } from '../types/farm';
import { stageOf, type ItemState } from './garden';

/** 16 воеводств: slug = хвост id `geo.voi.<slug>`, объект — `sad_<slug>`. */
export const VOIVODESHIPS: readonly string[] = [
  'zachodniopomorskie', 'pomorskie', 'warminsko-mazurskie', 'podlaskie',
  'lubuskie', 'wielkopolskie', 'kujawsko-pomorskie', 'mazowieckie',
  'dolnoslaskie', 'lodzkie', 'swietokrzyskie', 'lubelskie',
  'opolskie', 'slaskie', 'malopolskie', 'podkarpackie',
];
/** Ульи: куплеты и припев (`hive_<stanza>`). */
export const STANZAS: readonly string[] = ['s1', 'ref', 's2', 's3', 's4'];
export const KLUMBA_SIZE = 21;

export const PLOT_NAME: Readonly<Record<ZPlot, { pl: string; ru: string }>> = {
  sad: { pl: 'Sad', ru: 'Сад' },
  pasieka: { pl: 'Pasieka', ru: 'Пасека' },
  miesiace: { pl: 'Ogród miesięcy', ru: 'Огород месяцев' },
  klumba: { pl: 'Klumba', ru: 'Клумба' },
};

/** Все объекты участков в порядке карты: их id обязаны быть на `zagroda.json` (тест). */
export const PLOT_OBJECTS: readonly { obj: string; plot: ZPlot }[] = [
  ...VOIVODESHIPS.map((v) => ({ obj: `sad_${v}`, plot: 'sad' as const })),
  ...STANZAS.map((s) => ({ obj: `hive_${s}`, plot: 'pasieka' as const })),
  ...Array.from({ length: 12 }, (_, i) => ({ obj: `bed_${i + 1}`, plot: 'miesiace' as const })),
  ...Array.from({ length: KLUMBA_SIZE }, (_, i) => ({ obj: `klumba_${i}`, plot: 'klumba' as const })),
];

/** Где растёт единица: участок, объект (к нему бежит герой) и группа для бонуса за закрытый набор. */
export interface PlotRef {
  plot: ZPlot;
  obj: string;
  group: string;
}

const hashOf = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/^geo\.voi\./, '')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Воеводство единицы geo: свой id, `region` (строка или первый из массива), иначе по хэшу. */
function voiOf(u: PolskaUnit): string {
  if (u.id.startsWith('geo.voi.')) {
    const s = slugOf(u.id);
    if (VOIVODESHIPS.includes(s)) return s;
  }
  const r = u.raw.region;
  const first = typeof r === 'string' ? r : Array.isArray(r) && typeof r[0] === 'string' ? r[0] : '';
  const s = slugOf(first);
  return VOIVODESHIPS.includes(s) ? s : VOIVODESHIPS[hashOf(u.id) % VOIVODESHIPS.length]!;
}

/** Порядок праздников на клумбе: по данным. */
export function plotOf(u: PolskaUnit, holidayIndex = 0): PlotRef {
  switch (u.kind) {
    case 'geo': {
      const v = voiOf(u);
      return { plot: 'sad', obj: `sad_${v}`, group: `voi:${v}` };
    }
    case 'hymn': {
      const st = typeof u.raw.stanza === 'string' ? u.raw.stanza : (u.id.split('.')[1] ?? 's1');
      const s = STANZAS.includes(st) ? st : 's1';
      return { plot: 'pasieka', obj: `hive_${s}`, group: `stanza:${s}` };
    }
    case 'symbol':
      return { plot: 'pasieka', obj: 'hive_ref', group: 'symbols' };
    case 'date': {
      const m = typeof u.raw.month === 'number' && u.raw.month >= 1 && u.raw.month <= 12 ? u.raw.month : 1;
      return { plot: 'miesiace', obj: `bed_${m}`, group: `month:${m}` };
    }
    case 'holiday': {
      const season = typeof u.raw.season === 'string' ? u.raw.season : 'rok';
      return { plot: 'klumba', obj: `klumba_${holidayIndex % KLUMBA_SIZE}`, group: `season:${season}` };
    }
  }
}

/** Единица → объект (праздники по порядку в данных). */
export function plotMap(units: readonly PolskaUnit[]): Map<string, PlotRef> {
  const out = new Map<string, PlotRef>();
  let hol = 0;
  for (const u of units) out.set(u.id, plotOf(u, u.kind === 'holiday' ? hol++ : 0));
  return out;
}

const RANK: Record<string, number> = { seed: 1, sprout: 2, bush: 3, overripe: 4 };

/** Вид каждого объекта участков по состоянию огорода v2. */
export function plotViews(units: readonly PolskaUnit[], items: ReadonlyMap<string, ItemState>, now: number, refs: Map<string, PlotRef> = plotMap(units)): PlotView[] {
  const by = new Map<string, PlotView>(PLOT_OBJECTS.map((p) => [p.obj, { obj: p.obj, plot: p.plot, units: 0, planted: 0, grown: 0, pct: 0, best: null }]));
  for (const u of units) {
    const ref = refs.get(u.id);
    const v = ref ? by.get(ref.obj) : undefined;
    if (!v) continue;
    v.units++;
    const it = items.get(u.id);
    if (!it) continue;
    v.planted++;
    if (it.harvests > 0) v.grown++;
    const s: Stage | null = stageOf(it, now);
    if (s && s !== 'ripe' && (RANK[s] ?? 0) > (v.best ? (RANK[v.best] ?? 0) : 0)) v.best = s;
  }
  for (const v of by.values()) v.pct = v.units ? v.grown / v.units : 0;
  return [...by.values()];
}
