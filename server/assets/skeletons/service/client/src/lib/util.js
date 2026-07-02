/**
 * Light helpers — no DOM, safe at import time.
 */

const COLORS = ['#d97757', '#7d9cd9', '#70c19e', '#d9a557', '#a8553b', '#d96a6a', '#b894d4', '#5fb8b3'];

export function avatarColor(seed) {
  // simple stable hash → palette index
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() || '?';
}

export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date(); today.setHours(0,0,0,0);
  const sameDay = d.getTime() >= today.getTime() && d.getTime() < today.getTime() + 86400000;
  const opts = sameDay
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined };
  return d.toLocaleDateString('en-US', opts);
}

export function fmtDateLong(ms) {
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function isOverdue(ms) {
  if (!ms) return false;
  return ms < Date.now() - 24 * 3600 * 1000;
}

export function dueLabel(ms) {
  if (!ms) return null;
  const diff = ms - Date.now();
  const days = Math.round(diff / (24 * 3600 * 1000));
  if (days < 0) {
    const a = Math.abs(days);
    if (a === 0) return 'Due today';
    if (a === 1) return '1 day overdue';
    return `${a} days overdue`;
  }
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7)  return `Due in ${days} days`;
  return `Due ${fmtDate(ms)}`;
}

export function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)   return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30)    return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12)   return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export function todayInputValue(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

export function fromInputDate(s) {
  if (!s) return null;
  // s is YYYY-MM-DD from <input type="date">
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.getTime();
}
