// Общие кирпичи оверлея (I-08): озвучка через шину, портреты из атласа, кнопки.
import { bus as globalBus, type Bus } from '../../systems/bus';
import type { BusEvents } from '../../types/bus';
import { el } from '../dom';

// ── Озвучка. Оверлей не играет звук сам: шлёт `audio:play`, слушает platform/audio (I-09).

export interface AudioPort {
  play(text: string, opts?: { slow?: boolean; who?: string; id?: string }): void;
  /**
   * Есть ли чем озвучить текст. false → аудио-шаг заменяется текстовым аналогом (ТЗ §5.7) без
   * записи `lis`-карточки. До I-09 (манифест, Web Speech) склейка отвечает true.
   */
  has(text: string): boolean;
}

export function busAudio(bus: Bus<BusEvents> = globalBus, has: (text: string) => boolean = () => true): AudioPort {
  return {
    play(text, opts = {}) {
      if (!text) return;
      bus.emit('audio:play', { text, ...opts });
    },
    has,
  };
}

// ── Портреты. Источник кадра даёт склейка (атлас грузится там); без него — буква в рамке.

export interface PortraitFrame {
  /** URL листа атласа. */
  url: string;
  sheet: [number, number];
  /** x, y, w, h кадра в листе. */
  rect: [number, number, number, number];
}

export type PortraitSource = (charId: string) => PortraitFrame | null;

export interface Speaker {
  id: string;
  name: string;
}

/** Рамка 64 CSS px; кадр масштабируется целым множителем (пиксели ровные). */
export function portrait(sp: Speaker, src?: PortraitSource | null, box = 58): HTMLElement {
  const frame = src?.(sp.id) ?? null;
  const node = el('div', { class: 'pq-portrait', 'data-who': sp.id, 'aria-hidden': 'true' });
  if (frame) {
    const [x, y, w, h] = frame.rect;
    const k = Math.max(1, Math.floor(box / Math.max(w, h)));
    node.append(
      el('div', {
        class: 'pix',
        style: `width:${w * k}px;height:${h * k}px;background-image:url("${frame.url}");background-size:${frame.sheet[0] * k}px ${frame.sheet[1] * k}px;background-position:${-x * k}px ${-y * k}px`,
      }),
    );
  } else {
    node.append(el('span', { class: 'initial' }, (sp.name || sp.id).replace(/^(pan|pani)\s+/i, '').charAt(0).toUpperCase()));
  }
  return node;
}

/** Реакция NPC на ответ (СЮЖЕТ §1 правило 3: смешно, без стыда). Иконка над портретом и покачивание. */
export type React = 'confused' | 'happy' | 'laugh' | 'cold';
const EMOTE: Record<React, string> = { confused: '?', happy: '♥', laugh: 'ha', cold: '…' };

export function react(node: HTMLElement | null | undefined, kind: React): void {
  if (!node) return;
  node.querySelector('.pq-emote')?.remove();
  node.classList.remove('pq-react');
  void node.offsetWidth; // перезапуск анимации
  node.classList.add('pq-react');
  node.dataset.react = kind;
  node.append(el('span', { class: 'pq-emote' }, EMOTE[kind]));
}

// ── Кнопки.

export function btn(label: string | Node, onClick: () => void, cls = '', attrs: Record<string, string | boolean | undefined> = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: `pq-btn ${cls}`.trim(), onclick: () => onClick(), ...attrs }, label);
}

/** ▶ и «медленно» для польской строки. */
export function audioButtons(audio: AudioPort, text: string, who?: string): HTMLElement[] {
  const opt = (slow: boolean): { slow: boolean; who?: string } => (who ? { slow, who } : { slow });
  return [
    btn('▶', () => audio.play(text, opt(false)), 'icon', { 'aria-label': 'Послушать', 'data-nav': true, 'data-audio': 'play' }),
    btn('медленно', () => audio.play(text, opt(true)), 'icon ghost', { 'aria-label': 'Послушать медленно', 'data-nav': true, 'data-audio': 'slow' }),
  ];
}

/** Мини-markdown для `explain` (≤ 400 знаков): **жирный**, *курсив*, `код`, переносы строк. */
export function mdInline(md: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = md.split('\n');
  lines.forEach((line, li) => {
    const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > last) frag.append(line.slice(last, m.index));
      if (m[1] !== undefined) frag.append(el('b', {}, m[1]));
      else if (m[2] !== undefined) frag.append(el('i', {}, m[2]));
      else frag.append(el('code', {}, m[3] ?? ''));
      last = m.index + m[0].length;
    }
    if (last < line.length) frag.append(line.slice(last));
    if (li < lines.length - 1) frag.append(el('br'));
  });
  return frag;
}
