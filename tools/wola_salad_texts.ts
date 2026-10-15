// Строки Salad Story для озвучки (W-02): всё, что визит может сказать вслух (реплики кассиров с подстановками меню,
// шаги на слух, «повтори вслух», задание в реале) — из того же генератора, что играет (src/wola/systems/saladVisit.ts).
// Печатает JSON { texts: [{ text, slow }], spoken: { заимствование: написание } } для tools/build_audio.py.
//   npx tsx tools/wola_salad_texts.ts [--root <content>]
import { join, resolve } from 'node:path';
import { wolaContentFrom } from '../src/wola/content';
import { saladTexts } from '../src/wola/systems/saladVisit';
import { readContentDir } from './lib/content_io';
import { isMain, ROOT } from './lib/files';

export function saladAudio(root = join(ROOT, 'content')): { texts: { text: string; slow: boolean }[]; spoken: Record<string, string> } {
  const disk = readContentDir(root).files;
  const files = Object.fromEntries([...disk].map(([k, v]) => [`/content/${k}`, v]));
  const { content, salad } = wolaContentFrom(files);
  return { texts: saladTexts(salad, (id) => content.vocab.get(id)?.value), spoken: salad.menu.spoken };
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  process.stdout.write(JSON.stringify(saladAudio(i >= 0 ? resolve(process.argv[i + 1]!) : undefined)));
}
