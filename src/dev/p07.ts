// Dev-демо окна диалога P-07 (только `/?dev=lesson`): `dlg=dlg.dev.p07` — сцена базара из СЮЖЕТ_v2 d01.s4
// (тексты оттуда, в content/ не попадает: реплики переписывает P-08) со всеми видами коробок: русская
// речь Казика с польским вкраплением, польская реплика NPC с подписью, выбор из двух с ошибкой, длинная
// реплика на две коробки, рассказчик. `learn=dlg|lx.a,lx.b` — слова «выучены» (intro + rev, интервал 3 дня):
// подпись знакомых строк гаснет. Склейка dev-страницы, как main.ts.
import type { Content } from '../systems/content';
import type { EventDraft } from '../systems/log';
import { buildWordIndex, isLatin, matchWords } from '../systems/words';
import type { Dialogue, Line } from '../types/content';

export const P07_DLG = 'dlg.dev.p07';

const LINES: Line[] = [
  { id: 'dev.p07.kazik.1', who: 'bobr', ru: 'Вон ящик. Скажи ей «Dzień dobry»: здравствуйте.' },
  { id: 'dev.p07.kazik.2', who: 'bobr', pl: 'No proszę. Gość mówi!', plRu: 'Ну надо же. Гость говорит!' },
  {
    id: 'dev.p07.kazik.3',
    who: 'bobr',
    ru: 'Первая печать. Кривая, но наша. Это паспорт гостя. Печать ставит тот, с кем ты поговорил. Главная тут Прага.',
  },
  { id: 'dev.p07.narr.1', who: 'narrator', ru: 'Паспорт гостя. Пустой. Фото подошло.' },
];

const DIALOGUE: Dialogue = {
  id: P07_DLG,
  npc: 'pani_hela',
  start: 'kazik',
  nodes: {
    kazik: { line: 'dev.p07.kazik.1', next: 'tak' },
    tak: {
      who: 'pani_hela',
      pl: 'Tak?',
      ru: 'Да?',
      choices: [
        { pl: 'Dzień dobry!', ru: 'Здравствуйте!', ok: true, react: 'happy', next: 'ok' },
        { pl: 'Do widzenia!', ru: 'До свидания!', ok: false, react: 'cold', next: 'err' },
      ],
    },
    err: { who: 'pani_hela', pl: 'Do widzenia? Pan dopiero przyszedł!', ru: 'До свидания? Вы же только пришли!', next: 'tak' },
    ok: { who: 'pani_hela', pl: 'Dzień dobry!', ru: 'Здравствуйте!', next: 'gosc' },
    gosc: { line: 'dev.p07.kazik.2', next: 'bierze' },
    bierze: { who: 'pani_hela', pl: 'Pan bierze? Za darmo. To też za darmo. I pieczątka. Gratis.', ru: 'Берёте? Даром. Это тоже даром. И печать. Бесплатно.', next: 'stamp' },
    stamp: { line: 'dev.p07.kazik.3', next: 'narr' },
    narr: { line: 'dev.p07.narr.1', next: 'end' },
    end: { end: true },
  },
};

/** Подложить демо-диалог и его реплики в контент dev-страницы (в памяти). */
export function addP07Demo(content: Content): void {
  (content.dialogues as Map<string, { module: string; value: Dialogue }>).set(P07_DLG, { module: 'ch01', value: DIALOGUE });
  for (const l of LINES) (content.lines as Map<string, Line>).set(l.id, l);
}

/** Слова диалога из словаря: польские строки целиком, у русской речи — латиница. */
export function dialogueWords(content: Content, dlgId: string): string[] {
  const d = content.dialogues.get(dlgId)?.value;
  if (!d) return [];
  const index = buildWordIndex([...content.vocab.values()].map((x) => x.value));
  const out = new Set<string>();
  const add = (text: string | undefined, latinOnly = false): void => {
    if (!text) return;
    for (const s of matchWords(text, index, latinOnly ? { only: isLatin } : {})) if (s.lx) out.add(s.lx);
  };
  for (const n of Object.values(d.nodes)) {
    add(n.pl);
    for (const c of n.choices ?? []) add(c.pl);
    const l = n.line ? content.lines.get(n.line) : undefined;
    add(l?.pl);
    add(l?.ru, true);
  }
  return [...out];
}

/** «Выучить» слова: intro 4 дня назад и верный повтор 3 дня назад → карточка rec с интервалом 3 дня. */
export function learnDrafts(items: readonly string[], now: number): EventDraft[] {
  const day = 86_400_000;
  return items.flatMap((item): EventDraft[] => [
    { k: 'intro', ts: now - 4 * day, item, lesson: 'dev.learn', ok: ['rec', 'lis'] },
    { k: 'rev', ts: now - 3 * day + 3_600_000, card: `${item}#rec`, g: 3, ms: 1500, src: 'scene' },
  ]);
}
