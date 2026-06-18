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

# Delegate to deploy.sh (auto mode): it hard-resets to origin/main, picks TLS vs plain
# from SITE_ADDRESS in .env (the SOURCE OF TRUTH), stops BOTH stacks to avoid a port
# 80/443 conflict, rebuilds, and health-checks (non-zero exit on failure).
# This replaces the old "pick the stack based on whether the Caddy container is running"
# heuristic, which silently DOWNGRADED a TLS site to plain HTTP the moment Caddy was
# stopped (e.g. a manual `docker compose down --remove-orphans`) and then never recovered.
if ./deploy.sh; then
  echo "$REMOTE" > "$MARKER"
  echo "[autodeploy] done at $REMOTE."
else
  echo "[autodeploy] DEPLOY FAILED for $REMOTE — keeping marker at $DEPLOYED; will retry next tick." >&2
  exit 1
fi
