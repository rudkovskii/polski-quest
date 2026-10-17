# Ferma (polski-quest)

Пиксельная игра по польскому в духе Stardew Valley: фермер выращивает слова. Phaser 4 + Vite + TypeScript, PWA на GitHub Pages
(`/polski-quest/`). Правила для агентов, слои, контракты событий — `AGENTS.md`.

```bash
nvm use           # Node 24 (.nvmrc)
npm ci
npm run dev       # http://localhost:5173/polski-quest/?mute=1&dev=1
npm run check     # typecheck + audio + слои + запреты + тесты + спрайты + сборка
npm run art       # tools/art_*.py → art/sprites/*.sprite.json
npm run sprites   # art/ → public/atlas (Python 3 + Pillow 12.2.0)
```

Деплой: пуш в `main` → GitHub Actions (`.github/workflows/deploy.yml`) → Pages. Старая версия игры: тег `archive-v1`, ветка `archive/v1`.
