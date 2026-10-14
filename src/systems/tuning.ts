// Значения tuning по умолчанию для чистых функций, которым контент не передали (тесты, ранний старт).
// Источник один — content/tuning.json; в игре tuning приходит из getContent().tuning.
import type { Tuning } from '../types/content';
import tuningJson from '../../content/tuning.json';

export const DEFAULT_TUNING: Tuning = tuningJson as Tuning;
