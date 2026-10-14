// Облако игры (ТЗ §6.1): существующий Supabase-проект `polski-trener`, общий с тренажёром.
// Publishable key публичный по дизайну (тот же, что в `config.js` тренажёра): доступ к сейвам
// закрыт RLS без политик, читать и писать можно только через RPC `game_load`/`game_save` по секрету.
// Лежит в platform/, а не в src/: sync.ts (слой platform) не может импортировать корень (check:layers).

export const SUPABASE_URL = 'https://uxlzblyzdyjizxrbmoxj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_eYwVVA4z4B0j2hHe8qHefg_3N89lRB0';

/** Канонический адрес игры для приватной ссылки, если страница открыта не с Pages (тесты, tools). */
export const GAME_URL = 'https://rudkovskii.github.io/polski-quest/';
