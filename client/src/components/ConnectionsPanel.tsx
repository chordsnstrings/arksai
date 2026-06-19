import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Conn { id: string; provider: string; accountId: string; accountName: string | null; status: string }

const LABELS: Record<string, string> = {
  meta: 'Meta Ads (Facebook / Instagram)',
  google: 'Google Ads',
  tiktok: 'TikTok Ads',
};

/** Connect/disconnect ad-platform data sources for the caller's organization.
 *  Connecting redirects to the provider's OAuth consent screen; on return the
 *  agent can pull live numbers with fetch_ads (dashboards/reports). */
export function ConnectionsPanel() {
  const [enabled, setEnabled] = useState(true);
  const [providers, setProviders] = useState<{ provider: string; label: string }[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');

  const refresh = () => {
    api.connectorsAvailable().then((r) => { setEnabled(r.enabled); setProviders(r.providers); }).catch(() => {});
    api.listConnectors().then(setConns).catch(() => setConns([])).finally(() => setLoading(false));
  };
  useEffect(() => {
    refresh();
    // Surface the OAuth round-trip result (?connect=meta&status=connected).
    const p = new URLSearchParams(window.location.search);
    if (p.get('connect')) {
      setNote(`${LABELS[p.get('connect')!] ?? p.get('connect')}: ${p.get('status')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const disconnect = async (id: string) => {
    await api.deleteConnector(id).catch(() => {});
    refresh();
  };

  const byProvider = (prov: string) => conns.filter((c) => c.provider === prov);

  if (!enabled) {
    return (
      <div className="an-empty">
        Ad-platform connections aren’t configured on this server yet. An operator needs to set the platform
        app credentials and a token-encryption key. See CONNECTORS.md.
      </div>
    );
  }

  return (
    <div className="conn-panel">
      <p className="conn-intro">
        Connect your ad accounts so ArksAI can pull live numbers into dashboards and reports. You connect once;
        the agent fetches on demand. Tokens are encrypted and scoped to your organization.
      </p>
      {note && <div className="conn-note">{note}</div>}
      {loading ? (
        <div className="an-empty">Loading…</div>
      ) : providers.length === 0 ? (
        <div className="an-empty">No ad platforms are enabled on this server.</div>
      ) : (
        <ul className="conn-list">
          {providers.map(({ provider, label }) => {
            const linked = byProvider(provider);
            return (
              <li key={provider} className="conn-row">
                <div className="conn-head">
                  <strong>{label}</strong>
                  <a className="send-btn" href={`/api/connectors/${provider}/connect`}>
                    {linked.length ? 'Connect another' : 'Connect'}
                  </a>
                </div>
                {linked.length > 0 && (
                  <ul className="conn-accounts">
                    {linked.map((c) => (
                      <li key={c.id} className={c.status !== 'active' ? 'conn-bad' : ''}>
                        <span>{c.accountName || c.accountId} {c.status !== 'active' && `· ${c.status}`}</span>
                        <button className="link-btn" onClick={() => disconnect(c.id)}>Disconnect</button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
