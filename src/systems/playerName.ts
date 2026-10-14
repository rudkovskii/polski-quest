// Имя игрока в репликах (P-10a): плейсхолдер `{name}` в `pl`/`ru`/`plRu` реплик, вариантов ответа и шагов
// уроков подставляется в рантайме именем из Fotobudka (`settings.avatar.name`). Реплика `<id>.anyname`
// подменяет `<id>`, когда имя не «Dima» (шутка Брзехвы «Dima / zima» звучит только для Димы).
// Чистый модуль: склейка (src/avatarGlue.ts) зовёт personalize() при смене имени, тексты меняются на месте —
// диалоги, пузыри, уроки и подпись говорящего читают контент как раньше.
import type { Content } from './content';
import { DEFAULT_NAME } from './avatar';

export const NAME_TOKEN = '{name}';
/** Суффикс реплики-замены для любого имени, кроме «Dima». */
export const ANY_NAME_SUFFIX = '.anyname';
/** Поля, в которых `{name}` разрешён (валидатор, tools/lib/content_check.ts). */
export const NAME_FIELDS: readonly string[] = ['pl', 'ru', 'plRu'];

/** Имя по умолчанию: озвучка (tools/build_audio.py) и рифма «Dima / zima» написаны для него. */
export function isDefaultName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === DEFAULT_NAME.toLowerCase() || n === 'дима';
}

/** `{name}` → имя. Пустое имя → «Dima». */
export function fillName(text: string, name: string): string {
  return text.includes(NAME_TOKEN) ? text.split(NAME_TOKEN).join(name.trim() || DEFAULT_NAME) : text;
}

/** Текст для озвучки и проверок: `{name}` = «Dima» (файлы озвучки собраны под него). */
export const defaultNamed = (text: string): string => fillName(text, DEFAULT_NAME);

interface Slot {
  obj: Record<string, unknown>;
  key: string;
  /** Исходное значение (как в JSON). */
  base: unknown;
  /** Значение для имени не «Dima» (из реплики `.anyname`); `undefined` в alt = поля нет. */
  alt?: { value: unknown };
}

const memo = new WeakMap<object, Slot[]>();

function collect(content: Pick<Content, 'lines' | 'dialogues' | 'lessons' | 'characters'>): Slot[] {
  const slots: Slot[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === 'string' && x.includes(NAME_TOKEN)) slots.push({ obj: v as Record<string, unknown>, key: k, base: x });
        else if (x && typeof x === 'object') walk(x);
      }
  };
  for (const [id, line] of content.lines) {
    if (id.endsWith(ANY_NAME_SUFFIX)) continue;
    const alt = content.lines.get(`${id}${ANY_NAME_SUFFIX}`);
    if (alt) {
      const l = line as unknown as Record<string, unknown>;
      const a = alt as unknown as Record<string, unknown>;
      for (const key of [...NAME_FIELDS, 'words']) slots.push({ obj: l, key, base: l[key], alt: { value: a[key] } });
    } else walk(line);
  }
  for (const d of content.dialogues.values()) walk(d.value.nodes);
  for (const l of content.lessons.values()) walk(l.value);
  for (const c of content.characters.values())
    if (c.kind === 'player') slots.push({ obj: c as unknown as Record<string, unknown>, key: 'name', base: `${NAME_TOKEN}` });
  return slots;
}

/**
 * Подставить имя игрока в контент на месте. Повторный вызов с другим именем берёт исходные шаблоны
 * (они запомнены при первом вызове), так что имя можно менять сколько угодно (зеркало, облако).
 */
export function personalize(content: Pick<Content, 'lines' | 'dialogues' | 'lessons' | 'characters'>, name: string): void {
  let slots = memo.get(content.lines);
  if (!slots) {
    slots = collect(content);
    memo.set(content.lines, slots);
  }
  const other = !isDefaultName(name);
  for (const s of slots) {
    const v = other && s.alt ? s.alt.value : s.base;
    if (v === undefined) delete s.obj[s.key];
    else s.obj[s.key] = typeof v === 'string' ? fillName(v, name) : v;
  }
}
