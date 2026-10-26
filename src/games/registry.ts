// Реестр игр v2. Папки фиксированы: `src/games/{geo,hymn,daty,swieta}/index.ts` экспортируют `game: PolskaGame`.
// Игровые агенты правят только свою папку; этот файл, `kit.ts`, `stub.ts` — общие (ядро v2).
import type { PolskaEntry, PolskaGame, PolskaGameId } from '../types/polska';
import { game as daty } from './daty';
import { game as geo } from './geo';
import { game as hymn } from './hymn';
import { game as miesiace } from './miesiace';
import { game as swieta } from './swieta';
import { game as symbole } from './symbole';

/** Порядок на доске: Mapa → Kalendarz (Daty, Miesiące) → Święta → Maszt (Hymn, Symbole) (ФЕРМА_v2 §6; разделение 26.10). */
export const GAMES: readonly PolskaGame[] = [geo, daty, miesiace, swieta, hymn, symbole] as unknown as PolskaGame[];

export const GAME_BY_ID: ReadonlyMap<PolskaGameId, PolskaGame> = new Map(GAMES.map((g) => [g.id, g]));

/** Точка входа в мире → игры (`world:interact` с `use` = entry); несколько — склейка показывает выбор (`ui/entryPick.ts`). */
export const GAMES_BY_ENTRY: ReadonlyMap<PolskaEntry, readonly PolskaGame[]> = GAMES.reduce((m, g) => m.set(g.entry, [...(m.get(g.entry) ?? []), g]), new Map<PolskaEntry, PolskaGame[]>());
