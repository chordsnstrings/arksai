#!/usr/bin/env bash
# Polled auto-deploy: if origin/main has new commits, pull and rebuild.
# Installed as a systemd timer by install-autodeploy.sh. Logs to journald.
#
# Retry-safe by design: success is recorded in .deployed-sha ONLY after a build
# that actually comes up. If a build fails, the marker is left untouched so the
# next tick retries the same SHA — a broken build can never strand the deploy on
# stale code (which is what a plain `HEAD == origin/main` short-circuit did,
# since `git reset --hard` runs before the build).
set -uo pipefail
cd /opt/arksai

git fetch origin main --quiet || exit 0
REMOTE=$(git rev-parse origin/main)

MARKER=/opt/arksai/.deployed-sha
DEPLOYED=$(cat "$MARKER" 2>/dev/null || echo none)
if [ "$REMOTE" = "$DEPLOYED" ]; then
  exit 0  # this SHA already built & deployed successfully
fi

echo "[autodeploy] deploying $REMOTE (last good: $DEPLOYED)…"
git reset --hard origin/main

# Pick whichever stack is currently running (tls if its container exists),
# else default to plain HTTP.
if docker ps --format '{{.Names}}' | grep -q '^arksai-caddy-1$'; then
  COMPOSE="docker-compose.tls.yml"
else
  COMPOSE="docker-compose.yml"
fi

if docker compose -f "$COMPOSE" up -d --build; then
  echo "$REMOTE" > "$MARKER"
  echo "[autodeploy] done ($COMPOSE) at $REMOTE."
else
  echo "[autodeploy] BUILD FAILED for $REMOTE — keeping marker at $DEPLOYED; will retry next tick." >&2
  exit 1
fi
