// Живая проверка RPC после того, как Шэф применил supabase/001_game_saves.sql (I-06).
//   npm run sync:smoke
// Работает со случайными тестовыми ключами (не приватная ссылка Шэфа), секреты не печатает.
// Пишет строки с updated_by = 'test-…'; убрать: delete from public.game_saves where updated_by like 'test-%';
import { merge, sameProgress } from '../src/systems/merge';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../src/systems/platform/config';
import { adoptSecret, generateSecret } from '../src/systems/platform/secret';
import { SupabaseRpc, SyncClient, type SyncStore } from '../src/systems/platform/sync';
import { append, newLocal, newProgress, type LocalState, type Progress } from '../src/systems/progress';
import { randomBase32 } from '../src/systems/platform/storage';
import type { EventDraft } from '../src/systems/log';

const rpc = new SupabaseRpc(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const failures: string[] = [];
const T0 = Date.now();

function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
  if (!ok) failures.push(name);
}

function draft(i: number): EventDraft {
  return { k: 'rev', ts: T0 + i * 1000, card: `lx.smoke${i % 5}#rec`, g: 2, ms: 1500, src: 'obchod' };
}

function withEvents(p: Progress, deviceId: string, from: number, n: number): Progress {
  let dev = { deviceId, seq: from };
  for (let i = 0; i < n; i++) {
    const r = append(p, dev, draft(from + i));
    if (r.ok) {
      p = r.progress;
      dev = r.dev;
    }
  }
  return p;
}

class MemStore implements SyncStore {
  readOnly = false;
  constructor(
    public progress: Progress,
    public local: LocalState,
  ) {}
  setProgress(p: Progress): boolean {
    this.progress = p;
    return true;
  }
  setLocal(l: LocalState): void {
    this.local = l;
  }
}

async function main(): Promise<void> {
  console.log(`Supabase: ${SUPABASE_URL}`);
  const secret = generateSecret();

  // 1. Пустой ключ → null (и проверка, что SQL применён).
  const l0 = await rpc.load(secret);
  if (l0.kind === 'missing') {
    console.log('PGRST202: функций нет. Примени supabase/001_game_saves.sql (см. supabase/README.md) и запусти снова.');
    process.exit(2);
  }
  if (l0.kind !== 'ok') {
    console.log(`Supabase недоступен: ${l0.detail}`);
    process.exit(3);
  }
  check('game_load по новому ключу → null', l0.value === null);

  // 2. Первая запись.
  const worldId = `smoke${randomBase32(8)}`;
  const p0 = withEvents(newProgress(T0, worldId), 'aaaaaa', 0, 3);
  const s1 = await rpc.save(secret, p0, 0, 'test-smoke');
  check('game_save base_rev 0 → ok, rev 1', s1.kind === 'ok' && s1.value.ok && s1.value.rev === 1, JSON.stringify(s1.kind === 'ok' ? { ...s1.value } : s1).slice(0, 120));

  // 3. Чтение того же.
  const l1 = await rpc.load(secret);
  check('game_load → rev 1, данные совпали', l1.kind === 'ok' && l1.value !== null && l1.value.rev === 1 && sameProgress(p0, l1.value.data));

  // 4. Конфликт ревизий: второе «устройство» пишет поверх base_rev 0.
  const p1 = withEvents(newProgress(T0, worldId), 'bbbbbb', 0, 2);
  const s2 = await rpc.save(secret, p1, 0, 'test-smoke');
  const conflict = s2.kind === 'ok' && !s2.value.ok && 'conflict' in s2.value ? s2.value : null;
  check('game_save со старым base_rev → conflict + данные облака', conflict !== null && conflict.rev === 1);

  // 5. Слияние и повтор.
  if (conflict) {
    const m = merge(p1, conflict.data as Progress);
    const s3 = await rpc.save(secret, m, conflict.rev, 'test-smoke');
    check('merge → game_save base_rev 1 → rev 2', s3.kind === 'ok' && s3.value.ok && s3.value.rev === 2);
    const l2 = await rpc.load(secret);
    check('в облаке 5 событий двух устройств', l2.kind === 'ok' && l2.value !== null && (l2.value.data as Progress).log.events.length === 5);

    // 6. Старый клиент: v меньше schema_v облака.
    const s4 = await rpc.save(secret, { ...m, v: 0 }, 2, 'test-smoke');
    check('game_save с v < schema_v → old_client', s4.kind === 'ok' && !s4.value.ok && 'old_client' in s4.value);
  }

  // 7. Неверный ключ.
  const s5 = await rpc.save('short', p0, 0, 'test-smoke');
  check('game_save с коротким ключом → отказ (bad key)', s5.kind === 'rejected' && /bad key/.test(s5.detail), s5.kind === 'ok' ? 'ok?!' : s5.detail);

  // 8. Два устройства через SyncClient: A создаёт мир, B подключается, оба играют офлайн, сходятся.
  const secret2 = generateSecret();
  const wA = `smoke${randomBase32(8)}`;
  const A = new MemStore(withEvents(newProgress(T0, wA), 'cccccc', 0, 2), { ...newLocal('cccccc'), seq: 2 });
  const B = new MemStore(newProgress(T0 + 5, `smoke${randomBase32(8)}`), newLocal('dddddd'));
  const mk = (store: MemStore) =>
    new SyncClient({ store, rpc, device: () => `test-${store.local.deviceId}`, pushDelayMs: 0, retryDelaysMs: [60_000] });
  const syncA = mk(A);
  const syncB = mk(B);
  adoptSecret(A, secret2);
  await syncA.start();
  check('A: новый мир записан', syncA.status.state === 'ok' && A.local.sync.rev === 1, syncA.status.state);
  adoptSecret(B, secret2, { join: true });
  await syncB.start();
  check('B: подключился, пустой мир уступил облачному', syncB.status.state === 'ok' && B.progress.worldId === wA && B.progress.log.events.length === 2);

  A.progress = withEvents(A.progress, 'cccccc', 2, 3);
  B.progress = withEvents(B.progress, 'dddddd', 0, 4);
  syncA.markDirty();
  syncB.markDirty();
  await syncA.flush();
  await syncB.flush(); // конфликт → слияние → повтор
  await syncA.start();
  check('A и B сошлись к одному журналу', sameProgress(A.progress, B.progress), `${A.progress.log.events.length} / ${B.progress.log.events.length} событий`);
  check('в журнале 9 событий (2 + 3 + 4)', A.progress.log.events.length === 9);
  syncA.dispose();
  syncB.dispose();

  console.log('');
  console.log(failures.length ? `ИТОГ: ${failures.length} провал(ов): ${failures.join('; ')}` : 'ИТОГ: ok');
  console.log("Убрать тестовые строки (SQL Editor): delete from public.game_saves where updated_by like 'test-%';");
  process.exit(failures.length ? 1 : 0);
}

void main();
