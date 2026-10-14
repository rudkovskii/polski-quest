# Облачный сейв игры (Supabase `polski-trener`)

Игра хранит прогресс локально и синкает его в существующий Supabase-проект `polski-trener`
(тот же, что у тренажёра и «Карты поляка»). Новый бэкенд не поднимается. Логина нет: доступ по
секрету из приватной ссылки `https://rudkovskii.github.io/polski-quest/#k=<секрет>`, в базе только
`sha256(секрет)`. Подробно: `../ТЗ.md` §6.

SQL применяет только Шэф. Агенты в Supabase Studio не ходят.

## 1. Применить SQL (один раз, ~5 минут)

1. Открой https://supabase.com/dashboard → проект **polski-trener** → слева **SQL Editor** → **New query**.
2. Скопируй целиком `supabase/001_game_saves.sql` и вставь в редактор:
   ```bash
   pbcopy < supabase/001_game_saves.sql        # из папки Игра/app
   ```
3. Нажми **Run**. Ожидаемо: `Success. No rows returned`.
4. Новый запрос, вставь и **Run**:
   ```sql
   select public.game_load('test-key-not-real-000000');
   ```
   Ожидаемо: одна строка, в колонке `game_load` значение `NULL`.

Повторный Run файла безопасен: таблицы `create if not exists`, функции `create or replace`.

## 2. Проверить из терминала

```bash
cd ~/Documents/GitHub/Изучение\ польского/Игра/app
npm run sync:smoke
```

Скрипт `tools/sync_smoke.ts` создаёт случайный тестовый ключ (не твою ссылку), прогоняет
`game_load` / `game_save`: первая запись, чтение, конфликт ревизий, слияние, старый клиент, неверный
ключ и два «устройства» через настоящий `SyncClient`. В конце печатает `ИТОГ: ok` или список
провалов. Если SQL ещё не применён, скрипт скажет `PGRST202: примени supabase/001_game_saves.sql`.

Та же проверка вручную:

```bash
curl -s -X POST "https://uxlzblyzdyjizxrbmoxj.supabase.co/rest/v1/rpc/game_load" \
  -H "apikey: sb_publishable_eYwVVA4z4B0j2hHe8qHefg_3N89lRB0" -H "Content-Type: application/json" \
  -d '{"p_key":"test-key-not-real-000000"}'          # → null
```

## 3. Убрать тестовые строки

Smoke-тест и ручной тест с `?dev=1` пишут `updated_by` с префиксом `test-`. После проверки:

```sql
delete from public.game_saves where updated_by like 'test-%';
```

## Ручной сценарий двух устройств

1. `npm run dev`, профиль браузера A: `http://localhost:5173/polski-quest/?dev=1` → тап → «Начать».
2. Точка синка в правом верхнем углу позеленела → тап по ней → «Скопировать».
3. Профиль B (или другое устройство в той же сети): та же страница с `?dev=1` → тап →
   «У меня есть ссылка» → вставить → «Подключить».
4. Отключить сеть в обоих (DevTools → Network → Offline), поиграть, включить сеть: точки зелёные,
   журналы одинаковые (DevTools → Application → IndexedDB → `polski-quest` → `pq_progress`).

## Если что-то пошло не так

| Ситуация | Что делать |
|---|---|
| Точка красная, в подсказке `apply_sql` | SQL не применён: шаг 1 |
| Supabase на паузе (free plan) | Studio → Restore project. Игра всё это время работает локально и дошлёт изменения |
| Сломалась миграция сейва | Бэкапы за 45 дней: `select rev, saved_at from game_save_backups order by saved_at desc;` |
| Потерял ссылку, есть файл-копия | В игре «Создать новый мир» → «Загрузить копию» → «Заменить» |
| Потерял ссылку, файла нет | `select key_hash, updated_at, updated_by from game_saves order by updated_at desc;` → агент даст строку `update … set key_hash = …` с новым секретом; секрет вставляешь сам, в чат он не пишется |

Посмотреть свои сейвы (без секретов, только хэши):

```sql
select key_hash, rev, schema_v, updated_at, updated_by, octet_length(data::text) as bytes
from public.game_saves order by updated_at desc;
```
