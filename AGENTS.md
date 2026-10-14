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

## Ходьба везде (P-02)
- Все локации `controls: walk` (режим `tap` остался в модели для карт-меню). Модель `src/world/location.ts`: 4,5 клетки/с
  (`CELLS_PER_SEC`), поворот на месте коротким нажатием (`TURN_MS`), удержание = идти, смена направления на ходу без паузы,
  диагональ — по последней нажатой оси (роутер). A — клетка перед лицом; грядка — только перед лицом и по клетке
  (`setGarden`), тап по клетке грядки — дойти до соседней и сделать именно с ней. «A»-пузырёк: `actionHint()`.
- Посадка руками: флаг `seed.<item>` = семя в кармане (не на грядке), A/тап по пустой клетке → флаг `plant.<x>_<y>.<item>`
  (`src/world/dzialka.ts`, склейка `flow.claim`). Кто кладёт семя в карман — режиссёр/сцена (P-05/P-06).
- Пузырь Казика в мире: сцена шлёт `world:anchor` (экранная точка над головой), `ui/guide.ts` ставит пузырь туда.
  Строка «Сейчас» спрятана первые 3 игровых дня (`step.nowHidden`), видна при 10 с бездействия. Подсказка управления —
  шаг с `moveHint`, первый вход на карту, только после 3 с без ввода. B/Esc закрывает слой оверлея кнопкой `data-act="close"`.
- Dev: `&seed=lx.a,lx.b` — семена в кармане (`/?dev=world&map=ch01.dzialka`).

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
  (правила 1–10, слоты битов, `reveals`). Ничего не пишет: флаги `beat.d01.*` (день 1, P-05), `beat.first_day_done`, `sys.*` (P-06),
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

## Полировка плейтестов (P-01)
- `[todo]` в сборке не виден никогда: реплика-заглушка пропускается (диалог, runLines, вступление, пузырь, bobrLine),
  у узла с вариантами остаются варианты. Видно только в `npm run dev` с `?dev=…`/`?reset=1` (`src/ui/todo.ts`), `&todo=0` прячет.
- Бит первого дня без `todo`: `npm run validate:release` / `npm run build:release` (`PQ_RELEASE=1`) падают на заглушке
  в репликах `FIRST_DAY_LINES` (director.ts) и в диалогах диагностики и ремонтных сцен. Без флага — предупреждение.
- Варианты, плитки, пары перемешиваются по `ExerciseCtx.seed` = id шага + игровой день (`options.ts`: `seedOf`,
  `shuffleOptions`); `stress` не перемешивается. В тестах выбирай вариант по тексту, не по индексу.
- После ошибки: ответ, строка правила (`step.why` → `errorTags[tag].hint` → `ru`), перевод с транскрипцией, потом
  «Prawie. Jeszcze raz.» (`frame.ts`: `ruleLine`, `glossLine`).
- Кнопки: `plBtn(BTN.next, …)` из `overlay/kit.ts` — польское слово + мелкая русская подпись; новые подписи — в `BTN`.
  Портрета нет — силуэт. Итог дня: «полито» только обход/экспресс (+ ранний полив агрегатом `lesson obchod.*`),
  минуты — `retrievalMsOf` (уроки целиком + ответы вне уроков).
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

## Играбельный день 1 (P-05)
- День 1 = биты слота `day1` в `content/director.json` (id `d01.*`, флаг `beat.<id>`), по порядку СЮЖЕТ_v2 §4: вокзал (карточка) →
  фотобудка → перрон → чемодан и выбор звука → улица → табличка → вход на базар → лоток Хели → Висла → działka → полив →
  ветер → шляпа → Брзехва → посадка → вечер → сон. `firstDay()` в director.ts берёт первый несделанный бит с истинным `if`;
  посадка сделана, когда карман пуст (`pocketSeeds`). После сна склейка ставит `beat.first_day_done`.
- Бит без `npc/object/plot/screen` и без `act` играется сам, как только Дима на его карте (`isAutoBeat`, flow.ts); у бита с `act`
  своё действие в `src/flow.ts` (`day1`): `card`, `fotobudka` (openCreator), `sound` (флаги `d01.sound.on|mute` → настройка
  `sound.mode`), `bazar` (плитки, паспорт, печать — `ui/intro.ts`), `water`, `brzechwa` (урок `ch01.d01.brzechwa` по чанку на
  слово: `play.openLesson(id, { item })`, семя `seed.<item>` до чанка), `plant` (руками), `sleep` (общий итог дня, ночь — P-10b).
- Реплики, которые показывает код, — константа `D01` (director.ts); они и всё, что в `do` битов `day1` и их диалогах, входят в
  проверку `validate:release` / `build:release` (`todo` в дне 1 = ошибка). Заглушки дней 2+ сюда не входят.
- Карты дня 1: `ch01.dworzec`, `ch01.peron`, `ch01.bazar` (улица + базар), `ch01.wisla`, `ch01.chatka` (хатка) + `ch01.dzialka`.
  Выход дальше закрыт `if` по флагу сцены; ширина ≥ 12 и высота ≥ 26 клеток (iPhone zoom 2 без пустоты, тест mapsDay1).
  Пока виден d-pad, камера даёт карте уехать вверх на его высоту (`DPAD_INSET`, Location.ts). `world:teleport` принимает `facing`.
- Предметы на карте, которые исчезают по ходу сцены (чемодан, шляпа), — NPC-персонажи `walizka`, `kapelusz` с `if`.
  Компаньона на карте нет, если там стоит NPC `bobr` (в зале вокзала он спрятан `if` — Казик появляется на перроне).
- Арт: `art/sprites/{fotobudka,train,peron,tablo,kamienica,poslanie,walizka,kapelusz}.sprite.json` + тайлы в `ninja16.json`.
- Dev: `/?reset=1&mute=1` — весь день с нуля; в скрытой вкладке кадры шагать `window.__pq.game.loop.step(t)`.

## Темп и контент дней 2–14 (P-06, P-08)
- Игровой день главы: `storyDay` (`src/systems/pace.ts`, атом условия `gameDay: { min, max }`): день 1 — до флага
  `beat.first_day_done`, дальше +1 за каждый засчитанный день. Пропуск календарных дней день не двигает.
- Расписание систем — данные `director.json` → `schedule` (одна запись = одна новая система дня, `with` — её части):
  1 ходьба · 2 обход+письмо+метро+диагностика · 3 клавиатура · 4 «повтори вслух» · 5 вечер · 6 выбор вечера ·
  7 экспресс (+ воскресенье) · 8 «скажи в жизни» · 14 карта и босс. `systemState` = closed / new / open; показ ставит
  флаг `sys.<запись>` (склейка `flow.ts`, шаг с `system`), в день не больше одной новой; валидатор — `scheduleIssues`.
- Сцены по дням: `requires: { gameDay: { min: N } }` у уроков ch01; режиссёр даёт столько сцен, сколько у дня в
  расписании, + одну с прошлых дней (`sceneQuota`, реплика `sys.kazik.extra_repair`). Биты дней — `director.json`
  (`dNN.*`, `system` у бита), реплики шагов дня — `director.days` (полив, сцена, вечер, сон, крючок итога).
- Шаги урока на сегодня: `lessonForToday` (play.ts) — type/dictation до клавиатуры и shadow до дня 4 не играются;
  без звука — listen/dictation только с `tr` (шаг) или `vocab.tr`, пары — «какое слово значит …».
- Без звука: настройка `sound.mode: 'on' | 'off'` — один ключ: выбор на перроне в день 1 (P-05, флаги `d01.sound.on|mute` →
  `applySound` в flow.ts) и переключатель в настройках; старые значения `sound`/`mute` читаются как `on`/`off` (`getSetting`). Карточки `lis`
  остаются (P-10b: чтение транскрипции засчитывается в них); упражнения получают `ctx.silent`; реплика `<id>.mute` подменяет `<id>` (`lineFor`, `muteLines`).
- Диагностика `ch01.s00`: 12 пунктов, `ctx.oneShot` (ошибка → правило и «Hyk!», без повтора), «Wyjdź» в шапке:
  выход после ответа пишет `diag` + `lesson` по отвеченному, непроверенные кластеры `unknown` → ремонт полной сценой.
  Карта звуков — `src/ui/soundMap.ts` сразу после (play.ts) и страница паспорта.
- Реакция мира на ошибку: `lesson.errLine` (реплика NPC перед правилом, `ctx.errLine`).
- Сборка для людей: `PQ_RELEASE=1` в CI (`deploy.yml`) — `todo` в любой реплике/узле = ошибка.
- Dev: `/?reset=1&mute=1&now=+1d` — день 2 (после сна дня 1), `&now=+2d` — день 3 и т.д.; `/?reset=1&mute=1&day=N` — чистый
  мир сразу в день N (`src/dev/seedDay.ts`: биты `d01.*` и прошлых дней, сцены, диагностика «всё красное»); `window.__pq.flow.step.reason`.

## Стык дня 1 и дней 2–14 (слияние P-05 + P-06)
- День 1 целиком P-05: `firstDay()` идёт по битам слота `day1`, пока нет `beat.first_day_done`; расписание P-06 в нём не
  участвует (`systemState` для записей дня 1 — `open`, системы дней 2+ — `closed`, т.к. `storyDay` = 1). Флаг ставит сон
  дня 1 (`sleepFlow`), со следующего календарного дня `storyDay` = 2 и шаги ведут правила 2–10 с расписанием P-06.
- Итог дня — один для всех дней (P-10b): `summaryBody` с репликами `director.days[N].sleep` (`[]` — без Казика), `.umiem`
  и крючком `.hook`; «ещё 3 минуты» с дня 7.
- Схема `director`: биты со слотами `start/afterWater/afterScene/beforeSleep` (дни 2+, поле `system`) и `day1` (поле `act`);
  `schedule`, `days` (включая день 1), атом условия `gameDay`.

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

## Диалоги по новым правилам (P-07)
- Окно реплики `src/ui/dialog/line.ts`: портрет с именем над коробкой, коробка до 2 строк по 40 знаков (`boxes.ts`:
  `splitBoxes` режет по предложениям, потом по словам), листает игрок (тап по коробке, A, Enter, пробел), печать 16 мс на
  букву, тап дописывает. Казик (`kind: companion`) — польская коробка с подписью, потом его русская речь коробками;
  рассказчик (`who: narrator`) — без портрета, курсивом. Узел только с вариантами — коробки нет, только кнопки.
- Подпись-перевод: настройка `translations` = `always` / `auto` («по ситуации», по умолчанию; старое `tap` читается как
  `auto`) / `never`. В `auto` подпись скрыта (остаётся «?»), когда все значимые слова строки знакомы: карточка `rec`
  с интервалом ≥ 3 дней (`src/systems/words.ts`: `isFamiliar`, `captionHidden`); имена (`pos: name`) знакомы всегда.
  Слово вне словаря держит подпись. Тап по польскому слову — всплывашка `pl [tr] ru` из vocab, нет слова — перевод строки.
- Варианты: на экране максимум 2 (`screenChoices`), выбор с `ok: false` перемешан по `dlg#узел:день`, вкусовой — по
  порядку; верный остаётся всегда. Первый тап выбирает (тап, пока строка печаталась, раньше только допечатывал).
  Перевод варианта — «?» слева или долгое нажатие (`src/input/press.ts`).
- Ошибка в упражнении: `Prawie. Jeszcze raz.` только для почти верного (вердикт diacritics / ortho / typo), иначе
  `Jeszcze raz.` (`frame.ts`: `isNear`, `NEAR_LINE`, `WRONG_LINE`), правило и перевод P-01 перед ними.
- **Формат `words` для контента (P-08).** Необязательное поле у узла диалога, у варианта и у реплики `story/lines.json`:
  значимые польские слова строки. Элемент — id слова (`"lx.kawa"`, в строке стоит его `pl` или форма из `forms`) или
  `{ "pl": "kawy", "lx": "lx.kawa" }` (форма ровно как в строке, фраза тоже можно: `{ "pl": "Dzień dobry", "lx": "lx.dzien_dobry" }`).
  С `words` подпись гаснет, когда знакомы все размеченные слова (остальные — служебные: «pan», «to», «i»); без `words`
  слова ищутся в vocab сами, и подпись гаснет, только если нашлись и знакомы все. У Казика `words` размечает польские
  вкрапления в `ru` (латиница подсвечивается и без разметки). Пример:
  `{ "who": "pan_marek", "pl": "Dzień dobry! Nie ma kawy?", "ru": "Здравствуйте! Кофе нет?", "words": ["lx.dzien_dobry", "lx.nie", { "pl": "kawy", "lx": "lx.kawa" }] }`
  (`kawy` нет в `forms` слова `lx.kawa`, поэтому записана формой; «ma» не размечено — служебное).
  Валидатор: id не из vocab — ошибка `ref`; формы нет в строке — предупреждение `words`; больше 2 вариантов и русская
  речь польского NPC (`ru` без `pl` у узла, `ru` у реплики не Казика/рассказчика) — предупреждения.
- Dev: `/?dev=lesson&dlg=dlg.ch01.bramka&mute=1` (с `dlg` без `id` теперь берётся `content/`, а не фикстура),
  демо всех коробок `dlg=dlg.dev.p07` (`src/dev/p07.ts`), `&learn=dlg` (или `lx.a,lx.b`) — слова диалога «выучены»
  (intro + rev, интервал 3 дня), `&days=10` — подпись знакомых строк скрыта.

## Имя, кнопка A, камера, обновление (P-10a)
- Имя из Fotobudka в репликах: `{name}` в `pl`/`ru`/`plRu` реплик (`story/lines.json`), узлов и вариантов диалогов и шагов
  `say` (единственный плейсхолдер; в другом месте — ошибка `name` валидатора). Рантайм: `src/systems/playerName.ts`
  (`personalize` меняет тексты контента на месте, подпись говорящего у `kind: player` — тоже), склейка `startPlayerName`
  (avatarGlue.ts, раньше play/flow). Реплика `<id>.anyname` заменяет `<id>` для имени не «Dima» (рифма Брзехвы «Dima/zima»).
  Озвучка собирается под «Dima» (`build_audio.py`, `voiceTexts`); другое имя — текстом (Web Speech или без звука).
  Обращение в мужском роде остаётся (ПОЛИРОВКА §2 п.12). Dev: `/?dev=lesson&dlg=dlg.ch01.d01_imie&name=Andrzej`.
- Кнопка A (`LocationModel.actionTarget`): цель режиссёра рядом (`setGoal`, контур) → объект перед лицом → соседний →
  Казик (только если больше ничего нет) → под ногами. Подсвеченный выход рядом — A шагает в него. Грядка сбоку — только
  подсвеченная клетка. Казик (NPC и компаньон) не встаёт на клетки `reserved()` (Дима, куда шагает, конец пути) и на выходы;
  Дима шагает на компаньона — тот уступает (`yieldCompanion`). Цель «Kazik» (`npc: bobr` или бит без цели, `talksToKazik`
  в flow.ts) — Казик подходит сбоку (`besideCell`), контур и стрелка идут за ним; компаньон — объект `npc:bobr` для A и тапа.
  Тап по цели: путь перегородили — новый путь, действие не теряется.
- Камера (Location.layout): видимая зона — между HUD сверху (`HUD_TOP_INSET` + safe-area) и d-pad снизу (`DPAD_INSET` +
  safe-area). Карта, которая влезает, центрируется в зоне; большая — Дима в центре зоны, низ карты поднимается над крестом,
  цель режиссёра рядом подтягивает камеру (`updateFollow`). Стрелка к цели считает HUD и d-pad краем экрана.
- Обновление сборки: `registerPwa` (platform/pwa.ts, `virtual:pwa-register`, autoUpdate + skipWaiting/clientsClaim,
  `injectRegister: false`). Новая сборка взяла страницу: на титуле — перезагрузка (`updateAction`, защита от петли 60 с),
  в игре — тост `app:update` «Есть обновление» (ui/updateToast.ts) → `app:reload` → flush базы → reload.
- Dev: свой профиль проверки `?dev=p10a` (база `polski-quest-p10a`, как `dev=play`), не мешает другим вкладкам.
## Один конец дня, правдивый итог, без звука (P-10b)
- Сон только в хатке Казика (`ch01.chatka`, постель `poslanie`): день 1 — бит `d01.sen`, дни 2+ — правило 9 режиссёра
  (`FIRST_DAY.chatka/sleepObject`). Альтанка на działce — декор, `open: summary` в картах не ставить; `ui:screen:open summary`
  ничего не открывает, обход сон не предлагает. `flow.sleepFlow`: итог → `runNight({ dark })` каждый день (день 1 — «miau» и
  Казик, дни 2+ — «miau»), день 1 ещё ставит `beat.first_day_done` и экран ссылки.
- Итог (`daySummary.ts`): полито = растения (`DaySummary.plants`, как «Obchód (N)»), выросло — по виду на грядке
  (`garden.plantLook`: маленький/крепкий росток, куст, банка), посажено, «Umiem» дня, «Минуты в заданиях» (`retrievalMs`, ТЗ),
  «Всего в игре» (сессии дня + таймер), завтра к поливу — растения. «Повторено из нужного» и złoty убраны.
- Паспорт: печать №1 — «Bazar» (Bazar Różyckiego), «Умею» по `canDo[].when` из module.json (нет `when` — по боссу).
- Новые слова: день 2 — урок `ch01.d02.znaki` (wejście, wyjście, peron, kind practice, `pass.firstTry 0`) битом `d02.znaki`
  у Брзехвы после турникета (`once: false` + «урок не сдан»: прерванный повторится); день 3 — киоск `ch01.s01`
  (woda, kawa, herbata) без `skipIf`: зелёный R1 → разминка `short`. Сцена — не больше 3 новых слов.
- Без звука: `lis` и `pair` в обходе/вечере — чтением (транскрипция / перевод пары), ответ пишется в карточку; ▶ нигде нет
  (`ctx.silent`, `say`, `DialogDeps.silent`, `IntroDeps.silent`), «Pip!/Hyk!» турникета заменяет обычный текстовый отклик.
- Варианты в диалогах: русская подпись видна сразу (`choiceRuShown`): служебные ответы всегда, с проверкой — до дня 7 и пока
  слова не знакомы, потом по P-07 за «?».
