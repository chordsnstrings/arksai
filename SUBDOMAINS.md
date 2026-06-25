# Clean per-app subdomains (`<slug>.apps.arksai.studio`)

Published apps always work at the **path URL** `https://arksai.studio/apps/<slug>/`. To also serve
them at a clean **subdomain** `https://<slug>.apps.arksai.studio/`, the code + Caddy are already
done — the only missing piece is **DNS**, which lives in the DNS zone (the
`marketing.gicbd@gmail.com` DO account, not the compute account).

## What's already in place (no code change needed)
- **Routing:** `server/src/routes/deployments.ts` matches `^([a-z0-9-]+)\.apps\.arksai\.studio$`
  and serves that deployment at root; `/internal/tls-check` authorizes a cert only for a host that
  maps to a real deployment.
- **TLS / proxy:** `Caddyfile` has a global `on_demand_tls { ask … /internal/tls-check }` and a
  `*.apps.arksai.studio { tls { on_demand } reverse_proxy arksai:3000 }` block; `caddy-data`
  persists the issued certs (`docker-compose.tls.yml`).

## The fix (operator — needs droplet + DNS access)
1. **Add wildcard DNS** in the zone that holds `arksai.studio` (the `marketing.gicbd@gmail.com`
   account → Networking → Domains → arksai.studio):
   - Type `A`, Hostname `*.apps`, Value `159.89.172.210` (the droplet), TTL 3600.
2. **Verify it resolves** (give DNS a few minutes):
   ```
   dig +short gic-global.apps.arksai.studio        # → 159.89.172.210
   ```
3. **Confirm TLS + serving** (Caddy issues the cert on first hit):
   ```
   curl -I https://gic-global.apps.arksai.studio/  # → HTTP/2 200
   ```
   (Use any currently-published slug. If you get a TLS error, check the Caddy logs:
   `docker compose -f docker-compose.tls.yml logs caddy | tail -50`.)
4. **Advertise the clean URL** so the agent hands it out instead of the path: in
   `/opt/arksai/.env` set `APPS_SUBDOMAIN_BASE=apps.arksai.studio`, then `./deploy.sh tls`
   (or wait for the auto-deploy). Until this is set, apps keep using the always-working path URL.

## STATUS (2026-06-25) — verified, still not serving → it's Caddy cert issuance
Checked everything reachable; all green EXCEPT the final TLS handshake:
- **DNS ✓** — `A *.apps.arksai.studio → 159.89.172.210` exists in the zone (DO account
  `marketing.gicbd@gmail.com`, "My Team"). Droplet IP confirmed `159.89.172.210`.
- **On-demand-TLS gate ✓** — `GET https://arksai.studio/internal/tls-check?domain=gic-global.apps.arksai.studio`
  → `ok` (200); a bogus host → `no` (404). So Caddy is AUTHORIZED to mint the cert.
- **Deployment ✓** — `https://arksai.studio/apps/gic-global/` → 200 (live).
- **Still:** `https://gic-global.apps.arksai.studio/` won't load for the user. Since DNS + gate +
  app are fine, the remaining suspect is **Caddy failing to ISSUE the on-demand cert** on the
  droplet (Let's Encrypt rate-limit / challenge failure, or the Caddy container running a stale
  config that never got the `*.apps` block reloaded).

### NEXT STEP when you return (needs droplet shell — the sandbox can't reach it)
```
docker compose -f /opt/arksai/docker-compose.tls.yml logs caddy | grep -i "apps.arksai\|on_demand\|obtain\|error\|rate" | tail -60
docker compose -f /opt/arksai/docker-compose.tls.yml exec caddy caddy validate --config /etc/caddy/Caddyfile   # confirm the *.apps block is actually loaded
```
Paste that log to me and I'll pinpoint it. If it's a stale Caddy config: `cd /opt/arksai && ./deploy.sh tls`
(recreates Caddy with the current Caddyfile). Once it serves, set `APPS_SUBDOMAIN_BASE=apps.arksai.studio`
in `/opt/arksai/.env` so the clean URL is advertised.

## Most likely original cause

