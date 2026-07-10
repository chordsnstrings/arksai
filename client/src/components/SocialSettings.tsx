import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { RobotChannel } from '@shared/types';

/**
 * Social Media Manager settings — the AUTONOMY SLIDER (the single control over how much the
 * robot does on its own), the ad spend caps, and the Facebook Page + Instagram connection.
 * Mounted in the robot's settings for `social` robots.
 */

const BANDS = [
  { min: 0, label: 'Ask first', blurb: 'Proposes everything — nothing goes out without your tap.' },
  { min: 40, label: 'Auto-reply', blurb: 'Answers comments & DMs on its own. Posts and ads still ask you.' },
  { min: 60, label: 'Auto content', blurb: 'Auto-replies AND publishes the approved calendar. Ads still ask.' },
  { min: 80, label: 'Autopilot', blurb: 'Replies, publishes, and runs ads on its own — within your caps.' },
];
const bandOf = (v: number) => BANDS.reduce((b, cur) => (v >= cur.min ? cur : b), BANDS[0]);

export function SocialSettings({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [level, setLevel] = useState(30);
  const [dailyCap, setDailyCap] = useState('20');
  const [campaignCap, setCampaignCap] = useState('');
  const [saved, setSaved] = useState(false);
  const [channel, setChannel] = useState<RobotChannel | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const reload = () => {
    api.getRobot(orgId, robotId).then((r) => {
      const c = (r.config || {}) as any;
      if (typeof c.autonomyLevel === 'number') setLevel(c.autonomyLevel);
      if (typeof c.adDailyCapUsd === 'number') setDailyCap(String(c.adDailyCapUsd));
      if (typeof c.adCampaignCapUsd === 'number') setCampaignCap(String(c.adCampaignCapUsd));
    }).catch(() => {});
    api.listRobotChannels(orgId, robotId).then((cs) => setChannel(cs.find((c) => c.kind === 'meta') ?? null)).catch(() => {});
  };
  useEffect(reload, [orgId, robotId]);

  const persist = async (patch: Record<string, any>) => {
    const backend = await api.getRobot(orgId, robotId);
    await api.updateRobot(orgId, robotId, { config: { ...(backend.config || {}), ...patch } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const saveChannel = async () => {
    setBusy('save'); setMsg(null);
    try {
      await api.saveRobotChannel(orgId, robotId, 'meta' as any, form);
      setForm({}); setMsg({ ok: true, text: 'Saved. Now Test it.' }); reload();
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'Could not save.' }); }
    finally { setBusy(null); }
  };
  const testChannel = async () => {
    setBusy('test'); setMsg(null);
    try {
      const r = await api.testRobotChannel(orgId, robotId, 'meta' as any);
      setMsg({ ok: r.ok, text: r.detail }); if (r.ok) reload();
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'Test failed.' }); }
    finally { setBusy(null); }
  };

  const band = bandOf(level);
  const hookUrl = `${window.location.origin}/api/hooks/meta`;

  return (
    <div className="soc-settings">
      <section className="soc-card">
        <h4>Autonomy</h4>
        <p className="soc-sub">How much this robot does on its own. Two rules always hold: negative comments come to you, and no ad spends over your cap without approval.</p>
        <div className="soc-slider-row">
          <input
            type="range" min={0} max={100} step={1} value={level}
            aria-label="Autonomy level"
            onChange={(e) => setLevel(Number(e.target.value))}
            onMouseUp={() => persist({ autonomyLevel: level })}
            onTouchEnd={() => persist({ autonomyLevel: level })}
            onKeyUp={() => persist({ autonomyLevel: level })}
          />
          <div className="soc-band">
            <strong>{band.label}</strong>
            <span>{band.blurb}</span>
          </div>
        </div>
        <div className="soc-ticks">
          {BANDS.map((b) => <span key={b.min} className={level >= b.min ? 'on' : ''}>{b.label}</span>)}
        </div>
      </section>

      <section className="soc-card">
        <h4>Ad spend caps</h4>
        <p className="soc-sub">Hard limits the robot can never exceed. It always asks before going over.</p>
        <div className="soc-grid2">
          <label>Daily cap (USD)
            <input type="number" min={0} value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} onBlur={() => persist({ adDailyCapUsd: Number(dailyCap) || 0 })} />
          </label>
          <label>Per-campaign cap (USD, optional)
            <input type="number" min={0} value={campaignCap} onChange={(e) => setCampaignCap(e.target.value)} onBlur={() => persist({ adCampaignCapUsd: campaignCap ? Number(campaignCap) : undefined })} />
          </label>
        </div>
        {saved && <span className="soc-saved">Saved ✓</span>}
      </section>

      <section className="soc-card">
        <h4>Facebook Page + Instagram {channel?.verifiedAt ? <span className="soc-ok">connected ✓</span> : channel ? <span className="soc-warn">saved — test it</span> : <span className="soc-muted">not connected</span>}</h4>
        <p className="soc-sub">Connect the Page (and its linked Instagram account) the robot manages. The Page access token needs the posting, engagement and ads permissions.</p>
        <div className="soc-grid2">
          <input placeholder="Facebook Page ID" value={form.pageId ?? ''} onChange={set('pageId')} />
          <input placeholder="Instagram user ID (linked to the Page)" value={form.igUserId ?? ''} onChange={set('igUserId')} />
          <input placeholder="Page name (label)" value={form.pageName ?? ''} onChange={set('pageName')} />
          <input placeholder={channel?.meta?.verifyToken ? 'Verify token (saved — paste to replace)' : 'Webhook verify token (you choose)'} value={form.verifyToken ?? ''} onChange={set('verifyToken')} />
          <input placeholder={channel?.hasSecrets ? 'Page access token (saved — paste to replace)' : 'Page access token'} value={form.pageAccessToken ?? ''} onChange={set('pageAccessToken')} />
          <input placeholder="App secret (for webhook verification)" value={form.appSecret ?? ''} onChange={set('appSecret')} />
        </div>
        <div className="soc-actions">
          <button className="soc-btn" disabled={busy === 'save'} onClick={saveChannel}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          <button className="soc-btn ghost" disabled={busy === 'test' || !channel} onClick={testChannel}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        </div>
        {msg && <p className={`soc-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p>}
        <p className="soc-hook">In the Meta App Dashboard, set the webhook callback URL to <code>{hookUrl}</code> and subscribe the Page to <code>feed</code>, <code>comments</code>, <code>messages</code>, <code>messaging_referrals</code> (ad→DM attribution) and <code>leadgen</code> (Instant-Form leads), using the verify token above.</p>
      </section>
    </div>
  );
}
