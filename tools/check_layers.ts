// Правила слоёв (ТЗ §2.1): разбор import в src/** и доступа к глобалам браузера в чистых systems.
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { isMain, listFiles, ROOT } from './lib/files';

type Layer = 'systems' | 'platform' | 'world' | 'ui' | 'input' | 'types' | 'games' | 'root';

export function layerOf(path: string): Layer {
  if (path.startsWith('src/systems/platform/')) return 'platform';
  if (path.startsWith('src/systems/')) return 'systems';
  if (path.startsWith('src/scenes/') || path.startsWith('src/world/')) return 'world';
  if (path.startsWith('src/ui/')) return 'ui';
  if (path.startsWith('src/input/')) return 'input';
  if (path.startsWith('src/types/')) return 'types';
  // v2: игры о Польше (`src/games/<id>/`): DOM-экраны поверх чистой модели; их собирает только main.ts.
  if (path.startsWith('src/games/')) return 'games';
  return 'root';
}

/** Слой → слои, которые ему запрещено импортировать. `phaser` — пакет. */
const FORBIDDEN: Record<Layer, (Layer | 'phaser')[]> = {
  systems: ['phaser', 'platform', 'world', 'ui', 'input', 'games', 'root'],
  platform: ['phaser', 'world', 'ui', 'input', 'games', 'root'],
  world: ['ui', 'games', 'root'],
  ui: ['phaser', 'world', 'games', 'root'],
  // Ввод (ТЗ §2.1): читает DOM-события и шлёт intents в bus, сцены и экраны не знает.
  input: ['phaser', 'platform', 'world', 'ui', 'games', 'root'],
  types: ['phaser', 'platform', 'world', 'ui', 'input', 'games', 'root'],
  // Игры v2: чистая модель (systems), DOM-хелперы (ui), типы. Без Phaser, адаптеров браузера, мира, ввода.
  games: ['phaser', 'platform', 'world', 'input', 'root'],
  root: [],
};

const BROWSER_GLOBALS = /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|requestAnimationFrame)\b/;

export interface Violation {
  file: string;
  detail: string;
}

function stripCommentsAndStrings(src: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, src);
  let out = '';
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
    if (
      k === ts.SyntaxKind.StringLiteral ||
      k === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      k === ts.SyntaxKind.TemplateHead ||
      k === ts.SyntaxKind.TemplateMiddle ||
      k === ts.SyntaxKind.TemplateTail
    ) {
      out += ' "" ';
    } else {
      out += `${scanner.getTokenText()} `;
    }
  }
  return out;
}

export function checkFile(file: string, source: string): Violation[] {
  const v: Violation[] = [];
  const from = layerOf(file);
  const info = ts.preProcessFile(source, true, true);
  for (const imp of info.importedFiles) {
    const spec = imp.fileName;
    let target: Layer | 'phaser' | null = null;
    if (spec === 'phaser' || spec.startsWith('phaser/')) target = 'phaser';
    else if (spec.startsWith('.')) {
      const resolved = normalize(join(dirname(file), spec)).split('\\').join('/');
      // `/` в конце: импорт папки (`../input` → src/input/index.ts) попадает в слой папки.
      if (resolved.startsWith('src/')) target = layerOf(resolved.endsWith('.ts') ? resolved : `${resolved}/`);
    }
    if (target && FORBIDDEN[from].includes(target)) {
      v.push({ file, detail: `слой ${from} не импортирует ${target}: '${spec}'` });
    }
  }
  if (from === 'systems' || from === 'types') {
    const code = stripCommentsAndStrings(source);
    const m = BROWSER_GLOBALS.exec(code);
    if (m) v.push({ file, detail: `${from} не трогает браузерные глобалы: ${m[1]} (адаптер в src/systems/platform/)` });
  }
  return v;
}

if (isMain(import.meta.url)) {
  const files = listFiles('src', ['.ts', '.tsx']);
  const violations = files.flatMap((f) => checkFile(f, readFileSync(join(ROOT, f), 'utf8')));
  for (const x of violations) console.error(`${x.file}: ${x.detail}`);
  if (violations.length) {
    console.error(`check:layers: ${violations.length} нарушени(й)`);
    process.exit(1);
  }
  console.log(`check:layers: ok (${files.length} файлов)`);
}
