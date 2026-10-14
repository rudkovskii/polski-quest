// Чтение контента с диска и предыдущей версии слов из git (для tools/validate_content.ts,
// vite-плагина и тестов). Сама проверка — в content_check.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { checkContent, type Issue } from './content_check';
import { ROOT } from './files';

export const CONTENT_DIR = join(ROOT, 'content');
export const SCHEMA_DIR = join(CONTENT_DIR, 'schema');
export const AUDIO_MANIFEST = join(ROOT, 'public', 'audio', 'manifest.json');

const toPosix = (p: string): string => p.split(sep).join('/');

function walkJson(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const name of readdirSync(abs).sort()) {
      if (name.startsWith('.')) continue;
      const p = join(abs, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json')) out.push(toPosix(relative(dir, p)));
    }
  };
  walk(dir);
  return out;
}

/** Все JSON под корнем контента, кроме `schema/`. Ошибки разбора — отдельным списком. */
export function readContentDir(root: string): { files: Map<string, unknown>; issues: Issue[] } {
  const files = new Map<string, unknown>();
  const issues: Issue[] = [];
  for (const rel of walkJson(root)) {
    if (rel.startsWith('schema/')) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    try {
      files.set(rel, JSON.parse(text));
    } catch (e) {
      issues.push({ level: 'error', code: 'json', file: rel, path: '', msg: `не JSON: ${(e as Error).message}` });
    }
  }
  return { files, issues };
}

export function readSchemas(dir = SCHEMA_DIR): Map<string, object> {
  const out = new Map<string, object>();
  for (const name of readdirSync(dir).sort())
    if (name.endsWith('.schema.json')) out.set(name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as object);
  return out;
}

/** lxId → файл из набора файлов контента (vocab.json модулей). */
export function vocabIds(files: ReadonlyMap<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [file, data] of files) {
    if (!/^modules\/[^/]+\/vocab\.json$/.test(file) || !Array.isArray(data)) continue;
    for (const v of data as { id?: unknown }[]) if (typeof v?.id === 'string') out.set(v.id, file);
  }
  return out;
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
}

/**
 * База для п. 7: `--base <ref>`, иначе в CI `HEAD~1`, локально `origin/main`.
 * Возвращает null, если такой ревизии нет (первый коммит, мелкий клон).
 */
export function defaultBaseRef(): string | null {
  const candidates = process.env.CI ? ['HEAD~1'] : ['origin/main', 'main'];
  for (const ref of candidates) if (git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null) return ref;
  return null;
}

/** Слова из vocab.json всех модулей в ревизии `ref` (только для корня content/ репозитория). */
export function vocabIdsFromGit(ref: string, contentRel = 'content'): Map<string, string> | null {
  const list = git(['ls-tree', '-r', '--name-only', ref, '--', `${contentRel}/modules`]);
  if (list === null) return null;
  const out = new Map<string, string>();
  for (const path of list.split('\n')) {
    if (!/\/modules\/[^/]+\/vocab\.json$/.test(path)) continue;
    const text = git(['show', `${ref}:${path}`]);
    if (text === null) continue;
    try {
      const rel = path.slice(contentRel.length + 1);
      for (const [id] of vocabIds(new Map([[rel, JSON.parse(text)]]))) out.set(id, rel);
    } catch {
      /* битый JSON в прошлой версии не мешает */
    }
  }
  return out;
}

export interface ValidateOptions {
  /** Корень контента (по умолчанию content/). */
  root?: string;
  /** Сравнить слова с другим корнем контента вместо git (п. 7). */
  prevRoot?: string;
  /** Git-ревизия для п. 7 (по умолчанию defaultBaseRef()). Только для content/ репозитория. */
  base?: string;
  /** Сборка release (P-01): todo в бите первого дня = ошибка. */
  release?: boolean;
}

export interface ValidateResult {
  issues: Issue[];
  files: number;
  /** Откуда взяты прошлые id слов (для п. 7), или null. */
  prevFrom: string | null;
}

export function validateDir(opts: ValidateOptions = {}): ValidateResult {
  const root = resolve(opts.root ?? CONTENT_DIR);
  const { files, issues } = readContentDir(root);
  let prevVocab: Map<string, string> | null = null;
  let prevFrom: string | null = null;
  if (opts.prevRoot) {
    prevVocab = vocabIds(readContentDir(resolve(opts.prevRoot)).files);
    prevFrom = toPosix(relative(ROOT, resolve(opts.prevRoot)));
  } else if (root === CONTENT_DIR) {
    const ref = opts.base ?? defaultBaseRef();
    prevVocab = ref ? vocabIdsFromGit(ref) : null;
    prevFrom = prevVocab ? ref : null;
  }
  const audioManifest = existsSync(AUDIO_MANIFEST) ? (JSON.parse(readFileSync(AUDIO_MANIFEST, 'utf8')) as unknown) : undefined;
  if (issues.length) return { issues, files: files.size + issues.length, prevFrom };
  const all = checkContent({ files, schemas: readSchemas(), prevVocab, audioManifest, ...(opts.release ? { release: true } : {}) });
  if (!prevVocab && root === CONTENT_DIR)
    all.push({ level: 'warn', code: 'vocab-removed', file: '*', path: '', msg: 'нет базовой ревизии git: удаление id слов (п. 7) не проверено' });
  return { issues: all, files: files.size, prevFrom };
}
