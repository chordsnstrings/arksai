import { useStore } from '../state/sessionStore';
import { money } from '../lib/money';

/**
 * A slim banner when the current org's prepaid wallet is low/empty. Members are told to ask their
 * admin; admins/operators can open Admin → Wallet to top up. Hidden for the operator workspace
 * (not metered) and when the balance is healthy.
 */
export function LowBalanceBanner() {
  const me = useStore((s) => s.me);
  const w = me?.wallet;
  if (!w || !w.lowBalance) return null;
  const empty = w.balanceUsd <= 0;
  const isAdmin = me?.role === 'admin' || me?.isSuperadmin;
  const msg = empty
    ? w.enforced
      ? 'Your workspace is out of credit — new runs are paused until it’s topped up.'
      : 'Your workspace is out of credit.'
    : `Low balance — ${money(w.balanceUsd)} left.`;
  return (
    <div
      style={{
        background: empty ? 'rgba(200,60,60,0.10)' : 'rgba(212,166,74,0.12)',
        color: 'var(--text)',
        borderBottom: '1px solid var(--border)',
        padding: '7px 16px',
        fontSize: 13,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span style={{ fontWeight: 600 }}>{msg}</span>
      <span style={{ color: 'var(--text-faint)' }}>{isAdmin ? 'Open Admin → Wallet to add funds.' : 'Ask your workspace admin to top up the wallet.'}</span>
    </div>
  );
}
