// Стили оверлея диалогов и упражнений (I-08): деревянная рамка в духе Stardew по палитре
// art/palette.json (x_orange_1, brown_4, plum_0, x_orange_5, ink). Текст ≥ 17 px, цели касания ≥ 44 px,
// системный шрифт (польские глифы), safe-area даёт #overlay. Вставляются один раз на документ.

const css = `
.pq-layer { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center;
  background: rgba(20,27,27,.38); font-size: 17px; line-height: 1.35; color: #141b1b; touch-action: manipulation; overscroll-behavior: none; }
.pq-layer[inert] { filter: brightness(.8); }
.pq-wood { position: relative; box-sizing: border-box; background: #f0e5d1; color: #141b1b; border: 4px solid #91522c; border-radius: 8px;
  box-shadow: 0 0 0 3px #3b3643, inset 0 0 0 3px #d3865f, inset 0 0 0 5px #f0e5d1, 0 8px 0 3px rgba(20,27,27,.45); }
.pq-btn { box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 8px 16px; font: inherit; font-size: 17px; font-weight: 600; color: #141b1b;
  background: #ffcba9; border: 3px solid #91522c; border-radius: 6px; box-shadow: 0 3px 0 #543c52; cursor: pointer; touch-action: manipulation;
  -webkit-user-select: none; user-select: none; }
.pq-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 #543c52; }
.pq-btn:disabled { opacity: .45; cursor: default; }
.pq-btn:focus { outline: none; }
.pq-btn:focus-visible, .pq-btn.pq-focus { outline: 3px solid #e89b2f; outline-offset: 2px; }
.pq-btn.primary { background: #74a334; color: #141b1b; border-color: #56864c; box-shadow: 0 3px 0 #345a52; }
.pq-btn.ghost { background: transparent; border-color: transparent; box-shadow: none; color: #695953; font-weight: 500; }
.pq-btn.icon { padding: 6px 10px; min-width: 44px; }
.pq-btn2 { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; padding-top: 5px; padding-bottom: 5px; }
.pq-btn2[hidden] { display: none; }
.pq-btn2 .pl { font-weight: 700; }
.pq-btn2 .ru { font-size: 12px; font-weight: 500; opacity: .8; margin-top: 2px; }
.pq-btn.ok { background: #a8d672; border-color: #56864c; }
.pq-btn.bad { background: #ef9597; border-color: #8f3e56; animation: pq-shake .35s; }
.pq-btn.show { background: #a8d672; border-color: #56864c; box-shadow: 0 0 0 3px #f2eaf1, 0 3px 0 #345a52; }
@keyframes pq-shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) } 75% { transform: translateX(5px) } }
@keyframes pq-wobble { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-8deg) } 75% { transform: rotate(8deg) } }
@keyframes pq-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
@media (prefers-reduced-motion: reduce) { .pq-btn.bad, .pq-react, .pq-emote { animation: none !important; } }

/* Портрет: кадр атласа с целым масштабом в рамке 48×48 (CSS 64). */
.pq-portrait { position: relative; flex: none; width: 64px; height: 64px; box-sizing: border-box; border: 3px solid #91522c; border-radius: 6px;
  background: #b8dce5; overflow: hidden; display: flex; align-items: center; justify-content: center; image-rendering: pixelated; }
.pq-portrait .pix { image-rendering: pixelated; background-repeat: no-repeat; }
.pq-portrait .sil { position: relative; width: 70%; height: 80%; align-self: flex-end; }
.pq-portrait .sil .head { position: absolute; left: 30%; top: 8%; width: 40%; height: 40%; border-radius: 50%; background: #4a5270; }
.pq-portrait .sil .body { position: absolute; left: 6%; bottom: 0; width: 88%; height: 40%; border-radius: 45% 45% 0 0; background: #4a5270; }
.pq-react { animation: pq-wobble .45s 2; }
.pq-emote { position: absolute; right: -6px; top: -10px; min-width: 26px; height: 26px; padding: 0 4px; box-sizing: border-box; border-radius: 13px;
  background: #fff; border: 2px solid #3b3643; font: 700 16px/22px -apple-system, sans-serif; text-align: center; color: #3b3643; animation: pq-pop .3s; }

/* Диалог */
.pq-dlg { width: min(100% - 16px, 720px); margin: 0 8px calc(8px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
.pq-dlg-choices { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.pq-dlg-choices .pq-btn { max-width: 92%; text-align: left; }
.pq-dlg-choices .pq-btn small { display: block; font-weight: 400; font-size: 15px; color: #543c52; }
.pq-line { display: flex; gap: 12px; padding: 20px 14px 12px; min-height: 120px; margin-top: 16px; }
.pq-line-who { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.pq-line-name { position: absolute; left: 14px; top: -17px; white-space: nowrap; padding: 2px 10px; background: #ffcba9; border: 3px solid #91522c; border-radius: 6px;
  font-weight: 700; font-size: 16px; color: #3b3643; box-shadow: 0 0 0 2px #3b3643; }
.pq-line-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pq-line-pl { font-size: 20px; font-weight: 600; min-height: 1.4em; cursor: pointer; }
.pq-line-pl.todo { color: #8f3e56; font-family: ui-monospace, Menlo, monospace; font-size: 17px; }
.pq-line-ru { font-size: 17px; color: #543c52; }
.pq-line-ru.hidden-ru { color: #695953; font-style: italic; }
.pq-line-rus { font-size: 17px; color: #3a2c38; margin-top: 4px; }
.pq-line-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.pq-line-next { position: absolute; right: 12px; bottom: 8px; }
.pq-noaudio { font-size: 15px; color: #8f3e56; }

/* Урок */
.pq-lesson { width: min(100%, 680px); height: 100%; max-height: 100%; display: flex; flex-direction: column; box-sizing: border-box; padding: 8px; }
.pq-lesson > .pq-wood { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pq-lesson-top { display: flex; align-items: center; gap: 8px; padding: 10px 10px 6px; }
.pq-lesson-top .title { flex: 1; min-width: 0; font-weight: 700; color: #543c52; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pq-lesson-top .pq-portrait { width: 48px; height: 48px; }
.pq-dots { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 6px; }
.pq-dot { width: 12px; height: 12px; border-radius: 3px; background: #d2b37d; border: 2px solid #91522c; box-sizing: border-box; }
.pq-dot.cur { background: #e89b2f; }
.pq-dot.ok { background: #74a334; }
.pq-dot.bad { background: #e0394c; }
.pq-dot.rep { border-style: dashed; }
.pq-lesson-main { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 14px 14px; }

/* Шаг упражнения */
.pq-ex { display: flex; flex-direction: column; gap: 12px; }
.pq-ex-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 19px; font-weight: 600; }
.pq-ex-head .q { flex: 1 1 200px; }
.pq-ex-body { display: flex; flex-direction: column; gap: 10px; }
.pq-opts { display: flex; flex-direction: column; gap: 8px; }
.pq-opts.row { flex-direction: row; flex-wrap: wrap; justify-content: center; }
.pq-opts .pq-btn { text-align: left; font-weight: 500; font-size: 19px; }
.pq-opts.row .pq-btn { text-align: center; min-width: 96px; }
.pq-sign { font-family: ui-monospace, Menlo, monospace; text-transform: uppercase; letter-spacing: .04em; background: #2d697b !important; color: #f4f8fb !important; border-color: #4a5270 !important; }
.pq-ex-fb { padding: 10px 12px; border-radius: 6px; font-size: 17px; background: #eecf9b; border: 2px solid #91522c; display: flex; flex-direction: column; gap: 4px; }
.pq-ex-fb[hidden] { display: none; }
.pq-ex-fb.ok { background: #d6ecb8; border-color: #56864c; }
.pq-ex-fb.part { background: #ffe18d; border-color: #e89b2f; }
.pq-ex-fb.bad { background: #f6d0cf; border-color: #8f3e56; }
.pq-ex-fb .verdict { font-weight: 700; font-size: 19px; }
.pq-ex-fb .answer { font-size: 19px; }
.pq-ex-fb .tr { color: #543c52; font-size: 16px; }
.pq-ex-fb .rule { color: #2d697b; font-weight: 600; }
.pq-ex-fb .gloss { color: #3a2c38; }
.pq-ex-fb .pq-btn { align-self: flex-start; }
.pq-ex-actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding-top: 6px;
  background: linear-gradient(rgba(240,229,209,0), #f0e5d1 30%); }
.pq-ex-actions .grow { flex: 1; }
.pq-ex input.pq-answer { box-sizing: border-box; width: 100%; min-height: 48px; padding: 8px 12px; font: inherit; font-size: 20px; color: #141b1b;
  background: #fff; border: 3px solid #91522c; border-radius: 6px; -webkit-user-select: text; user-select: text; }
.pq-ex input.pq-answer:focus { outline: 3px solid #e89b2f; }
.pq-md { font-size: 18px; }
.pq-md table { border-collapse: collapse; margin-top: 8px; }
.pq-md td { border: 2px solid #d2b37d; padding: 4px 10px; }
.pq-big { font-size: 24px; font-weight: 700; }
.pq-big-ru { font-size: 16px; font-weight: 500; color: #543c52; }
.pq-gap { font-size: 22px; }
.pq-gap .slot { display: inline-block; min-width: 3.5em; padding: 0 6px; border-bottom: 3px solid #91522c; text-align: center; color: #2d697b; font-weight: 700; }
.pq-order-line, .pq-order-pool { display: flex; flex-wrap: wrap; gap: 8px; min-height: 56px; padding: 8px; border-radius: 6px; box-sizing: border-box; }
.pq-order-line { background: #fff7ec; border: 3px dashed #c8966b; }
.pq-order-line.over { border-color: #2a9d9b; background: #e6f6f3; }
.pq-order-pool { background: rgba(145,82,44,.08); }
.pq-tile { touch-action: none; font-weight: 600; font-size: 19px; }
.pq-tile.ghost { position: fixed; z-index: 1000; pointer-events: none; opacity: .9; transform: translate(-50%, -50%) rotate(-3deg); }
.pq-tile.lifted { opacity: .35; }
.pq-match { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pq-match .col { display: flex; flex-direction: column; gap: 8px; }
.pq-match .pq-btn { text-align: center; font-weight: 500; }
.pq-match .pq-btn.sel { background: #79b8ce; border-color: #2d697b; }
.pq-match .pq-btn.done { background: #d6ecb8; border-color: #56864c; color: #345a52; }
.pq-hint { color: #2d697b; font-weight: 600; }

/* Табличка и тост */
.pq-signpop { width: min(100% - 32px, 420px); margin: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; align-items: center; text-align: center; }
.pq-toast { position: absolute; left: 50%; top: calc(16px + env(safe-area-inset-top)); transform: translateX(-50%); padding: 10px 16px; z-index: 50; pointer-events: none; }
.pq-summary { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.pq-summary .stat { display: flex; justify-content: space-between; font-size: 18px; border-bottom: 2px dotted #c8966b; padding: 4px 0; }
.pq-summary .planted { font-size: 18px; }
`;

export function ensureOverlayStyle(doc: Document): void {
  if (doc.getElementById('pq-overlay-style')) return;
  const style = doc.createElement('style');
  style.id = 'pq-overlay-style';
  style.textContent = css;
  doc.head.append(style);
}
