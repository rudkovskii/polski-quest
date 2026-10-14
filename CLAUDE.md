# AGENTS.md: polski-quest

Ты пишешь код игры по польскому для Димы («Шэф»). ТЗ и план лежат в воркспейсе:
`~/Documents/GitHub/Изучение польского/Игра/ТЗ.md` и `ПЛАН.md`. Читай раздел ТЗ своей итерации до кода.
Код игры живёт в `~/Documents/GitHub/Изучение польского/Игра/app/` (этот репозиторий, `rudkovskii/polski-quest`).
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

## Слои (ловит tools/check_layers.ts)
- `src/systems/**` без `platform/`: не импортирует `phaser`, `platform/`, `scenes|world`, `ui`, `main.ts`;
  не трогает `window`, `document`, `navigator`, `localStorage`, `indexedDB`, `fetch`, `requestAnimationFrame`.
- `src/systems/platform/**`: адаптеры браузера, без `phaser`, `scenes|world`, `ui`.
- `src/scenes|world/**` ⇄ `src/ui/**`: друг друга не импортируют. `ui` не импортирует `phaser`.
- Склейка слоёв только в `src/main.ts`.

## Как добавить модуль
1. `content/modules/<id>/`: `module.json`, `vocab.json`, `lessons.json`, `dialogues.json`, `maps/*.json`.
2. Id: модуль `[a-z0-9_]+`, урок `<module>.<name>`, слово `lx.<slug>` (глобально уникально),
   диалог `dlg.<module>.<name>`, локация `<module>.<name>`.
3. Привязать модуль к биому в `content/world.json`.
4. `npm run validate`, затем `npm run audio` (на Mac), затем `npm run check`.
5. `status: "draft"` → модуль не виден в игре. `ready` ставит Шэф после вычитки польского.
Новый тип шага = файл в `src/ui/exercises/`, запись в реестре, схема в `content/schema/steps.schema.json`, тест.

## Проверки перед коммитом
`npm run check` = typecheck + validate + check:layers + check:banned + test + build.
Если менял арт: `npm run sprites -- --check`. Если менял польский текст: `npm run audio`.
