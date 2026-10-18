// Игра «Święta»: картина праздника в рамке в стиле игры. Файлы — `public/swieta/*.jpg` (Wikimedia Commons, автор и лицензия — `credit` узла
// колеса, `CREDITS.md`), не в precache SW (runtime-кэш `pq-swieta`). Картину слегка пикселизуем: рисуем на маленьком холсте и растягиваем
// с `image-rendering: pixelated`. Нет холста (тесты, старый браузер) — обычный `<img>`.
import { el } from '../../ui/dom';
import type { Credit } from './wheel';

const base = (): string => {
  try {
    return import.meta.env.BASE_URL ?? '/';
  } catch {
    return '/';
  }
};

export const picUrl = (file: string): string => `${base()}swieta/${file}`;

export const PIC_W = 192;
export const PIC_H = 144;

/** Рамка с картиной. `w`×`h` — размер холста в «больших пикселях» (чем меньше, тем крупнее квадраты). */
export function picFrame(file: string, alt: string, w = PIC_W, h = PIC_H): HTMLElement {
  const wrap = el('div', { class: 'sw-frame', 'data-pic': file });
  let ctx: CanvasRenderingContext2D | null = null;
  const cv = document.createElement('canvas');
  try {
    cv.width = w;
    cv.height = h;
    ctx = cv.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx || typeof Image === 'undefined') {
    wrap.append(el('img', { class: 'sw-pic', src: picUrl(file), alt, loading: 'lazy' }));
    return wrap;
  }
  cv.className = 'sw-pic';
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', alt);
  cv.style.aspectRatio = `${w} / ${h}`;
  const im = new Image();
  im.onload = () => {
    const iw = im.naturalWidth;
    const ih = im.naturalHeight;
    if (!iw || !ih) return;
    // Обрезка «по ширине рамки»: у портретных картин берём верх, там лица.
    const aspect = w / h;
    let sw = iw;
    let sh = iw / aspect;
    let sx = 0;
    let sy = 0;
    if (sh > ih) {
      sh = ih;
      sw = ih * aspect;
      sx = (iw - sw) / 2;
    } else sy = Math.max(0, (ih - sh) * 0.25);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(im, sx, sy, sw, sh, 0, 0, w, h);
  };
  im.src = picUrl(file);
  wrap.append(cv);
  return wrap;
}

/** «© автор, лицензия · Wikimedia Commons»: обязательная подпись под картиной. */
export function creditLine(c: Credit): HTMLElement {
  const who = /unknown|nieznany/i.test(c.author) ? 'автор неизвестен' : c.author;
  return el('div', { class: 'sw-credit', 'data-credit': '' }, `© ${who}, ${c.license} · `, el('a', { href: c.page, target: '_blank', rel: 'noopener noreferrer' }, 'Wikimedia Commons'));
}

export const picCss = `
.pq-pg .sw-frame { background: #fffaf0; border: 3px solid var(--pq-wood-dark); outline: 2px solid var(--pq-ink); box-shadow: 0 3px 0 2px var(--pq-ink); line-height: 0; overflow: hidden; }
.pq-pg .sw-pic { display: block; width: 100%; height: auto; image-rendering: crisp-edges; image-rendering: pixelated; }
.pq-pg .sw-credit { font-size: 10.5px; line-height: 1.25; opacity: .7; margin-top: 5px; overflow-wrap: anywhere; }
.pq-pg .sw-credit a { color: inherit; }
`;
