// @vitest-environment happy-dom
// P-10a: имя из Fotobudka в репликах — `{name}` в pl/ru/plRu, реплика `<id>.anyname` для имени не «Dima»,
// подпись говорящего у Димы, озвучка под «Dima», валидатор знает плейсхолдер.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startPlayerName } from '../src/avatarGlue';
import { DEFAULT_NAME, setAppearance, defaultAppearance } from '../src/systems/avatar';
import { getContent } from '../src/systems/content';
import { newProgress } from '../src/systems/progress';
import { ANY_NAME_SUFFIX, defaultNamed, fillName, isDefaultName, NAME_TOKEN, personalize } from '../src/systems/playerName';
import { runDialog, type DialogDeps } from '../src/ui/dialog';
import { createOverlay } from '../src/ui/overlay/host';
import { checkContent, voiceTexts } from '../tools/lib/content_check';
import { readContentDir, readSchemas } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';
import { join } from 'node:path';
import { fakeAudio, flush, testBus } from './overlayKit';

const content = getContent();
afterEach(() => personalize(content, DEFAULT_NAME));

describe('{name}: подстановка', () => {
  it('fillName и имя по умолчанию', () => {
    expect(fillName('Cześć, {name}!', 'Andrzej')).toBe('Cześć, Andrzej!');
    expect(fillName('{name}? {name}!', 'Ola')).toBe('Ola? Ola!');
    expect(fillName('Bez imienia', 'Ola')).toBe('Bez imienia');
    expect(fillName('Cześć, {name}!', '  ')).toBe('Cześć, Dima!');
    expect(defaultNamed('Cześć, {name}!')).toBe('Cześć, Dima!');
    expect(isDefaultName('Dima')).toBe(true);
    expect(isDefaultName('dima ')).toBe(true);
    expect(isDefaultName('Andrzej')).toBe(false);
  });

  it('в контенте нет жёсткого «Dima» там, где это имя игрока: варианты, уроки, приветствия', () => {
    personalize(content, 'Andrzej');
    const imie = content.dialogues.get('dlg.ch01.d01_imie')!.value.nodes.imie!;
    expect(imie.choices![0]!.pl).toBe('Andrzej.');
    expect(content.characters.get('dima')!.name).toBe('Andrzej');
    expect(content.lines.get('d01.brzechwa.plot.5')!.pl).toBe('Cześć, Andrzej! Do jutra!');
    expect(content.lines.get('d01.brzechwa.plot.5')!.plRu).toBe('Пока, Andrzej! До завтра!');
    expect(content.lines.get('idle.ola.2')!.pl).toBe('Cześć, Andrzej! Co słychać?');
    const say = content.lessons.get('ch01.d01.brzechwa')?.value.steps?.find((s) => s.t === 'say' && s.who === 'brzechwa' && s.pl.startsWith('Cześć,'));
    if (say && say.t === 'say') expect(say.pl).toBe('Cześć, Andrzej!');
    // Ни одной строки с «{name}» после подстановки.
    const all = JSON.stringify([...[...content.lines.values()].filter((l) => !l.id.endsWith(ANY_NAME_SUFFIX)), ...[...content.dialogues.values()].map((d) => d.value), ...[...content.lessons.values()].map((l) => l.value)]);
    expect(all.includes(NAME_TOKEN)).toBe(false);
    expect(JSON.stringify(imie)).not.toContain('Dima');
  });

  it('рифма «Dima / zima» только для Димы, иначе нейтральная реплика; имя меняется туда и обратно', () => {
    personalize(content, 'Andrzej');
    expect(content.lines.get('d01.brzechwa.plot.4')!.pl).toBe('Andrzej? Ładne imię!');
    expect(content.lines.get('d02.brzechwa.bramka.1')!.pl).toBe('Cześć, Andrzej!');
    expect(content.lines.get('d14.letter.chopin')!.pl).toBe('Zapraszam na Rynek. F.C.');
    personalize(content, 'Dima');
    expect(content.lines.get('d01.brzechwa.plot.4')!.pl).toBe('Dima? Rymuje się z „zima”!');
    expect(content.lines.get('d02.brzechwa.bramka.1')!.pl).toBe('Cześć, Dima! Zima!');
    expect(content.lines.get('d14.letter.chopin')!.pl).toBe('Panie Dimo, zapraszam na Rynek. F.C.');
    expect(content.characters.get('dima')!.name).toBe('Dima');
    personalize(content, 'Marina');
    expect(content.lines.get('d01.brzechwa.plot.4')!.pl).toBe('Marina? Ładne imię!');
    expect(content.lines.get('d01.brzechwa.plot.4')!.words).toEqual(['lx.imie']);
    personalize(content, 'Dima');
    expect(content.lines.get('d01.brzechwa.plot.4')!.words).toBeUndefined();
  });

  it('склейка: имя из settings.avatar приходит до следующего диалога (синхронно на progress:changed)', async () => {
    const bus = testBus();
    const s = { progress: newProgress(Date.UTC(2026, 9, 1, 10), 'w1') };
    startPlayerName(content, Promise.resolve(s), bus);
    await flush();
    expect(content.characters.get('dima')!.name).toBe('Dima');
    s.progress = setAppearance(s.progress, { ...defaultAppearance(), name: 'Andrzej' }, Date.UTC(2026, 9, 1, 11));
    bus.emit('progress:changed', { kinds: ['settings'] });
    expect(content.characters.get('dima')!.name).toBe('Andrzej');
    expect(content.dialogues.get('dlg.ch01.d01_imie')!.value.nodes.imie!.choices![0]!.pl).toBe('Andrzej.');
  });
});

describe('{name}: диалог на экране', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => host.remove());

  it('«A ty?» — ответ и подпись игрока именем из Fotobudka; Брзехва без рифмы', async () => {
    personalize(content, 'Andrzej');
    const bus = testBus();
    const audio = fakeAudio();
    const d: DialogDeps = { overlay: createOverlay(host, { bus }), content, audio, typeMs: 0, reactMs: 0, coarse: true };
    const p = runDialog(content.dialogues.get('dlg.ch01.d01_imie')!.value, d);
    await flush();
    (host.querySelector('.pq-line') as HTMLElement).click(); // «Jestem Jan Brzechwa. A ty?» → варианты
    await flush();
    const choice = host.querySelector<HTMLButtonElement>('[data-choice="0"]')!;
    expect(choice.textContent).toContain('Andrzej.');
    expect(choice.textContent).not.toContain('Dima');
    choice.click();
    await flush();
    expect(host.textContent).toContain('Andrzej? Ładne imię!');
    expect(host.textContent).not.toContain('zima');
    // Озвучка строки с другим именем идёт текстом (файла нет → Web Speech или без звука), не по id «Dima».
    expect(audio.played.some((x) => x.text.includes('Andrzej'))).toBe(true);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    await p;
  });
});

describe('{name}: валидатор и озвучка', () => {
  const real = (): Map<string, unknown> => readContentDir(join(ROOT, 'content')).files;
  const schemas = (): Map<string, object> => readSchemas();

  it('озвучка собирается под «Dima»: в текстах нет плейсхолдера', () => {
    const c = getContent();
    const texts = voiceTexts([...c.lessons.values()].map((l) => l.value), [...c.vocab.values()].map((v) => v.value), [...c.dialogues.values()].map((d) => d.value));
    expect(texts.some((t) => t.includes(NAME_TOKEN))).toBe(false);
  });

  it('чужой плейсхолдер, {name} вне pl/ru/plRu и .anyname без основной реплики — ошибки', () => {
    const files = real();
    const lines = structuredClone(files.get('story/lines.json')) as { id: string; who: string; pl?: string; plRu?: string }[];
    lines.push({ id: `nope${ANY_NAME_SUFFIX}`, who: 'brzechwa', pl: '{name}!', plRu: '{name}!' });
    lines.push({ id: 'p10a.bad', who: 'brzechwa', pl: 'Cześć, {imie}!', plRu: 'Привет!' });
    files.set('story/lines.json', lines);
    const issues = checkContent({ files, schemas: schemas() }).filter((i) => i.code === 'name');
    expect(issues.some((i) => i.msg.includes('nope.anyname'))).toBe(true);
    expect(issues.some((i) => i.msg.includes('{imie}'))).toBe(true);
  });

  it('реальный контент без ошибок name', () => {
    const issues = checkContent({ files: real(), schemas: schemas() }).filter((i) => i.code === 'name');
    expect(issues).toEqual([]);
  });
});
