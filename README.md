# polski-quest — «Pierogi i Przypadki»

Персональная пиксельная игра для изучения польского. Phaser 4 + Vite + TypeScript, PWA на GitHub Pages:
https://rudkovskiid-blip.github.io/polski-quest/

Правила для агентов — `AGENTS.md`. ТЗ и план итераций лежат вне репозитория, в воркспейсе Шэфа.

## Запуск

```bash
nvm use        # Node 24 (.nvmrc)
npm ci
npm run dev    # http://localhost:5173/polski-quest/
npm run check  # typecheck + validate + check:layers + check:banned + test + build
```

Деплой: пуш в `main` → GitHub Actions (`.github/workflows/deploy.yml`) → Pages.

Приватная ссылка на сохранение в этот репозиторий не пишется.
