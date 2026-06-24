import type { FastifyInstance, FastifyRequest } from 'fastify';
import { scopeOf } from '../auth';
import { DEFAULT_ORG_ID, getOrg, roleInOrg } from '../orgs/store';
import { getRate, setRate } from '../lib/fx';
import { creditOrg, ledger, microsToUsd, usdToMicros, walletBalanceMicros } from '../wallet/store';
import { availableProviders } from '../payments/provider';
import { config } from '../config';
import { convertFromUsd, currencyOf, formatMoney, formatMoneyWithBasis } from '../../../shared/currency';

/** Superadmin OR an admin of the org may VIEW the wallet; only superadmin tops up (until gateways). */
async function canSeeOrg(req: FastifyRequest, orgId: string): Promise<boolean> {
  const s = scopeOf(req);
  if (!s) return false;
  if (s.isSuperadmin) return true;
  return s.orgId === orgId && (await roleInOrg(s.userId, orgId)) === 'admin';
}

/** Build the token-free wallet view: USD canonical + the org's display currency (BDT indicative). */
async function walletView(orgId: string) {
  const org = await getOrg(orgId);
  const code = currencyOf(org?.currency).code;
  const rate = await getRate(code);
  const balMicros = await walletBalanceMicros(orgId);
  const balanceUsd = microsToUsd(balMicros);
  return {
    orgId,
    currency: code,
    pegged: rate.pegged,
    fxRate: rate.rate,
    fxAsOf: rate.asOf,
    fxSource: rate.source,
    balanceUsd,
    balanceMicros: balMicros,
    balanceDisplay: formatMoney(balanceUsd, code, rate.rate),
    balanceUsdDisplay: formatMoney(balanceUsd, 'USD'),
    balanceBasis: formatMoneyWithBasis(balanceUsd, code, rate.rate, rate.asOf),
    lowBalance: balanceUsd <= config.walletLowUsd,
    enforced: config.walletEnforce,
    providers: availableProviders(), // empty until Stripe/PayPal land
  };
}

export function registerWalletRoutes(app: FastifyInstance) {
  // The current resolved rate for a currency (for the admin currency UI). Any signed-in user.
  app.get('/api/fx/:code', async (req, reply) => {
    if (!scopeOf(req)) return reply.code(401).send({ error: 'Sign in first.' });
    const code = currencyOf((req.params as any).code).code;
    return getRate(code);
  });

  // Operator sets a floating currency's rate (units per 1 USD), e.g. USD→BDT.
  app.post('/api/admin/fx', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    const b = (req.body ?? {}) as { code?: string; rate?: number };
    const code = String(b.code ?? '').trim().toUpperCase();
    const rate = Number(b.rate);
    try {
      const r = await setRate(code, rate, req.identity.userId);
      return r;
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  // Org wallet summary (balance + the BDT basis). Admins of the org or the operator.
  app.get('/api/orgs/:id/wallet', async (req, reply) => {
    const orgId = (req.params as { id: string }).id;
    if (!(await canSeeOrg(req, orgId))) return reply.code(403).send({ error: 'Not allowed.' });
    return walletView(orgId);
  });

  // The statement / ledger (most recent first).
  app.get('/api/orgs/:id/wallet/ledger', async (req, reply) => {
    const orgId = (req.params as { id: string }).id;
    if (!(await canSeeOrg(req, orgId))) return reply.code(403).send({ error: 'Not allowed.' });
    const org = await getOrg(orgId);
    const code = currencyOf(org?.currency).code;
    const rate = await getRate(code);
    const limit = Number((req.query as any)?.limit) || 100;
    const entries = (await ledger(orgId, limit)).map((e) => {
      const usd = microsToUsd(e.amountMicros);
      const balUsd = microsToUsd(e.balanceAfterMicros);
      return {
        id: e.id,
        ts: e.ts,
        type: e.type,
        source: e.source,
        ref: e.ref,
        note: e.note,
        amountUsd: usd,
        amountUsdDisplay: formatMoney(usd, 'USD'),
        amountDisplay: formatMoney(usd, code, rate.rate),
        balanceAfterUsd: balUsd,
        balanceAfterDisplay: formatMoney(balUsd, code, rate.rate),
      };
    });
    return { currency: code, fxRate: rate.rate, fxAsOf: rate.asOf, entries };
  });

  // Operator tops up an org's wallet. Amount may be entered in USD or the org's currency.
  app.post('/api/admin/orgs/:id/wallet/topup', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    const orgId = (req.params as { id: string }).id;
    if (orgId === DEFAULT_ORG_ID) return reply.code(400).send({ error: 'The operator workspace is not metered.' });
    if (!(await getOrg(orgId))) return reply.code(404).send({ error: 'Organization not found.' });
    const b = (req.body ?? {}) as { amount?: number; currency?: string; note?: string };
    const amount = Number(b.amount);
    if (!(amount > 0)) return reply.code(400).send({ error: 'Enter a positive amount.' });
    // Convert the entered amount to USD. 'USD' or omitted → as-is; the org currency → ÷ rate.
    const inCode = String(b.currency ?? 'USD').trim().toUpperCase();
    let amountUsd = amount;
    if (inCode && inCode !== 'USD') {
      const r = await getRate(inCode);
      amountUsd = amount / r.rate; // entered in local currency → USD
    }
    const micros = usdToMicros(amountUsd);
    if (micros <= 0) return reply.code(400).send({ error: 'Amount too small.' });
    await creditOrg(orgId, micros, { type: 'topup', source: 'manual', note: b.note ? String(b.note).slice(0, 200) : `Operator top-up`, by: req.identity.userId });
    return walletView(orgId);
  });
}

export { walletView, convertFromUsd };
