// Стили экранов Wola (W-01): места без ходьбы, ноутбук «Słowniczek» в виде пиксельного монитора, полка, огород.
const css = `
.wl-place { position: absolute; inset: 0; display: flex; flex-direction: column; background: #1a1c2c; animation: wl-flash .14s ease-out; }
@keyframes wl-flash { from { filter: brightness(1.9); } to { filter: none; } }
.wl-bar { flex: none; display: flex; align-items: center; gap: 8px; padding: calc(6px + env(safe-area-inset-top)) 10px 6px; background: #3b3643; color: #f2eaf1; }
.wl-bar h2 { flex: 1; margin: 0; font-size: 20px; line-height: 1.1; }
.wl-bar h2 small { display: block; font-size: 13px; font-weight: 400; color: #d3a2c0; }
.wl-stage { position: relative; flex: 1; min-height: 0; overflow: auto; display: flex; align-items: center; justify-content: center; }
.wl-scene { position: relative; margin: auto; }
.wl-room { position: relative; image-rendering: pixelated; }
.wl-tile, .wl-spr { position: absolute; display: block; image-rendering: pixelated; }
.wl-spr { position: relative; }
.wl-hot { position: absolute; box-sizing: border-box; border: 3px dashed transparent; border-radius: 6px; background: transparent; padding: 0; cursor: pointer; }
.wl-hot:focus { outline: none; }
.wl-hot:focus-visible, .wl-hot:hover, .wl-hot.pq-focus { border-color: #ffd966; background: rgba(255, 217, 102, .12); }
.wl-tag { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; pointer-events: none; display: flex; flex-direction: column; align-items: center;
  padding: 2px 8px; border-radius: 6px; background: rgba(20, 27, 27, .82); color: #fff; font-size: 15px; font-weight: 700; line-height: 1.15; }
.wl-tag small { font-size: 12px; font-weight: 400; color: #b8dce5; }
.wl-tag .cnt { margin-top: 2px; padding: 0 6px; border-radius: 8px; background: #e89b2f; color: #141b1b; font-size: 12px; font-weight: 700; }
.wl-tag .cnt.due { background: #e0394c; color: #fff; }
.wl-scene.small .wl-tag { font-size: 12px; padding: 1px 5px; }
.wl-scene.small .wl-tag small { display: none; }
.wl-scene.small .wl-tag .cnt { font-size: 11px; }
.wl-tag.top { bottom: calc(100% + 2px); }
.wl-tag.bottom { top: calc(100% + 2px); }

/* Подписи мест на улице (W-04: выше двери, над фасадом, или под калиткой — дверь всегда видна). */
.wl-spots { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.wl-spot { position: absolute; transform: translate(-50%, -100%); pointer-events: auto; border: 0; background: none; padding: 0 0 4px; cursor: pointer; font: inherit; }
.wl-spot.below { transform: translate(-50%, 0); padding: 4px 0 0; }
.wl-spot .cnt { white-space: normal; max-width: 220px; text-align: center; }
.wl-spot .wl-tag { position: static; transform: none; }
.wl-hud { position: absolute; right: calc(8px + env(safe-area-inset-right)); top: calc(8px + env(safe-area-inset-top)); z-index: 5; display: flex; gap: 6px; }
.wl-hud[hidden] { display: none; }
.wl-title { position: absolute; left: calc(8px + env(safe-area-inset-left)); top: calc(8px + env(safe-area-inset-top)); z-index: 5; pointer-events: none;
  padding: 4px 10px; border-radius: 6px; background: rgba(20, 27, 27, .7); color: #fff; font-weight: 700; font-size: 18px; }
.wl-title small { display: block; font-size: 12px; font-weight: 400; color: #b8dce5; }
.wl-title[hidden] { display: none; }

/* Ноутбук «Słowniczek»: монитор с рамкой, экран тёмный, моноширинный шрифт. */
.wl-laptop { width: min(100% - 16px, 560px); max-height: calc(100% - 16px); margin: auto; box-sizing: border-box; display: flex; flex-direction: column;
  padding: 14px 14px 10px; background: #4e484a; border: 4px solid #141b1b; border-radius: 10px; box-shadow: inset 0 0 0 3px #695953, 0 8px 0 #141b1b; }
.wl-laptop .base { height: 10px; margin: 8px -24px -18px; background: #8e7c73; border: 4px solid #141b1b; border-radius: 0 0 14px 14px; }
.wl-screen { position: relative; flex: 1; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 12px 14px; border: 4px solid #141b1b; border-radius: 4px;
  background: #1a1c2c; color: #b8dce5; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 16px;
  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px); }
.wl-screen .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.wl-screen .head b { flex: 1; color: #ffd966; font-size: 17px; }
.wl-screen .head b small { display: block; color: #79b8ce; font-weight: 400; font-size: 13px; }
.wl-bar8 { display: flex; gap: 3px; align-items: center; }
.wl-bar8 i { width: 14px; height: 10px; background: #345a52; box-shadow: inset 0 0 0 2px #141b1b; }
.wl-bar8 i.on { background: #74a334; }
.wl-bar8 span { margin-left: 6px; color: #8feff1; font-size: 14px; }
.wl-card { display: flex; flex-direction: column; gap: 8px; padding: 8px 2px; }
.wl-card .word { font-size: 34px; font-weight: 700; color: #f4f8fb; min-height: 1.2em; letter-spacing: .5px; overflow-wrap: anywhere; }
.wl-card .word .caret { display: inline-block; width: .55em; height: .9em; margin-left: 2px; background: #74a334; vertical-align: -.1em; animation: wl-blink 1s steps(1) infinite; }
@keyframes wl-blink { 50% { opacity: 0; } }
.wl-card .tr { color: #79b8ce; font-size: 17px; }
.wl-card .tl { color: #ffd966; font-size: 20px; }
.wl-card .ex { border-left: 3px solid #345a52; padding-left: 8px; font-size: 15px; }
.wl-card .ex .pl { color: #f2eaf1; }
.wl-card .ex .exru { color: #8d977f; }
.wl-card .theme { color: #a5608b; font-size: 13px; }
.wl-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; margin-top: 6px; }
.wl-row .grow { flex: 1; }
.wl-screen .pq-btn { font-family: inherit; }
.wl-screen .msg { color: #b8dce5; font-size: 16px; line-height: 1.4; }
.wl-screen .msg b { color: #ffd966; }
.wl-screen .warn { color: #ef9597; }
.wl-screen .pq-lesson .pq-wood { background: #f0e5d1; }

/* Полка, банки, итог: деревянные панели основной игры. */
.wl-panel { width: min(100% - 16px, 560px); max-height: calc(100% - 24px); margin: auto; box-sizing: border-box; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.wl-panel h2 { margin: 0; font-size: 22px; color: #543c52; }
.wl-panel h2 small { display: block; font-size: 15px; font-weight: 500; }
.wl-panel .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.wl-panel .stat { display: flex; justify-content: space-between; gap: 12px; font-size: 18px; border-bottom: 2px dotted #c8966b; padding: 4px 0; }
.wl-panel .list { font-size: 16px; color: #345a52; }
.wl-panel .note { font-size: 16px; color: #8f3e56; }
.wl-theme { flex: none; display: flex; align-items: center; gap: 10px; text-align: left; justify-content: flex-start; }
.wl-panel .body > * { flex-shrink: 0; }
.wl-theme .t { flex: 1; display: flex; flex-direction: column; }
.wl-theme .t small { font-weight: 400; font-size: 14px; color: #543c52; }
.wl-theme .n { font-size: 15px; color: #345a52; white-space: nowrap; }
.wl-theme .meter { width: 64px; height: 8px; background: #d3865f55; border-radius: 4px; overflow: hidden; }
.wl-theme .meter i { display: block; height: 100%; background: #74a334; }
.wl-jars { display: flex; flex-wrap: wrap; gap: 6px; }
.wl-jar { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 64px; padding: 4px; font-size: 14px; }
.wl-jar .due { color: #e0394c; font-weight: 700; }

/* Огород. */
.wl-garden { box-sizing: border-box; width: 100%; max-width: 640px; margin: 0 auto; padding: 10px; }
.wl-beds { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; }
.wl-plant { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; min-height: 92px; padding: 4px 2px;
  border: 3px solid #91522c; border-radius: 6px; color: #fff; cursor: pointer; font: inherit;
  background: repeating-linear-gradient(0deg, #965340 0 3px, #9c6546 3px 9px); box-shadow: 0 3px 0 #543c52; }
.wl-plant .wl-spr { z-index: 1; }
.wl-plant .w { position: relative; z-index: 1; font-size: 13px; font-weight: 700; text-shadow: 0 1px 0 #141b1b; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-plant .mark { position: absolute; top: 2px; right: 4px; z-index: 2; min-width: 18px; height: 18px; border-radius: 9px; background: #e0394c; color: #fff; font-weight: 800; font-size: 13px; line-height: 18px; text-align: center; }
.wl-plant .mark.ripe { background: #e89b2f; color: #141b1b; }
.wl-plant.wilted .wl-spr { filter: sepia(.9) saturate(.6) brightness(.85); transform: rotate(-8deg); }
.wl-plant:focus { outline: none; }
.wl-plant:focus-visible, .wl-plant.pq-focus { outline: 3px solid #ffd966; outline-offset: 2px; }
.wl-garden .empty { color: #141b1b; font-size: 18px; text-align: center; padding: 30px 10px; }
.wl-ogrod .wl-stage { display: block; background-color: #56864c;
  background-image: radial-gradient(#345a52 1.5px, transparent 1.6px), radial-gradient(#74a334 1px, transparent 1.2px);
  background-size: 14px 14px, 22px 22px; background-position: 0 0, 7px 9px; }
.wl-foot:empty { display: none; }
.wl-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
  padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); background: rgba(26, 28, 44, .92); }
.wl-legend { display: inline-block; color: #141b1b; background: rgba(240,229,209,.85); border-radius: 6px; padding: 4px 8px; font-size: 14px; margin: 0 0 8px; }

/* Salad Story (W-02): сцена сверху, стойка/шаги визита снизу. */
.wl-salad .wl-stage { display: block; overflow: hidden; background: #3b3643; }
.wl-ss { position: absolute; inset: 0; display: flex; flex-direction: column; }
.wl-ss-top { flex: none; display: flex; justify-content: center; padding: 4px 4px 0; }
.wl-ss-panel { position: relative; flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 6px 6px calc(6px + env(safe-area-inset-bottom)); }
.wl-ss-panel .pq-lesson { position: static; width: auto; height: auto; max-height: none; margin: 0 auto; max-width: 620px; }
.wl-ss-panel .pq-lesson .pq-wood { max-height: none; }
.wl-ss-scene { overflow: hidden; border: 3px solid #141b1b; border-radius: 6px; }
.wl-ss-cashier { position: absolute; z-index: 1; }
.wl-ss-bowl { position: absolute !important; z-index: 2; }
.wl-ss-board { position: absolute; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #f4f8fb; line-height: 1.05;
  text-align: center; overflow: hidden; font-family: ui-monospace, Menlo, monospace; }
.wl-ss-board b { color: #ffd966; font-weight: 700; }
.wl-ss-think, .wl-ss-say { position: absolute; z-index: 3; max-width: 38%; box-sizing: border-box; padding: 4px 8px; border: 2px solid #141b1b; border-radius: 10px;
  background: #f4f8fb; color: #141b1b; font-size: 13px; line-height: 1.2; box-shadow: 0 2px 0 #141b1b; }
/* Облачко — мысль Димы: он стоит перед стойкой, облачко внизу справа, хвостик вниз. Пузырь кассира — вверху слева. */
.wl-ss-think { right: 4px; bottom: 12px; max-width: 44%; display: flex; align-items: center; gap: 4px; border-radius: 14px; }
.wl-ss-think::after { content: ''; position: absolute; left: 14px; bottom: -8px; width: 6px; height: 6px; border: 2px solid #141b1b; border-radius: 50%; background: #f4f8fb; }
.wl-ss-think[hidden], .wl-ss-say[hidden] { display: none; }
.wl-ss-say { left: 4px; top: 4px; display: flex; flex-direction: column; background: #ffe18d; }
.wl-ss-say small { color: #543c52; font-size: 11px; }
.wl-ss-card { max-width: 620px; margin: 0 auto; box-sizing: border-box; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.wl-ss-card h3 { margin: 0; font-size: 20px; color: #543c52; }
.wl-ss-card h3 small { display: block; font-size: 14px; font-weight: 500; }
.wl-ss-card .goal { font-size: 15px; color: #345a52; }
.wl-ss-card .note { font-size: 15px; color: #8f3e56; }
.wl-ss-card .stat { display: flex; justify-content: space-between; gap: 10px; font-size: 16px; border-bottom: 2px dotted #c8966b; padding: 3px 0; }
.wl-ss-card .mine { font-size: 14px; color: #543c52; }
.wl-ss-card .up { font-size: 18px; font-weight: 700; color: #56864c; }
.wl-ss-card .big { font-size: 28px; font-weight: 800; color: #56864c; text-align: center; }
.wl-ss-card .big small { font-size: 15px; font-weight: 500; color: #543c52; }
.wl-ss-stamps { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; color: #543c52; }
.wl-ss-stamps .cells { display: inline-flex; gap: 3px; }
.wl-ss-stamps .cells i { width: 16px; height: 16px; border: 2px solid #91522c; border-radius: 50%; box-sizing: border-box; }
.wl-ss-stamps .cells i.on { background: #e0394c; border-color: #8f3e56; }
.wl-ss-stamps .gold { color: #91522c; font-weight: 700; }
.wl-ss-tried { display: flex; flex-direction: column; gap: 2px; font-size: 14px; color: #543c52; }
.wl-ss-tried .bowls { display: flex; flex-wrap: wrap; gap: 2px; }
.wl-ss-tried .ghost { filter: grayscale(1) brightness(.35); opacity: .45; }
.wl-ss-tray { position: relative; margin: 0 auto; }
.wl-ss-item { position: absolute !important; }
.wl-ss-gag { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #8f3e56; }
.wl-ss-real { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 3px dashed #e89b2f; border-radius: 8px; background: #fff7e0; }
.wl-ss-real > b { color: #91522c; font-size: 14px; }
.wl-ss-real .phrase { font-size: 20px; font-weight: 800; color: #141b1b; }
.wl-ss-real small { font-size: 13px; color: #543c52; }
.pq-pick { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.pq-pick-item { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 84px; min-height: 84px; padding: 6px; background: #b8dce5; }
.pq-pick-item .lbl { font-size: 14px; font-weight: 700; }
.pq-pick-item.ok, .pq-pick-item.show { outline: 4px solid #74a334; }
.pq-pick-item.bad { outline: 4px solid #e0394c; opacity: .6; }

/* W-04: план дня, полоса «Wola» над ноутбуком, проверка внутри экрана ноутбука, кнопки салатной у нижнего края. */
.wl-plan { display: inline-block; margin: 0 0 8px; padding: 4px 10px; border-radius: 6px; background: rgba(240, 229, 209, .94); color: #345a52;
  font-size: 15px; font-weight: 700; line-height: 1.25; box-shadow: 0 2px 0 #141b1b; }
.wl-plan small { font-weight: 400; color: #543c52; }
.wl-plan-top { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); z-index: 2; margin: 0; max-width: calc(100% - 16px); box-sizing: border-box; text-align: center; }
.wl-screen .head small.plan { color: #ffd966; margin-top: 2px; }
.wl-laptop-layer:has(> .wl-laptop-bar) { background: rgba(26, 28, 44, .9); }
.wl-laptop-layer > .wl-laptop-bar { flex: none; align-self: stretch; }
.wl-laptop-layer > .wl-laptop { flex: 0 1 auto; min-height: 0; }
.wl-screen > .head { position: sticky; top: -12px; z-index: 2; margin: -12px -14px 10px; padding: 12px 14px 8px; background: #1a1c2c; }
.wl-screen .pq-lesson { width: auto; height: auto; max-height: none; padding: 0; }
.wl-screen .pq-lesson > .pq-wood { flex: none; }
.wl-screen .pq-lesson-main { overflow: visible; }
.wl-ss-panel .pq-lesson-main { overflow: visible; }
.wl-ss-panel .pq-ex-actions { background: #f0e5d1; padding-bottom: 6px; z-index: 2; }
.wl-ss-card > .wl-row:last-child { position: sticky; bottom: -6px; z-index: 2; margin: 0 -14px -12px; padding: 8px 14px; background: #f0e5d1; border-radius: 0 0 8px 8px; }
.wl-ss-real-mark { color: #345a52; font-weight: 600; }

/* Пиксельный загрузчик (W-04): вместо тёмного экрана при входе в место, пока картинки атласа не готовы. */
.wl-loading { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: #1a1c2c; color: #b8dce5; font: 700 15px ui-monospace, Menlo, monospace; }
.wl-loading .blocks { display: flex; gap: 4px; }
.wl-loading .blocks i { width: 12px; height: 12px; background: #345a52; box-shadow: inset 0 0 0 2px #141b1b; animation: wl-load 0.9s steps(1) infinite; }
.wl-loading .blocks i:nth-child(2) { animation-delay: .15s; } .wl-loading .blocks i:nth-child(3) { animation-delay: .3s; }
.wl-loading .blocks i:nth-child(4) { animation-delay: .45s; } .wl-loading .blocks i:nth-child(5) { animation-delay: .6s; }
@keyframes wl-load { 0% { background: #74a334; } 50% { background: #345a52; } }

/* Быстрые переходы (W-04): мелкие иконки мест в углу улицы, клавиши 1/2/3. */
.wl-jump { position: absolute; right: calc(8px + env(safe-area-inset-right)); top: calc(52px + env(safe-area-inset-top)); z-index: 5; display: flex; flex-direction: column; gap: 4px; }
.wl-jump[hidden] { display: none; }
.wl-jump button { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 2px 6px 2px 2px; border: 2px solid #141b1b; border-radius: 6px;
  background: rgba(240, 229, 209, .9); color: #141b1b; font: 700 12px ui-monospace, Menlo, monospace; cursor: pointer; }
.wl-jump button .k { display: inline-block; min-width: 14px; padding: 0 2px; border-radius: 3px; background: #3b3643; color: #f2eaf1; text-align: center; }
.wl-jump button:focus-visible { outline: 3px solid #ffd966; }
`;

export function ensureWolaStyle(doc: Document): void {
  if (doc.getElementById('wl-style')) return;
  const s = doc.createElement('style');
  s.id = 'wl-style';
  s.textContent = css;
  doc.head.append(s);
}
