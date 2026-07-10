import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { RobotJob } from '@shared/types';

/**
 * Report bot setup — schedule a daily / weekly / monthly ads performance report (account rollup
 * + per-campaign, with week-over-week deltas) emailed as a designed PDF. Backed by `ads_report`
 * robot jobs; "Send me one now" runs the whole pipeline immediately so the schedule is proven
 * before you wait a week for it.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const cadenceLabel = (j: RobotJob) => {
  if (j.cadence === 'daily') return `Daily at ${j.atTime ?? '09:00'}`;
  if (j.cadence === 'weekly') return `${WEEKDAYS[j.weekday ?? 1] ?? 'Monday'}s at ${j.atTime ?? '09:00'}`;
  if (j.cadence === 'monthly') return `Monthly on day ${j.weekday ?? 1} at ${j.atTime ?? '09:00'}`;
  return j.cadence;
};

export function ReportSetup({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [jobs, setJobs] = useState<RobotJob[] | null>(null);
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [atTime, setAtTime] = useState('09:00');
  const [weekday, setWeekday] = useState('1'); // weekly: 0-6 · monthly: day of month
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api.listAdsReports(orgId, robotId).then(setJobs).catch(() => setJobs([]));
  useEffect(() => { void load(); }, [orgId, robotId]);

  const addRecipient = () => {
    const e = draft.trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !recipients.includes(e)) setRecipients((r) => [...r, e]);
    setDraft('');
  };

  const create = async () => {
    setMsg(null);
    if (!recipients.length) return setMsg({ ok: false, text: 'Add at least one recipient email.' });
    setBusy('create');
    try {
      await api.createAdsReport(orgId, robotId, {
        cadence, at_time: atTime,
        weekday: cadence !== 'daily' ? Number(weekday) : undefined,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recipients,
      });
      setMsg({ ok: true, text: 'Scheduled. The first report arrives at the next slot.' });
      void load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not schedule.' });
    } finally {
      setBusy(null);
    }
  };

  const sendNow = async () => {
    setMsg(null);
    if (!recipients.length) return setMsg({ ok: false, text: 'Add a recipient email first.' });
    setBusy('now');
    try {
      const r = await api.runAdsReportNow(orgId, robotId, { recipients });
      setMsg({ ok: true, text: r.detail });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not send the report.' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setJobs((js) => (js ?? []).filter((j) => j.id !== id));
    await api.deleteAdsReport(orgId, robotId, id).catch(() => load());
  };

  return (
    <div className="soc-reports">
      <h3 style={{ margin: 0 }}>Performance reports</h3>
      <p className="soc-sub" style={{ margin: '2px 0 10px' }}>
        A designed PDF of your ad account — spend, reach, leads, conversions, per-campaign breakdown and
        what changed since last time — emailed on your schedule.
      </p>

      {(jobs ?? []).length > 0 && (
        <ul className="soc-report-list">
          {(jobs ?? []).map((j) => (
            <li key={j.id}>
              <span>{cadenceLabel(j)} → {j.deliverTo.map((d) => d.address).join(', ')}</span>
              <button className="soc-x" onClick={() => remove(j.id)} aria-label="Remove report schedule">Remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="soc-grid2">
        <label>How often
          <select value={cadence} onChange={(e) => setCadence(e.target.value as any)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label>At (your time)
          <input type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} />
        </label>
        {cadence === 'weekly' && (
          <label>Day of week
            <select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        )}
        {cadence === 'monthly' && (
          <label>Day of month (1–28)
            <input type="number" min={1} max={28} value={weekday} onChange={(e) => setWeekday(e.target.value)} />
          </label>
        )}
      </div>

      <label className="soc-field" style={{ marginTop: 8 }}>Send to
        <div className="soc-chip-row">
          {recipients.map((r) => (
            <span key={r} className="soc-chip">{r}
              <button onClick={() => setRecipients((rs) => rs.filter((x) => x !== r))} aria-label={`Remove ${r}`}>×</button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
            onBlur={addRecipient}
            placeholder={recipients.length ? 'Add another…' : 'you@company.com'}
          />
        </div>
      </label>

      {msg && <p className={`soc-msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</p>}
      <div className="soc-actions">
        <button className="soc-btn" disabled={busy === 'create'} onClick={create}>{busy === 'create' ? 'Scheduling…' : 'Schedule it'}</button>
        <button className="soc-btn ghost" disabled={busy === 'now'} onClick={sendNow}>{busy === 'now' ? 'Building…' : 'Send me one now'}</button>
      </div>
    </div>
  );
}
