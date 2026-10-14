-- polski-quest: облачный сейв по секрету из ссылки. Применять в Supabase → polski-trener → SQL Editor.
--
-- Как применить (делает только Шэф, ~5 минут, подробно в supabase/README.md):
--   1. supabase.com → проект polski-trener → SQL Editor → New query.
--   2. Вставить этот файл целиком → Run. Ожидаемо: «Success. No rows returned».
--   3. Новый запрос: select public.game_load('test-key-not-real-000000');  → одна строка с null.
-- Файл идемпотентный: повторный Run ничего не ломает (create if not exists / create or replace).
-- Таблицы тренажёра (trainer_progress) и «Карты поляка» (docs) не трогаются.
--
-- Модель (ТЗ §6.1–6.2): логина нет. Клиент знает секрет из ссылки …/polski-quest/#k=<секрет>,
-- база хранит только sha256(секрет). Прямого доступа к таблицам у anon нет (RLS без политик),
-- только две функции security definer: game_load (прочитать) и game_save (записать с проверкой ревизии).

-- Сейв: одна строка на мир.
create table if not exists public.game_saves (
  key_hash   text primary key check (length(key_hash) = 64),   -- sha256(секрет) hex
  data       jsonb not null,                                   -- весь Progress (журнал, мир, настройки)
  rev        integer not null default 1,                       -- ревизия для оптимистической блокировки
  schema_v   integer not null default 1,                       -- Progress.v последней записи
  updated_at timestamptz not null default now(),
  updated_by text                                              -- deviceId, для отладки
);
alter table public.game_saves enable row level security;      -- политик нет: прямой доступ anon закрыт

-- Ежедневный бэкап: первая запись нового дня кладёт сюда вчерашнее состояние, хранится 45 дней.
create table if not exists public.game_save_backups (
  key_hash  text not null,
  rev       integer not null,
  data      jsonb not null,
  saved_at  timestamptz not null,
  primary key (key_hash, rev)
);
alter table public.game_save_backups enable row level security;

-- Прочитать сейв по секрету. Нет сейва → null.
create or replace function public.game_load(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('data', data, 'rev', rev, 'schema_v', schema_v, 'updated_at', updated_at)
  from game_saves
  where key_hash = encode(sha256(convert_to(p_key, 'utf8')), 'hex');
$$;

-- Записать сейв. Ответы:
--   {ok: true, rev}                       — записано;
--   {ok: false, conflict: true, data, rev} — в облаке другая ревизия: клиент сливает и повторяет;
--   {ok: false, old_client: true, schema_v} — клиент старее облака: не пишет, ждёт обновления.
create or replace function public.game_save(p_key text, p_data jsonb, p_base_rev integer, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  h   text := encode(sha256(convert_to(p_key, 'utf8')), 'hex');
  v   integer := coalesce((p_data->>'v')::int, 1);
  cur game_saves;
  r   integer;
begin
  if p_key is null or length(p_key) < 20 or length(p_key) > 64 then raise exception 'bad key'; end if;
  if octet_length(p_data::text) > 2000000 then raise exception 'too large'; end if;

  -- Блокировка строки: две записи одного мира идут строго по очереди.
  select * into cur from game_saves where key_hash = h for update;
  if not found then
    insert into game_saves(key_hash, data, rev, schema_v, updated_by)
      values (h, p_data, 1, v, p_device)
      on conflict (key_hash) do nothing
      returning rev into r;
    if r is null then   -- параллельная первая запись: отдать то, что легло
      return (select jsonb_build_object('ok', false, 'conflict', true, 'data', data, 'rev', rev)
              from game_saves where key_hash = h);
    end if;
    return jsonb_build_object('ok', true, 'rev', 1);
  end if;

  -- Защита от старого клиента (старая версия игры в кэше SW): данные новой схемы не затираются.
  if v < cur.schema_v then
    return jsonb_build_object('ok', false, 'old_client', true, 'schema_v', cur.schema_v);
  end if;
  -- Оптимистическая блокировка: клиент писал поверх не той ревизии → отдать текущую для слияния.
  if cur.rev <> p_base_rev then
    return jsonb_build_object('ok', false, 'conflict', true, 'data', cur.data, 'rev', cur.rev);
  end if;

  if cur.updated_at::date < now()::date then          -- бэкап: первая запись нового дня сохраняет вчерашнее
    insert into game_save_backups(key_hash, rev, data, saved_at)
      values (h, cur.rev, cur.data, cur.updated_at) on conflict do nothing;
    delete from game_save_backups where key_hash = h and saved_at < now() - interval '45 days';
  end if;

  update game_saves
     set data = p_data, rev = cur.rev + 1, schema_v = v, updated_at = now(), updated_by = p_device
   where key_hash = h;
  return jsonb_build_object('ok', true, 'rev', cur.rev + 1);
end $$;

-- Доступ: только эти две функции и только роли anon (publishable key).
revoke all on function public.game_load(text) from public;
revoke all on function public.game_save(text, jsonb, integer, text) from public;
grant execute on function public.game_load(text) to anon;
grant execute on function public.game_save(text, jsonb, integer, text) to anon;
