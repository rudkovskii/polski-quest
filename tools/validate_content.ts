// Заглушка валидатора контента (I-01). Схемы, ссылки, карты и покрытие аудио — I-02 (ТЗ §3.13).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles, ROOT } from './lib/files';

if (!existsSync(join(ROOT, 'content'))) {
  console.error('validate: нет папки content/');
  process.exit(1);
}
const files = listFiles('content', ['.json']);
if (files.length === 0) {
  console.log('validate: нет контента, ок');
} else {
  console.log(`validate: ${files.length} файлов, схемы появятся в I-02, ок`);
}
