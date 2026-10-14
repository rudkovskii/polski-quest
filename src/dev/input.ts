// Dev-страница `/?dev=input` (I-03): поток intents от клавиатуры, d-pad и тапа без Phaser.
// Квадрат на сетке 10×10 ходит по intents, лог показывает каждый intent после роутера,
// поле ввода подключено к экранной клавиатуре. Это склейка слоёв, как main.ts.
import { startInput, type Dir, type RoutedIntent } from '../input';
import { bus } from '../systems/bus';
import { el } from '../ui/dom';
import { mountDpad } from '../ui/dpad';
import { attachKeyboard, type KeyboardMode } from '../ui/keyboard';

const N = 10;
const STEP_MS = 1000 / 6; // 6 клеток/с (ТЗ §2.7)
const WALLS = new Set(['3,2', '3,3', '3,4', '3,5', '6,6', '7,6', '8,6', '6,1']);
const OBJECTS = [
  { id: 'npc.zosia', x: 8, y: 2, color: '#ef7d57' },
  { id: 'word.chleb', x: 1, y: 7, color: '#ffcd75' },
  { id: 'sign.metro', x: 5, y: 8, color: '#41a6f6' },
];
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const css = `
.pq-dev { position: fixed; inset: 0; overflow: auto; padding: calc(env(safe-area-inset-top) + 10px) 12px 220px; box-sizing: border-box;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f4f4f4; background: #1a1c2c; }
.pq-dev h1 { font-size: 16px; margin: 0 0 8px; color: #ffcd75; }
.pq-dev .controls { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 8px; font-size: 13px; }
.pq-dev select { font: inherit; }
.pq-dev .stage { position: relative; width: fit-content; }
.pq-dev canvas { display: block; image-rendering: pixelated; touch-action: none; border: 2px solid #566c86; }
.pq-dev .fake-overlay { position: absolute; left: 10%; right: 10%; top: 30%; padding: 12px; background: #29366fee; border: 2px solid #f4f4f4; border-radius: 6px; text-align: center; pointer-events: none; }
.pq-dev .status { margin: 6px 0; font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #94b0c2; }
.pq-dev .field { max-width: 560px; margin: 10px 0; }
.pq-dev .field input { width: 100%; box-sizing: border-box; font-size: 20px; padding: 8px; border-radius: 6px; border: 2px solid #566c86; background: #f4f4f4; color: #1a1c2c; }
.pq-dev .log { font-family: ui-monospace, Menlo, monospace; font-size: 12px; max-width: 560px; white-space: pre; overflow-x: auto; background: #333c57; padding: 6px; border-radius: 6px; min-height: 120px; }
`;

function select<T extends string>(label: string, values: readonly T[], value: T, onChange: (v: T) => void): HTMLElement {
  const s = el('select', { onchange: () => onChange(s.value as T) }, ...values.map((v) => el('option', { value: v, selected: v === value }, v)));
  return el('label', {}, `${label} `, s);
}

export function mountInputDev(parent: HTMLElement): void {
  const tile = Math.max(24, Math.min(32, Math.floor((window.innerWidth - 32) / N)));
  const canvas = el('canvas', { width: N * tile, height: N * tile, 'aria-label': 'Сетка 10×10' });
  const fakeOverlay = el('div', { class: 'fake-overlay', hidden: true }, 'Оверлей открыт: intents → ui. Тап по карте = cancel');
  const status = el('div', { class: 'status' });
  const log = el('div', { class: 'log', 'data-testid': 'log' });
  const field = el('input', { type: 'text', placeholder: 'Wpisz: zażółć gęślą jaźń', 'aria-label': 'Поле ввода' });
  const lines: string[] = [];

  const player = { x: 1, y: 1, face: 'down' as Dir };
  let moveDir: Dir | null = null;
  let path: [number, number][] = [];
  let pendingTarget: string | null = null;
  let flash: { x: number; y: number; until: number } | null = null;
  let selected = 0;
  let acc = 0;

  const write = (s: string): void => {
    lines.unshift(s);
    lines.length = Math.min(lines.length, 40);
    log.textContent = lines.join('\n');
  };

  const free = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < N && y < N && !WALLS.has(`${x},${y}`) && !OBJECTS.some((o) => o.x === x && o.y === y);

  const bfs = (to: [number, number], adjacent = false): [number, number][] => {
    const key = (x: number, y: number): string => `${x},${y}`;
    const prev = new Map<string, string | null>([[key(player.x, player.y), null]]);
    const queue: [number, number][] = [[player.x, player.y]];
    const isGoal = (x: number, y: number): boolean =>
      adjacent ? Math.abs(x - to[0]) + Math.abs(y - to[1]) === 1 : x === to[0] && y === to[1];
    while (queue.length) {
      const [x, y] = queue.shift() as [number, number];
      if (isGoal(x, y)) {
        const out: [number, number][] = [];
        for (let k: string | null = key(x, y); k && k !== key(player.x, player.y); k = prev.get(k) ?? null) {
          const [a, b] = k.split(',').map(Number) as [number, number];
          out.unshift([a, b]);
        }
        return out;
      }
      for (const [dx, dy] of Object.values(DELTA)) {
        const nx = x + dx;
        const ny = y + dy;
        if (!free(nx, ny) || prev.has(key(nx, ny))) continue;
        prev.set(key(nx, ny), key(x, y));
        queue.push([nx, ny]);
      }
    }
    return [];
  };

  const step = (dir: Dir): void => {
    player.face = dir;
    const [dx, dy] = DELTA[dir];
    if (free(player.x + dx, player.y + dy)) {
      player.x += dx;
      player.y += dy;
    }
  };

  const interactWith = (id: string | undefined): void => {
    const obj = id
      ? OBJECTS.find((o) => o.id === id)
      : OBJECTS.find((o) => o.x === player.x + DELTA[player.face][0] && o.y === player.y + DELTA[player.face][1]) ??
        OBJECTS.find((o) => Math.abs(o.x - player.x) + Math.abs(o.y - player.y) === 1);
    if (obj) {
      flash = { x: obj.x, y: obj.y, until: performance.now() + 400 };
      write(`   → действие с ${obj.id}`);
    } else {
      flash = { x: player.x, y: player.y, until: performance.now() + 250 };
    }
  };

  const onWorld = (i: RoutedIntent): void => {
    switch (i.type) {
      case 'move':
        if (i.held) {
          path = []; // move отменяет goto
          pendingTarget = null;
          moveDir = i.dir;
          step(i.dir);
          acc = 0;
        } else if (moveDir === i.dir) moveDir = null;
        break;
      case 'goto':
        moveDir = null;
        pendingTarget = null;
        path = bfs(i.tile);
        break;
      case 'interact': {
        const id = i.target ?? (router.state.mapControls === 'tap' ? OBJECTS[selected]?.id : undefined);
        const obj = OBJECTS.find((o) => o.id === id);
        if (obj && Math.abs(obj.x - player.x) + Math.abs(obj.y - player.y) !== 1) {
          path = bfs([obj.x, obj.y], true); // объект вдали: подойти, потом действие
          pendingTarget = obj.id;
        } else interactWith(id);
        break;
      }
      case 'cancel':
        path = [];
        pendingTarget = null;
        break;
      case 'focus':
        selected = (selected + (i.dir === 'prev' || i.dir === 'left' || i.dir === 'up' ? OBJECTS.length - 1 : 1)) % OBJECTS.length;
        break;
    }
  };

  bus.on('input:intent', (i) => {
    const { type, to, source, ...rest } = i;
    write(`${to.padEnd(5)} ${source.padEnd(8)} ${type} ${JSON.stringify(rest)}`);
    if (to === 'world') onWorld(i);
    else if (type === 'cancel') bus.emit('world:input', { enabled: true }); // оверлей закрылся
  });
  bus.on('world:input', ({ enabled }) => {
    fakeOverlay.hidden = enabled;
    overlayBox.checked = !enabled;
  });

  const overlayBox = el('input', { type: 'checkbox', onchange: () => bus.emit('world:input', { enabled: !overlayBox.checked }) });
  let kb: ReturnType<typeof attachKeyboard> | null = null;
  const controls = el(
    'div',
    { class: 'controls' },
    select('controls', ['walk', 'tap'] as const, 'walk', (v) => router.setMapControls(v)),
    select('dpad', ['auto', 'always', 'never'] as const, 'auto', (v) => router.setControls({ dpad: v })),
    select('side', ['left', 'right'] as const, 'left', (v) => router.setControls({ dpadSide: v })),
    select('keyboard', ['auto', 'strip', 'full'] as const, 'auto', (v: KeyboardMode) => kb?.setMode(v)),
    el('label', {}, overlayBox, ' оверлей'),
  );

  const root = el(
    'div',
    { class: 'pq-dev' },
    el('style', {}, css),
    el('h1', {}, 'dev: input (I-03)'),
    controls,
    el('div', { class: 'stage' }, canvas, fakeOverlay),
    status,
    el('div', { class: 'field' }, field),
    log,
  );
  parent.append(root);
  kb = attachKeyboard(field, { onEnter: () => write(`Enter: «${field.value}»`) });

  const dpad = mountDpad(document.body);
  const { router } = startInput({
    dpad,
    pointer: {
      target: canvas,
      tileAt(x, y) {
        const c = Math.floor(x / tile);
        const r = Math.floor(y / tile);
        if (c < 0 || r < 0 || c >= N || r >= N) return null;
        const obj = OBJECTS.find((o) => o.x === c && o.y === r);
        return obj ? { tile: [c, r], target: obj.id } : { tile: [c, r] };
      },
    },
  });
  (window as unknown as { __pq?: unknown }).__pq = { router, bus };

  const ctx = canvas.getContext('2d');
  let last = performance.now();
  const frame = (t: number): void => {
    const dt = t - last;
    last = t;
    acc += dt;
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      if (moveDir) step(moveDir);
      else if (path.length) {
        const [nx, ny] = path.shift() as [number, number];
        player.face = nx > player.x ? 'right' : nx < player.x ? 'left' : ny > player.y ? 'down' : 'up';
        player.x = nx;
        player.y = ny;
        if (!path.length && pendingTarget) {
          const obj = OBJECTS.find((o) => o.id === pendingTarget);
          if (obj) player.face = obj.x > player.x ? 'right' : obj.x < player.x ? 'left' : obj.y > player.y ? 'down' : 'up';
          interactWith(pendingTarget);
          pendingTarget = null;
        }
      }
    }
    if (!moveDir && !path.length) acc = Math.min(acc, STEP_MS);
    if (ctx) {
      ctx.fillStyle = '#257179';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#38b764';
      for (let i = 0; i <= N; i++) {
        ctx.beginPath();
        ctx.moveTo(i * tile + 0.5, 0);
        ctx.lineTo(i * tile + 0.5, N * tile);
        ctx.moveTo(0, i * tile + 0.5);
        ctx.lineTo(N * tile, i * tile + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = '#566c86';
      for (const w of WALLS) {
        const [x, y] = w.split(',').map(Number) as [number, number];
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
      ctx.fillStyle = '#73eff788';
      for (const [x, y] of path) ctx.fillRect(x * tile + tile / 3, y * tile + tile / 3, tile / 3, tile / 3);
      OBJECTS.forEach((o, idx) => {
        ctx.fillStyle = o.color;
        ctx.fillRect(o.x * tile + 4, o.y * tile + 4, tile - 8, tile - 8);
        if (router.state.mapControls === 'tap' && idx === selected) {
          ctx.strokeStyle = '#f4f4f4';
          ctx.lineWidth = 3;
          ctx.strokeRect(o.x * tile + 1.5, o.y * tile + 1.5, tile - 3, tile - 3);
          ctx.lineWidth = 1;
        }
      });
      const lit = flash && flash.until > t;
      if (flash && !lit) flash = null;
      if (lit && flash) {
        ctx.fillStyle = '#f4f4f4';
        ctx.fillRect(flash.x * tile + 2, flash.y * tile + 2, tile - 4, tile - 4);
      }
      ctx.fillStyle = '#b13e53';
      ctx.fillRect(player.x * tile + 3, player.y * tile + 3, tile - 6, tile - 6);
      const [fx, fy] = DELTA[player.face];
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(player.x * tile + tile / 2 - 2 + fx * (tile / 4), player.y * tile + tile / 2 - 2 + fy * (tile / 4), 4, 4);
    }
    const s = router.state;
    status.textContent = `focus=${s.focus} controls=${s.mapControls} source=${s.lastSource ?? '—'} held=${s.heldDir ?? '—'} coarse=${s.coarse} dpad=${s.dpadVisible ? 'on' : 'off'} pos=${player.x},${player.y}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
