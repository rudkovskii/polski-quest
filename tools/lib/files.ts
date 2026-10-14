import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROOT = join(import.meta.dirname, '..', '..');

/** Все файлы под `dir` с заданными расширениями; пути относительные к корню репо, через `/`. */
export function listFiles(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(abs, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some((e) => name.endsWith(e))) out.push(relative(ROOT, p).split(sep).join('/'));
    }
  };
  walk(join(ROOT, dir));
  return out.sort();
}

/** Запущен ли модуль как скрипт (а не импортирован тестом). */
export function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}
