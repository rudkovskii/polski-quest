// Детерминированный хеш для «случайностей», которые обязаны совпасть на двух устройствах
// (разброс интервалов SRS §4.1, генерация заказов §4.13, точка кота §4.12). Без Math.random.

/** FNV-1a 32 бит по UTF-16 кодам строки. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Число в [0, 1) из строки. */
export function unit(s: string): number {
  return fnv1a(s) / 0x1_0000_0000;
}
