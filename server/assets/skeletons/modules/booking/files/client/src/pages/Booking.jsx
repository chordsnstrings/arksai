import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

const fmtTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const todayEpochDay = () => Math.floor(Date.now() / 86400000);
const dayLabel = (d) => {
  const date = new Date(d * 86400000);
  const t = todayEpochDay();
  if (d === t) return 'Today';
  if (d === t + 1) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

/** Pick a resource → a day → a free slot; see and cancel your reservations. */
export default function Booking() {
  const toast = useToast();
  const [resources, setResources] = useState(null);
  const [resourceId, setResourceId] = useState('');
  const [day, setDay] = useState(todayEpochDay());
  const [slots, setSlots] = useState(null);
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => todayEpochDay() + i), []);
  const resource = (resources || []).find((x) => x.id === resourceId);

  const loadMine = () => api.get('/booking/reservations').then(setMine).catch(() => {});
  useEffect(() => {
    api.get('/booking/resources').then((rs) => { setResources(rs); if (rs.length) setResourceId(rs[0].id); }).catch(() => setResources([]));
    loadMine();
  }, []);
  useEffect(() => {
    if (!resourceId) return;
    setSlots(null);
    api.get(`/booking/resources/${resourceId}/slots?day=${day}`).then((d) => setSlots(d.slots)).catch((e) => { setSlots([]); toast(e.message, 'error'); });
  }, [resourceId, day]);

  async function book(slot) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/booking/reservations', { resourceId, day, startMin: slot.startMin });
      toast(`Booked ${dayLabel(day)} ${fmtTime(slot.startMin)}`);
      setSlots((ss) => ss.map((s) => (s.startMin === slot.startMin ? { ...s, free: false } : s)));
      loadMine();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  const cancel = (b) => api.del(`/booking/reservations/${b.id}`).then(() => {
    toast('Reservation cancelled');
    loadMine();
    if (b.resourceId === resourceId && b.day === day) {
      setSlots(null);
      api.get(`/booking/resources/${resourceId}/slots?day=${day}`).then((d) => setSlots(d.slots)).catch(() => setSlots([]));
    }
  }).catch((e) => toast(e.message, 'error'));

  if (resources === null) return <div className="page"><div className="empty">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Schedule</div>
          <h1>Bookings</h1>
          <div className="sub">{resources.length} bookable resource{resources.length === 1 ? '' : 's'}.</div>
        </div>
      </div>

      {resources.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}>No resources are open for booking yet.</div>
      ) : (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="fields" style={{ gap: 12 }}>
            <label className="field" style={{ maxWidth: 340 }}>
              <span>Resource</span>
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                {resources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            {resource?.description && <p className="muted" style={{ margin: 0 }}>{resource.description}</p>}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, width: '100%' }}>
              {days.map((d) => (
                <button key={d} className={d === day ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setDay(d)} style={{ whiteSpace: 'nowrap' }}>
                  {dayLabel(d)}
                </button>
              ))}
            </div>
            {slots === null ? (
              <div className="empty">Loading availability…</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {slots.map((s) => (
                  <button
                    key={s.startMin}
                    className={s.free ? 'btn btn-sm' : 'btn btn-sm'}
                    disabled={!s.free || busy}
                    onClick={() => book(s)}
                    style={s.free ? {} : { opacity: 0.35, textDecoration: 'line-through' }}
                    aria-label={`${fmtTime(s.startMin)} ${s.free ? 'available' : 'taken'}`}
                  >
                    {fmtTime(s.startMin)}
                  </button>
                ))}
                {!slots.length && <div className="empty">No slots on this day.</div>}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-hd" style={{ padding: '14px 18px 0' }}><h3>Your reservations</h3></div>
        {mine.filter((b) => b.status === 'booked').map((b) => {
          const rsc = resources.find((x) => x.id === b.resourceId);
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{rsc?.name || 'Resource'}</strong> <span className="muted">{dayLabel(b.day)} · {fmtTime(b.startMin)}–{fmtTime(b.endMin)}</span>
              </div>
              <button className="btn btn-sm" onClick={() => cancel(b)}>Cancel</button>
            </div>
          );
        })}
        {!mine.filter((b) => b.status === 'booked').length && <div className="empty" style={{ padding: 24 }}>Nothing booked yet — pick a free slot above.</div>}
      </div>
    </div>
  );
}
