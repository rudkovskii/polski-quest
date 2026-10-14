// Settings (ТЗ §5.11) и Export / Import (§5.12), I-12. Настройки — LWW-ключи `progress.settings` (§3.10):
// ответы (диакритика, переводы, новых слов в день, клавиатура), управление (крестик, сторона), звук
// (медленная озвучка, громкость эффектов и музыки, reduced motion). Синк: «Сохрани свою ссылку»
// (экран I-06 через `ui:screen:open link`), статус. Копия: файл `pq-save` (exportImport.ts) через
// Web Share (iOS «Сохранить в Файлы») или загрузку; импорт файла — слияние или «Заменить» с автоэкспортом.
// Применение `controls.*` к роутеру ввода делает склейка по `progress:changed { kinds: ['settings'] }`.
import type { Bus } from '../systems/bus';
import { fileName, importPlan, parseFile, serializeFile, toFile } from '../systems/exportImport';
import { mergeReport } from '../systems/merge';
import { getSetting, setSetting, type Progress, type SettingsMap } from '../systems/progress';
import type { BusEvents, SyncState } from '../types/bus';
import { el } from './dom';
import type { Layer, Overlay } from './overlay/host';
import { btn } from './overlay/kit';

export interface SettingsStore {
  readonly progress: Progress;
  setProgress(p: Progress): boolean;
  /** «Заменить»/слияние из файла: сразу на диск, seq устройства подтянуть (GameStorage). */
  replaceProgress?(p: Progress): Promise<boolean>;
}

export interface SettingsDeps {
  overlay: Overlay;
  store: SettingsStore;
  bus: Bus<BusEvents>;
  clock?: { now(): number };
  /** Есть приватная ссылка (секрет): кнопка «Сохрани свою ссылку». */
  hasLink?: () => boolean;
  /** Последний статус синка (для строки «Синк: …»). */
  syncState?: () => SyncState | null;
  /** Отдать файл: по умолчанию Web Share с файлом, иначе загрузка. Тесты подменяют. */
  saveFile?: (name: string, text: string) => Promise<'shared' | 'downloaded' | 'failed'>;
  /** Выбрать файл: по умолчанию `<input type=file>`. Тесты подменяют. */
  pickFile?: () => Promise<string | null>;
  build?: string;
}

type Choice<K extends keyof SettingsMap> = { key: K; label: string; options: { value: SettingsMap[K]; label: string }[] };

const CHOICES = {
  diacritics: { key: 'diacritics', label: 'Ответ без ą, ę, ł…', options: [{ value: 'ok', label: 'засчитать' }, { value: 'warn', label: 'засчитать, но показать' }, { value: 'fail', label: 'ошибка' }] },
  translations: { key: 'translations', label: 'Перевод реплик', options: [{ value: 'always', label: 'всегда' }, { value: 'auto', label: 'по ситуации' }, { value: 'never', label: 'никогда' }] },
  keyboard: { key: 'keyboard.mode', label: 'Клавиатура на экране', options: [{ value: 'auto', label: 'сама решит' }, { value: 'full', label: 'вся' }, { value: 'strip', label: 'только ą ć ę…' }] },
  dpad: { key: 'controls.dpad', label: 'Крестик управления на экране', options: [{ value: 'auto', label: 'на телефоне' }, { value: 'always', label: 'всегда' }, { value: 'never', label: 'никогда' }] },
  dpadSide: { key: 'controls.dpadSide', label: 'Крестик управления: с какой стороны', options: [{ value: 'left', label: 'слева' }, { value: 'right', label: 'справа' }] },
  sound: { key: 'sound.mode', label: 'Звук', options: [{ value: 'on', label: 'со звуком' }, { value: 'off', label: 'без звука: задания на слух заменяются чтением' }] },
  slow: { key: 'audioSlowDefault', label: 'Медленная озвучка сразу', options: [{ value: false, label: 'нет' }, { value: true, label: 'да' }] },
  motion: { key: 'reducedMotion', label: 'Меньше анимации', options: [{ value: false, label: 'нет' }, { value: true, label: 'да' }] },
  debt: { key: 'showDebtNumber', label: 'Сколько слов ждёт полива (на элементах экрана)', options: [{ value: true, label: 'числом' }, { value: false, label: 'словами' }] },
} as const satisfies Record<string, Choice<keyof SettingsMap>>;

// Статус сохранения в облаке без жаргона (P-01: «синк», «сольём» пугали).
const SYNC_RU: Record<SyncState, string> = {
  idle: 'ещё не сохранялось',
  no_secret: 'ссылки нет, прогресс только на этом устройстве',
  pending: 'есть новое, скоро сохраню в облако',
  syncing: 'сохраняю в облако…',
  ok: 'всё сохранено в облаке',
  offline: 'нет связи с облаком, сохраню, когда появится сеть',
  conflict: 'в облаке другая версия, нужен выбор',
  old_client: 'обнови игру: закрой и открой заново',
  error: 'не получилось сохранить в облако',
};

const css = `
.pq-settings { width: min(100% - 16px, 620px); height: calc(100% - 24px); margin: auto; display: flex; flex-direction: column; box-sizing: border-box; }
.pq-settings .top { display: flex; align-items: center; gap: 8px; padding: 10px 12px 4px; }
.pq-settings .top h2 { flex: 1; margin: 0; font-size: 22px; color: #543c52; }
.pq-settings .body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 6px; }
.pq-settings h3 { margin: 12px 0 2px; font-size: 18px; color: #91522c; }
.pq-settings .set { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; border-bottom: 2px dotted #c8966b; }
.pq-settings .set > span { font-weight: 600; }
.pq-settings .seg { display: flex; flex-wrap: wrap; gap: 6px; }
.pq-settings .seg .pq-btn { font-weight: 500; padding: 6px 12px; }
.pq-settings .seg > b { align-self: center; min-width: 2em; text-align: center; font-size: 19px; }
.pq-settings .seg .pq-btn[aria-pressed="true"] { background: #74a334; border-color: #56864c; font-weight: 700; }
.pq-settings input[type=range] { width: 100%; min-height: 44px; }
.pq-settings .msg { font-size: 16px; color: #345a52; min-height: 1.3em; }
.pq-settings .msg.bad { color: #8f3e56; }
.pq-settings .ver { font-size: 14px; color: #695953; }
.pq-confirm { width: min(100% - 32px, 440px); margin: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.pq-confirm .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-settings-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-settings-style';
  s.textContent = css;
  doc.head.append(s);
}

/** Файл: Web Share с файлом (iOS: «Сохранить в Файлы»), иначе загрузка через ссылку. */
export async function shareOrDownload(name: string, text: string): Promise<'shared' | 'downloaded' | 'failed'> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'failed';
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name, style: 'display:none' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/** `<input type=file accept=.json>` → текст файла или null (отмена). */
export function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      void f.text().then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

/** Подтверждение. `safeYes` — «да» безопасно (слияние) и стоит под Enter; иначе под Enter «нет». */
function confirmBox(overlay: Overlay, text: string, yes: string, no = 'Отмена', safeYes = false): Promise<boolean> {
  const layer = overlay.open('pq-confirm-layer');
  layer.el.style.justifyContent = 'center';
  return new Promise((resolve) => {
    const done = (v: boolean): void => {
      layer.close();
      resolve(v);
    };
    const ok = btn(yes, () => done(true), 'primary', { 'data-nav': true, 'data-act': 'yes', 'data-primary': safeYes });
    const cancel = btn(no, () => done(false), '', { 'data-nav': true, 'data-act': 'no', 'data-primary': !safeYes });
    layer.el.append(el('div', { class: 'pq-wood pq-confirm' }, el('div', {}, text), el('div', { class: 'row' }, cancel, ok)));
    layer.handle({ cancel: () => (done(false), true) });
  });
}

/** Открыть настройки. Закрываются ✕ / Esc / «B». */
export function runSettings(deps: SettingsDeps): Promise<void> {
  ensureStyle(document);
  const { store, bus } = deps;
  const now = (): number => deps.clock?.now() ?? Date.now();
  const save = deps.saveFile ?? shareOrDownload;
  const pick = deps.pickFile ?? pickJsonFile;
  const layer: Layer = deps.overlay.open('pq-settings-layer');
  layer.el.style.justifyContent = 'center';
  const msg = el('div', { class: 'msg', role: 'status', 'data-msg': true });
  const say = (text: string, bad = false): void => {
    msg.textContent = text;
    msg.classList.toggle('bad', bad);
  };

  const put = <K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): void => {
    if (getSetting(store.progress, key) === value) return;
    if (store.setProgress(setSetting(store.progress, key, value, now()))) bus.emit('progress:changed', { kinds: ['settings'] });
    else say('Настройки сейчас только для чтения', true);
  };

  const choice = <K extends keyof SettingsMap>(c: Choice<K>): HTMLElement => {
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': c.label });
    const paint = (): void => {
      const cur = getSetting(store.progress, c.key);
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === String(cur)));
    };
    for (const o of c.options) {
      seg.append(
        btn(o.label, () => {
          put(c.key, o.value);
          paint();
        }, '', { 'data-nav': true, 'data-setting': c.key, 'data-value': String(o.value) }),
      );
    }
    paint();
    return el('div', { class: 'set' }, el('span', {}, c.label), seg);
  };

  const range = (key: 'sfxVolume' | 'musicVolume', label: string): HTMLElement => {
    const input = el('input', { type: 'range', min: 0, max: 1, step: 0.1, value: String(getSetting(store.progress, key)), 'data-setting': key, 'aria-label': label });
    input.addEventListener('change', () => put(key, Number(input.value)));
    return el('div', { class: 'set' }, el('span', {}, label), input);
  };

  const newItems = (): HTMLElement => {
    const val = el('b', { 'data-value': true }, String(getSetting(store.progress, 'newItemsPerDay')));
    const step = (d: number): void => {
      const v = Math.min(12, Math.max(4, getSetting(store.progress, 'newItemsPerDay') + d));
      put('newItemsPerDay', v);
      val.textContent = String(v);
    };
    return el(
      'div',
      { class: 'set' },
      el('span', {}, 'Новых слов в день (4–12)'),
      el('div', { class: 'seg' }, btn('−', () => step(-1), 'icon', { 'data-nav': true, 'data-act': 'new-minus', 'aria-label': 'меньше' }), val, btn('+', () => step(1), 'icon', { 'data-nav': true, 'data-act': 'new-plus', 'aria-label': 'больше' })),
    );
  };

  const exportNow = async (): Promise<boolean> => {
    const ts = now();
    const r = await save(fileName(ts), serializeFile(toFile(store.progress, ts)));
    if (r === 'failed') say('Не получилось сохранить файл', true);
    else say(r === 'shared' ? 'Копия отправлена' : `Копия сохранена: ${fileName(ts)}`);
    return r !== 'failed';
  };

  const apply = async (p: Progress, done: string): Promise<void> => {
    const ok = store.replaceProgress ? await store.replaceProgress(p) : store.setProgress(p);
    if (!ok) return say('Не смог записать: сохранение только для чтения', true);
    bus.emit('progress:changed', { kinds: ['cards', 'world', 'settings'] });
    say(done);
  };

  const importNow = async (): Promise<void> => {
    const text = await pick();
    if (text === null) return;
    const f = parseFile(text);
    if (f.kind === 'trainer') return say('Это файл старого тренажёра: перенос появится позже', true);
    if (f.kind === 'unknown') return say(`Файл не распознан (${f.reason})`, true);
    if (f.status === 'newer') return say('Файл из более новой версии игры. Обнови игру: закрой и открой заново', true);
    if (f.status === 'invalid') return say(`Файл повреждён: ${f.errors[0] ?? ''}`, true);
    const plan = importPlan(store.progress, f.progress);
    if (plan === 'merge') {
      // По умолчанию слияние (§5.12); «Заменить…» ведёт ко второму подтверждению.
      const doMerge = await confirmBox(deps.overlay, 'Слить копию с текущим прогрессом? Ничего не потеряется. «Заменить» сотрёт текущий прогресс (перед этим сохраню его копию).', 'Слить', 'Заменить…', true);
      if (doMerge) {
        const r = mergeReport(store.progress, f.progress);
        return apply(r.progress, `Слито: новых событий ${r.addedToA}`);
      }
      if (!(await confirmBox(deps.overlay, 'Заменить текущий прогресс копией из файла?', 'Заменить'))) return;
    } else if (plan === 'other_world') {
      if (!(await confirmBox(deps.overlay, 'Это другой мир. Заменить текущий? Перед этим сохраню копию текущего.', 'Заменить'))) return;
    }
    if (!(await exportNow())) return say('Сначала не удалось сохранить копию текущего: замена отменена', true);
    await apply(f.progress, 'Прогресс заменён копией из файла');
  };

  const sync = deps.syncState?.() ?? null;
  const body = el(
    'div',
    { class: 'body' },
    el('h3', {}, 'Ответы'),
    choice(CHOICES.diacritics),
    choice(CHOICES.translations),
    newItems(),
    choice(CHOICES.keyboard),
    el('h3', {}, 'Управление'),
    choice(CHOICES.dpad),
    choice(CHOICES.dpadSide),
    el('h3', {}, 'Звук и экран'),
    choice(CHOICES.sound),
    choice(CHOICES.slow),
    range('sfxVolume', 'Громкость эффектов'),
    range('musicVolume', 'Громкость музыки'),
    choice(CHOICES.motion),
    choice(CHOICES.debt),
    el('h3', {}, 'Сохранение в облаке'),
    sync ? el('div', { class: 'set', 'data-sync': sync }, el('span', {}, 'Облако'), el('div', {}, SYNC_RU[sync])) : null,
    deps.hasLink?.()
      ? btn('Сохрани свою ссылку', () => bus.emit('ui:screen:open', { screen: 'link' }), '', { 'data-nav': true, 'data-act': 'link' })
      : el('div', { class: 'set' }, el('span', {}, 'Приватной ссылки пока нет: прогресс живёт на этом устройстве')),
    el('h3', {}, 'Копия прогресса'),
    el(
      'div',
      { class: 'seg' },
      btn('Сохранить копию', () => void exportNow(), '', { 'data-nav': true, 'data-act': 'export' }),
      btn('Загрузить копию', () => void importNow(), '', { 'data-nav': true, 'data-act': 'import' }),
    ),
    msg,
    el('div', { class: 'ver' }, `Версия ${deps.build ?? 'dev'}`),
  );

  return new Promise((resolve) => {
    const close = (): void => {
      layer.close();
      resolve();
    };
    const x = btn('✕', close, 'icon ghost', { 'aria-label': 'Закрыть настройки', 'data-act': 'close', 'data-nav': true });
    layer.el.replaceChildren(el('div', { class: 'pq-wood pq-settings', 'data-screen': 'settings' }, el('div', { class: 'top' }, el('h2', {}, 'Настройки'), x), body));
    layer.handle({ cancel: () => (close(), true) });
  });
}
