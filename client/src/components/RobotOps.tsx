import { useEffect, useState } from 'react';
import type { RobotAction, RobotJob, RobotStats } from '@shared/types';
import { api } from '../api/client';

/**
 * Robots v2 office panels: proactive Routines (digest / scheduled brief), gated Actions
 * (org-defined HTTPS lookups), and the Performance stats strip.
 */

export function RoutinesPanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [jobs, setJobs] = useState<RobotJob[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ kind: 'digest', cadence: 'daily', atTime: '08:30', weekday: '1', prompt: '' });
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    api.listRobotJobs(orgId, robotId).then(setJobs).catch(() => setJobs([]));
  };
  useEffect(load, [orgId, robotId]);
  const add = async () => {
    setErr(null);
    try {
      await api.createRobotJob(orgId, robotId, {
        kind: draft.kind,
        cadence: draft.cadence,
        atTime: draft.atTime,
        weekday: draft.cadence === 'weekly' ? Number(draft.weekday) : undefined,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        prompt: draft.kind === 'brief' ? draft.prompt : undefined,
      });
      setAdding(false);
      setDraft({ ...draft, prompt: '' });
      load();
    } catch (e: any) {
      setErr(e?.message || 'Could not add the routine.');
    }
  };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <>
      <h3>Routines {jobs && jobs.length > 0 && <span className="rb-count">{jobs.length}</span>}</h3>
      <p className="rb-mini-empty" style={{ marginBottom: 8 }}>
        Things the robot does on a schedule, without being asked: a <strong>daily digest</strong> of what it
        handled + what's waiting on you (quiet days send nothing), or a <strong>recurring build</strong>
        (“every Monday 09:00: build the weekly sales summary”) delivered to your channel.
      </p>
      {jobs === null ? (
        <div className="rb-mini-empty">Loading…</div>
      ) : (
        <ul className="rb-rules">
          {jobs.map((j) => (
            <li key={j.id} className="rb-rule">
              <div className="rb-rule-main">
                <span className="rb-rule-when">
                  {j.kind === 'digest' ? 'digest' : 'build'} · {j.cadence === 'weekly' ? `${WEEKDAYS[j.weekday ?? 0]} ` : 'daily '}
                  {j.atTime}{j.tz ? ` (${j.tz})` : ''}
                </span>
                <span className="rb-rule-then">{j.kind === 'brief' ? j.prompt?.slice(0, 90) : 'Activity summary to your channel'}</span>
              </div>
              <button
                className="rb-rule-x"
                onClick={async () => {
                  await api.deleteRobotJob(orgId, robotId, j.id).catch(() => {});
                  load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rb-panel-actions">
        <button className="rb-ghost-btn" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Add routine'}</button>
      </div>
      {adding && (
        <div className="rb-chan-grid" style={{ marginTop: 8 }}>
          <div className="rb-persona-row">
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              <option value="digest">Daily digest</option>
              <option value="brief">Recurring build</option>
            </select>
            <select value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value })}>
              <option value="daily">Every day</option>
              <option value="weekly">Weekly</option>
            </select>
            {draft.cadence === 'weekly' && (
              <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: e.target.value })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={String(i)}>{d}</option>
                ))}
              </select>
            )}
            <input type="time" value={draft.atTime} onChange={(e) => setDraft({ ...draft, atTime: e.target.value })} style={{ flex: '0 0 110px' }} />
          </div>
          {draft.kind === 'brief' && (
            <textarea
              rows={3}
              placeholder="What should it build each time? (e.g. A one-page PDF summary of this week's sales from https://…/sheet.csv)"
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          )}
          <div className="rb-panel-actions">
            <button className="rb-save" onClick={add} disabled={draft.kind === 'brief' && !draft.prompt.trim()}>Add</button>
          </div>
          <p className="rb-mini-empty">Delivered to your notify-enabled commander addresses.</p>
        </div>
      )}
      {err && <div className="rb-check-msg" style={{ color: '#b23f2e' }}>{err}</div>}
    </>
  );
}

export function ActionsPanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [actions, setActions] = useState<RobotAction[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', method: 'GET', urlTemplate: '', headers: '', params: '', mode: 'ask' });
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    api.listRobotActions(orgId, robotId).then(setActions).catch(() => setActions([]));
  };
  useEffect(load, [orgId, robotId]);
  const save = async () => {
    setErr(null);
    try {
      let headers: Record<string, string> | undefined;
      if (draft.headers.trim()) {
        try {
          headers = JSON.parse(draft.headers);
        } catch {
          throw new Error('Headers must be JSON, e.g. {"Authorization": "Bearer …"}');
        }
      }
      const params = draft.params
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [name, ...desc] = s.split(':');
          return { name: name.trim(), description: desc.join(':').trim() || name.trim() };
        });
      await api.saveRobotAction(orgId, robotId, {
        name: draft.name,
        description: draft.description,
        method: draft.method,
        urlTemplate: draft.urlTemplate,
        headers,
        params,
        mode: draft.mode,
      });
      setAdding(false);
      setDraft({ name: '', description: '', method: 'GET', urlTemplate: '', headers: '', params: '', mode: 'ask' });
      load();
    } catch (e: any) {
      setErr(e?.message || 'Could not save the action.');
    }
  };
  return (
    <>
      <h3>Actions {actions && actions.length > 0 && <span className="rb-count">{actions.length}</span>}</h3>
      <p className="rb-mini-empty" style={{ marginBottom: 8 }}>
        Real lookups the robot may run mid-reply — an order-status API, a stock check. HTTPS only, you
        define the URL (with <code>{'{{param}}'}</code> slots); “ask first” flags the request to you instead of
        running it. Every run is logged.
      </p>
      {actions === null ? (
        <div className="rb-mini-empty">Loading…</div>
      ) : (
        <ul className="rb-rules">
          {actions.map((a) => (
            <li key={a.id} className="rb-rule">
              <div className="rb-rule-main">
                <span className="rb-rule-when">{a.name} · {a.method} · {a.mode === 'auto' ? `runs automatically (${a.cleanUses} uses)` : 'asks first'}</span>
                <span className="rb-rule-then">{a.description.slice(0, 90)}</span>
              </div>
              <button
                className="rb-rule-x"
                onClick={async () => {
                  await api.deleteRobotAction(orgId, robotId, a.id).catch(() => {});
                  load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rb-panel-actions">
        <button className="rb-ghost-btn" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Add action'}</button>
      </div>
      {adding && (
        <div className="rb-chan-grid" style={{ marginTop: 8 }}>
          <input placeholder="Name (e.g. order_status)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input placeholder="When to use it (e.g. Look up an order's delivery status by its number)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <input placeholder="https://api.yourshop.com/orders/{{order_id}}" value={draft.urlTemplate} onChange={(e) => setDraft({ ...draft, urlTemplate: e.target.value })} />
          <input placeholder="Params: order_id: the order number the customer gave" value={draft.params} onChange={(e) => setDraft({ ...draft, params: e.target.value })} />
          <input placeholder='Headers JSON (optional, stored encrypted): {"Authorization":"Bearer …"}' value={draft.headers} onChange={(e) => setDraft({ ...draft, headers: e.target.value })} />
          <div className="rb-persona-row">
            <select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
              <option value="ask">Ask me first</option>
              <option value="auto">Run automatically</option>
            </select>
            <button className="rb-save" onClick={save} disabled={!draft.name.trim() || !draft.urlTemplate.trim() || !draft.description.trim()}>Save action</button>
          </div>
        </div>
      )}
      {err && <div className="rb-check-msg" style={{ color: '#b23f2e' }}>{err}</div>}
    </>
  );
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 5000) return 'instant';
  if (ms < 90_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 5_400_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/** Compact performance strip for the robot office (last 30 days). */
export function PerformancePanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [stats, setStats] = useState<RobotStats | null>(null);
  useEffect(() => {
    api.getRobotStats(orgId, robotId).then(setStats).catch(() => setStats(null));
  }, [orgId, robotId]);
  if (!stats || !stats.total) return null; // quiet until there's real activity
  const maxDay = Math.max(1, ...stats.byDay.map(([, n]) => n));
  return (
    <section className="rb-panel rb-span rb-perf">
      <div className="rb-panel-head">
        <h3>Performance · 30 days</h3>
      </div>
      <div className="rb-perf-grid">
        <div className="rb-perf-stat"><strong>{stats.total}</strong><span>messages</span></div>
        <div className="rb-perf-stat"><strong>{stats.deflectionRate != null ? `${Math.round(stats.deflectionRate * 100)}%` : '—'}</strong><span>handled solo</span></div>
        <div className="rb-perf-stat"><strong>{fmtMs(stats.medianResponseMs)}</strong><span>median reply</span></div>
        <div className="rb-perf-stat"><strong>{stats.escalated}</strong><span>flagged to you</span></div>
        {stats.tasks.delivered + stats.tasks.error > 0 && (
          <div className="rb-perf-stat"><strong>{stats.tasks.delivered}</strong><span>builds delivered</span></div>
        )}
        {stats.actions.calls > 0 && (
          <div className="rb-perf-stat"><strong>{stats.actions.calls}</strong><span>lookups run</span></div>
        )}
        <div className="rb-perf-bars" title="Messages per day, last 14 days">
          {stats.byDay.map(([day, n, sentN]) => (
            <span key={day} className="rb-perf-bar" style={{ height: `${Math.max(8, (n / maxDay) * 100)}%`, opacity: n ? 1 : 0.25 }} title={`${n} messages, ${sentN} replied`} />
          ))}
        </div>
      </div>
      <div className="rb-perf-channels">
        {Object.entries(stats.byChannel).map(([k, n]) => (
          <span key={k} className="rb-trigger-tag">{k} · {n}</span>
        ))}
      </div>
    </section>
  );
}
