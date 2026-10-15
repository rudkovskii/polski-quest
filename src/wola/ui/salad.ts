// «Salad Story» (W-01): здание на улице и заглушка внутри. Стойку заказа с лестницей уровней делает W-02
// по исследованию research/12_salad_story.md; слова еды уже лежат темой `jedzenie` (place: salad) в словаре Wola.
import { el } from '../../ui/dom';
import { openPlace, boxOf, type WolaDeps } from './kit';
import { fitScale, roomEl, type Room } from './pix';

/** Витрина своим пиксель-артом (без логотипа сети): вывеска с миской салата, маркиза, окно, дверь. */
export const SALAD_FRONT: Room = {
  rows: ['SSSSzSS', '<=====>', 'QQdQQQQ'],
  legend: { S: 'w_salad', z: 'w_salad_szyld', '<': 'w_markiza_l', '=': 'w_markiza_m', '>': 'w_markiza_r', Q: 'w_salad_okno', d: 'w_salad_drzwi' },
};

export async function runSalad(deps: WolaDeps): Promise<void> {
  const frame = openPlace(deps, 'salad', { pl: 'Salad Story', ru: 'салатная, где я обедаю' });
  const box = boxOf(frame.stage);
  const k = fitScale(7, 3, Math.min(box.w - 16, 520), box.h / 2);
  frame.stage.replaceChildren(
    el(
      'div',
      { class: 'wl-soon', 'data-soon': 'salad' },
      roomEl(deps.atlas, SALAD_FRONT, k),
      el('b', { lang: 'pl' }, 'Wkrótce otwieramy!'),
      el('small', {}, 'Скоро: стойка заказа. Сначала одно слово и жест, потом заказ целиком, потом кассир переспрашивает.'),
    ),
  );
  queueMicrotask(() => frame.layer.el.querySelector<HTMLElement>('[data-act="close"]')?.focus({ preventScroll: true }));
  await frame.closed;
}
