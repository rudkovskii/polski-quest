// Реестр игр v2. Папки фиксированы: `src/games/{geo,hymn,daty,swieta}/index.ts` экспортируют `game: PolskaGame`.
// Игровые агенты правят только свою папку; этот файл, `kit.ts`, `stub.ts` — общие (ядро v2).
import type { PolskaEntry, PolskaGame, PolskaGameId } from '../types/polska';
import { game as daty } from './daty';
import { game as geo } from './geo';
import { game as hymn } from './hymn';
import { game as swieta } from './swieta';

/** Порядок на доске: Mapa → Kalendarz → Święta → Maszt (ФЕРМА_v2 §6). */
export const GAMES: readonly PolskaGame[] = [geo, daty, swieta, hymn] as unknown as PolskaGame[];

export const GAME_BY_ID: ReadonlyMap<PolskaGameId, PolskaGame> = new Map(GAMES.map((g) => [g.id, g]));

/** Точка входа в мире → игра (`world:interact` с `use` = entry). */
export const GAME_BY_ENTRY: ReadonlyMap<PolskaEntry, PolskaGame> = new Map(GAMES.map((g) => [g.entry, g]));
