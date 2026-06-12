#!/usr/bin/env bash
# Polled auto-deploy: if origin/main has new commits, pull and rebuild.
# Installed as a systemd timer by install-autodeploy.sh. Logs to journald.
set -euo pipefail
cd /opt/arksai

git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0  # already up to date
fi

echo "[autodeploy] $LOCAL -> $REMOTE; deploying…"
git reset --hard origin/main

# Pick whichever stack is currently running (tls if its container exists),
# else default to plain HTTP.
if docker ps --format '{{.Names}}' | grep -q '^arksai-caddy-1$'; then
  COMPOSE="docker-compose.tls.yml"
else
  COMPOSE="docker-compose.yml"
fi

docker compose -f "$COMPOSE" up -d --build
echo "[autodeploy] done ($COMPOSE)."
