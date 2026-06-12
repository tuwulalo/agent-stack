# agent-stack

Self-hosted AI agent: an OpenAI-compatible proxy + chat frontend + orchestration
of sub-agents and automations. Spins up on a single VPS in 5 minutes.

Two parts inside:

- **`kimi-mcp-proxy/`** — Node/Express backend (port `3001`):
  OpenAI-compatible `/v1/chat/completions`, an MCP stdio server, sub-agent
  orchestration via the `claude` CLI, a Telegram bot, and an automations queue.
- **`ai-chat-ui/`** — Next.js frontend (port `3002`): a chat UI on top of the
  proxy, basic-auth via middleware, session history.

On top sits **Caddy** with automatic HTTPS for your domain.

---

## Quick start

```bash
# on a fresh Ubuntu/Debian VPS, as root
git clone https://github.com/<your-user>/agent-stack.git /opt/agent-stack
cd /opt/agent-stack
bash deploy/install.sh
nano kimi-mcp-proxy/.env       # set KIMI_API_KEY (or another provider)
nano ai-chat-ui/.env.local     # set AUTH_USER / AUTH_PASSWORD
systemctl enable --now kimi-mcp-proxy ai-chat-ui
```

Access:
- Local: `http://VPS_IP:3002` (frontend), `http://VPS_IP:3001/health` (proxy).
- Over a domain + HTTPS: see `deploy/caddy/Caddyfile.snippet`.

---

## Connecting to different LLM providers

The proxy is **OpenAI-compatible**, which means any provider with an
OpenAI-compatible API connects by swapping just three variables in `.env`:

| Provider | `KIMI_BASE_URL` | `KIMI_MODEL` (example) |
|---|---|---|
| Moonshot / **Kimi** | `https://api.moonshot.ai/v1` | `kimi-k2-0711-preview` |
| OpenAI / **GPT** | `https://api.openai.com/v1` | `gpt-4o` |
| Anthropic / **Claude** | `https://api.anthropic.com/v1` | `claude-5` |
| Google / **Gemini** / **Antigravity** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-pro` |
| **Cerebras** | `https://api.cerebras.ai/v1` | `llama-3.3-70b` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **OpenRouter** (everything at once) | `https://openrouter.ai/api/v1` | `anthropic/claude-opus-4` |
| **xAI / Grok** | `https://api.x.ai/v1` | `grok-4` |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-large-latest` |

All options are pre-filled as commented-out blocks in
[`kimi-mcp-proxy/.env.example`](kimi-mcp-proxy/.env.example) — uncomment the one
you need and leave the rest under `#`.

### Connecting an IDE/client to the proxy

The proxy exposes an OpenAI-compatible endpoint, so anything can connect to it:
**Antigravity**, **Cursor**, **Cline**, **Roo Code**, any OpenAI-SDK client.

```text
Base URL: https://your-domain.tld/_kp/v1
API Key:  the PROXY_API_KEY value from .env
Model:    same as KIMI_MODEL
```

`PROXY_API_KEY` is mandatory — otherwise anyone on the internet can burn your quota.

---

## OAuth login + desktop CLI

Besides basic-auth (login/password), there are two more convenient options:

### 1) Browser OAuth — GitHub / Google

Register an app in one of the consoles (or both):

- **GitHub:** https://github.com/settings/developers → "New OAuth App".
  Callback URL: `https://your-domain.tld/api/auth/oauth/github/callback`
- **Google:** https://console.cloud.google.com/apis/credentials → OAuth client.
  Redirect URI: `https://your-domain.tld/api/auth/oauth/google/callback`

Put `OAUTH_*_CLIENT_ID/SECRET` into `ai-chat-ui/.env.local`. **Be sure** to set
`ALLOWED_EMAILS=you@email.com` — otherwise anyone with a GitHub account gets
access. Restart `ai-chat-ui`. Buttons will appear on `/login`.

### 2) Desktop CLI — auth via Device Flow

On your machine:

```bash
# one-time install
npm install -g /path/to/agent-stack/cli

# login
agent-stack login --server https://your-domain.tld
```

The CLI prints a short code and a URL; you open it in the browser, log in
(GitHub/Google/password — whatever you configured), and enter the code. The CLI
receives a long-lived JWT token (90 days) and saves it to
`~/.config/agent-stack/token.json` with `600` permissions.

After that, any OpenAI-compatible tool sees your VPS as OpenAI:

```bash
eval "$(agent-stack env)"
# OPENAI_BASE_URL=https://your-domain.tld/_kp/v1
# OPENAI_API_KEY=<your JWT>
```

In **Cursor / Cline / Antigravity / Roo Code**:

```
Base URL: https://your-domain.tld/_kp/v1
API Key:  the token from ~/.config/agent-stack/token.json
Model:    same as KIMI_MODEL on the server
```

**Revoking access:** change `JWT_SECRET` in `kimi-mcp-proxy/.env` →
`systemctl restart kimi-mcp-proxy` — all previously issued device tokens become
invalid instantly.

More: [`cli/README.md`](cli/README.md).

---

## SSH access to the VPS

Full guide: [`deploy/ssh/README.md`](deploy/ssh/README.md). TL;DR:

```bash
# on your machine
ssh-keygen -t ed25519 -f ~/.ssh/agent-stack
ssh-copy-id -i ~/.ssh/agent-stack.pub root@VPS_IP

# alias in ~/.ssh/config
Host agent-vps
    HostName VPS_IP
    User root
    IdentityFile ~/.ssh/agent-stack

# now
ssh agent-vps
```

Once the key works — disable password login on the VPS:
`PasswordAuthentication no` in `/etc/ssh/sshd_config` → `systemctl restart ssh`.

---

## Repo structure

```
agent-stack/
├── kimi-mcp-proxy/         # Express + MCP backend, port 3001
│   ├── src/                # server.js, agent-sessions.js, mcps.js, ...
│   ├── hooks/              # security hooks (bash-guard)
│   ├── public/             # built-in mini UI
│   ├── .env.example        # <- template; fill in and save as .env
│   ├── Dockerfile
│   └── package.json
├── ai-chat-ui/             # Next.js frontend, port 3002
│   ├── app/                # App Router pages
│   ├── components/
│   ├── lib/
│   ├── middleware.ts       # basic-auth
│   ├── .env.local.example  # <- template; fill in and save as .env.local
│   └── package.json
├── cli/                    # desktop CLI (OAuth Device Flow)
│   ├── agent-stack.mjs     # the binary itself
│   └── README.md
├── deploy/
│   ├── install.sh          # one-shot install on a fresh VPS
│   ├── systemd/            # units for kimi-mcp-proxy and ai-chat-ui
│   ├── caddy/              # Caddyfile snippet with HTTPS + reverse_proxy
│   └── ssh/                # SSH key instructions
├── .gitignore              # secrets, keys, chats, backups stay OUT of the repo
└── README.md               # you are here
```

---

## Key & secret hygiene

All secrets live in `.env` / `.env.local` and **never** land in the repository.
`.gitignore` catches:

- `.env`, `.env.*`, `*.env*` (except `.env.example`, `.env.local.example`)
- `*.key`, `*.pem`, `id_rsa*`, `id_ed25519*`, `authorized_keys`
- `.tg_token`, `secrets.json`, `credentials.json`, `service-account*.json`
- chat history: `agent-sessions.json*`, `chat-store/`, `kimi-chats/`
- automation state: `automations-runs.jsonl`, `automations-schedules.json`,
  `telegram-state.json`

If you accidentally commit a secret — **revoke the key at the provider** (a fresh
secret matters more than a clean git history) and re-issue it.

---

## License

MIT — see [LICENSE](LICENSE).
