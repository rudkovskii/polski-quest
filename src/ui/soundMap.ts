// Карта звуков (P-06, ПОЛИРОВКА §2 р. 5, СЮЖЕТ_v2 d02.s5): сразу после турникета-диагностики — 10 кружков
// R1–R10 (зелёный держит, жёлтый шатается, красный подлатаем, серый — не проверен: выход посреди) с русской
// подписью; та же карта — страница паспорта. Реплики: Brzechwa (или «Do jutra!» при выходе) и Казик.
import type { Content } from '../systems/content';
import type { ClusterStatus, Derived } from '../systems/derive';
import { el } from './dom';
import type { Overlay } from './overlay/host';
import { BTN, plBtn } from './overlay/kit';

export interface SoundDot {
  id: string;
  short: string;
  status: ClusterStatus;
}

const STATUS_RU: Record<ClusterStatus, string> = { green: 'держит', yellow: 'шатается', red: 'подлатаем', unknown: 'не проверено' };

/** Кружки карты по кластерам phonetics.json; null — диагностики ещё не было. */
export function soundMapModel(content: Pick<Content, 'phonetics'>, d: Pick<Derived, 'clusterStatus'>): SoundDot[] | null {
  if (!Object.values(d.clusterStatus).some((s) => s !== 'unknown')) return null;
  return content.phonetics.clusters.map((c) => ({ id: c.id, short: c.short ?? c.title, status: d.clusterStatus[c.id] ?? 'unknown' }));
}

const css = `
.pq-sounds { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px 6px; }
.pq-sounds .dot { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; font-size: 13px; line-height: 1.15; color: #3b3643; }
.pq-sounds .dot i { width: 30px; height: 30px; border-radius: 50%; border: 3px solid #3b3643; display: flex; align-items: center; justify-content: center;
  font-style: normal; font-weight: 800; font-size: 11px; }
.pq-sounds .green i { background: #74a334; }
.pq-sounds .yellow i { background: #e6c14b; }
.pq-sounds .red i { background: #c84a4a; color: #fff; }
.pq-sounds .unknown i { background: #d8cfc0; border-style: dashed; }
.pq-soundmap { width: min(100% - 16px, 520px); max-height: calc(100% - 24px); overflow-y: auto; margin: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
.pq-soundmap h2 { margin: 0; font-size: 22px; color: #543c52; }
.pq-soundmap h2 small { display: block; font-size: 15px; font-weight: 500; }
.pq-soundmap .say { padding: 8px 10px; border-radius: 6px; background: #fff7ec; border: 2px solid #c8966b; font-size: 17px; }
.pq-soundmap .say .ru { display: block; font-size: 15px; color: #543c52; }
`;

export function ensureSoundStyle(doc: Document): void {
  if (doc.getElementById('pq-sounds-style')) return;
  doc.head.append(el('style', { id: 'pq-sounds-style' }, css));
}

/** Сетка кружков (экран после турникета и страница паспорта). */
export function soundGrid(dots: readonly SoundDot[]): HTMLElement {
  return el(
    'div',
    { class: 'pq-sounds', 'data-role': 'soundmap' },
    ...dots.map((d) => el('div', { class: `dot ${d.status}`, 'data-cluster': d.id, 'data-status': d.status, title: STATUS_RU[d.status] }, el('i', {}, d.id), el('span', {}, d.short))),
  );
}

/** Реплика для карты: польская строка + подпись, или русская речь Казика. */
function sayLine(content: Pick<Content, 'lines' | 'characters'>, id: string): HTMLElement | null {
  const l = content.lines.get(id);
  if (!l || l.todo) return null;
  const who = content.characters.get(l.who)?.name ?? l.who;
  return el(
    'div',
    { class: 'say', 'data-line': id },
    el('b', {}, `${who}: `),
    l.pl ? el('span', { lang: 'pl' }, l.pl) : el('span', {}, l.ru ?? ''),
    l.pl && l.plRu ? el('span', { class: 'ru' }, l.plRu) : null,
  );
}

/**
 * Карта звуков сразу после турникета. `exited` — вышли посреди: первая реплика «Do jutra! Bramka poczeka.»,
 * непроверенные кружки серые. Все зелёные — «Всё зелёное? Ты меня пугаешь».
 */
export function openSoundMap(overlay: Overlay, content: Pick<Content, 'lines' | 'characters'>, dots: readonly SoundDot[], o: { exited?: boolean; lineFor?: (id: string) => string } = {}): Promise<void> {
  const layer = overlay.open('pq-soundmap-layer');
  ensureSoundStyle(layer.el.ownerDocument);
  layer.el.style.justifyContent = 'center';
  const line = (id: string): HTMLElement | null => sayLine(content, o.lineFor ? o.lineFor(id) : id);
  const allGreen = dots.every((d) => d.status === 'green');
  // Слой урока и кнопка «Słucham!» диалога под картой не торчат (P-11): нижние слои спрятаны, пока карта открыта.
  const below = [...(layer.el.parentElement?.querySelectorAll<HTMLElement>(':scope > .pq-layer') ?? [])].filter((n) => n !== layer.el && n.style.visibility !== 'hidden');
  for (const n of below) n.style.visibility = 'hidden';
  return new Promise((resolve) => {
    const close = (): void => {
      for (const n of below) n.style.visibility = '';
      layer.close();
      resolve();
    };
    const ok = plBtn(BTN.next, close, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'next' });
    layer.el.append(
      el(
        'div',
        { class: 'pq-wood pq-soundmap', 'data-screen': 'soundmap', ...(o.exited ? { 'data-exited': true } : {}) },
        el('h2', { lang: 'pl' }, 'Mapa dźwięków', el('small', { lang: 'ru' }, 'Карта звуков: зелёное держит, жёлтое шатается, красное подлатаем')),
        // Вышли посреди — «Do jutra! Bramka poczeka.» вместо «Brawo! Bramka otwarta!».
        o.exited ? line('d02.brzechwa.bramka.exit') : line('d02.brzechwa.result.1'),
        soundGrid(dots),
        ...(allGreen ? [line('d02.kazik.result.allgreen')] : [line('d02.kazik.result.1'), line('d02.kazik.result.2')]),
        el('div', { class: 'pq-ex-actions' }, el('span', { class: 'grow' }), ok),
      ),
    );
    layer.handle({ cancel: () => (close(), true) });
    queueMicrotask(() => ok.focus({ preventScroll: true }));
  });
}
