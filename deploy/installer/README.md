# agent-stack installer (web wizard)

Локальный мастер установки на чистом VPS. Ставит и настраивает
`kimi-mcp-proxy`, `ai-chat-ui`, systemd-юниты и пишет `.env` файлы — через
браузер, без копания в bash.

## Запуск

```bash
cd /opt/agent-stack/deploy/installer
node server.mjs
```

Открой в браузере (или прокинь порт по SSH):

```
http://127.0.0.1:7070
```

Сервер слушает **только 127.0.0.1**. Если ставишь на удалённый VPS — пробрось
порт:

```bash
ssh -L 7070:127.0.0.1:7070 root@your-vps
```

## Демо-режим (без реальных изменений)

Чтобы прокликать UI и убедиться что всё работает, не трогая систему:

```bash
INSTALLER_DEMO=1 node server.mjs
```

В этом режиме шаги `apt`, `npm`, `systemctl` и `curl` НЕ выполняются — только
печатается `[demo] would run: ...`. Конфиги `.env` всё равно пишутся (если
каталоги существуют).

## Что делает мастер

1. **Проверка системы** — `node`, `claude`, `codex`, `gemini`, `caddy`, `/opt/agent-stack`.
2. **Выбор бэкенда** — CLI-подписка (`claude` / `codex` / `gemini`) ИЛИ OpenAI-совместимый API.
3. **Доступ** — логин/пароль UI, авто-генерация `PROXY_API_KEY`, `PUBLIC_BASE`.
4. **Установка** — пошаговый запуск: `deps`, `node`, `proxy-deps`, `ui-deps`, `services`, `verify`. Лог стримится через SSE.
5. **Готово** — ссылки и подсказки по дальнейшим шагам.

## Файлы которые пишет мастер

- `kimi-mcp-proxy/.env` (mode 600)
- `ai-chat-ui/.env.local` (mode 600)

## Зависимости

Только встроенные модули Node (`http`, `fs`, `child_process`, `path`, `url`,
`crypto`). `npm install` в этом каталоге запускать не нужно.

## Безопасность

- bind только на `127.0.0.1`, входящие соединения с других IP отбиваются 403.
- параметр `step` для `/api/run` — whitelist (никаких shell-инъекций).
- `spawn` вызывается с массивом argv, без `shell: true`.
- значения env проходят strip CR/LF — нельзя протащить лишние строки.
