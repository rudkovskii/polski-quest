// Паспорт (ТЗ §5.10, I-11, минимальный): обложка, страница на каждый биом (печать или пустой силуэт и
// условие словами), предметы (билет), can-do главы с галочками. Челленджи, słoiki, spiżarnia и «Секреты»
// придут в следующих итерациях. Печать = стадия биома `stages.stamp` истинна (Praga: флаг ch01.done).
import type { Content } from '../systems/content';
import type { Derived } from '../systems/derive';
import type { Progress } from '../systems/progress';
import type { Condition } from '../types/content';
import { el } from './dom';
import type { Overlay } from './overlay/host';
import { BTN, plBtn } from './overlay/kit';

export interface PassportPage {
  biome: string;
  title: string;
  titleRu: string;
  stamped: boolean;
  /** Условие печати словами (для пустого силуэта). */
  how: string;
}

export interface PassportModel {
  /**
   * Первая страница (СЮЖЕТ §2, I-13): выцветшая запись «Dla następnego gościa. - K.» и печать №1
   * «Warszawa. Praga» за первое «Dzień dobry» (флаг STAMP_FIRST). null — паспорт ещё не найден.
   */
  first: { stamped: boolean; note: string | null } | null;
  pages: PassportPage[];
  items: { id: string; title: string; titleRu: string }[];
  canDo: { id: string; ru: string; done: boolean }[];
}

/** Флаг печати №1 (вступление, I-13). */
export const STAMP_FIRST = 'stamp.first';

/**
 * Условие печати по прогрессу (§3.9, подмножество): always/all/any/not, flag, item, bossPassed, lessonDone.
 * Остальные атомы ложны. Игра передаёт в passportModel полный вычислитель (systems/conditions.ts, I-13).
 */
export function passportCond(p: Progress, d: Pick<Derived, 'bossResults' | 'lessonsDone'>): (c: Condition) => boolean {
  const ev = (c: Condition): boolean => {
    if (c.always) return true;
    if (c.all) return c.all.every(ev);
    if (c.any) return c.any.some(ev);
    if (c.not) return !ev(c.not);
    if (c.flag !== undefined) return c.flag in p.world.flags;
    if (c.item !== undefined) return c.item in p.world.items;
    if (c.bossPassed !== undefined) return d.bossResults[c.bossPassed]?.passedAt !== undefined;
    if (c.lessonDone !== undefined) return d.lessonsDone.has(c.lessonDone);
    return false;
  };
  return ev;
}

/** Условие словами: «сдай босса главы 1», «пройди главу 1». */
export function condWords(c: Condition, content: Pick<Content, 'lessons' | 'modules'>): string {
  const chapter = (mod: string): string => {
    const m = /^ch0*(\d+)$/.exec(mod);
    return m ? `главы ${m[1]}` : `«${content.modules.get(mod)?.module.title.ru ?? mod}»`;
  };
  if (c.bossPassed) return `Сдай босса ${chapter(content.lessons.get(c.bossPassed)?.module ?? '')}`;
  if (c.flag) {
    const m = /^(.+)\.done$/.exec(c.flag);
    if (m) return `Пройди главу ${chapter(m[1]!).replace(/^главы /, '')}`;
  }
  if (c.all) return c.all.map((x) => condWords(x, content)).join(' и ');
  return 'Пока закрыто';
}

export function passportModel(
  content: Content,
  p: Progress,
  d: Pick<Derived, 'bossResults' | 'lessonsDone'>,
  condition?: (c: Condition) => boolean,
): PassportModel {
  const cond = condition ?? passportCond(p, d);
  const k = content.lines.get('intro.passport.k');
  const first = STAMP_FIRST in p.world.flags || 'beat.first.f1' in p.world.flags ? { stamped: STAMP_FIRST in p.world.flags, note: k?.pl ?? null } : null;
  const pages = content.world.biomes
    .filter((b) => b.stamp && cond(b.stages.visible))
    .map((b) => ({ biome: b.id, title: b.title.pl, titleRu: b.title.ru, stamped: cond(b.stages.stamp), how: condWords(b.stages.stamp, content) }));
  const items = Object.keys(p.world.items)
    .sort((a, b) => p.world.items[a]! - p.world.items[b]!)
    .map((id) => {
      const it = content.items.get(id);
      return { id, title: it?.title.pl ?? id, titleRu: it?.title.ru ?? '' };
    });
  // can-do главы закрыты, когда сдан её босс (§5.10: «по сданным сценам» — точнее, когда привяжем can-do к сценам).
  const canDo = [...content.modules.values()]
    .map((b) => b.module)
    .filter((m) => m.kind === 'chapter' && m.canDo?.length)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((m) => {
      const done = m.boss ? d.bossResults[m.boss]?.passedAt !== undefined : false;
      return (m.canDo ?? []).map((x) => ({ id: x.id, ru: x.ru, done }));
    });
  return { first, pages, items, canDo };
}

const css = `
.pq-passport { width: min(100%, 520px); max-height: 100%; overflow-y: auto; box-sizing: border-box; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.pq-passport h2 { margin: 0; font-size: 22px; color: #3b3643; letter-spacing: .1em; text-align: center; }
.pq-passport .page { display: flex; align-items: center; gap: 12px; border: 2px dashed #c8966b; border-radius: 6px; padding: 8px 10px; }
.pq-passport .seal { flex: none; width: 76px; height: 76px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800;
  font-size: 15px; letter-spacing: .06em; text-transform: uppercase; }
.pq-passport .seal.on { border: 5px double #8f3e56; color: #8f3e56; transform: rotate(-8deg); }
.pq-passport .seal.off { border: 3px dashed #b8a58a; color: #b8a58a; }
.pq-passport ul { margin: 0; padding-left: 4px; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.pq-passport .muted { color: #695953; font-size: 15px; }
`;

/** Открыть паспорт поверх мира. Закрыть: кнопка, Esc, «B». */
export function openPassport(overlay: Overlay, model: PassportModel): Promise<void> {
  const layer = overlay.open('pq-passport-layer');
  const doc = layer.el.ownerDocument;
  if (!doc.getElementById('pq-passport-style')) doc.head.append(el('style', { id: 'pq-passport-style' }, css));
  layer.el.style.justifyContent = 'center';
  return new Promise((resolve) => {
    const close = (): void => {
      layer.close();
      resolve();
    };
    layer.el.append(
      el(
        'div',
        { class: 'pq-wood pq-passport', 'data-screen': 'passport' },
        el('h2', { lang: 'pl' }, 'PASZPORT GOŚCIA'),
        model.first
          ? el(
              'div',
              { class: 'page', 'data-page': 'first', 'data-stamped': String(model.first.stamped) },
              el('div', { class: `seal ${model.first.stamped ? 'on' : 'off'}`, lang: 'pl' }, model.first.stamped ? 'Praga' : '?'),
              el('div', {}, model.first.note ? el('i', { lang: 'pl' }, model.first.note) : null, el('div', { class: 'muted', lang: 'pl' }, 'Warszawa. Praga · №1')),
            )
          : null,
        ...model.pages.map((pg) =>
          el(
            'div',
            { class: 'page', 'data-biome': pg.biome, 'data-stamped': String(pg.stamped) },
            el('div', { class: `seal ${pg.stamped ? 'on' : 'off'}` }, pg.stamped ? pg.title : '?'),
            el('div', {}, el('b', { lang: 'pl' }, pg.title), el('div', { class: 'muted' }, pg.stamped ? `${pg.titleRu}: печать получена` : pg.how)),
          ),
        ),
        el('b', {}, 'Вещи'),
        model.items.length
          ? el('ul', { 'data-role': 'items' }, ...model.items.map((it) => el('li', { 'data-item': it.id }, '🎫 ', el('b', { lang: 'pl' }, it.title), it.titleRu ? ` — ${it.titleRu}` : '')))
          : el('div', { class: 'muted' }, 'Пока пусто'),
        model.canDo.length ? el('b', {}, 'Умею') : null,
        model.canDo.length ? el('ul', { 'data-role': 'cando' }, ...model.canDo.map((c) => el('li', { 'data-cando': c.id, 'data-done': String(c.done) }, c.done ? '✅ ' : '⬜ ', c.ru))) : null,
        el('div', { class: 'pq-ex-actions' }, el('span', { class: 'grow' }), plBtn(BTN.close, close, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'close' })),
      ),
    );
    layer.handle({ cancel: () => (close(), true) });
  });
}
