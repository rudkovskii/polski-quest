// Секрет приватной ссылки (ТЗ §5.2, §6.1). Реальные секреты в тестах не пишутся: только сгенерированные
// или из фиксированных байтов, полная ссылка собирается в рантайме (git log -p не должен находить #k=…).
import { describe, expect, it, vi } from 'vitest';
import {
  adoptSecret,
  buildLink,
  captureSecretFromUrl,
  encodeBase32,
  forgetSecret,
  gameBaseUrl,
  generateSecret,
  parseSecretInput,
  secretFromHash,
  SECRET_RE,
  storedSecret,
  type SecretStore,
} from '../src/systems/platform/secret';
import { GAME_URL } from '../src/systems/platform/config';
import { newLocal, type LocalState } from '../src/systems/progress';

const bytes = (fill: (i: number) => number) => (n: number) => Uint8Array.from({ length: n }, (_, i) => fill(i));
const S1 = generateSecret(bytes((i) => i * 17 + 3));
const S2 = generateSecret(bytes((i) => 255 - i * 13));
const K = 'k' + '='; // чтобы в исходнике не было литерала «#k=<26 символов>»

class Store implements SecretStore {
  constructor(public local: LocalState) {}
  setLocal(l: LocalState): void {
    this.local = l;
  }
}

function env(hash: string) {
  const replaceState = vi.fn();
  return { location: { hash, pathname: '/polski-quest/', search: '?dev=1' }, history: { state: { s: 1 }, replaceState }, replaceState };
}

describe('генерация', () => {
  it('base32 по RFC 4648 (строчные, без паддинга)', () => {
    const enc = (s: string) => encodeBase32(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('my');
    expect(enc('fo')).toBe('mzxq');
    expect(enc('foob')).toBe('mzxw6yq');
    expect(enc('foobar')).toBe('mzxw6ytboi');
    expect(encodeBase32(new Uint8Array(16))).toBe('a'.repeat(26));
  });

  it('128 бит → 26 символов [a-z2-7], уникальные', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const s = generateSecret();
      expect(s).toMatch(SECRET_RE);
      seen.add(s);
    }
    expect(seen.size).toBe(2000);
    expect(S1).toHaveLength(26);
  });

  it('генератор не на 16 байт — ошибка, а не слабый секрет', () => {
    expect(() => generateSecret(() => new Uint8Array(8))).toThrow();
  });
});

describe('разбор ввода и фрагмента', () => {
  it('полная ссылка, голый секрет, k=, пробелы и заглавные', () => {
    expect(parseSecretInput(`https://rudkovskii.github.io/polski-quest/#${K}${S1}`)).toBe(S1);
    expect(parseSecretInput(`  ${S1}\n`)).toBe(S1);
    expect(parseSecretInput(`${K}${S1}`)).toBe(S1);
    expect(parseSecretInput(S1.charAt(0).toUpperCase() + S1.slice(1))).toBe(S1);
    expect(parseSecretInput(`http://localhost:5173/polski-quest/?dev=1#x=1&${K}${S1}`)).toBe(S1);
  });

  it('мусор → null', () => {
    expect(parseSecretInput('')).toBeNull();
    expect(parseSecretInput(S1.slice(1))).toBeNull(); // 25 символов
    expect(parseSecretInput(`${S1}a`)).toBeNull(); // 27
    expect(parseSecretInput(S1.slice(0, 25) + '1')).toBeNull(); // 1 не из алфавита
    expect(parseSecretInput(`https://rudkovskii.github.io/polski-quest/#${K}${S1}x`)).toBeNull();
  });

  it('secretFromHash', () => {
    expect(secretFromHash(`#${K}${S1}`)).toBe(S1);
    expect(secretFromHash(`#a=1&${K}${S1}`)).toBe(S1);
    expect(secretFromHash('#k=short')).toBeNull();
    expect(secretFromHash('')).toBeNull();
  });
});

describe('ссылка', () => {
  it('buildLink = база + #k=секрет', () => {
    expect(buildLink(S1, GAME_URL)).toBe(`${GAME_URL}#${K}${S1}`);
    expect(() => buildLink('nope', GAME_URL)).toThrow();
  });

  it('база: текущая страница по http(s), иначе канонический адрес', () => {
    expect(gameBaseUrl({ origin: 'http://localhost:5173', protocol: 'http:' })).toBe(`http://localhost:5173${import.meta.env.BASE_URL}`);
    expect(gameBaseUrl({ origin: 'null', protocol: 'file:' })).toBe(GAME_URL);
    expect(gameBaseUrl(undefined)).toBe(GAME_URL);
  });
});

describe('хранение в pq_local', () => {
  it('новый секрет сбрасывает ревизию синка и помечает прогресс к отправке', () => {
    const st = new Store({ ...newLocal('aaaaaa'), secret: S1, sync: { rev: 9, lastSyncAt: 1, lastError: 'x', dirty: false } });
    expect(adoptSecret(st, S1)).toBe(false);
    expect(st.local.sync.rev).toBe(9);
    expect(adoptSecret(st, S2)).toBe(true);
    expect(st.local.secret).toBe(S2);
    expect(st.local.sync).toEqual({ rev: 0, lastSyncAt: null, lastError: null, dirty: true });
    expect(st.local.join).toBeUndefined();
    expect(() => adoptSecret(st, 'bad')).toThrow();
  });

  it('join ставится только при подключении', () => {
    const st = new Store(newLocal('aaaaaa'));
    adoptSecret(st, S1, { join: true });
    expect(st.local.join).toBe(true);
    adoptSecret(st, S2);
    expect(st.local.join).toBeUndefined();
  });

  it('forgetSecret стирает секрет и состояние синка', () => {
    const st = new Store({ ...newLocal('aaaaaa'), secret: S1, join: true });
    forgetSecret(st);
    expect(storedSecret(st)).toBeNull();
    expect(st.local.join).toBeUndefined();
  });
});

describe('captureSecretFromUrl (§5.2 п. 1)', () => {
  it('сохраняет секрет, убирает фрагмент через replaceState (путь и query остаются)', () => {
    const st = new Store(newLocal('aaaaaa'));
    const e = env(`#${K}${S1}`);
    expect(captureSecretFromUrl(st, e)).toBe('adopted');
    expect(storedSecret(st)).toBe(S1);
    expect(e.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/polski-quest/?dev=1');
    expect(st.local.join).toBe(true); // устройство без секрета вливается в мир ссылки
  });

  it('устройство с другим секретом: join не ставится (решит игрок через DifferentWorlds)', () => {
    const st = new Store({ ...newLocal('aaaaaa'), secret: S2 });
    expect(captureSecretFromUrl(st, env(`#${K}${S1}`))).toBe('adopted');
    expect(st.local.join).toBeUndefined();
  });

  it('тот же секрет → same; без k= адрес не трогается; битый k= убирается', () => {
    const st = new Store({ ...newLocal('aaaaaa'), secret: S1 });
    expect(captureSecretFromUrl(st, env(`#${K}${S1}`))).toBe('same');
    const none = env('#something');
    expect(captureSecretFromUrl(st, none)).toBeNull();
    expect(none.replaceState).not.toHaveBeenCalled();
    const bad = env('#k=oops');
    expect(captureSecretFromUrl(st, bad)).toBeNull();
    expect(bad.replaceState).toHaveBeenCalled();
    expect(storedSecret(st)).toBe(S1);
  });
});
