# agent-stack

**Агентская система, которая гоняет ИИ через локальные CLI вашей подписки — вместо поштучной оплаты API-токенов.**

*Self-hosted AI agent stack: drive Claude / ChatGPT / Gemini through their local
CLIs (authenticated by your flat-rate subscription) behind an OpenAI-compatible
HTTP endpoint.*

---

## Зачем

Большинство «оберток» над LLM требуют платный API-ключ и берут деньги за
каждый токен. Если у вас уже есть подписка с фиксированной ценой —
**Claude Max / Pro**, **ChatGPT Plus / Pro**, **Gemini Advanced** — её можно
использовать как backend для агента, а не оплачивать те же запросы повторно
через API.

agent-stack делает ровно это:

- **Дешевле при объёме.** Подписка стоит фикс, API — за каждый токен. На
  ощутимых нагрузках разница в счёте — порядок величины.
- **Та же модель, что и в десктоп-приложении.** Запросы идут через ваш
  локально установленный `claude` / `codex` / `gemini` CLI, авторизованный
  той же сессией.
- **OpenAI-совместимость.** Прокси выставляет `/v1/chat/completions` и
  `/v1/models` — подключается любой клиент, ожидающий OpenAI API
  (Cursor, Cline, Roo, Open WebUI, openai-python и т.д.).
- **Приватность.** Всё ходит через ваш VPS / машину — никакого
  посредника между клиентом и провайдером.
- **Совместимый «классический» режим.** При желании можно переключиться на
  обычный удалённый OpenAI-совместимый API (`LLM_BACKEND=api`) — Moonshot,
  OpenAI, OpenRouter, DeepSeek, xAI и т.д.

---

## Как это работает

```
┌──────────────┐     OpenAI-совместимый HTTPS      ┌─────────────────────┐
│   клиент     │  POST /v1/chat/completions        │   kimi-mcp-proxy    │
│              │ ────────────────────────────────▶ │   (Node/Express,    │
│ Cursor /     │     Bearer <PROXY_API_KEY|JWT>    │    порт 3001)       │
│ Cline / Roo /│                                   │                     │
│ openai-sdk / │                                   │  LLM_BACKEND=cli ───┼──┐
│ ai-chat-ui   │                                   │  LLM_BACKEND=api ───┼──┼─▶ Moonshot/OpenAI/
└──────────────┘                                   └─────────────────────┘  │   OpenRouter/...
                                                                            │
                                                  ┌─────────────────────────▼─────────┐
                                                  │   локальный CLI с вашей подпиской │
                                                  │   claude | codex | gemini         │
                                                  │   (Claude Max / ChatGPT Plus /    │
                                                  │    Gemini Advanced)               │
                                                  └───────────────────────────────────┘
```

Клиент думает, что говорит с OpenAI. Прокси транслирует запрос в локальный
CLI (или в удалённый OpenAI-совместимый эндпоинт) и заворачивает ответ обратно
в формат `chat/completions`.

---

## Возможности

- **OpenAI-совместимый API.** Эндпоинты `/v1/chat/completions` (включая
  `stream: true`) и `/v1/models`. Любой клиент с поддержкой OpenAI работает
  «из коробки».
- **Два бэкенда на выбор.** `LLM_BACKEND=cli` — через локальный CLI на вашей
  подписке. `LLM_BACKEND=api` — через любой удалённый OpenAI-совместимый
  провайдер.
- **MCP-сервер.** Прокси сам по себе является MCP stdio-сервером — его можно
  подключать к Claude Desktop / Cursor как инструмент.
- **Оркестрация суб-агентов.** `POST /automations/delegate` спавнит дочернюю
  CLI-сессию с собственным контекстом и возвращает результат — синхронно
  (`stdout`) или асинхронно (`async: true` + поллинг
  `/automations/delegate/status` и `/automations/delegate/result/:id`).
- **Очередь автоматизаций.** Расписания (`/automations/schedules`),
  потоковый запуск (`/automations/run-stream`), follow-up в существующую
  сессию (`/automations/sessions/:id/queue-next`).
- **Веб-чат UI** (`ai-chat-ui/`, порт 3002) — Next.js фронт поверх прокси,
  с историей чатов, basic-auth и опциональным OAuth (GitHub / Google).
- **Desktop CLI** (`cli/`) — авторизуется по OAuth Device Flow, выдаёт JWT
  на 90 дней, экспортирует `OPENAI_BASE_URL` / `OPENAI_API_KEY`.
- **Telegram-бот** (опционально) — общение с агентом из мессенджера.
- **Загрузка файлов** — `POST /agent/uploads` (multipart) для передачи
  файлов в контекст агента.

---

## Быстрый старт — веб-установщик (рекомендуется)

На свежем Ubuntu/Debian VPS под root:

```bash
git clone https://github.com/<your-user>/agent-stack.git /opt/agent-stack
cd /opt/agent-stack/deploy/installer
node server.mjs
```

Откройте `http://127.0.0.1:7070` (или туннельте на свою машину по SSH:
`ssh -L 7070:127.0.0.1:7070 root@VPS_IP`). Установщик с UI проведёт через
выбор бэкенда (CLI / API), задание секретов (`PROXY_API_KEY`, `JWT_SECRET`),
домена и поднимет сервисы.

## Ручная установка

```bash
git clone https://github.com/<your-user>/agent-stack.git /opt/agent-stack
cd /opt/agent-stack
bash deploy/install.sh
nano kimi-mcp-proxy/.env       # выставить PROXY_API_KEY + бэкенд
nano ai-chat-ui/.env.local     # AUTH_USER / AUTH_PASSWORD
systemctl enable --now kimi-mcp-proxy ai-chat-ui
```

Скрипт ставит Node 20, Caddy, npm-зависимости, копирует systemd-юниты и
шаблоны `.env`. После — добавьте свой домен в `/etc/caddy/Caddyfile` по
сниппету `deploy/caddy/Caddyfile.snippet`.

Доступ:
- локально: `http://VPS_IP:3002` (UI), `http://VPS_IP:3001/health` (прокси);
- через домен с HTTPS: всё то же, но `https://your-domain.tld`.

---

## Конфигурация

Все параметры — в `kimi-mcp-proxy/.env` (шаблон — `.env.example`). Ключевые:

| Переменная        | Значение по умолчанию          | Назначение                                                            |
|-------------------|--------------------------------|-----------------------------------------------------------------------|
| `LLM_BACKEND`     | `api`                          | `cli` — гонять через локальный CLI подписки; `api` — через удалённый OpenAI-совместимый |
| `CLI_PROVIDER`    | `claude`                       | Какой CLI использовать в режиме `cli`: `claude` / `codex` / `gemini`  |
| `CLI_MODEL`       | *(пусто — дефолт CLI)*         | Модель, которую передавать в CLI (например `claude-opus-4-7`)         |
| `CLI_TIMEOUT_MS`  | `120000`                       | Таймаут одного CLI-вызова, мс                                         |
| `CLAUDE_BIN`      | `claude`                       | Путь к бинарю Claude CLI                                              |
| `CODEX_BIN`       | `codex`                        | Путь к бинарю Codex / ChatGPT CLI                                     |
| `GEMINI_BIN`      | `gemini`                       | Путь к бинарю Gemini CLI                                              |
| `KIMI_BASE_URL`   | `https://api.kimi.com/coding/v1` | Upstream-эндпоинт в режиме `api` (любой OpenAI-совместимый)         |
| `KIMI_API_KEY`    | —                              | API-ключ upstream в режиме `api`                                      |
| `KIMI_MODEL`      | `kimi-for-coding`              | Модель upstream в режиме `api`                                        |
| `PROXY_API_KEY`   | —                              | Bearer-токен, который требуется в `Authorization` входящих запросов   |
| `JWT_SECRET`      | —                              | Секрет подписи JWT (для desktop-CLI через Device Flow). Min 32 символа |
| `PUBLIC_BASE`     | —                              | Публичный URL прокси (нужен Device Flow для `verification_uri`)       |
| `PORT`            | `3001` (в systemd)             | Порт прокси                                                           |
| `REQUEST_TIMEOUT_MS` | `120000`                    | Таймаут запроса к upstream                                            |

`PROXY_API_KEY` обязателен — иначе любой в интернете расходует вашу подписку
или API-квоту.

---

## Примеры использования

### curl

```bash
curl -sS https://your-domain.tld/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-7",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

### openai-python

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-domain.tld/v1",
    api_key="<PROXY_API_KEY или JWT из device-flow>",
)

resp = client.chat.completions.create(
    model="claude-opus-4-7",          # имя модели, понятное вашему CLI/upstream
    messages=[{"role": "user", "content": "Привет"}],
)
print(resp.choices[0].message.content)
```

### Cursor / Cline / Roo Code

```
Base URL: https://your-domain.tld/v1
API Key:  PROXY_API_KEY (или JWT-токен из desktop CLI)
Model:    то же имя, что выставлено в CLI_MODEL / KIMI_MODEL
```

---

## Поддерживаемые CLI-провайдеры

`LLM_BACKEND=cli` + `CLI_PROVIDER=…`:

| `CLI_PROVIDER` | CLI                | Подписка                                | Авторизация на машине                  |
|----------------|--------------------|-----------------------------------------|----------------------------------------|
| `claude`       | Anthropic `claude` | Claude Max / Pro                        | `claude login` (браузерный OAuth)      |
| `codex`        | OpenAI `codex`     | ChatGPT Plus / Pro                      | `codex login` → ChatGPT-аккаунт        |
| `gemini`       | Google `gemini`    | Gemini Advanced / AI Pro                | `gemini auth login` (Google-аккаунт)   |

Поставьте нужный CLI на VPS, авторизуйтесь под своей подпиской — дальше
прокси будет дергать его на каждый `/v1/chat/completions`. Бинарь можно
переопределить через `CLAUDE_BIN` / `CODEX_BIN` / `GEMINI_BIN`.

Для классического режима с API-ключом (`LLM_BACKEND=api`) подходит любой
OpenAI-совместимый upstream — Moonshot/Kimi, OpenAI, Anthropic
(OpenAI-совместимый эндпоинт), Gemini (`generativelanguage.googleapis.com/v1beta/openai`),
Cerebras, DeepSeek, OpenRouter, xAI, Mistral и т.п. — достаточно поменять
`KIMI_BASE_URL` + `KIMI_API_KEY` + `KIMI_MODEL`.

---

## Архитектура

```
agent-stack/
├── kimi-mcp-proxy/      # Node/Express бэкенд, порт 3001
│   ├── src/
│   │   ├── server.js         # OpenAI-совместимые роуты + автоматизации
│   │   ├── config.js         # LLM_BACKEND, CLI_*, KIMI_*
│   │   ├── kimi-client.js    # upstream OpenAI-совместимого API
│   │   ├── auth-jwt.js       # JWT-токены для CLI/UI
│   │   ├── auth-device.js    # OAuth 2.0 Device Authorization Grant
│   │   ├── automations.js    # очередь и спавн дочерних CLI-сессий
│   │   ├── mcp-server.js     # MCP stdio-сервер
│   │   ├── mcps.js           # каталог подключаемых MCP
│   │   ├── chat-store.js     # история чатов
│   │   ├── agent-sessions.js # отслеживание сессий суб-агентов
│   │   └── telegram.js       # бот
│   ├── hooks/                # security hooks (bash-guard)
│   └── .env.example
├── ai-chat-ui/          # Next.js фронт, порт 3002
├── cli/                 # desktop CLI (OAuth Device Flow → JWT)
├── deploy/
│   ├── installer/            # веб-установщик (UI на 7070)
│   ├── install.sh            # установка на чистый VPS
│   ├── systemd/              # юниты kimi-mcp-proxy и ai-chat-ui
│   ├── caddy/                # сниппет для Caddyfile (HTTPS + reverse_proxy)
│   └── ssh/                  # инструкции по SSH-ключам
└── README.md
```

**Ключевые эндпоинты прокси:**

- `GET  /health` — health-check.
- `GET  /v1/models`, `POST /v1/chat/completions` — OpenAI-совместимый API.
- `POST /agent/uploads` — multipart-загрузка файлов в контекст агента.
- `POST /automations/delegate` — спавн дочернего CLI-агента
  (`{ parentSessionId, name, task, async? }` → `{ childSessionId, stdout, exitCode }`
  либо `{ childSessionId, status: "running" }`).
- `GET  /automations/delegate/status?ids=...`,
  `GET  /automations/delegate/result/:id` — поллинг асинхронных воркеров.
- `POST /automations/sessions/:id/queue-next` — поставить follow-up в
  существующую сессию.
- `*    /automations/schedules`, `/automations/runs`, `/automations/mcps` —
  расписания, история, подключение внешних MCP.

---

## Безопасность

- **`PROXY_API_KEY` обязателен.** Без него любой запрос с улицы тратит вашу
  подписку или API-квоту.
- **`JWT_SECRET` ≥ 32 символа.** Меняйте его, чтобы массово отозвать ранее
  выданные device-flow токены (`systemctl restart kimi-mcp-proxy`).
- **CLI-режим запускает чужой shell.** `claude` / `codex` / `gemini` имеют
  доступ к файловой системе пользователя, под которым запущен сервис. На
  публичном VPS изолируйте — отдельный системный юзер, ограниченный
  workdir, при необходимости — Docker-песочница для воркеров
  (`WORKER_SANDBOX=docker`).
- **`--dangerously-skip-permissions` / `IS_SANDBOX=1`** в Claude CLI снимает
  интерактивные подтверждения. Включайте *только* внутри песочницы
  (контейнер, изолированный пользователь) — иначе агент может выполнить
  любую команду без вопросов.
- **`.env` не коммитим.** `.gitignore` ловит `.env*`, `*.key`, `*.pem`,
  `id_rsa*`, `*.tg_token`, `credentials.json`, `service-account*.json`,
  историю чатов (`chat-store/`, `agent-sessions.json*`) и состояние
  автоматизаций. Если случайно закоммитили секрет — **отзовите его у
  провайдера**, а потом уже чините git.

---

## Лицензия и дисклеймер

MIT — см. [LICENSE](LICENSE).

Использование Claude / ChatGPT / Gemini через их CLI подчиняется условиям
обслуживания соответствующих провайдеров. agent-stack — это всего лишь
HTTP-обёртка над уже установленным локально CLI; вы отвечаете за то,
чтобы ваш сценарий использования не нарушал ToS подписки (личный
fair-use vs. перепродажа доступа третьим лицам — это разные истории).
