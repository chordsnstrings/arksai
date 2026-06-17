import { useEffect, useState } from 'react';
import type { Schedule, ScheduleCadence, SessionMode } from '@shared/types';
import { api } from '../api/client';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function summarize(s: Schedule): string {
  if (s.cadence === 'interval') return `every ${Math.round((s.intervalMs ?? 0) / 3_600_000)}h`;
  if (s.cadence === 'weekly') return `${WEEKDAYS[s.weekday ?? 1]} at ${s.at}`;
  return `daily at ${s.at}`;
}

export function SchedulesDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Schedule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    label: '',
    prompt: '',
    mode: 'code' as SessionMode,
    cadence: 'weekly' as ScheduleCadence,
    at: '09:00',
    weekday: 1,
    everyHours: 24,
  });

  const refresh = () => api.listSchedules().then(setList).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    if (!form.label.trim() || !form.prompt.trim()) {
      setError('A name and a task description are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.createSchedule({
        label: form.label.trim(),
        prompt: form.prompt.trim(),
        mode: form.mode,
        cadence: form.cadence,
        at: form.cadence === 'interval' ? undefined : form.at,
        weekday: form.cadence === 'weekly' ? form.weekday : undefined,
        intervalMs: form.cadence === 'interval' ? form.everyHours * 3_600_000 : undefined,
        // Fire at the USER's local wall-clock time, not the server's (Bangalore).
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      });
      setForm((f) => ({ ...f, label: '', prompt: '' }));
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not create the schedule');
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    await refresh();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Scheduled tasks</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          Run a task on a recurring schedule — e.g. “every Monday, build the weekly performance report.”
          Each run creates its own session and result, even with the app closed.
        </p>

        <div className="sched-form">
          <input placeholder="Name (e.g. Weekly performance report)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <textarea
            placeholder="What should it do each time? (the brief sent to the agent)"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          />
          <div className="row">
            <div>
              <label>Mode</label>
              <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as SessionMode })}>
                <option value="code">Code (build)</option>
                <option value="report">Report (PDF/deck)</option>
                <option value="chat">Chat</option>
              </select>
            </div>
            <div>
              <label>Repeats</label>
              <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value as ScheduleCadence })}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="interval">Every N hours</option>
              </select>
            </div>
          </div>
          <div className="row">
            {form.cadence === 'weekly' && (
              <div>
                <label>Day</label>
                <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.cadence !== 'interval' ? (
              <div>
                <label>Time ({Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'})</label>
                <input type="time" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
              </div>
            ) : (
              <div>
                <label>Every (hours)</label>
                <input
                  type="number"
                  min={1}
                  value={form.everyHours}
                  onChange={(e) => setForm({ ...form, everyHours: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
            )}
          </div>
          {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
          <button className="send-btn" onClick={create} disabled={busy} style={{ alignSelf: 'flex-start' }}>
            {busy ? 'Scheduling…' : '+ Schedule it'}
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Active schedules</label>
          <div className="kb-list">
            {list.length === 0 && (
              <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '4px 2px' }}>None yet.</div>
            )}
            {list.map((s) => (
              <div key={s.id} className="kb-row">
                <span className={`status-dot ${s.enabled ? 'idle' : 'error'}`} />
                <span className="kb-name">
                  {s.label}{' '}
                  <span style={{ color: 'var(--text-faint)' }}>
                    · {summarize(s)} · next {new Date(s.nextRunAt).toLocaleString()}
                  </span>
                </span>
                <button className="canvas-btn" onClick={() => act(() => api.toggleSchedule(s.id, !s.enabled))}>
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
                <button className="kb-del" title="Delete" onClick={() => act(() => api.deleteSchedule(s.id))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="actions">
          <button className="cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
