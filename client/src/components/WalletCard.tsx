import { useEffect, useState } from 'react';
import { currencyOf } from '@shared/currency';
import type { WalletView, WalletLedgerEntry } from '@shared/types';
import { api } from '../api/client';
import { downloadCsv, toCsv } from './analyticsCharts';

const fmtDate = (ts: number) => {
  try {
    return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/**
 * Org wallet panel for the Admin dialog: balance, an operator top-up, the floating-rate (BDT)
 * setter, and the ledger statement (with CSV export). USD is canonical; the org's currency is
 * shown with its rate basis when floating.
 */
export function WalletCard({ orgId, isSuper }: { orgId: string; isSuper: boolean }) {
  const [w, setW] = useState<WalletView | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [topupCur, setTopupCur] = useState('USD');
  const [note, setNote] = useState('');
  const [rate, setRate] = useState('');
  const [showLedger, setShowLedger] = useState(false);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);

  const load = async () => {
    try {
      const wv = await api.getWallet(orgId);
      setW(wv);
      setTopupCur(wv.currency === 'USD' ? 'USD' : wv.currency);
      if (!wv.pegged) setRate(String(wv.fxRate));
    } catch (e: any) {
      setErr(e?.message || 'Could not load the wallet.');
    }
  };
  useEffect(() => {
    setW(null);
    setErr('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const topup = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) return;
    setBusy(true);
    setErr('');
    try {
      const wv = await api.topupWallet(orgId, amt, topupCur, note.trim() || undefined);
      setW(wv);
      setAmount('');
      setNote('');
      if (showLedger) await loadLedger();
    } catch (e: any) {
      setErr(e?.message || 'Top-up failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveRate = async () => {
    const r = Number(rate);
    if (!(r > 0) || !w) return;
    setBusy(true);
    setErr('');
    try {
      await api.setFxRate(w.currency, r);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Could not set the rate.');
    } finally {
      setBusy(false);
    }
  };

  const loadLedger = async () => {
    try {
      const r = await api.getWalletLedger(orgId, 200);
      setLedger(r.entries);
    } catch {
      /* ignore */
    }
  };
  const toggleLedger = async () => {
    const next = !showLedger;
    setShowLedger(next);
    if (next && !ledger.length) await loadLedger();
  };
  const exportCsv = () => {
    const csv = toCsv(
      ledger.map((e) => ({ date: fmtDate(e.ts), type: e.type, source: e.source, amount_usd: e.amountUsd.toFixed(6), balance_usd: e.balanceAfterUsd.toFixed(6), note: e.note ?? '', ref: e.ref ?? '' })),
      [
        { key: 'date', label: 'Date' },
        { key: 'type', label: 'Type' },
        { key: 'source', label: 'Source' },
        { key: 'amount_usd', label: 'Amount (USD)' },
        { key: 'balance_usd', label: 'Balance after (USD)' },
        { key: 'note', label: 'Note' },
        { key: 'ref', label: 'Ref' },
      ],
    );
    downloadCsv('wallet-statement.csv', csv);
  };

  if (!w) return <div style={{ color: 'var(--text-faint)', fontSize: 13, margin: '10px 0' }}>{err || 'Loading wallet…'}</div>;
  const floating = !w.pegged;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', margin: '14px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ margin: 0 }}>Wallet</label>
        {w.lowBalance && (
          <span style={{ color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>
            {w.balanceUsd <= 0 ? (w.enforced ? 'Out of credit — runs are blocked' : 'Out of credit') : 'Low balance'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{w.balanceDisplay}</span>
        {w.currency !== 'USD' && <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>≈ {w.balanceUsdDisplay}</span>}
      </div>
      {floating && (
        <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
          Indicative — billed in USD. {w.balanceBasis.split('·').slice(1).join('·').trim()}
        </div>
      )}

      {/* Floating-rate setter (operator only) */}
      {isSuper && floating && (
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12 }}>USD → {w.currency} rate (units per $1){w.fxAsOf ? ` · set ${fmtDate(w.fxAsOf)}` : ' · using default'}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 122" style={{ width: 120 }} inputMode="decimal" />
            <button className="cancel" onClick={saveRate} disabled={busy}>Save rate</button>
          </div>
        </div>
      )}

      {/* Operator top-up */}
      {isSuper && (
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12 }}>Add funds</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" style={{ width: 110 }} inputMode="decimal" />
            <select value={topupCur} onChange={(e) => setTopupCur(e.target.value)} style={{ width: 100 }}>
              <option value="USD">USD ($)</option>
              {w.currency !== 'USD' && <option value={w.currency}>{w.currency} ({currencyOf(w.currency).symbol})</option>}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ flex: 1, minWidth: 120 }} />
            <button className="send-btn" onClick={topup} disabled={busy || !(Number(amount) > 0)}>Top up</button>
          </div>
          {topupCur !== 'USD' && Number(amount) > 0 && (
            <div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 4 }}>≈ ${(Number(amount) / w.fxRate).toFixed(2)} at the current rate.</div>
          )}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 14, alignItems: 'center' }}>
        <button className="cancel" onClick={toggleLedger}>{showLedger ? 'Hide statement' : 'View statement'}</button>
        {showLedger && ledger.length > 0 && <button className="cancel" onClick={exportCsv}>↓ CSV</button>}
      </div>
      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{err}</div>}

      {showLedger && (
        <div style={{ marginTop: 10, maxHeight: 280, overflow: 'auto' }}>
          {ledger.length === 0 ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>No transactions yet.</div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-faint)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 6px' }}>Date</th>
                  <th style={{ padding: '4px 6px' }}>Type</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{fmtDate(e.ts)}</td>
                    <td style={{ padding: '4px 6px' }}>{e.type}{e.note ? ` · ${e.note}` : ''}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: e.amountUsd >= 0 ? 'var(--green)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                      {e.amountUsd >= 0 ? '+' : ''}{e.amountDisplay}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.balanceAfterDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
