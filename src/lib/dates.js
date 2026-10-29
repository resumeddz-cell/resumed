// Local-date helpers. Planner dates are calendar dates in the student's own timezone.
export const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
export const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function fmtDate(d, opts = { day: 'numeric', month: 'short' }) {
  return (typeof d === 'string' && d.length === 10 ? parseISODate(d) : new Date(d)).toLocaleDateString(undefined, opts);
}
export function fmtDateTime(d) { return new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
export function fmtTime(d) { return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${pad(m)} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}
export function fmtClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}
// minutes between "HH:MM[:SS]" strings
export function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const toM = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return Math.max(0, toM(end) - toM(start));
}
export function localDayKey(ts) { return toISODate(new Date(ts)); }
