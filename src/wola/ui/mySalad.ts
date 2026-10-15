// «Мой салат» в настройках Wola (W-02): обычный заказ Шэфа в Salad Story — салат из меню, порция, dressing, отдельно ли,
// палочка. Хранится настройкой `wola.salad` (LWW целиком); уровни 1–3 строятся вокруг него, «To co zwykle?» — тоже.
// По умолчанию первый салат меню: поменять — один выбор здесь.
import type { Progress, SettingsMap } from '../../systems/progress';
import type { SaladMenu } from '../../types/content';
import { el } from '../../ui/dom';
import { mySalad } from '../systems/saladVisit';

type Put = <K extends keyof SettingsMap>(key: K, value: SettingsMap[K]) => void;

/** Раздел «Мой салат» для runSettings({ section }). Селекты — нативные: на телефоне это системный выбор из списка. */
export function mySaladSection(menu: SaladMenu, api: { put: Put; progress(): Progress }): HTMLElement {
  const cur = (): ReturnType<typeof mySalad> => mySalad(api.progress(), menu);
  const save = (patch: Partial<ReturnType<typeof mySalad>>): void => {
    const m = { ...cur(), ...patch };
    api.put('wola.salad', {
      salad: m.salad,
      size: m.size,
      ...(m.dressing ? { dressing: m.dressing } : {}),
      ...(m.osobno ? { osobno: true } : {}),
      ...(m.bread ? { bread: m.bread } : {}),
    });
    paint();
  };
  const select = (key: string, label: string, options: { value: string; label: string }[], value: () => string, on: (v: string) => void): HTMLElement => {
    const s = el('select', { 'data-setting': `wola.salad.${key}`, 'data-nav': true, 'aria-label': label, style: 'min-height:40px;font-size:17px;padding:4px 6px;max-width:100%' });
    for (const o of options) s.append(el('option', { value: o.value }, o.label));
    s.value = value();
    s.addEventListener('change', () => on(s.value));
    return el('label', { class: 'set', style: 'gap:2px' }, el('span', {}, label), s);
  };
  const box = el('div', { class: 'set', 'data-set': 'wola.salad', style: 'border-bottom:0' });
  const summary = el('div', { class: 'msg', 'data-my-salad': true });
  const paint = (): void => {
    const m = cur();
    const s = menu.salads.find((x) => x.id === m.salad)!;
    const d = menu.dressings.find((x) => x.id === (m.dressing ?? s.dressing));
    const b = menu.breads.find((x) => x.id === m.bread);
    summary.textContent = `Poproszę sałatkę ${s.name}, ${m.size === 'normalna' ? 'normalną' : 'powiększoną'}. Dressing ${d?.pl ?? ''}${m.osobno ? ' osobno' : ''}${b ? `, ${b.pl.toLowerCase()}` : ''}.`;
  };
  box.append(
    el('span', {}, 'Мой салат в Salad Story: обычный заказ (уровни 1–3 строятся вокруг него)'),
    select('salad', 'Салат', menu.salads.map((s) => ({ value: s.id, label: `${s.name} — ${s.ru}` })), () => cur().salad, (v) => save({ salad: v, dressing: null })),
    select('size', 'Порция', menu.sizes.map((s) => ({ value: s.id, label: `${s.pl} — ${s.ru}` })), () => cur().size, (v) => save({ size: v === 'powiekszona' ? 'powiekszona' : 'normalna' })),
    select(
      'dressing',
      'Dressing',
      [{ value: '', label: 'как у салата' }, ...menu.dressings.map((d) => ({ value: d.id, label: `${d.pl} — ${d.ru}` }))],
      () => cur().dressing ?? '',
      (v) => save({ dressing: v || null }),
    ),
    select('osobno', 'Dressing отдельно?', [{ value: '', label: 'вмешать (wymieszać)' }, { value: '1', label: 'отдельно (osobno)' }], () => (cur().osobno ? '1' : ''), (v) => save({ osobno: v === '1' })),
    select('bread', 'Хлебная палочка', [{ value: '', label: 'без палочки' }, ...menu.breads.map((b) => ({ value: b.id, label: `${b.pl} — ${b.ru}` }))], () => cur().bread ?? '', (v) => save({ bread: v || null })),
    summary,
  );
  paint();
  return box;
}
