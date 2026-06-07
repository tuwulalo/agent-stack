#!/usr/bin/env bash
# =====================================================================
#  agent-stack — install on a clean Ubuntu/Debian VPS
#  Run as root: bash deploy/install.sh
# =====================================================================
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/agent-stack}"

echo "[1/6] apt update + base packages"
apt update
apt install -y curl ca-certificates gnupg git ufw

echo "[2/6] Node.js 20.x"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
node -v && npm -v

echo "[3/6] Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update && apt install -y caddy
fi

echo "[4/6] npm install for both apps"
cd "$STACK_DIR/kimi-mcp-proxy" && npm install --omit=dev
cd "$STACK_DIR/ai-chat-ui" && npm install && npm run build

echo "[5/6] systemd units"
cp "$STACK_DIR/deploy/systemd/kimi-mcp-proxy.service" /etc/systemd/system/
cp "$STACK_DIR/deploy/systemd/ai-chat-ui.service" /etc/systemd/system/
systemctl daemon-reload

echo "[6/6] .env"
if [ ! -f "$STACK_DIR/kimi-mcp-proxy/.env" ]; then
  cp "$STACK_DIR/kimi-mcp-proxy/.env.example" "$STACK_DIR/kimi-mcp-proxy/.env"
  echo "  warning: fill in /opt/agent-stack/kimi-mcp-proxy/.env (KIMI_API_KEY etc.)"
fi
if [ ! -f "$STACK_DIR/ai-chat-ui/.env.local" ]; then
  cp "$STACK_DIR/ai-chat-ui/.env.local.example" "$STACK_DIR/ai-chat-ui/.env.local"
  echo "  warning: fill in /opt/agent-stack/ai-chat-ui/.env.local (AUTH_USER/PASSWORD)"
fi

cat <<'DONE'

============================================================
 Install complete.
============================================================
 Next:
   1) nano /opt/agent-stack/kimi-mcp-proxy/.env        # provider key
   2) nano /opt/agent-stack/ai-chat-ui/.env.local      # UI login/password
   3) systemctl enable --now kimi-mcp-proxy ai-chat-ui
   4) Add your domain to /etc/caddy/Caddyfile,
      see /opt/agent-stack/deploy/caddy/Caddyfile.snippet
   5) systemctl reload caddy
   6) SSH keys: /opt/agent-stack/deploy/ssh/README.md
============================================================
DONE
