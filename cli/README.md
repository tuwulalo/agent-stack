# agent-stack CLI

Десктопный клиент: на своём компе один раз залогинился через **OAuth Device
Flow**, получил долгоживущий токен в `~/.config/agent-stack/token.json`, и
дальше любые OpenAI-совместимые инструменты (Cursor, Cline, Antigravity,
официальный `openai` SDK) ходят на твой VPS как на обычный OpenAI-эндпоинт.

## Установка

Требуется Node 18+. Дальше — глобальная установка через npm:

```bash
cd cli
npm install -g .
```

Либо просто запускай напрямую без установки:

```bash
node /path/to/agent-stack/cli/agent-stack.mjs login --server https://your-domain.tld
```

## Первый вход

```bash
agent-stack login --server https://your-domain.tld
```

CLI распечатает что-то вроде:

```
  ┌────────────────────────────────────────────────┐
  │  Код:    XQHM-7TPL                              │
  │  URL:    https://your-domain.tld/cli           │
  └────────────────────────────────────────────────┘

Открой URL в браузере, залогинься (GitHub/Google/пароль)
и введи код. Ждём подтверждения…
```

Открываешь URL у себя в браузере, логинишься (GitHub / Google / логин-пароль),
вводишь короткий код — CLI получает токен и сохраняет в
`~/.config/agent-stack/token.json` (chmod 600).

## Использование

```bash
agent-stack whoami           # текущий сервер + замаскированный токен
agent-stack logout           # удалить локальный токен

agent-stack curl /v1/models  # быстрый запрос через прокси
agent-stack curl /v1/chat/completions -X POST -H "Content-Type: application/json" \
    -d '{"model":"kimi-k2-0711-preview","messages":[{"role":"user","content":"Привет"}]}'

# Сделать твой VPS видимым как OpenAI для любого SDK:
eval "$(agent-stack env)"
# теперь работает: openai.chat.completions.create(...)
```

## Подключение IDE

**Cursor / Cline / Antigravity / Roo Code** — везде формат одинаковый:

```
Base URL:  https://your-domain.tld/_kp/v1
API Key:   <скопируй из agent-stack whoami или из config файла>
Model:     kimi-k2-0711-preview   (или то, что у тебя в KIMI_MODEL на сервере)
```

## Безопасность

- Токен — JWT с подписью `JWT_SECRET` (живёт на VPS), HS256, срок 90 дней.
- На стороне VPS токен валидируется в Express-middleware `requiresAuth`,
  payload должен иметь `kind: 'device'`.
- Локально файл с правами 600, не читаемый другими юзерами на компе.
- Если потерял доступ к компу — заходишь в UI на VPS, меняешь
  `JWT_SECRET` в `.env` и `systemctl restart kimi-mcp-proxy` — все ранее
  выписанные токены сразу инвалидируются.
