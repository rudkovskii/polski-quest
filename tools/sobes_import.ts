// Импорт вопросов собеса в игру «Sobes» (личная версия Шэфа, 30.10.2026): что сейчас учится в дриле → `content/v2/sobes.json`.
//   npm run sobes            # записать sobes.json
//   npm run sobes -- --check # только сверить: файл совпадает с источником (exit 1, если нет)
// Источники — папка `ПМЖ/Собес` (путь можно задать `SOBES_DIR`), своих копий текстов игра не держит:
//   - `drill/progress.md`, таблица между якорями STATUSY: берутся слои «ядро» и «личное» со статусом «учу» или «тетрадка»,
//     порядок — по дате «Последний», свежие первыми (то, что Шэф сейчас гоняет на занятиях, сажается первым);
//   - `Miso-baza-voprosov.md`: вопрос, ответ и три строки разметки под ним — `**Kawałki:**` (ответ, порезанный « / »),
//     `**Ru:**` (суть вопроса по-русски), `**Sedno:**` (факты ответа по-русски, через « · »). Склейка кусков обязана равняться ответу.
// Вопрос в работе без разметки в игру не попадает и печатается списком: его размечают в базе (KM или руками) и запускают импорт снова.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, ROOT } from './lib/files';

export interface SobesUnit {
  id: string;
  kind: 'answer';
  type: string;
  n: number;
  /** Вопрос по-польски. */
  pl: string;
  /** Суть вопроса по-русски. */
  ru: string;
  tr: string;
  band: number;
  /** Ответ целиком (склейка кусков). */
  answer: string;
  chunks: string[];
  sedno: string[];
  short?: string;
  variant?: string;
  status: string;
  last: string;
}

export interface SobesDoc {
  version: 1;
  src: string;
  units: SobesUnit[];
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Номера в работе из таблицы статусов: [номер, статус, слой, «Последний»] в порядке свежести. */
export function activeRows(progress: string): { n: number; status: string; layer: string; last: string }[] {
  const a = progress.lastIndexOf('<!-- STATUSY:START -->');
  const b = progress.lastIndexOf('<!-- STATUSY:END -->');
  if (a < 0 || b < a) throw new Error('progress.md: нет якорей STATUSY');
  const rows: { n: number; status: string; layer: string; last: string; at: number }[] = [];
  for (const line of progress.slice(a, b).split('\n')) {
    const c = line.split('|').map((x) => x.replace(/\*/g, '').trim());
    // | # | Вопрос | Категория | Слой | Статус | Серия | В приложении | Последний | Следующий |
    if (c.length < 10 || !/^\d+$/.test(c[1]!)) continue;
    const layer = c[4]!;
    const status = c[5]!;
    if (!['ядро', 'личное'].includes(layer) || !['учу', 'тетрадка'].includes(status)) continue;
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(c[8]!);
    rows.push({ n: Number(c[1]), status, layer, last: c[8]!, at: m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0 });
  }
  return rows.sort((x, y) => y.at - x.at || x.n - y.n).map(({ at: _at, ...r }) => r);
}

/** Карточки базы с разметкой: номер → вопрос, ответ, куски, суть. */
export function parseBase(md: string): Map<number, { q: string; answer: string; short?: string; variant?: string; chunks?: string[]; ru?: string; sedno?: string[] }> {
  const out = new Map<number, { q: string; answer: string; short?: string; variant?: string; chunks?: string[]; ru?: string; sedno?: string[] }>();
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^###\s+(\d+)\.\s*(.+?)\s*$/.exec(lines[i]!);
    if (!m) continue;
    const blk: string[] = [];
    for (let j = i + 1; j < lines.length && !/^(#{2,3}\s|\s*---\s*$)/.test(lines[j]!); j++) blk.push(lines[j]!.trim());
    const body: string[] = [];
    for (const l of blk) {
      if (!l) {
        if (body.length) break;
        continue;
      }
      body.push(l);
    }
    const tag = (name: string): string | undefined => {
      const l = blk.find((x) => x.startsWith(`**${name}:**`));
      return l ? norm(l.slice(name.length + 5)) : undefined;
    };
    const chunks = tag('Kawałki')?.split(' / ').map(norm).filter(Boolean);
    const sedno = tag('Sedno')?.split(' · ').map(norm).filter(Boolean);
    const ru = tag('Ru');
    const short = tag('Krótko');
    const variant = tag('Wariant');
    out.set(Number(m[1]), {
      q: m[2]!,
      answer: norm(body.filter((l) => !l.startsWith('**')).join(' ')),
      ...(short ? { short } : {}),
      ...(variant ? { variant } : {}),
      ...(chunks ? { chunks } : {}),
      ...(ru ? { ru } : {}),
      ...(sedno ? { sedno } : {}),
    });
  }
  return out;
}

export function buildSobes(base: string, progress: string): { doc: SobesDoc; missing: number[]; errors: string[] } {
  const cards = parseBase(base);
  const units: SobesUnit[] = [];
  const missing: number[] = [];
  const errors: string[] = [];
  for (const r of activeRows(progress)) {
    const c = cards.get(r.n);
    if (!c) {
      errors.push(`№${r.n}: в базе нет вопроса`);
      continue;
    }
    if (!c.chunks || !c.ru || !c.sedno) {
      missing.push(r.n);
      continue;
    }
    if (norm(c.chunks.join(' ')) !== c.answer) {
      errors.push(`№${r.n}: куски не совпадают с ответом — поправь строку Kawałki`);
      continue;
    }
    if (c.chunks.length < 2) {
      errors.push(`№${r.n}: нужно хотя бы два куска`);
      continue;
    }
    units.push({
      id: `ans.${r.n}`,
      kind: 'answer',
      type: r.layer === 'личное' ? 'personal' : 'core',
      n: r.n,
      pl: c.q,
      ru: c.ru,
      tr: '',
      band: 1,
      answer: c.answer,
      chunks: c.chunks,
      sedno: c.sedno,
      ...(c.short ? { short: c.short } : {}),
      ...(c.variant ? { variant: c.variant } : {}),
      status: r.status,
      last: r.last,
    });
  }
  return { doc: { version: 1, src: 'ПМЖ/Собес: drill/progress.md (STATUSY) + Miso-baza-voprosov.md (Kawałki, Ru, Sedno)', units }, missing, errors };
}

export const SOBES_JSON = join(ROOT, 'content', 'v2', 'sobes.json');

if (isMain(import.meta.url)) {
  const dir = process.env.SOBES_DIR ?? join(ROOT, '..', '..', '..', 'ПМЖ', 'Собес');
  const basePath = join(dir, 'Miso-baza-voprosov.md');
  const progPath = join(dir, 'drill', 'progress.md');
  if (!existsSync(basePath) || !existsSync(progPath)) {
    console.error(`нет источников в ${dir} (задай SOBES_DIR)`);
    process.exit(1);
  }
  const { doc, missing, errors } = buildSobes(readFileSync(basePath, 'utf8'), readFileSync(progPath, 'utf8'));
  for (const e of errors) console.error(`ошибка: ${e}`);
  if (missing.length) console.log(`без разметки (в игру не попали): ${missing.map((n) => `№${n}`).join(', ')}`);
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  if (process.argv.includes('--check')) {
    const same = existsSync(SOBES_JSON) && readFileSync(SOBES_JSON, 'utf8') === text;
    console.log(same ? `sobes.json актуален: ${doc.units.length} вопросов` : 'sobes.json отстал от источника: npm run sobes');
    process.exit(same && !errors.length ? 0 : 1);
  }
  writeFileSync(SOBES_JSON, text);
  console.log(`sobes.json: ${doc.units.length} вопросов (${doc.units.map((u) => u.n).join(', ')})`);
  if (errors.length) process.exit(1);
}
