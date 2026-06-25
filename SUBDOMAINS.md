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

## Most likely current cause
The symptom was "won't load at all" (not a cert warning, not a 404) — that's a **DNS miss**: the
`*.apps.arksai.studio` record either was never added to the zone or doesn't point at the droplet.
Step 1 is almost certainly the whole fix.
