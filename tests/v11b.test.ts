// @vitest-environment happy-dom
// V11b: музыка. Плеер (mute не создаёт аудио, переключение трека, пауза на скрытой вкладке, разблокировка жестом),
// сохранение настроек, радио в доме, нота в HUD и музыка в настройках.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUCK_FACTOR, FADE_IN_MS, FADE_OUT_MS, createMusicPlayer, type MusicPlayer } from '../src/systems/platform/music';
import { MUSIC_DEFAULT, TRACKS, normalizeMusic, stepTrack, type MusicSettings } from '../src/systems/musicSettings';
import { exportSave, importSave, newSave, normalizeSave } from '../src/systems/save';
import { mountRadio } from '../src/ui/radio';
import { mountMusicHud } from '../src/ui/radioHud';
import { mountSettings } from '../src/ui/settings';
import { getMap } from '../src/world/maps';
import { testBus } from './helpers';

class FakeAudio {
  src = '';
  paused = true;
  loop = false;
  preload = '';
  volume = 1;
  plays = 0;
  reject = false;
  private ended: Array<() => void> = [];
  addEventListener(type: string, fn: () => void): void {
    if (type === 'ended') this.ended.push(fn);
  }
  play(): Promise<void> {
    this.plays++;
    if (this.reject) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  finish(): void {
    this.paused = true;
    for (const f of this.ended) f();
  }
}

let vis: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vis = 'visible';
  document.body.replaceChildren();
});

function setup(init: Partial<MusicSettings> = {}, mute = false) {
  vi.useFakeTimers();
  let cfg: MusicSettings = { ...MUSIC_DEFAULT, ...init };
  const writes: MusicSettings[] = [];
  const made: FakeAudio[] = [];
  const player: MusicPlayer = createMusicPlayer({
    mute,
    base: '/polski-quest/',
    get: () => cfg,
    set: (m) => {
      cfg = m;
      writes.push(m);
    },
    create: () => {
      const a = new FakeAudio();
      made.push(a);
      return a as unknown as HTMLAudioElement;
    },
  });
  return { player, made, writes, cfg: () => cfg };
}
const settle = async (ms = FADE_OUT_MS + FADE_IN_MS + 200): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('плеер: ?mute=1', () => {
  it('аудио не создаётся и не играет, но переключатели работают и сохраняются', async () => {
    const Ctor = vi.fn();
    vi.stubGlobal('Audio', Ctor);
    const { player, made, cfg } = setup({ on: true }, true);
    player.setOn(true);
    player.toggle();
    player.toggle();
    player.select('farma', true);
    player.next();
    player.setLocation('farm');
    player.setDuck(true);
    await settle();
    expect(made).toHaveLength(0);
    expect(Ctor).not.toHaveBeenCalled();
    const v = player.view();
    expect(v.muted).toBe(true);
    expect(v.playing).toBe(false);
    expect(v.on).toBe(true);
    expect(cfg().track).toBe(stepTrack('farma', 1));
    player.dispose();
  });
});

describe('плеер: треки и громкость', () => {
  it('по умолчанию выключен: аудио не создаётся, пока не включили', async () => {
    const { player, made } = setup();
    await settle();
    expect(made).toHaveLength(0);
    expect(player.view().on).toBe(false);
    expect(player.view().playing).toBe(false);
  });

  it('включение играет выбранный трек с плавным нарастанием; выключение затихает и ставит на паузу', async () => {
    const { player, made, cfg } = setup();
    player.select('farma', true);
    await vi.advanceTimersByTimeAsync(0);
    const a = made[0]!;
    expect(a.src).toBe('/polski-quest/music/farma.m4a');
    expect(a.paused).toBe(false);
    expect(a.volume).toBeLessThan(0.1);
    await settle();
    expect(a.volume).toBeCloseTo(cfg().volume / 100, 2);
    expect(player.view().playing).toBe(true);
    player.setOn(false);
    await settle();
    expect(a.paused).toBe(true);
    expect(cfg().on).toBe(false);
    expect(player.view().playing).toBe(false);
  });

  it('переключение трека: следующий, предыдущий по кругу, выбор из списка; старый затухает, новый нарастает', async () => {
    const { player, made, cfg } = setup({ on: true, track: TRACKS[0]!.id });
    await settle();
    const a = made[0]!;
    expect(a.src).toContain(`/music/${TRACKS[0]!.id}.m4a`);
    player.next();
    await vi.advanceTimersByTimeAsync(FADE_OUT_MS / 2);
    expect(a.src).toContain(`/music/${TRACKS[0]!.id}.m4a`);
    expect(a.volume).toBeLessThan(cfg().volume / 100);
    await settle();
    expect(cfg().track).toBe(TRACKS[1]!.id);
    expect(a.src).toContain(`/music/${TRACKS[1]!.id}.m4a`);
    expect(made).toHaveLength(1);
    player.prev();
    player.prev();
    await settle();
    expect(cfg().track).toBe(TRACKS[TRACKS.length - 1]!.id);
    player.select('dzien');
    await settle();
    expect(a.src).toContain('/music/dzien.m4a');
    expect(a.paused).toBe(false);
    // выбор трека у выключенной музыки не включает её, а тап по треку в радио (play) включает
    player.setOn(false);
    await settle();
    player.select('laki');
    await settle();
    expect(a.paused).toBe(true);
    player.select('deszcz', true);
    await settle();
    expect(cfg().on).toBe(true);
    expect(a.src).toContain('/music/deszcz.m4a');
    expect(a.paused).toBe(false);
  });

  it('по кругу: после конца идёт следующий трек; «один трек» — loop', async () => {
    const { player, made, cfg } = setup({ on: true, track: 'farma', repeat: 'all' });
    await settle();
    const a = made[0]!;
    expect(a.loop).toBe(false);
    a.finish();
    await settle();
    expect(cfg().track).toBe(stepTrack('farma', 1));
    expect(a.paused).toBe(false);
    player.setRepeat('one');
    expect(a.loop).toBe(true);
    expect(cfg().repeat).toBe('one');
  });

  it('громкость сохраняется, в мини-игре тише, «только дома» играет лишь дома', async () => {
    const { player, made, cfg } = setup({ on: true, volume: 80 });
    await settle();
    const a = made[0]!;
    expect(a.volume).toBeCloseTo(0.8, 2);
    player.setDuck(true);
    expect(a.volume).toBeCloseTo(0.8 * DUCK_FACTOR, 2);
    player.setDuck(false);
    player.setVolume(30);
    expect(cfg().volume).toBe(30);
    expect(a.volume).toBeCloseTo(0.3, 2);
    player.setEverywhere(false);
    player.setLocation('farm');
    await settle();
    expect(a.paused).toBe(true);
    player.setLocation('home');
    await settle();
    expect(a.paused).toBe(false);
  });

  it('скрытая вкладка ставит на паузу, возврат продолжает', async () => {
    const { player, made } = setup({ on: true });
    await settle();
    const a = made[0]!;
    vis = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(a.paused).toBe(true);
    expect(player.view().playing).toBe(false);
    vis = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(a.paused).toBe(false);
  });

  it('автозапуск заблокирован браузером: ждём первый жест и играем', async () => {
    vi.useFakeTimers();
    const made: FakeAudio[] = [];
    const cfg: MusicSettings = { ...MUSIC_DEFAULT, on: true };
    const player = createMusicPlayer({
      get: () => cfg,
      set: () => undefined,
      create: () => {
        const a = new FakeAudio();
        a.reject = true;
        made.push(a);
        return a as unknown as HTMLAudioElement;
      },
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(made[0]!.paused).toBe(true);
    expect(player.view().playing).toBe(false);
    made[0]!.reject = false;
    document.body.dispatchEvent(new Event('click', { bubbles: true }));
    await settle();
    expect(made[0]!.paused).toBe(false);
    expect(player.view().playing).toBe(true);
    player.dispose();
  });
});

describe('настройки музыки в сохранении', () => {
  it('по умолчанию выключена; мусор заменяется значениями по умолчанию', () => {
    expect(newSave(1).settings.music).toEqual(MUSIC_DEFAULT);
    expect(MUSIC_DEFAULT.on).toBe(false);
    expect(normalizeMusic(null)).toEqual(MUSIC_DEFAULT);
    expect(normalizeMusic({ on: 'yes', volume: 999, track: 'nope', repeat: 'x', everywhere: 0 })).toEqual({ ...MUSIC_DEFAULT, volume: 100, everywhere: true });
    expect(normalizeMusic({ volume: -5 }).volume).toBe(0);
  });

  it('старое сохранение без music читается, выбор и состояние переживают экспорт и импорт', () => {
    const old = JSON.parse(JSON.stringify(newSave(5)));
    delete old.settings.music;
    expect(normalizeSave(old)!.settings.music).toEqual(MUSIC_DEFAULT);
    const s = newSave(5);
    s.settings.music = { on: true, volume: 35, track: 'wieczor', repeat: 'one', everywhere: false };
    const r = importSave(exportSave(s));
    expect(r.ok && r.save.settings.music).toEqual({ on: true, volume: 35, track: 'wieczor', repeat: 'one', everywhere: false });
  });

  it('плеер пишет каждое изменение через set', () => {
    const { player, writes } = setup();
    player.setVolume(20);
    player.setRepeat('one');
    player.select('deszcz');
    player.setEverywhere(false);
    expect(writes.at(-1)).toMatchObject({ volume: 20, repeat: 'one', track: 'deszcz', everywhere: false, on: false });
  });
});

describe('экраны', () => {
  const ui = (mute = false) => {
    const h = setup({}, mute);
    const bus = testBus();
    const root = document.createElement('div');
    document.body.append(root);
    return { ...h, bus, root };
  };

  it('радио: выключатель, тап по треку играет его (выбранный подсвечен), повтор, громкость', async () => {
    const { player, root, bus, cfg, made } = ui();
    const radio = mountRadio(root, player, bus);
    radio.open();
    const q = <T extends Element>(s: string): T => root.querySelector<T>(s)!;
    expect(q('[data-radio-power]').textContent).toContain('wył.');
    expect(root.querySelectorAll('[data-track]')).toHaveLength(TRACKS.length);
    q<HTMLButtonElement>('[data-track="laki"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(cfg()).toMatchObject({ on: true, track: 'laki' });
    expect(q('[data-track="laki"]').classList.contains('sel')).toBe(true);
    expect(q('[data-track="poranek"]').classList.contains('sel')).toBe(false);
    expect(q('[data-radio-power]').textContent).toContain('wł.');
    expect(made[0]!.src).toContain('/music/laki.m4a');
    q<HTMLButtonElement>('[data-radio-next]').click();
    expect(cfg().track).toBe('wieczor');
    q<HTMLButtonElement>('[data-radio-repeat]').click();
    expect(cfg().repeat).toBe('one');
    expect(q('[data-radio-repeat]').textContent).toBe('Один трек');
    q<HTMLButtonElement>('[data-radio-vol-down]').click();
    expect(cfg().volume).toBe(40);
    q<HTMLButtonElement>('[data-radio-everywhere]').click();
    expect(cfg().everywhere).toBe(false);
    q<HTMLButtonElement>('[data-radio-power]').click();
    expect(cfg().on).toBe(false);
    radio.close();
  });

  it('?mute=1: переключатели видны и работают, аудио не создаётся', async () => {
    const { player, root, bus, cfg, made } = ui(true);
    mountRadio(root, player, bus).open();
    mountMusicHud(root, player, { bus });
    root.querySelector<HTMLButtonElement>('[data-radio-power]')!.click();
    root.querySelector<HTMLButtonElement>('[data-track="deszcz"]')!.click();
    await settle();
    expect(cfg()).toMatchObject({ on: true, track: 'deszcz' });
    expect(made).toHaveLength(0);
    expect(root.querySelector('[data-radio-now]')!.textContent).toContain('?mute=1');
  });

  it('нота в HUD видна всегда; тап открывает мини-панель: вкл/выкл, следующий, громкость; мимо — закрывает', async () => {
    const { player, root, bus, cfg } = ui();
    const hud = mountMusicHud(root, player, { bus });
    const note = root.querySelector<HTMLButtonElement>('[data-music-hud]')!;
    const mini = root.querySelector<HTMLElement>('[data-mini]')!;
    expect(note.hidden).toBe(false);
    expect(note.classList.contains('on')).toBe(false);
    expect(mini.hidden).toBe(true);
    note.click();
    expect(mini.hidden).toBe(false);
    expect(root.querySelector('[data-mini-power]')!.textContent).toBe('Muzyka: wył.');
    root.querySelector<HTMLButtonElement>('[data-mini-power]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(cfg().on).toBe(true);
    expect(note.classList.contains('on')).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-mini-next]')!.click();
    expect(cfg().track).toBe(TRACKS[1]!.id);
    expect(root.querySelector('[data-mini-title]')!.textContent).toContain(TRACKS[1]!.pl);
    const vol = root.querySelector<HTMLInputElement>('[data-mini-volume]')!;
    vol.value = '25';
    vol.dispatchEvent(new Event('input'));
    expect(cfg().volume).toBe(25);
    document.body.click();
    expect(mini.hidden).toBe(true);
    note.click();
    bus.emit('world:input', { enabled: false });
    expect(mini.hidden).toBe(true);
    hud.dispose();
  });

  it('настройки: вкл/выкл музыки, выбор трека из списка, громкость; состояние общее с радио', async () => {
    const { player, root, bus, cfg } = ui();
    const settings = mountSettings(root, { bus, music: player, getSound: () => true, setSound: () => undefined, exportSave: () => 'x', importSave: async () => ({ ok: true, message: '' }), reset: async () => undefined });
    settings.open();
    const q = <T extends Element>(s: string): T => root.querySelector<T>(s)!;
    expect(q('[data-music-power]').textContent).toBe('Выкл');
    q<HTMLButtonElement>('[data-music-power]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(cfg().on).toBe(true);
    expect(q('[data-music-power]').textContent).toBe('Вкл');
    const sel = q<HTMLSelectElement>('[data-music-track]');
    expect(sel.options).toHaveLength(TRACKS.length);
    sel.value = 'wieczor';
    sel.dispatchEvent(new Event('change'));
    expect(cfg().track).toBe('wieczor');
    const vol = q<HTMLInputElement>('[data-music-volume]');
    vol.value = '15';
    vol.dispatchEvent(new Event('input'));
    expect(cfg().volume).toBe(15);
    expect(q('[data-music-volume-out]').textContent).toBe('15%');
    player.next();
    expect(sel.value).toBe(stepTrack('wieczor', 1));
    settings.close();
  });
});

describe('радио в доме', () => {
  it('объект radio в home.json с use=radio, файлы треков на месте', async () => {
    const map = getMap('home');
    const obj = map.objects.find((o) => o.type === 'prop' && o.id === 'radio');
    expect(obj).toMatchObject({ use: 'radio', sprite: 'radio' });
    const { existsSync, statSync } = await import('node:fs');
    let total = 0;
    for (const t of TRACKS) {
      const f = `${process.cwd()}/public/music/${t.id}.m4a`;
      expect(existsSync(f), t.id).toBe(true);
      total += statSync(f).size;
    }
    expect(total).toBeLessThan(15 * 1024 * 1024);
  });
});
