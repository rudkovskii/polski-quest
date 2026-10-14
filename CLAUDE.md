# AGENTS.md: polski-quest

Ты пишешь код игры по польскому для Димы («Шэф»). Репозиторий = папка `Игра/app/`
(`~/Documents/GitHub/Изучение польского/Игра/app/`, `rudkovskii/polski-quest`).
ТЗ, план и сюжет лежат уровнем выше: `../ТЗ.md`, `../ПЛАН.md`, `../СЮЖЕТ.md`, `../КОНЦЕПТ.md`.
Читай раздел ТЗ своей итерации до кода. Реплики персонажей не придумывай: бери из `../СЮЖЕТ.md`
в `content/story/lines.json`; если реплики нет, ставь id и `"todo": true`.
`CLAUDE.md` — копия этого файла (не симлинк): меняешь AGENTS.md → скопируй в CLAUDE.md.

## Итерация
- Одна сессия = одна итерация из ПЛАН.md: цель, проверка, коммит. Чужие итерации не начинай.
- В конце: `npm run check` зелёный → коммит `it-NN: <цель>` → строка в журнале ПЛАН.md.
- Если проверка не проходит за отведённое время, коммить в ветку `wip/it-NN`, не в main.

## Версии
- Версии в package.json точные. Не обновляй зависимости без отдельной итерации.
- Phaser 4.2.1. Не Phaser 3. Если не уверен в API, смотри `node_modules/phaser/types/phaser.d.ts`
  и migration guide Phaser 3→4 (`node_modules/phaser/skills/v3-to-v4-migration/SKILL.md`), а не память.
- Подвохи Phaser 4 без запрета: `Math.TAU` теперь 2π (было π/2, для π/2 есть `Math.PI_OVER_2`);
  `roundPixels` по умолчанию `false` (у нас включён в конфиге); `DynamicTexture`/`RenderTexture`
  рисуют только после `render()`; `ColorMatrix` → методы на `.colorMatrix`; `Grid` → `stroke*` вместо `outline*`.

## Запрещено (ловит tools/check_banned.ts)
- Phaser 3 API: `preFX`, `postFX`, `BitmapMask`,
  `Phaser.Geom.Point` (бери `Phaser.Math.Vector2`), `setTintFill`, `Phaser.Struct.Set/Map`
  (бери нативные Set/Map), `renderer.pipelines`, кастомные `Pipeline`, `Mesh`, `Plane`,
  `type: Phaser.CANVAS`. Список сверен с migration guide в I-01 и пополняется там же.
  Дополнено в I-01: `tintFill`, любой `*Pipeline*` (`setPipeline`, `setPostPipeline`, `PostFXPipeline`;
  свет — `setLighting(true)`), `Math.PI2`, `Create.GenerateTexture`/`textures.generate`,
  `SinCosTableGenerator`, `Camera3D`/`Layer3D`.
- Текст в canvas, кроме цифр HUD: весь польский текст рендерит DOM-оверлей.
  (`add.text`/`add.bitmapText` для цифр HUD — с пометкой `// banned-ok: hud-digits` в той же строке.)
- `localStorage`/`indexedDB`/`fetch`/`Date.now()` внутри `src/systems/` (кроме `platform/`).
  Время приходит параметром `now`.
- Импорт `src/ui` из `src/scenes|world` и наоборот. Связь через `bus`.
- Правка `public/audio/*`, `public/atlas/*` руками: только через `npm run audio`, `npm run sprites`.
- Правка Tiled `.tmj` руками. Обычные карты только ASCII (`maps/*.json`).
- Эффекты контента, которые выдают złoty, сердца или карточки напрямую.
- Секрет приватной ссылки в коде, коммитах, логах, README, тестах.
- Удаление или переименование id в `vocab.json`. Переименование только через `module.renames`.
  (Ловит `npm run validate`, ТЗ §3.13 п. 7.)
- Слушать `keydown`/`pointerdown` в сценах и экранах напрямую. Ввод только через `src/input` (intents).
- Меню выбора режима и экран «как играть». Следующий шаг выбирает `director`.
- Медведь Wojtek: компаньон бобр (`bobr`).
  (Три последних пункта пока ловит ревью, не `check_banned.ts`.)

## Слои (ловит tools/check_layers.ts)
- `src/systems/**` без `platform/`: не импортирует `phaser`, `platform/`, `scenes|world`, `ui`, `main.ts`;
  не трогает `window`, `document`, `navigator`, `localStorage`, `indexedDB`, `fetch`, `requestAnimationFrame`.
- `src/systems/platform/**`: адаптеры браузера, без `phaser`, `scenes|world`, `ui`.
- `src/scenes|world/**` ⇄ `src/ui/**`: друг друга не импортируют. `ui` не импортирует `phaser`.
- `src/input/**`: без `phaser`, `platform/`, `scenes|world`, `ui`; шлёт intents в `bus`. Прямой `keydown`/`pointerdown`
  только в `src/input/` и `src/ui/keyboard/` (сцены, мир, экраны ловит check:banned).
- Склейка слоёв только в `src/main.ts` (синк и экраны ссылки вынесены в `src/cloud.ts`, I-06).

## Контент (ТЗ §3, I-02)
- Схемы: `content/schema/*.schema.json` (draft 2020-12, `additionalProperties: false`). Поменял схему →
  `npm run gen:types` (перезаписывает `src/types/content.d.ts`, руками не править; тест сверяет файл со схемами).
- `npm run validate` = схемы + дубли id + висячие ссылки + ASCII-карты + introduces + реплики + секреты +
  рецепты + удалённые слова (против `origin/main`, в CI против `HEAD~1`). Вывод `файл:путь: сообщение`.
  Другой корень: `npx tsx tools/validate_content.ts --root <dir> [--prev <dir>]`.
- В `npm run dev` тот же валидатор гоняется на каждую правку `content/**`, ошибки видны оверлеем Vite.
- Игра читает контент через `getContent()` из `src/systems/content.ts` (типы из `src/types/content.d.ts`).
- Новый атом условия или эффекта: схема `conditions`/`effects`, проверка ссылок в `tools/lib/content_check.ts`,
  тест в `tests/content.test.ts`, вычислитель в `src/systems/conditions.ts`/`effects.ts`.
- Фикстура для тестов: `tests/fixtures/content-mini/` (модуль `demo`, все типы шагов, бобр и Симба,
  реплики — `todo`-заглушки). Новое правило валидатора = поломка фикстуры в тесте.

## Синк (ТЗ §6, I-06)
- SQL `supabase/001_game_saves.sql` применяет только Шэф по `supabase/README.md`; живая проверка — `npm run sync:smoke`.
- Слияние только через `merge()` (`src/systems/merge.ts`, чистый). Новое поле в `Progress` = правило слияния
  в `merge.ts` + поле в генераторе `tests/merge.test.ts` (коммутативность, ассоциативность, идемпотентность).
- `?dev=1`: устройство пишет в облако с `updated_by = 'test-<deviceId>'`, чистится SQL из README.
## Арт и мир (ТЗ §8, I-07)
- `art/palette.json` (≤ 64 цвета, у каждого имя) собирает `npm run palette` из `art/vendor/ninja-adventure`.
- Спрайты: `art/sprites/*.sprite.json` (sprite-as-data, ключи = имена цветов, hex запрещён), кадры из листов
  паков: `art/imports.json`, тайлсет локаций: `art/tilesets/ninja16.json` (имя тайла = `legend[*].tile` в картах).
- `npm run sprites` → `public/atlas/*` (руками не править), `npm run sprites:check` в `npm run check`:
  палитра, альфа 0/255, кратность 16, атлас не устарел.
- Мир: `src/world/ascii.ts` (карта → слои и коллизии), `pathfind.ts` (BFS), `location.ts` (модель без Phaser,
  тесты в `tests/location.test.ts`), сцена `src/scenes/Location.ts` только рисует и шлёт `world:*` в bus.
- Dev: `/?dev=world&map=ch01.metro[&spawn=<имя>]`, события мира в консоли.

## Аудио (ТЗ §7, I-09)
- `npm run audio` (только Mac: `say -v Zosia` → `afconvert`, AAC 64 кбит/с) озвучивает все польские строки `content/`
  инкрементально по `sha1(engine|voice|rate|text)` → `public/audio/<sha12>.m4a` + `manifest.json` (`entries` по ТЗ §7.1,
  плюс `files` с длительностью и `ids`: `lx.*`, `<lessonId>#<i>`, `dlg.*#<node>`, id реплик). Медленная версия — для слов,
  `listen`, `dictation`, `shadow`, `minimal_pair`, пар phonetics. `--voice engine:id`, `--prune`, `--force`, `--dry-run`.
- `npm run audio:check` (в `npm run check` и CI): ready-модуль без озвучки = ошибка, draft = предупреждение.
  Реплики `todo` и персонажи с `voice.engine: "none"` (Дима, бобр) не озвучиваются.
- В рантайме только шина: `bus.emit('audio:play', { id?, text?, slow?, queue?, done? })`, `audio:stop`; состояние —
  `audio:state`. Файл → Web Speech pl-PL → `'none'`. `playbackRate` для медленной речи не использовать (iOS меняет тембр).
- Разблокировка: Title (`unlockAudio`) и первый click/touchend (`connectAudio`); после фона `audio:blocked` → тост → `audio:unlock`.
- Dev: `/?dev=audio`. Сравнение голосов: `python3 tools/voice_compare/build.py` → `tools/voice_compare/index.html`.
## Оверлей: диалоги и упражнения (ТЗ §5.6–5.7, I-08)
- `src/ui/overlay/host.ts`: модальные слои. Открыт слой → `world:input {enabled:false}`, intents `to:'ui'` идут
  верхнему слою; стрелки двигают фокус по `[data-nav]`, interact жмёт фокус или `[data-primary]`. Своих keydown нет.
- Шаг урока = модуль `src/ui/exercises/<t>.ts` с `mount(step, ctx) → Promise<StepResult>`, общий цикл попыток в
  `frame.ts` (первая попытка → SRS, ошибка → «Prawie. Jeszcze raz.» + ответ + обучающий повтор). Поле ввода —
  только через рамку (`input` в спеке): она подключает `attachKeyboard`.
- `src/ui/lesson.ts`: события только `store.append(draft, appendGate(derived, tuning))`; resume в `local.resume`.
- Перетаскивание (pointerdown) — `src/input/drag.ts`, экраны его не слушают сами.
- Звук: оверлей шлёт `audio:play`, сам не играет. Реплики `todo` показываются как `[todo: id]`.
- `src/ui/play.ts`: `world:interact` → диалог/слово/табличка/триггер. Dev: `/?dev=lesson&id=demo.s01`
  (`&dlg=dlg.demo.marek`, `&days=N` — сдвиг часов, `&reset=1` — журнал в памяти, `&sound=1` — Web Speech),
  события журнала в консоли `[log]`.

## Босс, паспорт, кластеры (ТЗ §4.3, §5.8, §5.10, I-11)
- Урок с `parts` = босс: `runLesson` отдаёт его `src/ui/boss.ts`. Части по порядку без подсказок, после каждой части —
  `local.resume` (7 дней). Итог и выбор частей для повтора — чистые `bossVerdict` (`src/systems/clusters.ts`) и `bossPlan`
  (`boss.ts`): score ≥ `pass.score`, красный кластер ≥ `pass.redClusterMin` (решает при ≥ 2 ответах); повтор — части ниже порога
  и части со шагами проваленного красного кластера, сданные части берутся из последнего события `boss` (≤ 7 дней).
- Первая сдача босса: `play.ts` применяет `lesson.reward` и `module.onComplete` (предмет, флаг главы → печать биома, реплики).
- Диагностика (`kind: diag`) пишет `diag` по `cluster` шагов (или кластеру слова `item`) → статусы кластеров в derive.
- Паспорт: `src/ui/passport.ts` (`passportModel` чистая), открыть — `ui:screen:open { screen: 'passport' }` или
  `/?dev=lesson&passport=1`; после урока в dev — кнопка «Паспорт».
- Диалоги: узел `line` (реплика из `story/lines.json`), `todo: true` (реплики нет), чистый `end` без `who`.
  В `lines.json`: `pl` + перевод `plRu` + русская речь `ru` (видна сразу).
## Петля дня (ТЗ §4.5, §4.8, §5.5, §5.9, §5.11–5.12, I-12)
- Чистое: `src/systems/session.ts` (активное время, бюджет, `dayState`, `planRound`, `summarizeDay`), `src/systems/garden.ts`
  (стадия растения по rec, «!», подвявшие, банки), `src/world/dzialka.ts` (слова → клетки `plot`, `world:marks`).
- Склейка `src/day.ts` (из main.ts): таймер, `world:marks` на `world:location`/`progress:changed`, `world:position` →
  `local.position`, `controls.*` → роутер. Оверлей `src/ui/day.ts`: `ui:obchod:start` (полив = `runLesson` drill c `src`
  obchod/express), `ui:screen:open` summary/settings/export, мини-HUD działki. Экраны: `ui/obchod.ts`, `ui/daySummary.ts`, `ui/settings.ts`.
- `seg` пишут: раунд обхода (`water`), экспресс (`express`), «ещё 3 минуты» (`more3`), «Dobranoc» (`sleep` + `session`).
- Dev: `/?dev=world&map=ch01.dzialka&now=2026-10-14T10:00&mute=1[&plant=lx.woda,lx.kawa][&reset=1]` — `now` ISO или `+1d/-2h/+90m`
  (часы во всех deps, только с `dev`), `plant` — dev-событие `intro`, прогресс в базе `polski-quest-dev` без облака.

## Режиссёр и первый день (ТЗ §3.9, §4.12, §5.0, §5.2, I-13)
- Условия: только `src/systems/conditions.ts` (`evaluate`, `condCtx`, все атомы §3.9); варианты уроков —
  `lessonVariant` (requires → locked, skipIf → skip, short.if → short) + `lessonOfVariant` (шаги short с исходными id).
  `play.ts` применяет их в `lessonById`; объекты карты с ложным `if` уходят в `world:marks.hidden` (src/day.ts).
- Режиссёр: чистая `nextStep(directorInput(progress, content, now, {local, activeMin}))` в `src/systems/director.ts`
  (правила 1–10, слоты битов, `reveals`). Ничего не пишет: флаги `beat.first.f1…f6`, `beat.first_day_done`,
  `beat.<id>`, `hud.<el>`, `spring.<день>`, `stamp.first` ставит склейка `src/flow.ts`. После сна в тот же день — только `done`.
- Склейка `src/flow.ts`: `link:ready` → запуск сразу в шаг (F1 → `ui/intro.ts`, иначе `world:teleport`, resume —
  урок сразу); `guide:step` / `guide:target` после каждого `progress:changed`; действие шага — тап по цели
  (`play.claim`) или по строке «Сейчас» (`guide:act`). Рисуют: `src/ui/guide.ts` (строка «Сейчас», пузырь Казика,
  подсказка управления, анимация раскрытия), `src/world/guide.ts` + `Location` (контур, путь на 3 клетки, стрелка
  у края, бобр-указатель). HUD (`ui/day.ts`) показывает кнопку только при флаге `hud.<element>`.
- `seg`: water/express/more3/evening — обход (`ui/obchod.ts`, вечер = `mode: 'phonetic'`), scene/remedy — конец
  урока в `play.ts`, sleep — «Dobranoc».
- Реплики шагов — константы `LINES` в director.ts и `director.json` (биты, reveals, spring, done); нет в СЮЖЕТ.md →
  `todo` в lines.json: в игре такой пузырь не показывается, в dev — `[todo: id]`.
- Dev-прогон всей игры без облака: `/?reset=1&mute=1` (стирает базу `polski-quest-play`, адрес становится
  `?dev=play`), повторный запуск `/?dev=play&mute=1`, `&now=+1d` / `&now=+9d` (весна). В `window.__pq.flow.step` —
  шаг и `reason`. Вкладка в фоне почти не рисует кадры (rAF): мир «стоит», пока панель браузера скрыта.

## Аватар и Fotobudka (P-03)
- Слои `art/avatar/*.sprite.json` (тело, причёски, бороды, очки, верх; 12 кадров и якорь как у `dima`, кадр может быть
  ссылкой `i` или `{"flip": i}`) + `art/avatar/avatar.json` (варианты, подписи pl/ru, подстановки палитры `base` → `ramp`,
  пресет `default` = Дима). В атлас не идут: `npm run sprites:check` только проверяет палитру и кадры, лист собирает игра.
- Чистое: `src/systems/avatar.ts` (`Appearance`, `avatarKey`, `cycle`, `randomAppearance(seed)`, `composeAvatar`),
  данные — `avatarArt.ts`. Пресет совпадает с `dima` пиксель в пиксель (тест).
- Хранение: `settings.avatar` (LWW целиком по `at`, merge.ts не менялся). Нет ключа = Fotobudka не пройдена.
- Склейка `src/avatarGlue.ts` → `avatar:changed`; мир: `playerTextureKey()` (`src/world/avatar.ts`, CanvasTexture `avatar`,
  фолбэк `dima`); DOM: `src/ui/avatar.ts` (кадр, фото, портрет игрока, атлас вступления).
- Экран `src/ui/creator.ts`: `openCreator({ mode: 'new' | 'mirror' })` → `ui:creator:show`. Новый мир: `flow.ts` открывает
  его перед вступлением F1. Фото — `passportModel().owner`. Dev: `/?dev=creator&mute=1[&mode=mirror][&seed=N]`.

## Как добавить модуль
1. `content/modules/<id>/`: `module.json`, `vocab.json`, `lessons.json`, `dialogues.json`, `maps/*.json`.
2. Id: модуль `[a-z0-9_]+`, урок `<module>.<name>`, слово `lx.<slug>` (глобально уникально),
   диалог `dlg.<module>.<name>`, локация `<module>.<name>`.
3. Привязать модуль к биому в `content/world.json`.
4. `npm run validate`, затем `npm run audio` (на Mac), затем `npm run check`.
5. `status: "draft"` → модуль не виден в игре. `ready` ставит Шэф после вычитки польского.
Новый тип шага = файл в `src/ui/exercises/`, запись в `registry.ts`, схема в `content/schema/steps.schema.json`, тест в `tests/exercises.test.ts`.

## Проверки перед коммитом
`npm run check` = typecheck + validate + check:layers + check:banned + test + build.
Если менял арт: `npm run sprites -- --check`. Если менял польский текст: `npm run audio`.

## Звук при проверках

Заказчик работает за этим же Mac. При браузерных прогонах звук вслух не воспроизводить: кнопки озвучки не нажимать, автозвук глушить (`?mute=1` или мок `audio:play`), озвучку проверять тестами с моками. Прослушивание голосов делает сам заказчик.
