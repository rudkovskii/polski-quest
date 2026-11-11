# Ferma (polski-quest)

Пиксельная игра по польскому в духе Stardew Valley: фермер выращивает слова. Phaser 4 + Vite + TypeScript, PWA.
Игра Шэфа живёт только на его маке: http://127.0.0.1:5321/ (с 11.11.2026). Правила для агентов, слои, контракты событий — `AGENTS.md`.

```bash
nvm use           # Node 24 (.nvmrc)
npm ci
npm run dev       # http://localhost:5173/?mute=1&dev=1
npm run check     # typecheck + audio + слои + запреты + тесты + спрайты + сборка
npm run art       # tools/art_*.py → art/sprites/*.sprite.json
npm run sprites   # art/ → public/atlas (Python 3 + Pillow 12.2.0)
```

Озвучка польского — синтетический голос «hela» (OmniVoice, придуманный моделью, не голос реального человека; веса CC BY-NC 4.0,
игра некоммерческая), подробности в `CREDITS.md`. Пересборка: `python3 tools/audio_list.py`, `npm run audio` (см. `AGENTS.md`).

## Личная версия на маке

- Адрес: http://127.0.0.1:5321/ — работает без интернета, сервер поднимается сам после перезагрузки (LaunchAgent `com.rudkovskiid.polski-local`).
- Выложить новую версию (только по слову Шэфа): `npm run local` — проверка, сборка, атомарная замена `../local-site/current`. Откат: `npm run local -- --rollback`.
- Ленты (свои слова, ответы собеса) — `../local-site/feed/`, пишет LaunchAgent `com.rudkovskiid.polski-feed` через минуту после правки `../data/moje_slowa.json` или `ПМЖ/Собес`; итог — `../data/feed-status.json`. Руками: `npm run words`, `npm run sobes:feed`, `npm run feed:run`.
- Сервер руками: `npm run local:serve`; поставить/снять агента: `npm run local:install` / `local:uninstall`. Логи — `/tmp/polski-local.*.log`.
- Проверить: открыть адрес, внизу настроек версия сборки; `curl -s http://127.0.0.1:5321/version.json`.

## Pages

Пуш в `main` → GitHub Actions (`.github/workflows/deploy.yml`) → Pages: только персональные версии из `deploy/editions.json`
(сейчас Оля), в корне — пустая страница. Старая версия игры: тег `archive-v1`, ветка `archive/v1`.
