// Радио в доме (V11b, `world:interact` use=radio): большой выключатель «Muzyka: wł./wył.», список треков (тап = играть),
// назад/вперёд, «по кругу / один трек», громкость, «Играть по всей ферме». Состояние хранит плеер (`MusicControl`).
// С `?mute=1` всё видно и переключается, но звука нет (плеер не создаёт аудио).
import { TRACKS, trackById, type MusicControl, type MusicView } from '../systems/musicSettings';
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { createPanel, nav } from './panel';

const css = `
.rd { display: flex; flex-direction: column; gap: 10px; }
.rd-power { width: 100%; font-size: 20px; padding: 14px 12px; background: var(--pq-wood-dark); }
.rd-power[aria-pressed=true] { background: #5a8f3e; }
.rd-now { background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; padding: 8px 10px; font-size: 15px; min-height: 2.6em; }
.rd-now b { font-size: 17px; }
.rd-now small { display: block; opacity: .72; font-size: 13px; }
.rd-list { display: flex; flex-direction: column; gap: 6px; }
.rd-track { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: var(--pq-wood); padding: 8px 12px; }
.rd-track .mark { width: 1.2em; text-align: center; }
.rd-track .ru { opacity: .75; font-weight: 400; font-size: 13px; margin-left: auto; }
.rd-track.sel { background: var(--pq-accent); color: var(--pq-ink); }
.rd-row { display: flex; align-items: center; gap: 8px; }
.rd-row .pq-btn { flex: 1 1 0; }
.rd-vol { display: flex; align-items: center; gap: 8px; }
.rd-vol input { flex: 1 1 auto; min-width: 0; accent-color: var(--pq-wood); }
.rd-vol output { min-width: 3em; text-align: right; font-variant-numeric: tabular-nums; font-size: 14px; }
.rd-vol .pq-btn { padding: 8px 12px; }
`;

export interface RadioScreen {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

export function mountRadio(parent: HTMLElement, music: MusicControl, bus?: Bus<BusEvents>): RadioScreen {
  const panel = createPanel({ title: 'Radio · Радио', bus });
  const power = el('button', { type: 'button', class: 'pq-btn rd-power', 'data-radio-power': '', ...nav('power', 'v', 'power'), onclick: () => music.toggle() });
  const now = el('div', { class: 'rd-now', 'data-radio-now': '', role: 'status' });
  const rows = new Map<string, { btn: HTMLButtonElement; mark: HTMLElement }>();
  const list = el('div', { class: 'rd-list', 'data-radio-list': '' });
  for (const t of TRACKS) {
    const mark = el('span', { class: 'mark' });
    const btn = el('button', { type: 'button', class: 'pq-btn rd-track', 'data-track': t.id, ...nav('tracks', 'v', `t:${t.id}`), onclick: () => music.select(t.id, true) }, mark, el('span', {}, t.pl), el('span', { class: 'ru' }, t.ru));
    rows.set(t.id, { btn, mark });
    list.append(btn);
  }
  const prev = el('button', { type: 'button', class: 'pq-btn', 'data-radio-prev': '', 'aria-label': 'Предыдущий трек', ...nav('ctl', 'h', 'prev'), onclick: () => music.prev() }, '|◂');
  const next = el('button', { type: 'button', class: 'pq-btn', 'data-radio-next': '', 'aria-label': 'Следующий трек', ...nav('ctl', 'h', 'next'), onclick: () => music.next() }, '▸|');
  const repeat = el('button', { type: 'button', class: 'pq-btn', 'data-radio-repeat': '', ...nav('ctl', 'h', 'repeat'), onclick: () => music.setRepeat(music.view().repeat === 'all' ? 'one' : 'all') });
  const vol = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Громкость музыки', 'data-radio-volume': '' });
  const volOut = el('output', {});
  const step = (d: number): void => music.setVolume(music.view().volume + d);
  vol.addEventListener('input', () => music.setVolume(Number(vol.value) || 0));
  const volRow = el(
    'div',
    { class: 'rd-vol' },
    el('button', { type: 'button', class: 'pq-btn', 'aria-label': 'Тише', 'data-radio-vol-down': '', ...nav('vol', 'h', 'vdown'), onclick: () => step(-10) }, '−'),
    vol,
    el('button', { type: 'button', class: 'pq-btn', 'aria-label': 'Громче', 'data-radio-vol-up': '', ...nav('vol', 'h', 'vup'), onclick: () => step(10) }, '+'),
    volOut,
  );
  const everywhere = el('button', { type: 'button', class: 'pq-btn pq-toggle', 'data-radio-everywhere': '', ...nav('opts', 'v', 'everywhere'), onclick: () => music.setEverywhere(!music.view().everywhere) });
  panel.body.append(el('style', {}, css), el('div', { class: 'rd' }, power, now, el('div', { class: 'rd-row' }, prev, next, repeat), el('div', {}, el('div', { class: 'pq-muted', style: 'font-size:13px' }, 'Громкость музыки'), volRow), list, everywhere));
  parent.append(panel.root);

  const paint = (v: MusicView): void => {
    power.setAttribute('aria-pressed', String(v.on));
    power.textContent = `${v.on ? '❚❚' : '▶︎'}  Muzyka: ${v.on ? 'wł.' : 'wył.'}`;
    const t = trackById(v.track);
    const state = !v.on ? 'выключено' : v.muted ? 'звук выключен ссылкой (?mute=1)' : v.playing ? 'играет' : 'ждёт нажатия, чтобы начать';
    now.replaceChildren(el('b', {}, `♪ ${t.pl}`), el('small', {}, `${t.ru} · ${state}`));
    for (const [id, r] of rows) {
      const sel = id === v.track;
      r.btn.classList.toggle('sel', sel);
      r.btn.setAttribute('aria-current', String(sel));
      r.mark.textContent = sel ? (v.on ? '♪' : '•') : '';
    }
    repeat.textContent = v.repeat === 'all' ? 'По кругу' : 'Один трек';
    if (document.activeElement !== vol) vol.value = String(v.volume);
    volOut.textContent = `${v.volume}%`;
    everywhere.setAttribute('aria-pressed', String(v.everywhere));
    everywhere.textContent = `Играть по всей ферме: ${v.everywhere ? 'да' : 'только дома'}`;
  };
  paint(music.view());
  music.onChange(paint);
  return {
    open() {
      paint(music.view());
      panel.open();
    },
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
  };
}
