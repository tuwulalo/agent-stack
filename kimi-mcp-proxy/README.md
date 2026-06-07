# Kimi MCP Proxy

An OpenAI-compatible proxy and MCP stdio server for the Kimi API. Works with Roo
Code, any OpenAI-compatible client, and MCP clients.

## What's inside

- Web UI: `http://SERVER:3000`
- Health check: `GET /health`
- Models: `GET /v1/models`
- Chat: `POST /v1/chat/completions`
- MCP stdio server: `npm run mcp`

## Security

- Set `PROXY_API_KEY` so nobody else can spend your provider quota through the VPS.
- Keep secrets in `.env`, never in the code, and never commit `.env`.
- Prefer SSH key login over passwords (see `deploy/ssh/README.md`).
- If a key leaks, rotate it at the provider and restart the service.

## Run locally

```bash
cp .env.example .env
npm install
npm start
# open http://localhost:3000
```

## Minimal `.env`

```env
PORT=3000
HOST=0.0.0.0
KIMI_API_KEY=your_key
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=kimi-k2-0711-preview
PROXY_API_KEY=your_private_proxy_key
REQUEST_TIMEOUT_MS=120000
MAX_REQUEST_BYTES=1048576
```

## Use it in Roo Code (OpenAI-compatible)

```text
Base URL: http://YOUR_VPS_IP:3000/v1
API Key:  the PROXY_API_KEY from .env
Model:    kimi-k2-0711-preview
```

Behind a domain with HTTPS (Nginx/Caddy):

```text
Base URL: https://your-domain.com/v1
```

## Check it with curl

```bash
curl http://YOUR_VPS_IP:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k2-0711-preview","messages":[{"role":"user","content":"Hello"}]}'
```

## MCP stdio config

For an MCP client that launches the server locally:

```json
{
  "mcpServers": {
    "kimi": {
      "command": "node",
      "args": ["/absolute/path/to/kimi-mcp-proxy/src/mcp-server.js"],
      "env": {
        "KIMI_API_KEY": "your_key",
        "KIMI_BASE_URL": "https://api.moonshot.ai/v1",
        "KIMI_MODEL": "kimi-k2-0711-preview"
      }
    }
  }
}
```

## Deploy on a VPS with systemd

Install Node.js 20+ and copy the project to `/opt/kimi-mcp-proxy`.

```bash
apt update
apt install -y nodejs npm
mkdir -p /opt/kimi-mcp-proxy
```

In the project folder on the VPS:

```bash
npm install --omit=dev
cp .env.example .env
nano .env
```

Create the service:

```bash
cat >/etc/systemd/system/kimi-mcp-proxy.service <<'UNIT'
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
UNIT
```

Start it:

```bash
systemctl daemon-reload
systemctl enable --now kimi-mcp-proxy
systemctl status kimi-mcp-proxy
```

## HTTPS

Close port `3000` in the firewall and expose only HTTPS through Nginx or Caddy.
For Nginx, the upstream is `http://127.0.0.1:3000`.
