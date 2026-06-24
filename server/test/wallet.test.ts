import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-wallet-'));
delete process.env.DATABASE_URL;

import {
  CURRENCIES,
  convertFromUsd,
  currencyOf,
  formatMoney,
  formatMoneyWithBasis,
} from '../../shared/currency';

test('BDT exists, is NOT pegged; GCC stays pegged', () => {
  assert.equal(CURRENCIES.BDT.pegged, false);
  assert.equal(CURRENCIES.BDT.symbol, '৳');
  assert.equal(CURRENCIES.AED.pegged, true);
  assert.equal(currencyOf('bdt').code, 'BDT');
});

test('convertFromUsd: override rate wins over the table default', () => {
  assert.equal(convertFromUsd(10, 'BDT'), 1220); // table default 122
  assert.equal(convertFromUsd(10, 'BDT', 120), 1200); // operator override
  assert.equal(convertFromUsd(10, 'AED'), 36.725); // peg unaffected
});

test('formatMoney: ৳ symbol; basis shown only for a floating currency', () => {
  assert.match(formatMoney(1, 'BDT', 122), /৳ 122/);
  // pegged → no basis
  assert.ok(!/1 USD =/.test(formatMoneyWithBasis(1, 'AED')));
  // floating → basis with rate (+ optional date)
  const basis = formatMoneyWithBasis(1, 'BDT', 122, Date.UTC(2026, 5, 24));
  assert.match(basis, /1 USD = ৳122/);
});

test('micro-USD round-trips exactly', async () => {
  const { usdToMicros, microsToUsd } = await import('../src/wallet/store');
  assert.equal(usdToMicros(1.234567), 1234567);
  assert.equal(microsToUsd(1234567), 1.234567);
  assert.equal(usdToMicros(0), 0);
});

test('wallet: credit/debit move the balance; balance == ledger sum; idempotent on ref', async () => {
  const db = await import('../src/db');
  await db.initDb();
  const w = await import('../src/wallet/store');
  const org = 'org-wallet-1';

  await w.creditOrg(org, w.usdToMicros(10), { type: 'topup', source: 'manual', note: 'seed', by: 'op' });
  assert.equal(await w.walletBalanceUsd(org), 10);

  await w.debitOrg(org, w.usdToMicros(2.5), { type: 'usage', source: 'system', ref: 'run:abc' });
  assert.equal(await w.walletBalanceUsd(org), 7.5);

  // idempotency: the SAME (source, ref) debit is a no-op the second time
  const dup = await w.debitOrg(org, w.usdToMicros(2.5), { type: 'usage', source: 'system', ref: 'run:abc' });
  assert.equal(dup, null);
  assert.equal(await w.walletBalanceUsd(org), 7.5);

  // cached balance reconciles with the ledger
  assert.equal(await w.walletBalanceMicros(org), await w.ledgerSumMicros(org));

  // a different ref DOES charge
  await w.debitOrg(org, w.usdToMicros(1), { type: 'usage', source: 'system', ref: 'run:def' });
  assert.equal(await w.walletBalanceUsd(org), 6.5);

  const led = await w.ledger(org, 50);
  assert.equal(led.length, 3); // topup + 2 distinct debits
  assert.equal(led[0].balanceAfterMicros, await w.walletBalanceMicros(org)); // newest first
});

test('fx: peg is fixed; operator can set a floating rate; cannot override a peg', async () => {
  await (await import('../src/db')).initDb();
  const fx = await import('../src/lib/fx');
  const aed = await fx.getRate('AED');
  assert.equal(aed.pegged, true);
  assert.equal(aed.rate, 3.6725);

  const bdt0 = await fx.getRate('BDT');
  assert.equal(bdt0.pegged, false);
  assert.equal(bdt0.rate, 122); // table default until set
  assert.equal(bdt0.source, 'default');

  const set = await fx.setRate('BDT', 119.5, 'op');
  assert.equal(set.rate, 119.5);
  const bdt1 = await fx.getRate('BDT');
  assert.equal(bdt1.rate, 119.5);
  assert.equal(bdt1.source, 'operator');
  assert.ok(bdt1.asOf && bdt1.asOf > 0);

  await assert.rejects(() => fx.setRate('AED', 4), /pegged/i);
});
