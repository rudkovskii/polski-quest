// @vitest-environment happy-dom
// Озвучка: манифест, очередь, медленная версия, fallback на Web Speech, блокировка iOS, шина.
import { describe, expect, it } from 'vitest';
import { createBus } from '../src/systems/bus';
import { connectAudio, createSpeech, entryKey, silentWav, type AudioManifest, type SpeechDeps } from '../src/systems/platform/audio';
import type { BusEvents } from '../src/types/bus';

type PlayMode = 'ok' | 'blocked' | 'error' | 'missing';

class FakeAudio extends EventTarget {
  static all: FakeAudio[] = [];
  src = '';
  preload = '';
  currentTime = 0;
  paused = true;
  attrs: Record<string, string> = {};
  /** Как ответит следующий play() для данного src (по умолчанию ok). */
  static mode: (src: string) => PlayMode = () => 'ok';
  plays: string[] = [];
  constructor() {
    super();
    FakeAudio.all.push(this);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  load(): void {}
  play(): Promise<void> {
    this.plays.push(this.src);
    const m = FakeAudio.mode(this.src);
    if (m === 'blocked') return Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }));
    if (m === 'error') return Promise.reject(Object.assign(new Error('bad'), { name: 'NotSupportedError' }));
    if (m === 'missing') {
      queueMicrotask(() => this.dispatchEvent(new Event('error')));
      return new Promise(() => {});
    }
    // Тишина из unlock() доигрывает мгновенно.
    this.paused = this.src.startsWith('data:');
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  end(): void {
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeUtterance {
  lang = '';
  rate = 1;
  volume = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class FakeSynth extends EventTarget {
  voices: { name: string; lang: string }[] = [];
  spoken: FakeUtterance[] = [];
  getVoices(): { name: string; lang: string }[] {
    return this.voices;
  }
  speak(u: FakeUtterance): void {
    this.spoken.push(u);
    if (u.text.trim()) queueMicrotask(() => u.onend?.());
  }
  cancel(): void {}
}

const MANIFEST: AudioManifest = {
  v: 1,
  default: 'say:Zosia',
  entries: {
    'say:Zosia|normal|mały': 'aaa.m4a',
    'say:Zosia|slow|mały': 'aas.m4a',
    'say:Zosia|normal|łata': 'lat.m4a',
    'say:Zosia|normal|lata': 'lal.m4a',
    'say:Zosia|normal|Mała kawa, proszę.': 'kaw.m4a',
    'say:Zosia|normal|stół': 'sto.m4a',
  },
  files: { 'aaa.m4a': { dur: 0.56 }, 'aas.m4a': { dur: 0.72 } },
  ids: { 'lx.maly': { text: 'mały', voice: 'say:Zosia', slow: true }, 'ch01.s03#4': { text: 'Mała kawa, proszę.' } },
};

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup(over: Partial<SpeechDeps> & { manifest?: unknown; noSynth?: boolean } = {}) {
  FakeAudio.all = [];
  FakeAudio.mode = () => 'ok';
  const synth = new FakeSynth();
  synth.voices = [
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Zosia', lang: 'pl-PL' },
  ];
  const events: { type: string; payload: unknown }[] = [];
  const speech = createSpeech({
    base: '/pq/',
    loadManifest: async () => {
      if (over.manifest instanceof Error) throw over.manifest;
      return over.manifest ?? MANIFEST;
    },
    createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
    synth: over.noSynth ? null : (synth as unknown as SpeechSynthesis),
    Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
    emit: (type, payload) => events.push({ type, payload }),
    voicesWaitMs: 20,
    endSlackMs: 50,
    ...over,
  });
  const playing = (): FakeAudio | undefined => FakeAudio.all.find((a) => !a.paused);
  return { speech, synth, events, playing };
}

describe('манифест и файл', () => {
  it('ключ = голос|скорость|текст NFC без пробелов по краям', () => {
    expect(entryKey('say:Zosia', false, '  mały ')).toBe('say:Zosia|normal|mały');
    expect(entryKey('say:Zosia', true, 'stó́ł'.normalize('NFD').replace('́', ''))).toBe('say:Zosia|slow|stół');
  });
  it('текст из манифеста играет файлом через HTMLAudioElement', async () => {
    const { speech, playing, events } = setup();
    const p = speech.play('mały');
    await tick();
    const a = playing()!;
    expect(a.src).toBe('/pq/audio/aaa.m4a');
    expect(a.attrs.playsinline).toBe('');
    expect(events).toContainEqual({ type: 'audio:state', payload: { state: 'playing', via: 'file', text: 'mały' } });
    a.end();
    expect(await p).toBe('file');
    await tick();
    expect(events.at(-1)).toEqual({ type: 'audio:state', payload: { state: 'idle' } });
  });
  it('NFD-текст находит NFC-запись', async () => {
    const { speech, playing } = setup();
    const p = speech.play('stół'.replace('ó', 'ó').normalize('NFD'));
    await tick();
    expect(playing()!.src).toBe('/pq/audio/sto.m4a');
    playing()!.end();
    expect(await p).toBe('file');
  });
  it('slow берёт медленный файл, а не playbackRate', async () => {
    const { speech, playing } = setup();
    const p = speech.play('mały', { slow: true });
    await tick();
    expect(playing()!.src).toBe('/pq/audio/aas.m4a');
    playing()!.end();
    expect(await p).toBe('file');
  });
  it('playId: id → текст и голос из manifest.ids', async () => {
    const { speech, playing, events } = setup();
    const p = speech.playId('ch01.s03#4');
    await tick();
    expect(playing()!.src).toBe('/pq/audio/kaw.m4a');
    expect(events.find((e) => e.type === 'audio:state')!.payload).toMatchObject({ id: 'ch01.s03#4' });
    playing()!.end();
    expect(await p).toBe('file');
  });
  it('неизвестный голос → голос по умолчанию', async () => {
    const { speech, playing } = setup();
    const p = speech.play('mały', { voice: 'piper:pl_PL-gosia-medium' });
    await tick();
    expect(playing()!.src).toBe('/pq/audio/aaa.m4a');
    playing()!.end();
    await p;
  });
  it('длительность из manifest.files', async () => {
    const { speech } = setup();
    await speech.ready;
    expect(speech.duration('mały')).toBe(0.56);
    expect(speech.duration('mały', { slow: true })).toBe(0.72);
    expect(speech.duration('nie ma')).toBeUndefined();
  });
  it('нет ended (iOS после фона) → страховка по длительности', async () => {
    const { speech } = setup();
    const p = speech.play('mały');
    expect(await p).toBe('file'); // 0.56 с + 50 мс запаса
  });
});

describe('очередь', () => {
  it('queue: true играет по порядку, второй файл заранее грузится во второй элемент пула', async () => {
    const { speech, playing } = setup();
    const order: string[] = [];
    const p1 = speech.play('łata').then((v) => order.push(`1:${v}`));
    const p2 = speech.play('lata', { queue: true }).then((v) => order.push(`2:${v}`));
    await tick();
    const first = playing()!;
    expect(first.src).toBe('/pq/audio/lat.m4a');
    const other = FakeAudio.all.find((a) => a !== first)!;
    expect(other.src).toBe('/pq/audio/lal.m4a'); // предзагрузка
    first.end();
    await tick();
    const second = playing()!;
    expect(second).toBe(other);
    expect(second.plays).toEqual(['/pq/audio/lal.m4a']);
    second.end();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['1:file', '2:file']);
  });
  it('новая фраза без queue прерывает текущую и очищает очередь', async () => {
    const { speech, playing } = setup();
    const p1 = speech.play('łata');
    const p2 = speech.play('lata', { queue: true });
    await tick();
    const first = playing()!;
    const p3 = speech.play('stół');
    await tick();
    expect(first.paused).toBe(true);
    expect(await p1).toBe('file');
    expect(await p2).toBe('none');
    expect(playing()!.src).toBe('/pq/audio/sto.m4a');
    playing()!.end();
    expect(await p3).toBe('file');
  });
  it('две быстрые фразы подряд: звучит вторая', async () => {
    const { speech, playing } = setup();
    const p1 = speech.play('łata');
    const p2 = speech.play('lata');
    await tick();
    expect(playing()!.src).toBe('/pq/audio/lal.m4a');
    playing()!.end();
    expect(await p2).toBe('file');
    expect(['file', 'none']).toContain(await p1);
  });
  it('stop() резолвит всё', async () => {
    const { speech } = setup();
    const p1 = speech.play('łata');
    const p2 = speech.play('lata', { queue: true });
    await tick();
    speech.stop();
    expect(await p1).toBe('file');
    expect(await p2).toBe('none');
  });
});

describe('fallback', () => {
  it('нет файла → Web Speech pl-PL с польским голосом', async () => {
    const { speech, synth, events } = setup();
    expect(await speech.play('Dzień dobry')).toBe('webspeech');
    const u = synth.spoken.at(-1)!;
    expect(u.text).toBe('Dzień dobry');
    expect(u.lang).toBe('pl-PL');
    expect((u.voice as { name: string }).name).toBe('Zosia');
    expect(u.rate).toBe(1);
    expect(events).toContainEqual({ type: 'audio:state', payload: { state: 'playing', via: 'webspeech', text: 'Dzień dobry' } });
  });
  it('slow без медленного файла → Web Speech с rate 0.7', async () => {
    const { speech, synth } = setup();
    expect(await speech.play('stół', { slow: true })).toBe('webspeech');
    expect(synth.spoken.at(-1)!.rate).toBe(0.7);
  });
  it('голоса приходят позже: ждём voiceschanged', async () => {
    const { speech, synth } = setup();
    const voices = synth.voices;
    synth.voices = [];
    const p = speech.play('Dzień dobry');
    await tick(5);
    synth.voices = voices;
    synth.dispatchEvent(new Event('voiceschanged'));
    expect(await p).toBe('webspeech');
  });
  it('нет польского голоса и нет медленного файла → обычный файл', async () => {
    const { speech, synth, playing } = setup();
    synth.voices = [{ name: 'Samantha', lang: 'en-US' }];
    const p = speech.play('stół', { slow: true });
    await tick(40);
    expect(playing()!.src).toBe('/pq/audio/sto.m4a');
    playing()!.end();
    expect(await p).toBe('file');
  });
  it('ничего нет → none и состояние none', async () => {
    const { speech, events } = setup({ noSynth: true });
    expect(await speech.play('Dzień dobry')).toBe('none');
    expect(events).toContainEqual({ type: 'audio:state', payload: { state: 'none', via: 'none', text: 'Dzień dobry' } });
  });
  it('файл не загрузился (404) → Web Speech', async () => {
    const { speech } = setup();
    FakeAudio.mode = () => 'missing';
    expect(await speech.play('mały')).toBe('webspeech');
  });
  it('манифест не загрузился → всё через Web Speech', async () => {
    const { speech } = setup({ manifest: new Error('offline') });
    expect(await speech.play('mały')).toBe('webspeech');
  });
  it('неизвестный id без текста → none', async () => {
    const { speech } = setup();
    expect(await speech.playId('lx.nie_ma')).toBe('none');
    expect(await speech.playId('lx.nie_ma', { text: 'Dzień dobry' })).toBe('webspeech');
  });
});

describe('разблокировка и iOS', () => {
  it('unlock() синхронно проигрывает тишину на всех элементах пула и будит Web Speech', () => {
    const { speech, synth } = setup();
    void speech.unlock();
    expect(FakeAudio.all.length).toBe(2);
    for (const a of FakeAudio.all) expect(a.plays).toEqual([silentWav()]);
    expect(synth.spoken[0]!.volume).toBe(0);
    expect(speech.isUnlocked()).toBe(true);
  });
  it('silentWav — валидный RIFF/WAVE', () => {
    const bin = atob(silentWav().split(',')[1]!);
    expect(bin.slice(0, 4)).toBe('RIFF');
    expect(bin.slice(8, 12)).toBe('WAVE');
  });
  it('NotAllowedError → audio:blocked, после unlock() фраза повторяется', async () => {
    const { speech, events, playing } = setup();
    FakeAudio.mode = () => 'blocked';
    const p = speech.play('mały');
    await tick();
    expect(events.map((e) => e.type)).toContain('audio:blocked');
    expect(events).toContainEqual({ type: 'audio:state', payload: { state: 'blocked', text: 'mały' } });
    expect(speech.isUnlocked()).toBe(false);
    FakeAudio.mode = () => 'ok';
    await speech.unlock();
    await tick();
    expect(playing()!.src).toBe('/pq/audio/aaa.m4a');
    playing()!.end();
    expect(await p).toBe('file');
  });
});

describe('шина', () => {
  it('audio:play → озвучка, done(via); audio:stop; первый click разблокирует', async () => {
    // connectAudio работает с общим экземпляром getSpeech(): манифест грузится fetch'ем.
    const fetchOrig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(MANIFEST))) as typeof fetch;
    const g = globalThis as unknown as { Audio: unknown; speechSynthesis: unknown; SpeechSynthesisUtterance: unknown };
    const orig = { Audio: g.Audio, s: g.speechSynthesis, u: g.SpeechSynthesisUtterance };
    FakeAudio.all = [];
    FakeAudio.mode = () => 'ok';
    const synth = new FakeSynth();
    synth.voices = [{ name: 'Zosia', lang: 'pl-PL' }];
    g.Audio = FakeAudio;
    g.speechSynthesis = synth;
    g.SpeechSynthesisUtterance = FakeUtterance;
    try {
      const bus = createBus<BusEvents>();
      const states: string[] = [];
      bus.on('audio:state', (s) => states.push(s.state));
      const off = connectAudio(bus);
      document.body.dispatchEvent(new Event('click', { bubbles: true }));
      expect(FakeAudio.all.every((a) => a.plays.length === 1)).toBe(true);
      const via = new Promise((r) => bus.emit('audio:play', { id: 'lx.maly', slow: true, done: r }));
      await tick(5);
      const a = FakeAudio.all.find((x) => !x.paused)!;
      expect(a.src.endsWith('audio/aas.m4a')).toBe(true);
      a.end();
      expect(await via).toBe('file');
      const via2 = new Promise((r) => bus.emit('audio:play', { text: 'Dzień dobry', done: r }));
      expect(await via2).toBe('webspeech');
      const via3 = new Promise((r) => bus.emit('audio:play', { text: 'łata', done: r }));
      await tick(5);
      bus.emit('audio:stop', {});
      expect(await via3).toBe('file');
      expect(states).toContain('playing');
      off();
    } finally {
      globalThis.fetch = fetchOrig;
      g.Audio = orig.Audio;
      g.speechSynthesis = orig.s;
      g.SpeechSynthesisUtterance = orig.u;
    }
  });
});
