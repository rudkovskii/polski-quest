// Общие помощники тестов оверлея (I-08): фикстура контента, память вместо GameStorage, клики.
import { join } from 'node:path';
import { createBus } from '../src/systems/bus';
import { buildContent, type Content } from '../src/systems/content';
import { append as appendEvent, newLocal, newProgress, type LocalState, type Progress } from '../src/systems/progress';
import type { BusEvents } from '../src/types/bus';
import type { LessonStore } from '../src/ui/lesson';
import type { AudioPort } from '../src/ui/overlay/kit';
import { readContentDir } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';

let cached: Content | null = null;
export function fixture(): Content {
  cached ??= buildContent(Object.fromEntries([...readContentDir(join(ROOT, 'tests', 'fixtures', 'content-mini')).files].map(([k, v]) => [`/content/${k}`, v])));
  return cached;
}

export function memStore(p: Progress = newProgress(Date.UTC(2026, 9, 1, 10), 'w1'), l: LocalState = newLocal('dev001')): LessonStore & { progress: Progress; local: LocalState; setProgress(p: Progress): boolean } {
  const s = {
    progress: p,
    local: l,
    append(draft: Parameters<LessonStore['append']>[0], opts?: Parameters<LessonStore['append']>[1]) {
      const r = appendEvent(s.progress, { deviceId: s.local.deviceId, seq: s.local.seq }, draft, opts);
      if (r.ok) {
        s.progress = r.progress;
        s.local = { ...s.local, seq: r.dev.seq };
      }
      return r;
    },
    setLocal(x: LocalState) {
      s.local = x;
    },
    setProgress(x: Progress) {
      s.progress = x;
      return true;
    },
  };
  return s;
}

export function testBus() {
  return createBus<BusEvents>();
}

export function fakeAudio(has = true): AudioPort & { played: { text: string; slow?: boolean }[] } {
  const played: { text: string; slow?: boolean }[] = [];
  return {
    played,
    play(text, o = {}) {
      played.push({ text, ...(o.slow ? { slow: true } : {}) });
    },
    has: () => has,
  };
}

export const flush = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

export function buttons(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((b) => !b.hidden && !b.closest('[hidden]'));
}

export function byText(root: ParentNode, text: string): HTMLButtonElement {
  const b = buttons(root).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`нет кнопки «${text}»: ${buttons(root).map((x) => x.textContent?.trim()).join(' | ')}`);
  return b;
}

export function act(root: ParentNode, a: string): HTMLButtonElement {
  const b = root.querySelector<HTMLButtonElement>(`[data-act="${a}"]`);
  if (!b || b.hidden) throw new Error(`нет видимой кнопки data-act=${a}`);
  return b;
}

export function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
