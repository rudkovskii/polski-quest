// Личная версия только на маке (11.11, ТЗ-локальная-версия): ленты берутся с того же локального сервера, в облако запросов нет.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import edition from '../edition.json';
import { SOBES_FEED_URL, WORD_FEED_URL, fetchWordFeed } from '../src/systems/platform/wordFeed';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('ленты локальные', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('адреса лент — рядом с игрой, не GitHub', () => {
    expect(WORD_FEED_URL).toBe('/feed/moje_slowa.json');
    expect(SOBES_FEED_URL).toBe('/feed/sobes.json');
  });

  it('в коде игры нет raw.githubusercontent.com и github.io', () => {
    const hits = files('src').filter((f) => /raw\.githubusercontent\.com|github\.io/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('игра Шэфа собирается в корень (локальный сервер)', () => {
    expect(edition.id).toBe('main');
    expect(edition.base).toBe('/');
  });

  it('запрос ленты — тот же адрес без меток, мимо кэша', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', (u: string, o?: RequestInit) => {
      calls.push([u, o]);
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    expect(await fetchWordFeed(WORD_FEED_URL, 0)).toEqual([]);
    expect(calls).toEqual([['/feed/moje_slowa.json', { cache: 'no-store' }]]);
  });
});
