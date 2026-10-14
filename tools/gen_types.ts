// JSON Schema (content/schema/*.schema.json) → src/types/content.d.ts (ТЗ §2.3, I-02).
// `npm run gen:types` перезаписывает файл; `--check` только сравнивает (exit 1, если устарел).
// tests/content.test.ts тоже сверяет файл со схемами, поэтому `npm run check` ловит забытую генерацию.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, type JSONSchema } from 'json-schema-to-typescript';
import { isMain, ROOT } from './lib/files';

export const SCHEMA_DIR = join(ROOT, 'content', 'schema');
export const TYPES_FILE = join(ROOT, 'src', 'types', 'content.d.ts');

/** Файл контента → схема. Корневой тип ContentFiles собирает их, чтобы общие типы объявлялись один раз. */
const ROOTS: Record<string, string> = {
  world: 'world',
  characters: 'characters',
  items: 'items',
  tuning: 'tuning',
  director: 'director',
  lines: 'lines',
  secrets: 'secrets',
  orders: 'orders',
  recipes: 'recipes',
  phonetics: 'phonetics',
  errorTags: 'errorTags',
  module: 'module',
  vocab: 'vocab',
  lessons: 'lessons',
  dialogues: 'dialogues',
  map: 'map',
  step: 'steps',
  condition: 'conditions',
  effects: 'effects',
};

const BANNER = `/* eslint-disable */
// Сгенерировано tools/gen_types.ts из content/schema/*.schema.json. Не править руками:
// поменяй схему и запусти \`npm run gen:types\`.`;

export async function generate(): Promise<string> {
  const root = {
    title: 'ContentFiles',
    description: 'Тип каждого файла контента (ключ = вид файла).',
    type: 'object',
    additionalProperties: false,
    required: Object.keys(ROOTS),
    properties: Object.fromEntries(Object.entries(ROOTS).map(([k, f]) => [k, { $ref: `${f}.schema.json` }])),
  } as JSONSchema;
  return compile(root, 'ContentFiles', {
    cwd: SCHEMA_DIR,
    bannerComment: BANNER,
    additionalProperties: false,
    declareExternallyReferenced: true,
    unreachableDefinitions: false,
    maxItems: 2, // кортежи только для пар ([x, y], пара слов); длинные массивы остаются массивами
    style: { singleQuote: true, printWidth: 120 },
  });
}

if (isMain(import.meta.url)) {
  const out = await generate();
  if (process.argv.includes('--check')) {
    let cur = '';
    try {
      cur = readFileSync(TYPES_FILE, 'utf8');
    } catch {
      /* нет файла */
    }
    if (cur !== out) {
      console.error('gen:types: src/types/content.d.ts устарел, запусти `npm run gen:types`');
      process.exit(1);
    }
    console.log('gen:types: content.d.ts актуален');
  } else {
    writeFileSync(TYPES_FILE, out);
    console.log('gen:types: src/types/content.d.ts обновлён');
  }
}
