// Нота в HUD (V11b): всегда видна рядом с шестерёнкой, тап открывает мини-панель без захода в дом:
// вкл/выкл, предыдущий/следующий, название трека, громкость. Мир при этом принимает ввод (панель не модальная).
import { bus as globalBus, type Bus } from '../systems/bus';
import { trackById, type MusicControl, type MusicView } from '../systems/musicSettings';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-note { position: fixed; z-index: 31; top: calc(env(safe-area-inset-top) + 8px); right: calc(env(safe-area-inset-right) + 10px + 44px + 8px);
  width: 44px; height: 44px; padding: 0; font-size: 22px; line-height: 40px; text-align: center; opacity: .8; }
.pq-note.on { opacity: 1; background: var(--pq-accent); color: var(--pq-ink); }
.pq-note.playing span { display: inline-block; animation: pq-note-bob 1.2s ease-in-out infinite; }
.pq-note:not(.on) span { position: relative; }
.pq-note:not(.on) span::after { content: ''; position: absolute; left: -2px; right: -2px; top: 48%; height: 3px; background: var(--pq-cream); border-radius: 2px; transform: rotate(-35deg); }
@keyframes pq-note-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.pq-mini { position: fixed; z-index: 32; top: calc(env(safe-area-inset-top) + 58px); right: calc(env(safe-area-inset-right) + 10px); width: min(260px, calc(100vw - 20px));
  box-sizing: border-box; background: var(--pq-cream); color: var(--pq-ink); border: 3px solid var(--pq-ink); border-radius: 10px; box-shadow: 0 4px 0 var(--pq-ink);
  padding: 10px; display: flex; flex-direction: column; gap: 8px; font: 15px/1.25 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.pq-mini[hidden] { display: none; }
.pq-mini .pq-btn { width: 100%; }
.pq-mini .pq-toggle[aria-pressed=true] { background: #5a8f3e; }
.pq-mini .t { font-weight: 700; text-align: center; min-height: 1.3em; }
.pq-mini .t small { display: block; font-weight: 400; opacity: .7; font-size: 12px; }
.pq-mini .r { display: flex; gap: 8px; }
.pq-mini .r .pq-btn { flex: 1 1 0; padding: 9px 10px; }
.pq-mini .v { display: flex; align-items: center; gap: 8px; }
.pq-mini .v input { flex: 1 1 auto; min-width: 0; accent-color: var(--pq-wood); }
.pq-mini .v output { min-width: 3em; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }
`;

export interface MusicHud {
  readonly isOpen: boolean;
  close(): void;
  dispose(): void;
}

export function mountMusicHud(parent: HTMLElement, music: MusicControl, o: { bus?: Bus<BusEvents>; doc?: Document } = {}): MusicHud {
  const bus = o.bus ?? globalBus;
  const doc = o.doc ?? document;
  const glyph = el('span', {}, '♪');
  const btn = el('button', { type: 'button', class: 'pq-btn pq-note', 'data-music-hud': '', 'aria-label': 'Музыка', 'aria-expanded': 'false' }, glyph);
  const power = el('button', { type: 'button', class: 'pq-btn pq-toggle', 'data-mini-power': '', onclick: () => music.toggle() });
  const title = el('div', { class: 't', 'data-mini-title': '' });
  const prev = el('button', { type: 'button', class: 'pq-btn', 'data-mini-prev': '', 'aria-label': 'Предыдущий трек', onclick: () => music.prev() }, '|◂');
  const next = el('button', { type: 'button', class: 'pq-btn', 'data-mini-next': '', 'aria-label': 'Следующий трек', onclick: () => music.next() }, '▸|');
  const vol = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Громкость музыки', 'data-mini-volume': '' });
  const volOut = el('output', {});
  vol.addEventListener('input', () => music.setVolume(Number(vol.value) || 0));
  const mini = el('div', { class: 'pq-mini', hidden: true, 'data-mini': '', role: 'dialog', 'aria-label': 'Музыка' }, power, title, el('div', { class: 'r' }, prev, next), el('div', { class: 'v' }, vol, volOut));
  const root = el('div', {}, el('style', {}, css), btn, mini);
  parent.append(root);

  const paint = (v: MusicView): void => {
    btn.classList.toggle('on', v.on);
    btn.classList.toggle('playing', v.playing);
    btn.title = v.on ? 'Музыка включена' : 'Музыка выключена';
    power.setAttribute('aria-pressed', String(v.on));
    power.textContent = `Muzyka: ${v.on ? 'wł.' : 'wył.'}`;
    const t = trackById(v.track);
    title.replaceChildren(`♪ ${t.pl}`, el('small', {}, v.muted && v.on ? `${t.ru} · звук выключен ссылкой` : t.ru));
    if (doc.activeElement !== vol) vol.value = String(v.volume);
    volOut.textContent = `${v.volume}%`;
  };
  paint(music.view());
  const off = music.onChange(paint);

  let open = false;
  const setOpen = (on: boolean): void => {
    open = on;
    mini.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    setOpen(!open);
  };
  // Тап мимо панели закрывает её (click, не pointerdown: ввод слушает только src/input).
  const onDoc = (e: Event): void => {
    if (open && e.target instanceof Node && !mini.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  };
  doc.addEventListener('click', onDoc, true);
  // Открылся экран (настройки, словарь, радио): мини-панель уходит.
  const offInput = bus.on('world:input', ({ enabled }) => {
    if (!enabled) setOpen(false);
  });
  return {
    get isOpen() {
      return open;
    },
    close: () => setOpen(false),
    dispose() {
      off();
      offInput();
      doc.removeEventListener('click', onDoc, true);
      root.remove();
    },
  };
}
