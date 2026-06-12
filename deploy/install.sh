#!/usr/bin/env bash
# =====================================================================
#  agent-stack — install on a clean Ubuntu/Debian VPS
#  Run as root: bash deploy/install.sh
# =====================================================================
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/agent-stack}"

echo "[1/6] apt update + base packages"
apt update
apt install -y curl ca-certificates gnupg git ufw openssl

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

echo "[6/6] .env — copy templates and generate real secrets"
PROXY_ENV="$STACK_DIR/kimi-mcp-proxy/.env"
UI_ENV="$STACK_DIR/ai-chat-ui/.env.local"
UI_PASSWORD=""

if [ ! -f "$PROXY_ENV" ]; then
  cp "$STACK_DIR/kimi-mcp-proxy/.env.example" "$PROXY_ENV"
  chmod 600 "$PROXY_ENV"
  sed -i "s|^PROXY_API_KEY=.*|PROXY_API_KEY=$(openssl rand -hex 32)|" "$PROXY_ENV"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" "$PROXY_ENV"
  echo "  generated PROXY_API_KEY and JWT_SECRET; still fill in KIMI_API_KEY"
fi

if [ ! -f "$UI_ENV" ]; then
  cp "$STACK_DIR/ai-chat-ui/.env.local.example" "$UI_ENV"
  chmod 600 "$UI_ENV"
  UI_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  sed -i "s|^AUTH_PASSWORD=.*|AUTH_PASSWORD=$UI_PASSWORD|" "$UI_ENV"
  sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" "$UI_ENV"
  # The UI calls the proxy's device-approve endpoint with the same shared key.
  PROXY_KEY="$(grep -E '^PROXY_API_KEY=' "$PROXY_ENV" | cut -d= -f2-)"
  sed -i "s|^PROXY_API_KEY=.*|PROXY_API_KEY=$PROXY_KEY|" "$UI_ENV"
fi

cat <<'DONE'

============================================================
 Install complete.
============================================================
 Next:
   1) nano /opt/agent-stack/kimi-mcp-proxy/.env        # provider key (KIMI_API_KEY)
   2) nano /opt/agent-stack/ai-chat-ui/.env.local      # check AUTH_USER, OAuth (optional)
   3) systemctl enable --now kimi-mcp-proxy ai-chat-ui
   4) Add your domain to /etc/caddy/Caddyfile,
      see /opt/agent-stack/deploy/caddy/Caddyfile.snippet
   5) systemctl reload caddy
   6) SSH keys: /opt/agent-stack/deploy/ssh/README.md
============================================================
DONE

if [ -n "$UI_PASSWORD" ]; then
  echo " UI login: admin / $UI_PASSWORD"
  echo " (stored in $UI_ENV — change anytime)"
  echo "============================================================"
fi
