// Таблички у интерактивных объектов карты (просьба Шэфа 27.10): возле каждого объекта, с которым можно что-то сделать, всегда видно, что
// это («Словарь», «Символы и гимн», «Месяцы и даты»), на языке интерфейса игрока. Двери подписаны тем, куда ведут; участки Zagroda — одной
// табличкой на группу (сад, пасека, огород месяцев, клумбы), а не на каждую грядку: над группой или в точке `sign_<группа>` карты. Чистый TS без Phaser: сцена переводит точки в экран,
// DOM рисует `ui/float.ts` (текст в canvas запрещён).
import type { LocationMap, PropObject } from '../types/map';

/** Язык табличек. Выбора языка интерфейса в игре пока нет: все три версии для русскоязычных игроков. */
export type SignLang = 'ru' | 'pl';
export const SIGN_LANG: SignLang = 'ru';

type Text = Readonly<Record<SignLang, string>>;

/** Объекты по `use`. Названия — по тому, что открывается (экраны «Słownik», «Spiżarnia», «Łóżko · Итог»…). */
export const USE_SIGNS: Readonly<Record<string, Text>> = {
  desk: { ru: 'Словарь', pl: 'Słownik' },
  shelf: { ru: 'Кладовая', pl: 'Spiżarnia' },
  bed: { ru: 'Итог дня', pl: 'Łóżko' },
  radio: { ru: 'Радио', pl: 'Radio' },
  map: { ru: 'Карта Польши', pl: 'Mapa Polski' },
  calendar: { ru: 'Месяцы и даты', pl: 'Miesiące i daty' },
  bin: { ru: 'Коробка урожая', pl: 'Skrzynka' },
  board: { ru: 'Мини-игры', pl: 'Tablica' },
  mast: { ru: 'Символы и гимн', pl: 'Symbole i hymn' },
  seasonBoard: { ru: 'Праздники', pl: 'Święta' },
};

/** Двери — по карте, куда ведут. */
export const EXIT_SIGNS: Readonly<Record<string, Text>> = {
  home: { ru: 'Дом', pl: 'Dom' },
  farm: { ru: 'Ферма', pl: 'Farma' },
  zagroda: { ru: 'Загорода', pl: 'Zagroda' },
};

/** Группы участков Zagroda по началу id объекта (`sad_mazowieckie`, `hive_s1`, `bed_5`, `klumba_3`). */
export const PLOT_SIGNS: Readonly<Record<string, Text>> = {
  sad: { ru: 'Сад · карта Польши', pl: 'Sad' },
  hive: { ru: 'Пасека · гимн и символы', pl: 'Pasieka' },
  bed: { ru: 'Огород месяцев', pl: 'Ogród miesięcy' },
  klumba: { ru: 'Клумбы · праздники', pl: 'Klumby' },
};

export interface Sign {
  key: string;
  text: string;
  /** Низ таблички в пикселях мира: середина над верхом спрайта (с местом под пузырёк «A»). */
  x: number;
  y: number;
}

/** Высота спрайта по id (из `sprites.json`), чтобы встать над его верхом. */
export type SpriteHeight = (sprite: string) => number | undefined;

/** Отступ над верхом спрайта, px мира. */
export const SIGN_GAP = 2;
/** На сколько поднять табличку объекта, над которым сейчас пузырёк «A» (он ≈14 px над верхом), px мира. */
export const SIGN_BUBBLE = 15;
/** Выше скольких клеток над основанием табличка не встаёт: у высокого спрайта (мачта) она висит на нём, а не у верхнего края экрана. */
export const SIGN_RISE = 3;

export function signsOf(map: LocationMap, tile: number, height: SpriteHeight, lang: SignLang = SIGN_LANG): Sign[] {
  const out: Sign[] = [];
  const groups = new Map<string, PropObject[]>();
  for (const o of map.objects) {
    if (o.type === 'exit') {
      const t = EXIT_SIGNS[o.to];
      // Дверь в нижней стене (выход из дома) — табличка под проёмом, чтобы не закрывать героя у двери; остальные — над клеткой выхода.
      const low = o.at[1] === map.size[1] - 1;
      if (t) out.push({ key: `exit:${o.at[0]},${o.at[1]}`, text: t[lang], x: (o.at[0] + 0.5) * tile, y: low ? (o.at[1] + 1) * tile + 14 : o.at[1] * tile - SIGN_GAP });
      continue;
    }
    if (o.type !== 'prop' || !o.use) continue;
    if (o.use === 'zplot') {
      const g = o.id.split('_')[0]!;
      if (PLOT_SIGNS[g]) groups.set(g, [...(groups.get(g) ?? []), o]);
      continue;
    }
    const t = USE_SIGNS[o.use];
    if (!t) continue;
    const [w, h] = o.size ?? [1, 1];
    const base = (o.at[1] + h) * tile - (o.dy ?? 0);
    const top = Math.max(base - (height(o.sprite) ?? h * tile) - SIGN_GAP, base - SIGN_RISE * tile);
    out.push({ key: `prop:${o.id}`, text: t[lang], x: (o.at[0] + w / 2) * tile, y: top });
  }
  for (const [g, list] of groups) {
    // Своё место таблички на карте (`spot` с id `sign_<группа>`): сад раскинут на пол-карты, его верх вне экрана у дорожки.
    const spot = map.objects.find((o) => o.type === 'spot' && o.id === `sign_${g}`);
    if (spot) {
      out.push({ key: `plot:${g}`, text: PLOT_SIGNS[g]![lang], x: (spot.at[0] + 0.5) * tile, y: (spot.at[1] + 1) * tile - SIGN_GAP });
      continue;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    for (const o of list) {
      const [w, h] = o.size ?? [1, 1];
      x0 = Math.min(x0, o.at[0]);
      x1 = Math.max(x1, o.at[0] + w);
      y0 = Math.min(y0, (o.at[1] + h) * tile - (height(o.sprite) ?? h * tile));
    }
    out.push({ key: `plot:${g}`, text: PLOT_SIGNS[g]![lang], x: ((x0 + x1) / 2) * tile, y: y0 - SIGN_GAP });
  }
  return out;
}
