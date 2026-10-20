// @vitest-environment happy-dom
// Сборщик польских строк, которые игры v2 произносят (🔊, плитки, части флага/герба, озвучка после ответа), для tools/audio_list.py.
// Не тест: запускается отдельно и пишет content/audio_harvest.json (в git не идёт):
//   npx vitest run --config tools/audio_harvest.config.ts
// Каждая игра рисует задания для всех единиц пула, 4 вида Want, несколько seed; жмём все 🔊, плитки и `hy-pick`, собираем текст `say`;
// плюс экран выбора (колесо Święta), карточки знакомства (единицы ещё не «знакомы») и отзыв `check` на неверный и верный ответ.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { GAMES } from '../src/games/registry';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import { SUBLEVELS, A1_LEVEL } from '../src/systems/xp';
import type { GameCtx, GamePanel, Want } from '../src/types/polska';
import { polishPart } from '../src/ui/sayButton';
import { seeded, testBus } from '../tests/helpers';

const NOW = Date.UTC(2026, 9, 18, 9, 0);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

it('harvest', () => {
  const out = new Map<string, Set<string>>();
  const add = (src: string, t: string | undefined | null): void => {
    const s = (t ?? '').normalize('NFC').trim();
    if (!s || /[а-яё]/i.test(s) || !/\p{L}{2,}/u.test(s)) return;
    (out.get(s) ?? out.set(s, new Set()).get(s)!).add(src);
  };
  for (const seen of [true, false]) {
    for (const g of GAMES) {
      let save: PolskaSave = newPolskaSave();
      const p = createPolska({ bus: testBus(), load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
      if (seen) for (const u of p.content.units) p.markSeen(u.id);
      for (const seed of seen ? SEEDS : [1]) {
        const ctx: GameCtx = {
          units: p.units(g.id), unit: (id) => p.unit(id), info: (id) => p.info(id), seen: (id) => p.seen(id), markSeen: () => {},
          doc: p.content.docs[g.id], now: () => NOW, date: () => ({ y: 2026, m: 10, d: 18, weekday: 0 }), rand: seeded(seed),
        };
        const said: string[] = [];
        const mkPanel = (): GamePanel => {
          const panel: GamePanel = { body: document.createElement('div'), foot: document.createElement('div'), layout: g.layout, submit: () => {}, say: (t) => said.push(t), rand: seeded(seed + 1) };
          document.body.append(panel.body, panel.foot);
          return panel;
        };
        const clickAll = (panel: GamePanel, src: string): void => {
          said.length = 0;
          for (const root of [panel.body, panel.foot]) {
            for (const b of root.querySelectorAll<HTMLElement>('.pq-say')) add(src, b.dataset.saytext);
            for (const b of root.querySelectorAll<HTMLElement>('.pq-say, [data-tile], .hy-pick')) b.click();
          }
          for (const t of said) add(src, t);
          panel.body.remove();
          panel.foot.remove();
        };
        if (g.hub && seed <= 2) {
          const panel = mkPanel();
          try {
            g.hub(panel, ctx, () => {});
          } catch {
            /* экран выбора без DOM-окружения — пропуск */
          }
          clickAll(panel, `${g.id}:hub`);
        }
        for (const id of g.pool(ctx)) {
          for (const want of [
            { id, side: 'A', self: false, stage: 'seed' },
            { id, side: 'B', self: false, stage: 'sprout' },
            { id, side: 'B', self: false, stage: 'bush' },
            { id, side: 'B', self: true, stage: 'bush' },
          ] as Want[]) {
            let task;
            try {
              task = g.nextTask(ctx, want);
            } catch {
              continue;
            }
            if (!task) continue;
            const panel = mkPanel();
            try {
              g.render(task, panel, ctx);
            } catch {
              /* рисование без canvas — пропуск, текст заберём из check */
            }
            clickAll(panel, `${g.id}:task`);
            const t = task as unknown as { answer?: unknown };
            for (const ans of [t.answer, '__x__', ['__x__']]) {
              if (ans === undefined) continue;
              try {
                const r = g.check(task, ans, ctx);
                const u = p.unit(task.id);
                const say = r.say ?? u?.pl ?? r.correct;
                add(`${g.id}:after`, say);
                add(`${g.id}:after`, polishPart(say));
                if (r.note) add(`${g.id}:note`, polishPart(r.note));
              } catch {
                /* ответ не того вида */
              }
            }
          }
        }
      }
    }
  }
  // Ферма: «Brawo! Poziom 7.» при новом уровне (systems/farm.ts), бобёр.
  for (const l of [...SUBLEVELS.slice(1), A1_LEVEL]) add('farm:levelup', `Brawo! ${l.pl}.`);
  add('beaver', 'Bóbr');
  const rows = [...out].map(([text, src]) => ({ text, src: [...src].sort() })).sort((a, b) => a.text.localeCompare(b.text, 'pl'));
  writeFileSync(join(process.cwd(), 'content', 'audio_harvest.json'), JSON.stringify({ n: rows.length, rows }, null, 0) + '\n');
  console.log(`audio_harvest: ${rows.length} строк`);
});
