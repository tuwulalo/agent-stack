#!/usr/bin/env bash
# =====================================================================
#  Пушит репо на GitHub. Запустить ОДИН раз после первого коммита.
#  Если не залогинен в gh — спросит токен/откроет браузер.
# =====================================================================
set -euo pipefail

REPO_NAME="${REPO_NAME:-agent-stack}"
VISIBILITY="${VISIBILITY:-private}"   # private | public
DESCRIPTION="${DESCRIPTION:-Self-hosted AI agent: OpenAI-compatible proxy + chat UI + deploy scripts}"

cd "$(dirname "$0")/.."

if ! command -v gh >/dev/null 2>&1; then
  echo "→ ставлю gh CLI"
  apt update && apt install -y gh
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "→ авторизация в GitHub (откроется браузер либо попросит токен)"
  gh auth login
fi

if [ ! -d .git ]; then
  git init -q
  git add -A
  git commit -q -m "init: agent-stack"
fi

# Текущая ветка → main
git branch -M main 2>/dev/null || true

echo "→ создаю репо $REPO_NAME ($VISIBILITY) и пушу"
gh repo create "$REPO_NAME" \
  --"$VISIBILITY" \
  --source=. \
  --remote=origin \
  --description="$DESCRIPTION" \
  --push

echo
echo "✅ Готово. URL:"
gh repo view --json url -q .url
