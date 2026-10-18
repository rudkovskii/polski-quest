// Запрещённое API (AGENTS.md → «Запрещено»). Список сверен с migration guide Phaser 3→4
// (node_modules/phaser/skills/v3-to-v4-migration/SKILL.md) в I-01 и пополняется там же.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, listFiles, ROOT } from './lib/files';

export interface Rule {
  re: RegExp;
  why: string;
  /** Применять только к путям, для которых вернёт true. */
  scope?: (path: string) => boolean;
  /** Строка с этой пометкой пропускается (только там, где правило это допускает). */
  allow?: string;
}

const inPureSystems = (p: string): boolean => (p.startsWith('src/systems/') && !p.startsWith('src/systems/platform/'));
/** Сцены, мир и экраны: ввод только через intents (src/input); исключение — поля ввода (src/ui/keyboard). */
const inScenesOrScreens = (p: string): boolean =>
  /^src\/(scenes|world|ui|games)\//.test(p) && !p.startsWith('src/ui/keyboard/');

export const RULES: Rule[] = [
  // Phaser 3 API, удалённое или заменённое в Phaser 4
  { re: /\bpreFX\b/, why: 'Phaser 3 FX: в Phaser 4 это filters.internal' },
  { re: /\bpostFX\b/, why: 'Phaser 3 FX: в Phaser 4 это filters.external' },
  { re: /\bBitmapMask\b/, why: 'BitmapMask удалён: filters.internal.addMask()' },
  { re: /\bGeom\.Point\b/, why: 'Geom.Point удалён: Phaser.Math.Vector2' },
  { re: /\bsetTintFill\b|\btintFill\b/, why: 'tintFill удалён: setTint().setTintMode(Phaser.TintModes.FILL)' },
  { re: /\bStruct\.(Set|Map)\b/, why: 'Phaser.Struct.Set/Map удалены: нативные Set/Map' },
  { re: /\brenderer\.pipelines\b/, why: 'Пайплайнов нет: render nodes' },
  { re: /Pipeline/, why: 'Pipeline удалён (setPipeline, PostFXPipeline…): render nodes, setLighting(true)' },
  { re: /\b(Mesh|Plane)\b|\badd\.(mesh|plane)\b/, why: 'Mesh и Plane удалены в Phaser 4' },
  { re: /\bPhaser\.CANVAS\b/, why: 'Только WEBGL (Canvas-рендерер устарел)' },
  { re: /\bMath\.PI2\b/, why: 'Math.PI2 удалён: Math.TAU (= 2π в Phaser 4)' },
  { re: /\bGenerateTexture\b|\btextures\.generate\b/, why: 'Create.GenerateTexture / TextureManager.generate удалены' },
  { re: /\bSinCosTableGenerator\b/, why: 'Удалён в Phaser 4' },
  { re: /\b(Camera3D|Layer3D)\b/, why: 'Плагины 3D удалены в Phaser 4' },
  // Текст в canvas: польский текст рисует только DOM-оверлей
  {
    re: /\b(add|make)\.(text|bitmapText)\s*\(/,
    why: 'Текст в canvas запрещён (кроме цифр HUD с пометкой `banned-ok: hud-digits`)',
    allow: 'banned-ok: hud-digits',
  },
  // Чистые systems: время и хранилище приходят снаружи
  { re: /\blocalStorage\b/, why: 'localStorage вне src/systems/platform/', scope: inPureSystems },
  { re: /\bindexedDB\b/, why: 'indexedDB вне src/systems/platform/', scope: inPureSystems },
  { re: /\bfetch\s*\(/, why: 'fetch вне src/systems/platform/', scope: inPureSystems },
  { re: /\bDate\.now\s*\(|\bnew Date\(\s*\)/, why: 'Текущее время в systems: передавай параметр now', scope: inPureSystems },
  // Ввод: прямые keydown/pointerdown в сценах и экранах (ТЗ §2.1, §2.7)
  {
    re: /['"`](keydown|keyup|keypress|pointerdown|pointerup)['"`]|\bon(keydown|keyup|keypress|pointerdown|pointerup)\b|\binput\.keyboard\b/,
    why: 'Ввод только через src/input (intents в bus); keydown/pointerdown слушают src/input и src/ui/keyboard',
    scope: inScenesOrScreens,
  },
];

export interface Hit {
  file: string;
  line: number;
  text: string;
  why: string;
}

export function scan(file: string, source: string, rules: Rule[] = RULES): Hit[] {
  const hits: Hit[] = [];
  source.split('\n').forEach((text, i) => {
    for (const r of rules) {
      if (r.scope && !r.scope(file)) continue;
      if (!r.re.test(text)) continue;
      if (r.allow && text.includes(r.allow)) continue;
      hits.push({ file, line: i + 1, text: text.trim(), why: r.why });
    }
  });
  return hits;
}

if (isMain(import.meta.url)) {
  const files = listFiles('src', ['.ts', '.tsx', '.js', '.mjs', '.html', '.css']);
  const hits = files.flatMap((f) => scan(f, readFileSync(join(ROOT, f), 'utf8')));
  for (const h of hits) console.error(`${h.file}:${h.line}: ${h.why}\n    ${h.text}`);
  if (hits.length) {
    console.error(`check:banned: ${hits.length} нарушени(й) в ${files.length} файлах`);
    process.exit(1);
  }
  console.log(`check:banned: ok (${files.length} файлов)`);
}
