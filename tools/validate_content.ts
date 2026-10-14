// Валидатор контента (ТЗ §3.13): схемы, дубли, ссылки, ASCII-карты, introduces, озвучка, удалённые слова,
// реплики, секреты, рецепты. Вывод `файл:путь: сообщение`, exit 1 при ошибках.
//   npm run validate                                   # content/, п. 7 против git (origin/main или HEAD~1 в CI)
//   npx tsx tools/validate_content.ts --root tests/fixtures/content-mini
//   … --prev <dir>                                     # п. 7 против другого корня контента
//   … --base <ref>                                     # п. 7 против ревизии git
//   … --quiet                                          # без предупреждений
//   … --release  (или PQ_RELEASE=1)                     # todo в бите первого дня = ошибка (P-01)
import { relative, resolve } from 'node:path';
import { formatIssue } from './lib/content_check';
import { validateDir } from './lib/content_io';
import { isMain, ROOT } from './lib/files';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (isMain(import.meta.url)) {
  const root = resolve(arg('--root') ?? 'content');
  const prefix = `${relative(ROOT, root).split('\\').join('/') || '.'}/`;
  const { issues, files, prevFrom } = validateDir({
    root,
    prevRoot: arg('--prev'),
    base: arg('--base'),
    release: process.argv.includes('--release') || process.env.PQ_RELEASE === '1',
  });
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  for (const i of errors) console.error(formatIssue(i, prefix));
  if (!process.argv.includes('--quiet')) for (const i of warns) console.log(formatIssue(i, prefix));
  const tail = `${files} файлов, ошибок ${errors.length}, предупреждений ${warns.length}${prevFrom ? `, слова сверены с ${prevFrom}` : ''}`;
  if (errors.length) {
    console.error(`validate: ${prefix} — ${tail}`);
    process.exit(1);
  }
  console.log(`validate: ${prefix} ок — ${tail}`);
}
