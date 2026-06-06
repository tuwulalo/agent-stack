# agent-stack

Self-hosted AI-агент: OpenAI-compatible прокси + чат-фронт + оркестрация
саб-агентов и автоматизаций. Заводится на одном VPS за 5 минут.

Внутри две части:

- **`kimi-mcp-proxy/`** — Node/Express бэкенд (порт `3001`):
  OpenAI-compatible `/v1/chat/completions`, MCP stdio-сервер, оркестрация
  саб-агентов через `claude` CLI, Telegram-бот, очередь автоматизаций.
- **`ai-chat-ui/`** — Next.js фронт (порт `3002`): чат поверх прокси,
  basic-auth через middleware, история сессий.

Сверху — **Caddy** с автоматическим HTTPS на твой домен.

---

## Быстрый старт

```bash
# на свежем Ubuntu/Debian VPS, от root
git clone https://github.com/<твой-юзер>/agent-stack.git /opt/agent-stack
cd /opt/agent-stack
bash deploy/install.sh
nano kimi-mcp-proxy/.env       # вписать KIMI_API_KEY (или другой провайдер)
nano ai-chat-ui/.env.local     # вписать AUTH_USER / AUTH_PASSWORD
systemctl enable --now kimi-mcp-proxy ai-chat-ui
```

Доступ:
- Локально: `http://VPS_IP:3002` (фронт), `http://VPS_IP:3001/health` (прокси).
- По домену + HTTPS: см. `deploy/caddy/Caddyfile.snippet`.

---

## Подключение к разным LLM-провайдерам

Прокси **OpenAI-compatible** — это значит, что любой провайдер с
OpenAI-совместимым API подключается просто заменой трёх переменных в `.env`:

| Провайдер | `KIMI_BASE_URL` | `KIMI_MODEL` (пример) |
|---|---|---|
| Moonshot / **Kimi** | `https://api.moonshot.ai/v1` | `kimi-k2-0711-preview` |
| OpenAI / **GPT** | `https://api.openai.com/v1` | `gpt-4o` |
| Anthropic / **Claude** | `https://api.anthropic.com/v1` | `claude-opus-4-7` |
| Google / **Gemini** / **Antigravity** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-pro` |
| **Cerebras** (он же "Села") | `https://api.cerebras.ai/v1` | `llama-3.3-70b` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **OpenRouter** (всё сразу) | `https://openrouter.ai/api/v1` | `anthropic/claude-opus-4` |
| **xAI / Grok** | `https://api.x.ai/v1` | `grok-4` |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-large-latest` |

Все варианты предзаполнены закомментированными блоками в
[`kimi-mcp-proxy/.env.example`](kimi-mcp-proxy/.env.example) — раскомментируй
нужный, остальные оставь под `#`.

### Подключение IDE/клиента к прокси

Прокси отдаёт OpenAI-совместимый эндпоинт, поэтому к нему цепляется что
угодно: **Antigravity**, **Cursor**, **Cline**, **Roo Code**, любой
OpenAI-SDK-клиент.

```text
Base URL: https://your-domain.tld/_kp/v1
API Key:  значение PROXY_API_KEY из .env
Model:    то же что KIMI_MODEL
```

`PROXY_API_KEY` обязателен — иначе любой в интернете будет тратить твою квоту.

---

## SSH-вход на VPS

Полный мануал: [`deploy/ssh/README.md`](deploy/ssh/README.md). TL;DR:

```bash
# у себя на компе
ssh-keygen -t ed25519 -f ~/.ssh/agent-stack
ssh-copy-id -i ~/.ssh/agent-stack.pub root@VPS_IP

# alias в ~/.ssh/config
Host agent-vps
    HostName VPS_IP
    User root
    IdentityFile ~/.ssh/agent-stack

# теперь
ssh agent-vps
```

После того как ключ работает — выключи парольный вход на VPS:
`PasswordAuthentication no` в `/etc/ssh/sshd_config` → `systemctl restart ssh`.

---

## Структура репо

```
agent-stack/
├── kimi-mcp-proxy/         # Express + MCP бэкенд, порт 3001
│   ├── src/                # server.js, agent-sessions.js, mcps.js, ...
│   ├── hooks/              # хуки безопасности (bash-guard)
│   ├── public/             # встроенный мини-UI
│   ├── .env.example        # ← шаблон, заполняешь и сохраняешь как .env
│   ├── Dockerfile
│   └── package.json
├── ai-chat-ui/             # Next.js фронт, порт 3002
│   ├── app/                # App Router страницы
│   ├── components/
│   ├── lib/
│   ├── middleware.ts       # basic-auth
│   ├── .env.local.example  # ← шаблон, заполняешь и сохраняешь как .env.local
│   └── package.json
├── deploy/
│   ├── install.sh          # one-shot установка на свежий VPS
│   ├── systemd/            # юниты для kimi-mcp-proxy и ai-chat-ui
│   ├── caddy/              # Caddyfile-snippet с HTTPS + reverse_proxy
│   └── ssh/                # инструкция по SSH-ключам
├── .gitignore              # секреты, ключи, чаты, бэкапы — в репо НЕ попадают
└── README.md               # ты здесь
```

---

## Безопасность ключей

Все секреты живут в `.env` / `.env.local` и **никогда** не попадают в репозиторий.
`.gitignore` ловит:

- `.env`, `.env.*`, `*.env*` (кроме `.env.example`, `.env.local.example`)
- `*.key`, `*.pem`, `id_rsa*`, `id_ed25519*`, `authorized_keys`
- `.tg_token`, `secrets.json`, `credentials.json`, `service-account*.json`
- история чатов: `agent-sessions.json*`, `chat-store/`, `kimi-chats/`
- состояние автоматизаций: `automations-runs.jsonl`,
  `automations-schedules.json`, `telegram-state.json`

Если случайно закоммитил секрет — **отзови ключ у провайдера** (новый секрет
важнее, чем чистая история git) и переиздай.

---

## Лицензия

MIT — см. [LICENSE](LICENSE).
