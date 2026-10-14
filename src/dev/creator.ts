// Dev-маршрут `/?dev=creator[&mute=1][&mode=mirror][&seed=N]` (P-03): Fotobudka без мира и Phaser.
// Прогресс в памяти (ничего не пишет в базы игры). После «Gotowe»: аватар в 4 сторонах, кнопки «Паспорт»,
// «Зеркало», «Ещё раз» и галерея случайных аватаров (Losuj с seed 1…4). Это склейка слоёв, как main.ts.
import { startInput } from '../input';
import { bus } from '../systems/bus';
import { appearanceOf, AVATAR_TURN, randomAppearance, type Appearance } from '../systems/avatar';
import { getContent } from '../systems/content';
import { GameStorage, memoryKV } from '../systems/platform/storage';
import { avatarFrameEl } from '../ui/avatar';
import { mountCreator, openCreator } from '../ui/creator';
import { el } from '../ui/dom';
import { mountPlay } from '../ui/play';

const css = `
.pq-devcreator { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  font: 16px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: #f4f4f4; background: #345a52; padding: 16px; box-sizing: border-box; text-align: center; overflow: auto; }
#game { display: none; }
.pq-devcreator .strip { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; justify-content: center; }
.pq-devcreator .strip figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; background: #b8dce5; border: 3px solid #3b3643; border-radius: 6px; color: #141b1b; font-size: 12px; }
`;

export async function mountCreatorDev(params: URLSearchParams): Promise<void> {
  const content = getContent();
  const storage = new GameStorage({ kv: memoryKV(), ls: null });
  await storage.load(Date.now());
  const overlay = document.getElementById('overlay')!;
  overlay.append(el('style', {}, css));
  const page = el('div', { class: 'pq-devcreator' });
  document.body.prepend(page);
  startInput({ focus: 'ui', mapControls: 'tap' });
  bus.on('audio:play', ({ text }) => console.info(`[audio] ${text ?? ''}`));
  const clock = { now: () => Date.now(), mono: () => performance.now() };
  const play = mountPlay(overlay, { content, store: storage, portraits: null, clock });
  const seed = params.get('seed');
  const creator = mountCreator({ overlay: play.overlay, store: storage, clock, ...(seed ? { seed: () => Number(seed) } : {}) });
  (window as unknown as { __pq?: unknown }).__pq = { bus, storage, play, creator, content };
  bus.on('progress:changed', (p) => console.info('[progress:changed]', JSON.stringify(p), JSON.stringify(storage.progress.settings.avatar ?? null)));

  const turns = (a: Appearance): HTMLElement =>
    el('div', { class: 'strip', 'data-role': 'turns' }, ...AVATAR_TURN.map((f) => el('figure', {}, avatarFrameEl(a, f, 4))));
  const gallery = (): HTMLElement =>
    el(
      'div',
      { class: 'strip', 'data-role': 'gallery' },
      ...[1, 2, 3, 4].map((s) => {
        const a = randomAppearance(s);
        return el('figure', { 'data-seed': s }, avatarFrameEl(a, 1, 4), `Losuj seed ${s}`);
      }),
    );

  const run = async (mode: 'new' | 'mirror'): Promise<void> => {
    page.replaceChildren(el('div', {}, `Fotobudka (${mode})`));
    const a = await openCreator({ mode });
    console.info('[creator]', JSON.stringify(a));
    const cur = appearanceOf(storage.progress);
    const btn = (label: string, act: string, fn: () => void, primary = false): HTMLButtonElement =>
      el('button', { type: 'button', class: `pq-btn${primary ? ' primary' : ''}`, 'data-act': act, 'data-nav': true, ...(primary ? { 'data-primary': true } : {}), onclick: fn }, label);
    const passport = btn('Паспорт', 'passport', () => void play.openPassport(), true);
    page.replaceChildren(
      el('div', {}, a ? `Сохранено: ${cur.name}` : 'Закрыто без выбора'),
      turns(cur),
      el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center' }, passport, btn('Зеркало', 'mirror', () => void run('mirror')), btn('Ещё раз', 'again', () => void run('new'))),
      el('div', {}, 'Галерея Losuj:'),
      gallery(),
    );
    passport.focus();
  };
  bus.on('input:intent', (i) => {
    // После закрытия оверлея роутер отдаёт фокус миру (world:input): Enter здесь ловим при любом `to`.
    if (i.type === 'interact' && play.overlay.depth === 0) ((document.activeElement as HTMLElement | null)?.closest('.pq-devcreator button') as HTMLElement | null ?? page.querySelector('[data-primary]'))?.click();
  });
  await run(params.get('mode') === 'mirror' ? 'mirror' : 'new');
}
