#!/usr/bin/env bash
# ArksAI one-command redeploy. Run on the server from /opt/arksai:
#   ./deploy.sh           # plain HTTP (port 80) — default
#   ./deploy.sh tls       # HTTPS via Caddy (needs SITE_ADDRESS/CADDY_TLS in .env)
#
# Hard-resets the checkout to origin/main (discards local changes), rebuilds,
# and brings up exactly one stack. The arksai-data volume (sessions/commands)
# and Postgres are untouched, so data persists across deploys.
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-http}"
PLAIN="docker-compose.yml"
TLS="docker-compose.tls.yml"

echo "==> Fetching latest main..."
git fetch origin main
git reset --hard origin/main

# Stop BOTH stacks so there's never a port 80/443 conflict between them.
echo "==> Stopping any running stack..."
docker compose -f "$PLAIN" down --remove-orphans 2>/dev/null || true
docker compose -f "$TLS" down --remove-orphans 2>/dev/null || true

if [ "$MODE" = "tls" ]; then
  COMPOSE="$TLS"
  echo "==> Deploying TLS stack (Caddy)..."
else
  COMPOSE="$PLAIN"
  echo "==> Deploying plain-HTTP stack (port 80)..."
fi

echo "==> Building & starting..."
docker compose -f "$COMPOSE" up -d --build

echo "==> Waiting for health..."
ok=""
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE" exec -T arksai node -e \
      "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=1; break
  fi
  sleep 2
done

echo
docker compose -f "$COMPOSE" ps
echo
if [ -n "$ok" ]; then
  if [ "$MODE" = "tls" ]; then
    echo "✓ Up. Open https://<your-host> (accept the cert warning if self-signed)."
  else
    echo "✓ Up. Open http://<your-host>"
  fi
else
  echo "✗ App did not report healthy in time. Check: docker compose -f $COMPOSE logs --tail=50"
  exit 1
fi
