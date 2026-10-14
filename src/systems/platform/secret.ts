// Секрет приватной ссылки (ТЗ §5.2, §6.1): `https://…/polski-quest/#k=<секрет>`.
// Секрет живёт только во фрагменте (не уходит на Pages и в Referer) и в `pq_local.secret` (в облако
// не синкается, в базе только sha256). Сразу после чтения фрагмент убирается из адреса.
// Секрет нельзя писать в логи, консоль, коммиты, тесты (AGENTS.md).
import type { LocalState } from '../progress';
import { GAME_URL } from './config';

/** 128 бит в base32 lowercase без паддинга = 26 символов. */
export const SECRET_LEN = 26;
export const SECRET_RE = /^[a-z2-7]{26}$/;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32, строчные, без `=`. */
export function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let buf = 0;
  let bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(buf >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buf &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 31];
  return out;
}

export type RandomBytes = (n: number) => Uint8Array;

const cryptoBytes: RandomBytes = (n) => {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a); // без запасного Math.random: слабый секрет хуже ошибки
  return a;
};

export function generateSecret(random: RandomBytes = cryptoBytes): string {
  const s = encodeBase32(random(16));
  if (!SECRET_RE.test(s)) throw new Error('secret: генератор вернул не 16 байт');
  return s;
}

export function isSecret(x: unknown): x is string {
  return typeof x === 'string' && SECRET_RE.test(x);
}

/**
 * Разобрать то, что игрок вставил в поле: полную ссылку, `#k=…`, `k=…` или голый секрет.
 * Пробелы и регистр не важны (iOS любит заглавную первую букву). Иначе null.
 */
export function parseSecretInput(text: string): string | null {
  const t = text.trim();
  const m = /(?:^|[#&?\s])k=([A-Za-z2-7]{26})(?![A-Za-z2-7])/.exec(t);
  const cand = (m ? m[1]! : t).toLowerCase();
  return SECRET_RE.test(cand) ? cand : null;
}

/** Секрет из фрагмента адреса (`#k=…`, допускаются другие параметры через `&`). */
export function secretFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const k = params.get('k');
  return k !== null && SECRET_RE.test(k) ? k : null;
}

/** Адрес игры без фрагмента: текущая страница (Pages или localhost), иначе канонический GAME_URL. */
export function gameBaseUrl(loc: Pick<Location, 'origin' | 'protocol'> | undefined = globalThis.location): string {
  if (loc && /^https?:$/.test(loc.protocol)) {
    const base = import.meta.env?.BASE_URL ?? '/';
    return `${loc.origin}${base}`;
  }
  return GAME_URL;
}

/** Приватная ссылка для экрана «Сохрани свою ссылку» и Settings. */
export function buildLink(secret: string, base: string = gameBaseUrl()): string {
  if (!SECRET_RE.test(secret)) throw new Error('secret: неверный формат');
  return `${base}#k=${secret}`;
}

// ── Хранение в pq_local.

/** То, что нужно от хранилища (GameStorage подходит как есть). */
export interface SecretStore {
  readonly local: LocalState;
  setLocal(l: LocalState): void;
}

export function storedSecret(store: SecretStore): string | null {
  const s = store.local.secret;
  return isSecret(s) ? s : null;
}

/**
 * Запомнить секрет. Новый секрет = другой сейв в облаке: ревизия синка сбрасывается,
 * локальный прогресс помечается к отправке. `join` — подключение через «У меня есть ссылка».
 * Возвращает true, если секрет сменился.
 */
export function adoptSecret(store: SecretStore, secret: string, opts: { join?: boolean } = {}): boolean {
  if (!SECRET_RE.test(secret)) throw new Error('secret: неверный формат');
  const l = store.local;
  if (l.secret === secret) return false;
  const next: LocalState = { ...l, secret, sync: { rev: 0, lastSyncAt: null, lastError: null, dirty: true } };
  if (opts.join) next.join = true;
  else delete next.join;
  store.setLocal(next);
  return true;
}

export interface UrlEnv {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState' | 'state'>;
}

/**
 * Шаг 1 Title (§5.2): если в адресе `#k=`, сохранить секрет и убрать фрагмент через
 * `history.replaceState` (секрет не остаётся в адресной строке и истории вкладки).
 * Устройство без секрета вливает локальный мир в облачный (`join`). Устройство, уже привязанное
 * к другому секрету, при синке получит DifferentWorlds: чей прогресс оставить, решает игрок.
 */
export function captureSecretFromUrl(store: SecretStore, env: UrlEnv): 'adopted' | 'same' | null {
  const secret = secretFromHash(env.location.hash);
  if (!/(^#|&)k=/.test(env.location.hash)) return null;
  // Фрагмент с k= убираем в любом случае, даже битый: в адресной строке ему не место.
  env.history.replaceState(env.history.state, '', `${env.location.pathname}${env.location.search}`);
  if (!secret) return null;
  return adoptSecret(store, secret, { join: storedSecret(store) === null }) ? 'adopted' : 'same';
}

/** «Отключить это устройство» (Settings, I-12): забыть секрет и состояние синка. */
export function forgetSecret(store: SecretStore): void {
  const l = { ...store.local, sync: { rev: 0, lastSyncAt: null, lastError: null, dirty: false } };
  delete l.secret;
  delete l.join;
  store.setLocal(l);
}
