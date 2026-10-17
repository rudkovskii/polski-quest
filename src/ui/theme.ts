// Тёплая тема DOM-оверлея в цветах мира (коричневое дерево, кремовая бумага, рыжие акценты).
export const THEME_CSS = `
:root { --pq-wood: #6c4a33; --pq-wood-dark: #46302a; --pq-cream: #f7ecd2; --pq-ink: #2a1418; --pq-accent: #d9782f; --pq-leaf: #6aa84a; }
.pq-btn { font: 600 15px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-cream); background: var(--pq-wood);
  border: 2px solid var(--pq-ink); border-radius: 6px; padding: 10px 14px; box-shadow: 0 3px 0 var(--pq-ink); cursor: pointer; touch-action: manipulation; }
.pq-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--pq-ink); }
.pq-btn.danger { background: #a8453a; }
`;
