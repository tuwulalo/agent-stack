# Kimi MCP Proxy

OpenAI-compatible прокси и MCP stdio-сервер для Kimi API. Подходит для Roo Code, OpenClowe/OpenAI-compatible клиентов и MCP-клиентов.

## Что внутри

- **Web UI:** `http://SERVER:3000`
- **Healthcheck:** `GET /health`
- **OpenAI-compatible models:** `GET /v1/models`
- **OpenAI-compatible chat:** `POST /v1/chat/completions`
- **MCP stdio server:** `npm run mcp`

## Безопасность

Ключ Kimi и пароль VPS, которые были отправлены в чат, нужно считать скомпрометированными.

- **Перевыпусти Kimi API key** в кабинете Kimi/Moonshot.
- **Смени root-пароль VPS** и лучше включи вход по SSH-ключу.
- **Не коммить `.env`** и не вставляй секреты в код.
- **Задай `PROXY_API_KEY`**, чтобы чужие люди не могли пользоваться твоим Kimi API через VPS.

## Локальный запуск

```bash
cp .env.example .env
npm install
npm start
```

Открой:

```text
http://localhost:3000
```

## `.env`

```env
PORT=3000
HOST=0.0.0.0
KIMI_API_KEY=your_rotated_kimi_key
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=kimi-k2-0711-preview
PROXY_API_KEY=your_private_proxy_key
REQUEST_TIMEOUT_MS=120000
MAX_REQUEST_BYTES=1048576
```

## Подключение в Roo Code как OpenAI-compatible API

В настройках Roo Code выбери OpenAI-compatible провайдера:

```text
Base URL: http://85.93.9.243:3000/v1
API Key: значение PROXY_API_KEY из .env
Model: kimi-k2-0711-preview
```

Если поставишь домен и HTTPS через Nginx/Caddy, используй:

```text
Base URL: https://your-domain.com/v1
```

## Проверка через curl

```bash
curl http://85.93.9.243:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k2-0711-preview","messages":[{"role":"user","content":"Привет"}]}'
```

## MCP stdio config

Для MCP-клиента, который запускает сервер локально/на машине клиента:

```json
{
  "mcpServers": {
    "kimi": {
      "command": "node",
      "args": ["/absolute/path/to/kimi-mcp-proxy/src/mcp-server.js"],
      "env": {
        "KIMI_API_KEY": "your_rotated_kimi_key",
        "KIMI_BASE_URL": "https://api.moonshot.ai/v1",
        "KIMI_MODEL": "kimi-k2-0711-preview"
      }
    }
  }
}
```

## Деплой на VPS через systemd

На VPS установи Node.js 20+ и скопируй проект в `/opt/kimi-mcp-proxy`.

```bash
apt update
apt install -y nodejs npm
mkdir -p /opt/kimi-mcp-proxy
```

В папке проекта на VPS:

```bash
npm install --omit=dev
cp .env.example .env
nano .env
```

Создай сервис:

```bash
cat >/etc/systemd/system/kimi-mcp-proxy.service <<'EOF'
[Unit]
Description=Kimi MCP Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kimi-mcp-proxy
EnvironmentFile=/opt/kimi-mcp-proxy/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

Запусти:

```bash
systemctl daemon-reload
systemctl enable --now kimi-mcp-proxy
systemctl status kimi-mcp-proxy
```

## Nginx HTTPS вариант

Рекомендуется закрыть порт `3000` firewall-ом и отдавать наружу только HTTPS через Nginx/Caddy. Для Nginx upstream будет `http://127.0.0.1:3000`.
