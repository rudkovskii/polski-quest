// Склейка синка (I-06): хранилище + секрет + SyncClient + экраны LinkSetup и «Сохрани свою ссылку».
// Вынесена из main.ts, чтобы параллельные итерации меньше конфликтовали; вызывается оттуда одной строкой.
// Секрет нигде не логируется.
import { bus } from './systems/bus';
import { isPristine } from './systems/merge';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './systems/platform/config';
import { adoptSecret, buildLink, captureSecretFromUrl, generateSecret, parseSecretInput, storedSecret } from './systems/platform/secret';
import { GameStorage } from './systems/platform/storage';
import { SupabaseRpc, SyncClient } from './systems/platform/sync';
import { setFlag } from './systems/progress';
import type { ConnectResult, LinkMode } from './types/bus';

/** Флаг мира: игрок отметил «Я сохранил ссылку в Заметки» (до этого напоминание в DaySummary, I-12). */
export const LINK_SAVED_FLAG = 'link.saved';

export interface Cloud {
  storage: GameStorage;
  sync: SyncClient;
}

export interface CloudOptions {
  /** `?dev=1`: в облаке устройство помечается `test-<deviceId>` (потом `delete … where updated_by like 'test-%'`). */
  dev?: boolean;
}

export function startCloud(opts: CloudOptions = {}): Promise<Cloud> {
  const storage = new GameStorage();
  const rpc = new SupabaseRpc(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const sync = new SyncClient({
    store: storage,
    rpc,
    bus,
    device: () => (opts.dev ? `test-${storage.local.deviceId}` : storage.local.deviceId),
  });

  let fromUrl = false;
  const loaded = (async (): Promise<Cloud> => {
    await storage.load(Date.now());
    storage.attachLifecycle();
    // Секрет из адреса забираем сразу, до тапа: фрагмент не должен висеть в адресной строке.
    fromUrl = captureSecretFromUrl(storage, { location, history }) !== null;
    // Ссылку вставили в адресную строку открытой вкладки: страница не перезагружается, только hashchange.
    window.addEventListener('hashchange', () => {
      if (captureSecretFromUrl(storage, { location, history }) === 'adopted') void sync.start();
    });
    sync.attach();
    if (storedSecret(storage)) void sync.start(); // синк в фоне (§5.2 п. 2)
    else bus.emit('sync:status', { state: 'no_secret' });
    return { storage, sync };
  })();

  const ready = (mode: LinkMode): void => bus.emit('link:ready', { mode });

  const create = (): void => {
    adoptSecret(storage, generateSecret());
    void sync.start(); // первый game_save с base_rev 0 уходит в фоне; офлайн — позже
    ready('new');
  };

  const connect = async (input: string): Promise<ConnectResult> => {
    const secret = parseSecretInput(input);
    if (!secret) return 'invalid';
    const r = await rpc.load(secret);
    if (r.kind === 'ok' && r.value === null) return 'not_found';
    // Нашёлся (или сеть недоступна): секрет запоминаем, локальный пустой мир вольётся в облачный.
    adoptSecret(storage, secret, { join: true });
    await sync.start();
    ready('joined');
    return r.kind === 'ok' ? 'ok' : 'offline';
  };

  let titleDone = false;
  bus.on('title:start', () => {
    if (titleDone) return;
    titleDone = true;
    void loaded.then(() => {
      if (storedSecret(storage)) return ready(fromUrl ? 'url' : 'stored');
      // Мир на устройстве уже есть, а ссылки нет: секрет создаётся молча.
      if (!isPristine(storage.progress)) return create();
      bus.emit('ui:start:show', { create, connect });
    });
  });

  bus.on('progress:changed', () => void loaded.then(() => sync.markDirty()));

  bus.on('ui:screen:open', ({ screen }) => {
    if (screen !== 'link') return;
    void loaded.then(() => {
      const secret = storedSecret(storage);
      if (!secret) return;
      bus.emit('ui:link:show', {
        link: buildLink(secret),
        saved: LINK_SAVED_FLAG in storage.progress.world.flags,
        onSaved: () => {
          if (storage.setProgress(setFlag(storage.progress, LINK_SAVED_FLAG, Date.now()))) {
            bus.emit('progress:changed', { kinds: ['world'] });
          }
        },
      });
    });
  });

  return loaded;
}
