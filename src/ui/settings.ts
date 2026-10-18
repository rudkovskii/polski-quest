// Настройки: звук, громкость эффектов, экспорт и импорт сохранения файлом, сброс (с автоэкспортом перед стиранием).
// Пока панель открыта, мир не принимает ввод (`world:input`), Esc закрывает.
import { bus as globalBus, type Bus } from '../systems/bus';
import { TRACKS, type MusicControl } from '../systems/musicSettings';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-modal { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; background: rgba(42, 20, 24, .55); padding: 16px; }
.pq-modal[hidden] { display: none; }
.pq-card { width: min(360px, 100%); background: var(--pq-cream); color: var(--pq-ink); border: 3px solid var(--pq-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--pq-ink);
  padding: 16px; display: flex; flex-direction: column; gap: 10px; font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.pq-card h2 { margin: 0 0 4px; font-size: 20px; }
.pq-card .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pq-card .note { font-size: 13px; opacity: .75; min-height: 1.3em; }
.pq-card .pq-btn { width: 100%; }
.pq-toggle[aria-pressed=true] { background: #5a8f3e; }
.pq-toggle:disabled { opacity: .6; cursor: default; }
.pq-vol { display: flex; align-items: center; gap: 10px; }
.pq-vol input { flex: 1 1 auto; min-width: 0; accent-color: var(--pq-wood); }
.pq-vol input:disabled { opacity: .5; }
.pq-vol output { min-width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; font-size: 14px; }
.pq-select { flex: 1 1 auto; min-width: 0; font: 600 15px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--pq-ink); background: #fffaf0; border: 2px solid var(--pq-ink); border-radius: 6px; padding: 8px; }
.pq-card .ver { font-size: 11px; opacity: .55; text-align: center; user-select: text; -webkit-user-select: text; }
.pq-card .ver:empty { display: none; }
`;

export interface SettingsDeps {
  bus?: Bus<BusEvents>;
  getSound(): boolean;
  setSound(on: boolean): void;
  /** Громкость эффектов, 0–100 %. */
  getSfxVolume?(): number;
  setSfxVolume?(v: number): void;
  /** Скачать сохранение файлом (возвращает имя файла). */
  exportSave(): string;
  /** Импорт: текст файла → сообщение для игрока; ok = сохранение принято (страница перезагрузится). */
  importSave(text: string): Promise<{ ok: boolean; message: string }>;
  /** Сброс: автоэкспорт, стирание, перезагрузка. */
  reset(): Promise<void>;
  /** Музыка (V11b): вкл/выкл, трек, громкость. С `?mute=1` переключатели работают, но аудио нет. */
  music?: MusicControl;
  /** Когда сохранение последний раз записано (мс); null — пока не писали. Показывается как «Последнее сохранение: ЧЧ:ММ». */
  lastSaved?(): number | null;
  /** Копию давно не скачивали (раз в 7 дней): в панели подсказка у «Экспорта». */
  backupDue?(): boolean;
  /** Звук выключен ссылкой (`?mute=1`): переключатель показывает «Выкл» и не работает. */
  muted?: boolean;
  /** Версия сборки (`0.2.0+abc1234`) и профиль (`?dev=<id>`) — мелко внизу панели. */
  version?: string;
  profile?: string;
}

export interface SettingsPanel {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export function mountSettings(parent: HTMLElement, deps: SettingsDeps): SettingsPanel {
  const bus = deps.bus ?? globalBus;
  const note = el('div', { class: 'note', 'data-note': '', role: 'status' });
  const savedLine = el('div', { class: 'note', 'data-last-saved': '' });
  const paintSaved = (): void => {
    const t = deps.lastSaved?.() ?? null;
    const hhmm = t === null ? '—' : new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    savedLine.textContent = `Последнее сохранение: ${hhmm}`;
    if (deps.backupDue?.()) note.textContent = 'Копию не скачивали больше недели: нажми «Экспорт сохранения».';
  };
  const sound = el('button', { type: 'button', class: 'pq-btn pq-toggle', 'aria-pressed': String(deps.getSound()) });
  const paintSound = (): void => {
    const on = !deps.muted && deps.getSound();
    sound.setAttribute('aria-pressed', String(on));
    sound.textContent = on ? 'Вкл' : 'Выкл';
    if (deps.muted) {
      sound.disabled = true;
      sound.title = 'Звук выключен ссылкой (?mute=1)';
    }
  };
  sound.onclick = () => {
    if (deps.muted) return;
    deps.setSound(!deps.getSound());
    paintSound();
  };
  // Громкость эффектов: при `?mute=1` слайдер виден, но неактивен.
  const vol = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Громкость эффектов', 'data-sfx-volume': '' });
  const volOut = el('output', { 'data-sfx-volume-out': '' });
  const paintVol = (): void => {
    const v = Math.round(deps.getSfxVolume?.() ?? 60);
    vol.value = String(v);
    volOut.textContent = `${v}%`;
    vol.disabled = !!deps.muted || !deps.setSfxVolume;
    if (deps.muted) vol.title = 'Звук выключен ссылкой (?mute=1)';
  };
  vol.addEventListener('input', () => {
    if (vol.disabled) return;
    const v = Math.min(100, Math.max(0, Number(vol.value) || 0));
    deps.setSfxVolume?.(v);
    volOut.textContent = `${v}%`;
  });
  // Музыка: вкл/выкл, выбор трека, громкость (V11b). Состояние — в плеере (`deps.music`), сюда приходит через onChange.
  const music = deps.music;
  const mPower = el('button', { type: 'button', class: 'pq-btn pq-toggle', 'data-music-power': '', onclick: () => music?.toggle() });
  const mTrack = el('select', { class: 'pq-select', 'aria-label': 'Трек', 'data-music-track': '' });
  for (const t of TRACKS) mTrack.append(el('option', { value: t.id }, `${t.pl} · ${t.ru}`));
  mTrack.addEventListener('change', () => music?.select(mTrack.value));
  const mVol = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Громкость музыки', 'data-music-volume': '' });
  const mVolOut = el('output', { 'data-music-volume-out': '' });
  mVol.addEventListener('input', () => music?.setVolume(Number(mVol.value) || 0));
  const paintMusic = (): void => {
    if (!music) return;
    const v = music.view();
    mPower.setAttribute('aria-pressed', String(v.on));
    mPower.textContent = v.on ? 'Вкл' : 'Выкл';
    mTrack.value = v.track;
    mVol.value = String(v.volume);
    mVolOut.textContent = `${v.volume}%`;
  };
  const musicRows = music ? [el('div', { class: 'row' }, el('span', {}, 'Музыка'), mPower), el('div', { class: 'row' }, mTrack), el('label', { class: 'pq-vol' }, el('span', {}, 'Громкость музыки'), mVol, mVolOut)] : [];
  const offMusic = music?.onChange(paintMusic);
  paintMusic();
  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    const r = await deps.importSave(await f.text());
    note.textContent = r.message;
  };
  let armed = false;
  const reset = el('button', { type: 'button', class: 'pq-btn danger', 'data-reset': '' }, 'Сбросить игру');
  reset.onclick = () => {
    if (!armed) {
      armed = true;
      reset.textContent = 'Точно? Сначала скачаю копию';
      note.textContent = 'Файл с сохранением скачается сам, потом всё сотрётся.';
      return;
    }
    reset.disabled = true;
    void deps.reset();
  };
  const closeBtn = el('button', { type: 'button', class: 'pq-btn', onclick: () => api.close() }, 'Закрыть');
  const card = el(
    'div',
    { class: 'pq-card', role: 'dialog', 'aria-label': 'Настройки' },
    el('h2', {}, 'Настройки'),
    el('div', { class: 'row' }, el('span', {}, 'Звук'), sound),
    el('label', { class: 'pq-vol' }, el('span', {}, 'Громкость эффектов'), vol, volOut),
    ...musicRows,
    savedLine,
    el('button', { type: 'button', class: 'pq-btn', 'data-export': '', onclick: () => (note.textContent = `Сохранено: ${deps.exportSave()}`) }, 'Экспорт сохранения'),
    el('button', { type: 'button', class: 'pq-btn', 'data-import': '', onclick: () => file.click() }, 'Импорт сохранения'),
    file,
    reset,
    note,
    closeBtn,
    el('div', { class: 'ver', 'data-version': '' }, [deps.version ? `Версия ${deps.version}` : '', deps.profile ? `профиль ${deps.profile}` : '', deps.muted ? 'звук выключен ссылкой' : ''].filter(Boolean).join(' · ')),
  );
  const root = el('div', { class: 'pq-modal', hidden: true, 'data-settings': '' }, el('style', {}, css), card);
  root.addEventListener('click', (e) => {
    if (e.target === root) api.close();
  });
  parent.append(root);
  let open = false;
  const offIntent = bus.on('input:intent', (i) => {
    if (open && i.to === 'ui' && i.type === 'cancel') api.close();
  });
  const api: SettingsPanel = {
    open() {
      if (open) return;
      open = true;
      armed = false;
      reset.textContent = 'Сбросить игру';
      reset.disabled = false;
      note.textContent = '';
      paintSaved();
      paintSound();
      paintVol();
      paintMusic();
      root.hidden = false;
      bus.emit('world:input', { enabled: false });
    },
    close() {
      if (!open) return;
      open = false;
      root.hidden = true;
      bus.emit('world:input', { enabled: true });
    },
    get isOpen() {
      return open;
    },
    dispose() {
      offIntent();
      offMusic?.();
      root.remove();
    },
  };
  return api;
}
