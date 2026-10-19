// Бобёр на ферме (просьба Шэфа 19.10), DOM-часть: карточка «Bóbr zamieszkał na farmie!» (один раз, когда бобёр поселился) и пузырь
// «Bóbr · бобёр» с 🔊 над бобром, с которым заговорили (тап или A). Озвучка — `audio:play` (под выключателем звука; с `?mute=1` — в консоль).
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { atlasIcon } from './atlasIcon';
import { el } from './dom';
import { THEME_CSS } from './theme';

/** Сколько висит карточка и пузырь, мс (тап по карточке закрывает раньше). */
export const SETTLE_CARD_MS = 7000;
export const TALK_MS = 5000;

export const BEAVER_PL = 'Bóbr';
export const BEAVER_RU = 'бобёр';

const css = `
${THEME_CSS}
.pq-bvcard { position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 74px); transform: translateX(-50%); z-index: 90; width: min(300px, calc(100vw - 32px)); box-sizing: border-box;
  background: var(--pq-cream); color: var(--pq-ink); border: 3px solid var(--pq-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--pq-ink), inset 0 0 0 3px var(--pq-wood);
  padding: 14px 14px 12px; text-align: center; cursor: pointer; touch-action: manipulation; font: 15px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: pq-bv-pop .45s cubic-bezier(.2, 1.4, .4, 1); }
.pq-bvcard[hidden] { display: none; }
.pq-bvcard .rib { display: inline-block; margin-top: -26px; padding: 4px 14px; background: var(--pq-accent); color: var(--pq-ink); border: 2px solid var(--pq-ink); border-radius: 6px; box-shadow: 0 2px 0 var(--pq-ink);
  font-weight: 800; font-size: 13px; letter-spacing: .4px; text-transform: uppercase; }
.pq-bvcard .ico { margin-top: 10px; min-height: 64px; display: flex; align-items: flex-end; justify-content: center; gap: 6px; }
.pq-bvcard h3 { margin: 6px 0 0; font-size: 22px; font-weight: 800; line-height: 1.15; }
.pq-bvcard .ru { opacity: .75; font-size: 15px; }
@keyframes pq-bv-pop { from { opacity: 0; transform: translateX(-50%) translateY(-18px) scale(.8); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) { .pq-bvcard { animation: none; } }
.pq-bvtalk { position: fixed; z-index: 37; transform: translate(-50%, -100%); max-width: min(240px, calc(100vw - 24px)); padding: 6px 8px 6px 12px; display: flex; align-items: center; gap: 8px;
  background: var(--pq-cream); color: var(--pq-ink); border: 2px solid var(--pq-ink); border-radius: 8px; box-shadow: 0 2px 0 var(--pq-ink);
  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; animation: pq-bv-in .18s ease-out; }
.pq-bvtalk[hidden] { display: none; }
.pq-bvtalk .t b { display: block; font-size: 16px; font-weight: 800; }
.pq-bvtalk button { flex: 0 0 auto; width: 36px; height: 36px; font-size: 18px; line-height: 1; cursor: pointer; touch-action: manipulation; background: var(--pq-wood); color: var(--pq-cream);
  border: 2px solid var(--pq-ink); border-radius: 6px; box-shadow: 0 2px 0 var(--pq-ink); }
.pq-bvtalk button:active { transform: translateY(1px); box-shadow: 0 1px 0 var(--pq-ink); }
@keyframes pq-bv-in { from { opacity: 0; margin-top: 6px; } to { opacity: 1; margin-top: 0; } }
`;

export interface BeaverUi {
  readonly cardOpen: boolean;
  readonly talkOpen: boolean;
  dispose(): void;
}

/** Карточка заселения и пузырь «Bóbr · бобёр». Не блокирует ввод: висит сверху, гаснет сама или по тапу. */
export function mountBeaver(parent: HTMLElement, o: { bus?: Bus<BusEvents>; cardMs?: number; talkMs?: number } = {}): BeaverUi {
  const bus = o.bus ?? globalBus;
  const card = el('div', { class: 'pq-bvcard', role: 'status', 'data-beaver-card': '', hidden: true });
  const talk = el('div', { class: 'pq-bvtalk', role: 'status', 'data-beaver-talk': '', hidden: true });
  parent.append(el('style', {}, css), card, talk);
  let cardTimer: ReturnType<typeof setTimeout> | null = null;
  let talkTimer: ReturnType<typeof setTimeout> | null = null;
  const closeCard = (): void => {
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = null;
    card.hidden = true;
  };
  const closeTalk = (): void => {
    if (talkTimer) clearTimeout(talkTimer);
    talkTimer = null;
    talk.hidden = true;
  };
  card.addEventListener('click', closeCard);
  const say = (): void => {
    bus.emit('audio:play', { id: 'beaver', text: BEAVER_PL });
    if (talkTimer) clearTimeout(talkTimer);
    talkTimer = setTimeout(closeTalk, o.talkMs ?? TALK_MS);
  };
  const offs = [
    bus.on('beaver:settled', () => {
      const pic = atlasIcon('beaver/12', 4) ?? el('span', {}, '🦫');
      card.replaceChildren(
        el('div', { class: 'rib' }, 'Nowy mieszkaniec · Новый житель'),
        el('div', { class: 'ico', 'aria-hidden': 'true' }, pic, atlasIcon('beaver_lodge/0', 2) ?? ''),
        el('h3', { 'data-beaver-title': '' }, 'Bóbr zamieszkał na farmie!'),
        el('div', { class: 'ru' }, 'Бобёр поселился на ферме'),
      );
      card.hidden = false;
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = '';
      if (cardTimer) clearTimeout(cardTimer);
      cardTimer = setTimeout(closeCard, o.cardMs ?? SETTLE_CARD_MS);
    }),
    bus.on('beaver:talk', ({ x, y }) => {
      const btn = el('button', { type: 'button', 'aria-label': 'Озвучить: Bóbr', 'data-beaver-say': '', onclick: say }, '🔊');
      talk.replaceChildren(el('div', { class: 't' }, el('b', {}, BEAVER_PL), BEAVER_RU), btn);
      talk.hidden = false;
      const r = talk.getBoundingClientRect();
      const half = r.width / 2 || 70;
      const vw = typeof innerWidth === 'number' && innerWidth > 0 ? innerWidth : x + half;
      talk.style.left = `${Math.round(Math.min(Math.max(x, half + 6), vw - half - 6))}px`;
      talk.style.top = `${Math.round(Math.max(y, (r.height || 46) + 66))}px`;
      if (talkTimer) clearTimeout(talkTimer);
      talkTimer = setTimeout(closeTalk, o.talkMs ?? TALK_MS);
    }),
    // Открылся экран или мини-игра: пузырь не нужен.
    bus.on('world:input', ({ enabled }) => {
      if (!enabled) closeTalk();
    }),
  ];
  return {
    get cardOpen() {
      return !card.hidden;
    },
    get talkOpen() {
      return !talk.hidden;
    },
    dispose() {
      for (const off of offs) off();
      closeCard();
      closeTalk();
      card.remove();
      talk.remove();
    },
  };
}
