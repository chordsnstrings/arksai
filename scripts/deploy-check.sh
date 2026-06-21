#!/usr/bin/env bash
# ArksAI — comprehensive LIVE-deployment health check (read-only; makes NO changes).
#
# WHY THIS EXISTS: the in-repo audits run the built code on a LOCAL server, which never
# exercises the deployed environment (TLS/Caddy, the public /apps/<slug>/ serving, the Canvas
# preview proxy). This script checks the REAL deployment end-to-end — exactly the paths a local
# audit can't reach (e.g. "publish works but the Canvas won't load the published app").
#
# RUN IT ON THE DROPLET (best — it then also checks containers + the capability log + reads
# APP_PASSWORD itself):
#     bash /opt/arksai/scripts/deploy-check.sh
# Or from anywhere that can reach the site:
#     BASE=https://arksai.studio APP_PASSWORD=... bash scripts/deploy-check.sh
#
# Deps: curl + standard coreutils only (no node/python needed).
set -uo pipefail

BASE="${BASE:-https://arksai.studio}"
APP_DIR="${APP_DIR:-/opt/arksai}"
COMPOSE="${COMPOSE:-docker-compose.tls.yml}"
PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $*"; FAIL=$((FAIL+1)); }
warn() { echo "  ! $*"; WARN=$((WARN+1)); }
hdr()  { echo; echo "=== $* ==="; }
CURL="curl -sS --max-time 25"

# APP_PASSWORD: from env, else read it from the Droplet's .env (when run on the box).
PW="${APP_PASSWORD:-}"
if [ -z "$PW" ] && [ -f "$APP_DIR/.env" ]; then
  PW="$(grep -E '^APP_PASSWORD=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
fi

echo "ArksAI deployment check — $(date -u '+%Y-%m-%d %H:%M:%SZ')"
echo "target: $BASE"

# ---------------------------------------------------------------------------
hdr "1. Infrastructure (containers, capabilities, resources)"
if command -v docker >/dev/null 2>&1 && [ -f "$APP_DIR/$COMPOSE" ]; then
  PS="$(cd "$APP_DIR" && docker compose -f "$COMPOSE" ps --format '{{.Name}} {{.State}}' 2>/dev/null)"
  echo "$PS" | grep -qiE 'arksai-arksai-1.*(running|up)'  && ok "app container running"       || bad "app container NOT running"
  echo "$PS" | grep -qiE 'arksai-caddy-1.*(running|up)'   && ok "caddy (TLS) container running" || bad "caddy container NOT running — HTTPS/site will be down"
  CAP="$(cd "$APP_DIR" && docker compose -f "$COMPOSE" logs --tail=400 arksai 2>/dev/null | grep -i 'capabilities' | tail -1)"
  if echo "$CAP" | grep -qi 'image generation.*enabled'; then ok "MiniMax (image gen + vision + M3) enabled"
  elif [ -n "$CAP" ];                                    then bad "MiniMax DISABLED — set MINIMAX_API_KEY in $APP_DIR/.env  [$CAP]"
  else                                                        warn "no capability log line found (older build, or logs rotated)"; fi
  df -h /  2>/dev/null | awk 'NR==2{printf "  · disk /: %s used, %s free\n",$5,$4}'
  free -m  2>/dev/null | awk 'NR==2{printf "  · mem: %sMB used / %sMB total\n",$3,$2}'
else
  warn "not on the Droplet (no docker/$COMPOSE) — skipping container/capability/resource checks"
fi

# ---------------------------------------------------------------------------
hdr "2. TLS + reachability + health"
HC="$($CURL -o /dev/null -w '%{http_code}' "$BASE/healthz" 2>/dev/null || echo 000)"
[ "$HC" = "200" ] && ok "GET /healthz → 200" || bad "GET /healthz → $HC"
if [[ "$BASE" == https://* ]]; then
  if $CURL -I "$BASE/healthz" >/dev/null 2>&1; then ok "TLS handshake OK"; else bad "TLS handshake FAILED — Caddy/cert issue"; fi
fi
# the SPA shell should serve (catch a broken static-asset mount)
SC="$($CURL -o /dev/null -w '%{http_code}' "$BASE/" 2>/dev/null || echo 000)"
[ "$SC" = "200" ] && ok "GET / (app shell) → 200" || bad "GET / → $SC"

# ---------------------------------------------------------------------------
hdr "3. Auth + DB"
CJ="$(mktemp)"; trap 'rm -f "$CJ"' EXIT
AUTHED=0
if [ -n "$PW" ]; then
  ESC_PW="$(printf '%s' "$PW" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  LC="$($CURL -o /dev/null -w '%{http_code}' -c "$CJ" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' --data "{\"password\":\"$ESC_PW\"}" 2>/dev/null || echo 000)"
  if [ "$LC" = "200" ]; then ok "operator login → 200"; AUTHED=1; else bad "operator login → $LC (APP_PASSWORD wrong / app down)"; fi
  if [ "$AUTHED" = 1 ]; then
    ME="$($CURL -b "$CJ" "$BASE/api/auth/me" 2>/dev/null)"
    echo "$ME" | grep -q '"isSuperadmin":true' && ok "/api/auth/me → operator identity" || warn "/api/auth/me unexpected: ${ME:0:120}"
    SLIST="$($CURL -b "$CJ" "$BASE/api/sessions" 2>/dev/null)"
    NSESS="$(printf '%s' "$SLIST" | grep -oE '"id":"' | wc -l | tr -d ' ')"
    if printf '%s' "$SLIST" | grep -q '\['; then ok "DB OK — /api/sessions returned ~$NSESS sessions"; else bad "DB/sessions query failed: ${SLIST:0:120}"; fi
  fi
else
  warn "no APP_PASSWORD — skipping auth/DB + publish checks (run on the Droplet, or pass APP_PASSWORD=…)"
fi

# ---------------------------------------------------------------------------
hdr "4. Publish + serve path  (the part local audits never reach)"
if [ "$AUTHED" = 1 ]; then
  DEPS="$($CURL -b "$CJ" "$BASE/api/deployments" 2>/dev/null)"
  # first slug (any status) — we test whatever exists and report its real state
  SLUG="$(printf '%s' "$DEPS" | grep -oE '"slug":"[^"]+"' | head -1 | cut -d'"' -f4)"
  if [ -z "$SLUG" ]; then
    warn "no deployments exist yet — publish one app, then re-run to test the serve/iframe path"
  else
    APPURL="$BASE/apps/$SLUG/"
    echo "  testing published app: /apps/$SLUG/"
    AC="$($CURL -o /dev/null -w '%{http_code}' "$APPURL" 2>/dev/null || echo 000)"
    [ "$AC" = "200" ] && ok "GET /apps/$SLUG/ → 200" || bad "GET /apps/$SLUG/ → $AC (publish serving broken)"
    HTML="$($CURL "$APPURL" 2>/dev/null)"
    CT="$($CURL -I "$APPURL" 2>/dev/null | grep -i '^content-type:' | tr -d '\r' | head -1)"
    echo "$CT" | grep -qi 'text/html' && ok "served as HTML ($CT)" || warn "unexpected content-type: $CT"
    echo "$HTML" | grep -qi '<base href' && ok "<base href> injected (relative assets resolve under /apps/$SLUG/)" \
                                          || warn "no <base href> in served HTML — relative assets may 404 in the Canvas"
    # iframe-blocking headers (Canvas loads apps in an iframe)
    IH="$($CURL -I "$APPURL" 2>/dev/null)"
    if echo "$IH" | grep -qiE '^x-frame-options:\s*(deny|sameorigin)'; then warn "X-Frame-Options blocks cross-origin framing — check the Canvas still frames it"; else ok "no blocking X-Frame-Options"; fi
    echo "$IH" | grep -qi '^content-security-policy:.*frame-ancestors' && warn "CSP frame-ancestors set — verify it allows the app origin" || ok "no blocking CSP frame-ancestors"
    # an actual asset must load (a 404/HTML-error here = blank/broken app in the Canvas)
    ASSET="$(printf '%s' "$HTML" | grep -oiE '(src|href)="[^"]+\.(js|css)"' | head -1 | sed -E 's/.*="([^"]+)".*/\1/')"
    if [ -n "$ASSET" ]; then
      case "$ASSET" in
        http*)  AU="$ASSET" ;;
        /*)     AU="$BASE$ASSET" ;;
        *)      AU="${APPURL}${ASSET}" ;;
      esac
      ASC="$($CURL -o /dev/null -w '%{http_code}' "$AU" 2>/dev/null || echo 000)"
      ASCT="$($CURL -I "$AU" 2>/dev/null | grep -i '^content-type:' | tr -d '\r' | head -1)"
      if [ "$ASC" = "200" ] && ! echo "$ASCT" | grep -qi 'text/html'; then ok "asset loads: $ASSET → 200 ($ASCT)"
      else bad "asset $ASSET → $ASC $ASCT — the Canvas would render blank/broken"; fi
      case "$AU" in http://*) [[ "$BASE" == https://* ]] && bad "asset served over http:// on an HTTPS site → MIXED CONTENT (the browser blocks it in the iframe) — THIS is a common 'Canvas won't load the app' cause" ;; esac
    else
      warn "no js/css asset reference found in the served HTML to test"
    fi
    echo "  deployment statuses on record:"
    printf '%s' "$DEPS" | grep -oE '"slug":"[^"]+"|"status":"[^"]+"' | paste - - 2>/dev/null | sed 's/^/    /' | head -12
  fi
fi

# ---------------------------------------------------------------------------
hdr "5. Public input boundary (unauthenticated)"
LEADC="$($CURL -o /dev/null -w '%{http_code}' -X POST "$BASE/api/leads" -H 'content-type: application/json' --data '{}' 2>/dev/null || echo 000)"
[ "$LEADC" = "400" ] && ok "POST /api/leads {} → 400 (validates, doesn't crash)" || warn "POST /api/leads {} → $LEADC (expected 400)"
BADJSON="$($CURL -o /dev/null -w '%{http_code}' -X POST "$BASE/api/leads" -H 'content-type: application/json' --data '{bad json,,,' 2>/dev/null || echo 000)"
[ "$BADJSON" = "400" ] && ok "malformed JSON → 400 (never 500)" || warn "malformed JSON → $BADJSON (expected 400)"

# ---------------------------------------------------------------------------
hdr "Summary"
echo "  PASS=$PASS   WARN=$WARN   FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then echo "  ✗ deployment has FAILURES — see the ✗ lines above"; exit 1; fi
if [ "$WARN" -gt 0 ]; then echo "  ! deployment OK with warnings — review the ! lines"; exit 0; fi
echo "  ✓ deployment healthy"
