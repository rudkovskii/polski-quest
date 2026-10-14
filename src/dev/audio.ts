// Dev-страница `/?dev=audio` (I-09): озвучка без Phaser. Первый тап разблокирует звук (connectAudio
// ловит click в capture-фазе раньше кнопки), дальше кнопки шлют `audio:play` в шину, как это делает UI.
// Склейка слоёв, как main.ts.
import { bus } from '../systems/bus';
import { connectAudio, getSpeech } from '../systems/platform/audio';
import type { BusEvents } from '../types/bus';
import { mountAudioToast } from '../ui/audioToast';
import { el } from '../ui/dom';

const css = `
.pq-dev { position: fixed; inset: 0; overflow: auto; padding: calc(env(safe-area-inset-top) + 10px) 12px 40px; box-sizing: border-box;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f4f4f4; background: #1a1c2c; }
.pq-dev h1 { font-size: 16px; margin: 0 0 8px; color: #ffcd75; }
.pq-dev .btns { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; max-width: 720px; margin: 10px 0; }
.pq-dev button { font: inherit; font-size: 15px; padding: 12px; border: 2px solid #f4f4f4; border-radius: 6px; background: #3b5dc9; color: #f4f4f4;
  cursor: pointer; touch-action: manipulation; text-align: left; }
.pq-dev button small { display: block; opacity: .75; font-size: 12px; }
.pq-dev .status { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #94b0c2; margin: 6px 0; }
.pq-dev .log { font-family: ui-monospace, Menlo, monospace; font-size: 12px; max-width: 720px; white-space: pre-wrap; background: #333c57; padding: 6px; border-radius: 6px; min-height: 160px; }
`;

type Play = BusEvents['audio:play'];
interface Demo {
  label: string;
  hint: string;
  plays: Play[];
}

const DEMOS: Demo[] = [
  { label: 'слово', hint: 'id lx.maly → mały (файл)', plays: [{ id: 'lx.maly' }] },
  { label: 'медленно', hint: 'id lx.maly, slow (файл -r 40)', plays: [{ id: 'lx.maly', slow: true }] },
  { label: 'фраза', hint: 'Mała kawa, proszę. (шаг shadow)', plays: [{ id: 'ch01.s03#4' }] },
  { label: 'фраза медленно', hint: 'Mała kawa, proszę. slow', plays: [{ text: 'Mała kawa, proszę.', slow: true }] },
  { label: 'пара в очереди', hint: 'łata → lata (queue)', plays: [{ text: 'łata' }, { text: 'lata', queue: true }] },
  { label: 'реплика NPC', hint: 'pan Marek: Słucham?', plays: [{ id: 'ch01.s03#5' }] },
  { label: 'нет файла → Web Speech', hint: 'Dzień dobry, jak się masz?', plays: [{ text: 'Dzień dobry, jak się masz?' }] },
  { label: 'нет файла, медленно', hint: 'Web Speech rate 0.7', plays: [{ text: 'Dzień dobry, jak się masz?', slow: true }] },
];

export function mountAudioDev(parent: HTMLElement): void {
  parent.append(el('style', {}, css));
  connectAudio(bus);
  mountAudioToast(parent);
  const speech = getSpeech();
  const log = el('div', { class: 'log' });
  const status = el('div', { class: 'status' }, 'манифест: загрузка…');
  const write = (s: string): void => {
    const t = new Date().toISOString().slice(11, 23);
    log.textContent = `${t} ${s}\n${log.textContent ?? ''}`.slice(0, 6000);
    console.info(`[audio] ${s}`);
  };
  const buttons = DEMOS.map((d) => {
    const b = el('button', { type: 'button' }, d.label, el('small', {}, d.hint));
    b.addEventListener('click', () => {
      for (const p of d.plays) {
        const t0 = performance.now();
        bus.emit('audio:play', {
          ...p,
          done: (via) => write(`done ${p.id ?? p.text}${p.slow ? ' (slow)' : ''} → ${via}, ${Math.round(performance.now() - t0)} мс`),
        });
      }
    });
    return b;
  });
  const stop = el('button', { type: 'button', onclick: () => bus.emit('audio:stop', {}) }, 'стоп', el('small', {}, 'audio:stop'));
  parent.append(
    el(
      'div',
      { class: 'pq-dev' },
      el('h1', {}, 'Аудио (I-09): тапни любую кнопку'),
      status,
      el('div', { class: 'btns' }, ...buttons, stop),
      log,
    ),
  );
  bus.on('audio:state', (s) => write(`state ${s.state}${s.via ? ` via ${s.via}` : ''}${s.text ? ` «${s.text}»` : ''}${s.id ? ` [${s.id}]` : ''}`));
  bus.on('audio:blocked', () => write('blocked: нужен тап'));
  void speech.ready.then(() => {
    const d = speech.duration('mały');
    const synth = globalThis.speechSynthesis;
    const pl = synth?.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pl')).map((v) => v.name) ?? [];
    status.textContent = `манифест: ${d === undefined ? 'нет записи «mały»' : `ok, mały = ${d} с`}; Web Speech: ${synth ? `голоса pl: ${pl.join(', ') || 'пока нет (придут по voiceschanged)'}` : 'нет'}; разблокировано: ${speech.isUnlocked()}`;
  });
}
