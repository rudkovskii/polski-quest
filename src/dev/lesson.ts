// Dev-маршрут `/?dev=lesson&id=<lessonId>` (I-08): урок или диалог без Phaser и мира.
//   id=demo.s01         урок фикстуры tests/fixtures/content-mini (все типы шагов); ch01.* — из content/
//   dlg=dlg.demo.marek  вместо урока — диалог (узел `lesson` запускает урок)
//   days=N              часы игры сдвинуты на N дней вперёд: карточки прошлого прогона становятся due → `rev`
//   reset=1             начать с чистого журнала (в памяти; иначе отдельная база polski-quest-dev, игру не трогает)
//   sound=1             озвучивать через Web Speech; по умолчанию звука нет (мок `audio:play`: только лог)
//   passport=1          сразу открыть паспорт (I-11); после урока — кнопка «Паспорт»
// Каждое событие журнала печатается в консоль `[log] {...}`, озвучка — `[audio] …`.
// Это склейка слоёв, как main.ts.
import { startInput } from '../input';
import { bus } from '../systems/bus';
import { buildContent, getContent, type Content } from '../systems/content';
import { GameStorage, memoryKV } from '../systems/platform/storage';
import { el } from '../ui/dom';
import { loadPortraits, mountPlay } from '../ui/play';

function fixtureContent(): Content {
  const files = import.meta.glob<unknown>(['/tests/fixtures/content-mini/**/*.json'], { eager: true, import: 'default' });
  return buildContent(files, '/tests/fixtures/content-mini/');
}

const css = `
.pq-devlesson { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  font: 16px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: #f4f4f4; background: #345a52; padding: 16px; box-sizing: border-box; text-align: center; }
#game { display: none; } /* без Phaser: пустой #game перекрывал кнопки страницы для мыши */
.pq-devlesson pre { max-width: min(100%, 680px); max-height: 40vh; overflow: auto; text-align: left; font-size: 12px; background: #141b1b; padding: 8px; border-radius: 6px; white-space: pre-wrap; }
`;

export async function mountLessonDev(params: URLSearchParams): Promise<void> {
  const lessonId = params.get('id') ?? 'demo.s01';
  const dlgId = params.get('dlg');
  const days = Number(params.get('days') ?? 0) || 0;
  const useFixture = (dlgId ?? lessonId).includes('.demo.') || lessonId.startsWith('demo.');
  const content = useFixture ? fixtureContent() : getContent();

  const storage = new GameStorage(params.get('reset') ? { kv: memoryKV(), ls: null } : { dbName: 'polski-quest-dev', ls: null });
  await storage.load(Date.now());

  const overlay = document.getElementById('overlay')!;
  overlay.append(el('style', {}, css));
  const page = el('div', { class: 'pq-devlesson' });
  document.body.prepend(page);

  // Только клавиатура: фокус сразу в оверлее (как при открытом диалоге в мире).
  startInput({ focus: 'ui', mapControls: 'tap' });

  let offset = days;
  const clock = { now: () => Date.now() + offset * 86_400_000, mono: () => performance.now() };
  const seen: string[] = [];
  const sound = params.get('sound') === '1';
  bus.on('audio:play', ({ text, slow }) => {
    console.info(`[audio] ${slow ? '(медленно) ' : ''}${text}`);
    if (!sound) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pl-PL';
      u.rate = slow ? 0.6 : 0.95;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* без Web Speech — только лог */
    }
  });
  bus.on('world:input', (p) => console.info('[world:input]', JSON.stringify(p)));
  bus.on('ui:lesson:end', (p) => console.info('[ui:lesson:end]', JSON.stringify(p)));

  const play = mountPlay(overlay, {
    content,
    store: storage,
    portraits: await loadPortraits(content),
    clock,
    onEvent: (e) => {
      const line = JSON.stringify(e);
      seen.push(line);
      console.info('[log]', line);
    },
  });
  (window as unknown as { __pq?: unknown }).__pq = { bus, storage, play, content };

  const passportBtn = (): HTMLButtonElement =>
    el('button', { type: 'button', class: 'pq-btn', 'data-nav': true, 'data-act': 'passport', onclick: () => void play.openPassport() }, 'Паспорт');
  if (params.get('passport') === '1') {
    page.replaceChildren(el('div', {}, 'Паспорт'), passportBtn());
    await play.openPassport();
    return;
  }
  const run = async (): Promise<void> => {
    page.replaceChildren(el('div', {}, dlgId ? `Диалог ${dlgId}` : `Урок ${lessonId}`, offset ? ` · +${offset} дн.` : ''));
    seen.length = 0;
    if (dlgId) await play.openDialog(dlgId);
    else await play.openLesson(lessonId);
    const again = el('button', { type: 'button', class: 'pq-btn', 'data-nav': true, onclick: () => void run() }, 'Ещё раз');
    // Через 2 дня карточки этого прогона становятся due: следующий прогон пишет `rev`.
    const later = el('button', { type: 'button', class: 'pq-btn primary', 'data-primary': true, 'data-nav': true, onclick: () => {
      offset += 2;
      void run();
    } }, 'Ещё раз через 2 дня');
    page.replaceChildren(
      el('div', {}, 'Готово. События этого прогона (они же в консоли, [log]):'),
      el('pre', { 'data-testid': 'log' }, seen.join('\n') || '—'),
      el('div', { style: 'display:flex;gap:12px' }, again, later, passportBtn()),
    );
    later.focus();
  };
  // Enter на «Ещё раз» вне оверлея: intents идут в ui, но слоёв нет — жмём кнопку сами.
  bus.on('input:intent', (i) => {
    if (i.to === 'ui' && i.type === 'interact' && play.overlay.depth === 0 && !play.busy) ((document.activeElement as HTMLElement | null)?.closest('.pq-devlesson button') as HTMLElement | null ?? page.querySelector('[data-primary]'))?.click();
  });
  await run();
}
