# agent-stack CLI

A desktop client. Log in once via OAuth Device Flow, get a long-lived token in
`~/.config/agent-stack/token.json`, and any OpenAI-compatible tool (Cursor,
Cline, Antigravity, the official `openai` SDK) can then reach your VPS as a
regular OpenAI endpoint.

## Install

Needs Node 18+. Install globally with npm:

```bash
cd cli
npm install -g .
```

Or run it directly without installing:

```bash
node /path/to/agent-stack/cli/agent-stack.mjs login --server https://your-domain.tld
```

## First login

```bash
agent-stack login --server https://your-domain.tld
```

The CLI prints something like:

```
  ┌────────────────────────────────────────────────┐
  │  Code:   XQHM-7TPL                              │
  │  URL:    https://your-domain.tld/cli           │
  └────────────────────────────────────────────────┘

Open the URL, sign in (GitHub/Google/password), and enter the code.
Waiting for confirmation...
```

Open the URL in a browser, sign in (GitHub / Google / username-password), and
enter the short code. The CLI receives a token and saves it to
`~/.config/agent-stack/token.json` (chmod 600).

## Usage

```bash
agent-stack whoami           # current server + masked token
agent-stack logout           # delete the local token

agent-stack curl /v1/models  # quick request through the proxy
agent-stack curl /v1/chat/completions -X POST -H "Content-Type: application/json" \
    -d '{"model":"kimi-k2-0711-preview","messages":[{"role":"user","content":"Hello"}]}'

# Expose your VPS as OpenAI for any SDK:
eval "$(agent-stack env)"
# now openai.chat.completions.create(...) works
```

## IDE setup

Cursor, Cline, Antigravity, Roo Code — same format everywhere:

```
Base URL:  https://your-domain.tld/_kp/v1
API Key:   <from agent-stack whoami or the config file>
Model:     kimi-k2-0711-preview   (or whatever KIMI_MODEL is on the server)
```

## Security

- The token is a JWT signed with `JWT_SECRET` (kept on the VPS), HS256, valid 90 days.
- On the VPS it's validated in the Express `requiresAuth` middleware; the payload must have `kind: 'device'`.
- The local file is mode 600, not readable by other users on the machine.
- Lost a machine? Change `JWT_SECRET` in `.env` and run `systemctl restart kimi-mcp-proxy`. Every issued token is invalidated at once.
