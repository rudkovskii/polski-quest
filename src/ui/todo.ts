// Реплики-заглушки (`todo` в story/lines.json и диалогах, P-01): в сборке их не видно никогда —
// реплика пропускается, узел идёт дальше. Видны только в dev-сервере (`import.meta.env.DEV`) с `?dev=…`
// или `?reset=1`, как `[todo: id]`; `&todo=0` прячет их и там (плейтест на dev-сервере).
// Флаг ставит склейка (src/main.ts) один раз при старте; тесты включают его сами.
let visible = false;

export function setTodoVisible(on: boolean): void {
  visible = on;
}

export function todoVisible(): boolean {
  return visible;
}
