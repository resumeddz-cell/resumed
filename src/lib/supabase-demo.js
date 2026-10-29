// DEMO BACKEND — used only by the demo build (node build.mjs --demo).
// Same interface as supabase.js, but everything runs in the browser and is stored in localStorage.
// It reproduces the server rules of supabase/migrations/001_schema.sql (approval gate, per-user data,
// admin-only operations, progress records, server-side Pomodoro state machine) so the demo behaves
// like the real app. It is NOT secure and NOT shared between devices: it exists only to show the app.
import seed from './demo-seed.json';

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, details = null, kind = 'api' } = {}) {
    super(message);
    this.status = status; this.code = code; this.details = details; this.kind = kind;
  }
}

const DB_KEY = 'resumed.demo.db.v1';
const SESSION_KEY = 'resumed.demo.session.v1';
export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@demo.resumed', password: 'demo1234' },
  student: { email: 'etudiante@demo.resumed', password: 'demo1234' },
};

const now = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const wait = (ms = 90) => new Promise((r) => setTimeout(r, ms));
const memory = {};
function readKey(k) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : (memory[k] ? JSON.parse(memory[k]) : null); } catch { return memory[k] ? JSON.parse(memory[k]) : null; } }
function writeKey(k, v) { const raw = v === null ? null : JSON.stringify(v); memory[k] = raw; try { if (raw === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, raw); } catch { /* memory only */ } }

function freshDb() {
  const t = now();
  const users = []; const profiles = [];
  const add = (email, password, role, status, extra = {}) => {
    const id = uuid();
    users.push({ id, email, password });
    profiles.push({ id, email, display_name: null, role, status, selected_year: null, selected_semester: null,
      status_changed_at: status === 'pending' ? null : t, status_changed_by: null, created_at: t, updated_at: t, ...extra });
  };
  add(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password, 'admin', 'approved', { display_name: 'Admin (démo)' });
  add(DEMO_ACCOUNTS.student.email, DEMO_ACCOUNTS.student.password, 'student', 'approved', { display_name: 'Étudiante (démo)' });
  add('nouvelle.inscription@demo.resumed', 'demo1234', 'student', 'pending');
  return {
    users, profiles,
    modules: seed.modules.map((m) => ({ ...m, created_at: t, updated_at: t })),
    lessons: seed.lessons.map((l) => ({ ...l, created_at: t, updated_at: t })),
    lesson_progress: [], planner_tasks: [], weekly_notes: [], notes: [], pomodoro_settings: [],
    user_preferences: [], study_sessions: [], timer_state: [], admin_audit_log: [],
  };
}
let DB = readKey(DB_KEY) || freshDb();
const persist = () => writeKey(DB_KEY, DB);
persist();
export function resetDemo() { writeKey(DB_KEY, null); writeKey(SESSION_KEY, null); }

// ------------------------------------------------------------------ auth
const listeners = new Set();
let session = readKey(SESSION_KEY);
function emit(e) { listeners.forEach((fn) => { try { fn(e, session); } catch { /* ignore */ } }); }
function b64(json) { return btoa(unescape(encodeURIComponent(JSON.stringify(json)))).replace(/\+/g, '-').replace(/\//g, '_'); }
function setSession(user, event = 'SIGNED_IN') {
  session = user ? { access_token: `demo.${b64({ sub: user.id, email: user.email })}.sig`, refresh_token: 'demo', expires_at: 4102444800 } : null;
  writeKey(SESSION_KEY, session); emit(event);
}
const deny = (msg = 'permission denied') => new ApiError(msg, { status: 403, code: '42501' });

export const auth = {
  getSession: () => session,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  async signUp(email, password) {
    await wait();
    const e = email.trim().toLowerCase();
    if (DB.users.some((u) => u.email === e)) throw new ApiError('An account with this e-mail already exists. Sign in or reset your password.', { code: 'user_already_exists' });
    const id = uuid(); const t = now();
    DB.users.push({ id, email: e, password });
    DB.profiles.push({ id, email: e, display_name: null, role: 'student', status: 'pending', selected_year: null, selected_semester: null,
      status_changed_at: null, status_changed_by: null, created_at: t, updated_at: t });
    persist(); setSession({ id, email: e });
    return { session, user: { id, email: e } };
  },
  async signIn(email, password) {
    await wait();
    const u = DB.users.find((x) => x.email === String(email).trim().toLowerCase() && x.password === password);
    if (!u) throw new ApiError('Invalid login credentials', { status: 400, code: 'invalid_credentials' });
    setSession(u); return session;
  },
  async refresh() { return session; },
  async accessToken() { return session && session.access_token; },
  async signOut() { setSession(null, 'SIGNED_OUT'); },
  async resetPasswordForEmail() { await wait(); throw new ApiError('E-mails are not sent in this demo. In the real app, a reset link is e-mailed to you.'); },
  async updatePassword(password) {
    await wait(); const id = uidOrThrow(); const u = DB.users.find((x) => x.id === id);
    if (String(password).length < 6) throw new ApiError('Password should be at least 6 characters.');
    u.password = password; persist(); return { id, email: u.email };
  },
  consumeUrlHash() { return null; },
};

// ------------------------------------------------------------------ "row level security"
function currentUid() {
  if (!session) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))).sub; } catch { return null; }
}
function uidOrThrow() { const id = currentUid(); if (!id) throw new ApiError('Not signed in', { status: 401, kind: 'auth' }); return id; }
const me = () => DB.profiles.find((p) => p.id === currentUid());
const isApproved = () => { const p = me(); return !!p && p.status === 'approved'; };
const isAdmin = () => { const p = me(); return !!p && p.role === 'admin' && p.status === 'approved'; };
const PERSONAL = ['lesson_progress', 'planner_tasks', 'weekly_notes', 'notes', 'pomodoro_settings', 'user_preferences', 'study_sessions', 'timer_state'];

function canSee(table, row) {
  const id = currentUid();
  if (PERSONAL.includes(table)) return row.user_id === id && isApproved();
  if (table === 'profiles') return row.id === id || isAdmin();
  if (table === 'modules' || table === 'lessons') return isApproved() && (row.active || isAdmin());
  if (table === 'admin_audit_log') return isAdmin();
  return false;
}
function canWrite(table, row) {
  if (PERSONAL.includes(table)) return row.user_id === currentUid() && isApproved();
  if (table === 'modules' || table === 'lessons') return isAdmin();
  return false;
}

// ------------------------------------------------------------------ query helpers
function matches(row, [col, op, val]) {
  const v = row[col];
  switch (op) {
    case 'eq': return v !== null && v !== undefined && String(v) === String(val);
    case 'neq': return String(v) !== String(val);
    case 'gt': return v !== null && v !== undefined && String(v) > String(val);
    case 'gte': return v !== null && v !== undefined && String(v) >= String(val);
    case 'lt': return v !== null && v !== undefined && String(v) < String(val);
    case 'lte': return v !== null && v !== undefined && String(v) <= String(val);
    case 'ilike': return new RegExp(`^${String(val).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(String(v ?? ''));
    case 'is': return val === null ? v === null || v === undefined : v === val;
    case 'in': return val.map(String).includes(String(v));
    default: throw new ApiError(`unsupported filter ${op}`);
  }
}
function sorter(order) {
  const parts = order.map((o) => { const [c, ...m] = o.split('.'); return { c, desc: m.includes('desc'), nullsLast: !m.includes('nullsfirst') }; });
  return (a, b) => {
    for (const { c, desc, nullsLast } of parts) {
      const x = a[c]; const y = b[c];
      if (x === y) continue;
      if (x === null || x === undefined) return nullsLast ? 1 : -1;
      if (y === null || y === undefined) return nullsLast ? -1 : 1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (r) return desc ? -r : r;
    }
    return 0;
  };
}
function project(row, columns) {
  if (!columns || columns === '*') return clone(row);
  const out = {}; columns.split(',').forEach((c) => { out[c.trim()] = clone(row[c.trim()]); }); return out;
}

const DEFAULTS = {
  planner_tasks: () => ({ id: uuid(), description: null, start_time: null, end_time: null, priority: 'medium', category: 'other', status: 'todo', completed_at: null, notes: null, module_id: null, lesson_id: null }),
  notes: () => ({ id: uuid(), title: '', content: '', version: 1 }),
  pomodoro_settings: () => ({ focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, sessions_before_long_break: 4, sound_enabled: true }),
  user_preferences: () => ({ language: 'en', data: {} }),
  modules: () => ({ id: uuid(), year: 1, semester: null, parent_id: null, description: null, icon: null, hero: null, source_page: null, position: 0, active: true }),
  lessons: () => ({ id: uuid(), number: null, icon: null, note: null, position: 0, active: true }),
};
function triggers(table, row, old) {
  const t = now();
  if (table === 'planner_tasks') {
    if (!old || row.status !== old.status) row.completed_at = row.status === 'done' ? t : null;
    if (row.start_time && row.start_time.length === 5) row.start_time += ':00';
    if (row.end_time && row.end_time.length === 5) row.end_time += ':00';
    if (row.start_time && row.end_time && row.end_time <= row.start_time) throw new ApiError('Some values are not valid.', { code: '23514' });
    if (!row.title || !String(row.title).trim()) throw new ApiError('Some values are not valid.', { code: '23514' });
  }
  if (table === 'notes' && old) {
    if (row.title !== old.title || row.content !== old.content) { row.version = old.version + 1; row.updated_at = t; } else { row.updated_at = old.updated_at; }
    return;
  }
  if (table === 'modules' && row.parent_id) {
    let cur = row.parent_id; let depth = 1;
    while (cur) { if (cur === row.id) throw new ApiError('Module cannot be its own ancestor', { code: '23514' }); depth += 1; cur = (DB.modules.find((m) => m.id === cur) || {}).parent_id; if (depth > 4) throw new ApiError('Module tree too deep', { code: '23514' }); }
  }
  row.updated_at = t;
}
function cascadeDelete(table, row) {
  if (table === 'modules') {
    DB.modules.filter((m) => m.parent_id === row.id).forEach((c) => { cascadeDelete('modules', c); });
    DB.modules = DB.modules.filter((m) => m.id !== row.id);
    DB.lessons.filter((l) => l.module_id === row.id).forEach((l) => cascadeDelete('lessons', l));
  } else if (table === 'lessons') {
    DB.lessons = DB.lessons.filter((l) => l.id !== row.id);
    DB.lesson_progress = DB.lesson_progress.filter((p) => p.lesson_id !== row.id);
  }
}

export const db = {
  async select(table, { columns = '*', filters = [], order = [], limit } = {}) {
    await wait(60); uidOrThrow();
    let rows = (DB[table] || []).filter((r) => canSee(table, r)).filter((r) => filters.every((f) => matches(r, f)));
    if (order.length) rows = rows.slice().sort(sorter(order));
    if (limit) rows = rows.slice(0, limit);
    return rows.map((r) => project(r, columns));
  },
  async insert(table, rows) {
    await wait(); uidOrThrow();
    const out = [];
    for (const input of rows) {
      const t = now();
      const row = { ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...clone(input), created_at: t, updated_at: t };
      if (!canWrite(table, row)) throw deny();
      triggers(table, row, null);
      DB[table].push(row); out.push(clone(row));
    }
    persist(); return out;
  },
  async upsert(table, rows, onConflict) {
    await wait(); uidOrThrow();
    const keys = onConflict.split(',');
    const out = [];
    for (const input of rows) {
      const existing = DB[table].find((r) => keys.every((k) => String(r[k]) === String(input[k])));
      if (existing) {
        if (!canWrite(table, existing) || !canWrite(table, { ...existing, ...input })) throw deny();
        const old = clone(existing); Object.assign(existing, clone(input)); triggers(table, existing, old); out.push(clone(existing));
      } else {
        const t = now();
        const row = { ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...clone(input), created_at: t, updated_at: t };
        if (!canWrite(table, row)) throw deny();
        triggers(table, row, null); DB[table].push(row); out.push(clone(row));
      }
    }
    persist(); return out;
  },
  async update(table, patch, filters) {
    await wait(); uidOrThrow();
    const rows = (DB[table] || []).filter((r) => canSee(table, r)).filter((r) => filters.every((f) => matches(r, f)));
    if (table === 'profiles') {
      const allowed = ['display_name', 'selected_year', 'selected_semester'];
      if (Object.keys(patch).some((k) => !allowed.includes(k))) throw deny('permission denied for table profiles');
      const own = rows.filter((r) => r.id === currentUid() && r.status === 'approved');
      own.forEach((r) => { Object.assign(r, clone(patch)); r.updated_at = now(); });
      persist(); return own.map(clone);
    }
    const out = [];
    for (const r of rows) {
      if (!canWrite(table, r)) throw deny();
      const old = clone(r);
      const next = { ...r, ...clone(patch), id: r.id, user_id: r.user_id, created_at: r.created_at };
      if (!canWrite(table, next)) throw deny();
      triggers(table, next, old);
      Object.assign(r, next); out.push(clone(r));
    }
    persist(); return out;
  },
  async remove(table, filters) {
    await wait(); uidOrThrow();
    const rows = (DB[table] || []).filter((r) => canSee(table, r)).filter((r) => filters.every((f) => matches(r, f)));
    for (const r of rows) {
      if (!canWrite(table, r) && !(table === 'study_sessions' && r.user_id === currentUid())) throw deny();
      if (table === 'modules' || table === 'lessons') cascadeDelete(table, r);
      else DB[table] = DB[table].filter((x) => x !== r);
    }
    persist(); return rows.map(clone);
  },
  async rpc(fn, args = {}) {
    await wait(); uidOrThrow();
    const impl = RPC[fn];
    if (!impl) throw new ApiError(`function ${fn} not found`, { status: 404 });
    const out = impl(args);
    persist(); return clone(out);
  },
};

// ------------------------------------------------------------------ server functions
function requireApproved() { if (!isApproved()) throw deny('Account not approved'); }
function requireAdmin() { if (!isAdmin()) throw deny('Administrator only'); }

function settingsOf(id) { return DB.pomodoro_settings.find((s) => s.user_id === id) || DEFAULTS.pomodoro_settings(); }
function phaseSeconds(id, phase) {
  const s = settingsOf(id);
  return 60 * (phase === 'focus' ? s.focus_minutes : phase === 'short_break' ? s.short_break_minutes : s.long_break_minutes);
}
function elapsed(s) {
  let e = s.accumulated_seconds;
  if (s.status === 'running') e += Math.max(0, Math.floor((Date.now() - new Date(s.running_since).getTime()) / 1000));
  return Math.min(s.duration_seconds, e);
}
function timerEnsure() {
  requireApproved();
  const id = currentUid();
  let s = DB.timer_state.find((x) => x.user_id === id);
  if (!s) {
    s = { user_id: id, session_id: uuid(), phase: 'focus', status: 'idle', duration_seconds: phaseSeconds(id, 'focus'), accumulated_seconds: 0,
      running_since: null, started_at: null, module_id: null, lesson_id: null, task_id: null, focus_in_cycle: 0, updated_at: now() };
    DB.timer_state.push(s);
  }
  return s;
}
function timerJson(s, extra = {}) {
  const el = elapsed(s);
  return { state: clone(s), server_now: now(), elapsed_seconds: el, remaining_seconds: Math.max(0, s.duration_seconds - el), finished_phase: null, ...extra };
}
function recordSession(s, status, active, endedMs) {
  if (s.phase !== 'focus' || DB.study_sessions.some((x) => x.id === s.session_id)) return;
  DB.study_sessions.push({ id: s.session_id, user_id: s.user_id, module_id: s.module_id, lesson_id: s.lesson_id, task_id: s.task_id,
    planned_seconds: s.duration_seconds, active_seconds: active,
    started_at: s.started_at || new Date(endedMs - active * 1000).toISOString(), ended_at: new Date(endedMs).toISOString(), status, created_at: now() });
}
function finish(s) {
  const endedMs = s.status === 'running'
    ? Math.min(Date.now(), new Date(s.running_since).getTime() + Math.max(0, s.duration_seconds - s.accumulated_seconds) * 1000) : Date.now();
  let cyc = s.focus_in_cycle; let nxt;
  if (s.phase === 'focus') {
    recordSession(s, 'completed', s.duration_seconds, endedMs);
    cyc += 1;
    if (cyc >= settingsOf(s.user_id).sessions_before_long_break) { nxt = 'long_break'; cyc = 0; } else nxt = 'short_break';
  } else nxt = 'focus';
  Object.assign(s, { phase: nxt, status: 'idle', duration_seconds: phaseSeconds(s.user_id, nxt), accumulated_seconds: 0, running_since: null,
    started_at: null, session_id: uuid(), focus_in_cycle: cyc, updated_at: now() });
}
function idleReset(s, phase) {
  Object.assign(s, { phase, status: 'idle', running_since: null, started_at: null, accumulated_seconds: 0,
    duration_seconds: phaseSeconds(s.user_id, phase), session_id: uuid(), updated_at: now() });
}

const RPC = {
  admin_stats() {
    requireAdmin();
    const st = DB.profiles.filter((p) => p.role === 'student');
    const c = (k) => st.filter((p) => p.status === k).length;
    return { total: st.length, pending: c('pending'), approved: c('approved'), rejected: c('rejected'), suspended: c('suspended') };
  },
  admin_set_status({ p_user, p_status }) {
    requireAdmin();
    if (!['approved', 'rejected', 'suspended'].includes(p_status)) throw new ApiError(`Invalid status ${p_status}`, { code: '22023' });
    const t = DB.profiles.find((p) => p.id === p_user);
    if (!t) throw new ApiError('User not found', { status: 404 });
    if (t.id === currentUid()) throw deny('You cannot change your own status');
    if (t.role === 'admin') throw deny('Administrator accounts cannot be changed here');
    const ok = (t.status === 'pending' && ['approved', 'rejected'].includes(p_status)) || (t.status === 'rejected' && p_status === 'approved')
      || (t.status === 'approved' && p_status === 'suspended') || (t.status === 'suspended' && p_status === 'approved');
    if (!ok) throw new ApiError(`Transition ${t.status} -> ${p_status} is not allowed`, { code: '22023' });
    DB.admin_audit_log.push({ id: DB.admin_audit_log.length + 1, admin_id: currentUid(), target_id: t.id, target_email: t.email, action: 'set_status',
      old_status: t.status, new_status: p_status, created_at: now() });
    Object.assign(t, { status: p_status, status_changed_at: now(), status_changed_by: currentUid(), updated_at: now() });
    return t;
  },
  admin_reorder_modules({ p_ids }) { requireAdmin(); p_ids.forEach((id, i) => { const m = DB.modules.find((x) => x.id === id); if (m) m.position = i + 1; }); return null; },
  admin_reorder_lessons({ p_ids }) { requireAdmin(); p_ids.forEach((id, i) => { const l = DB.lessons.find((x) => x.id === id); if (l) l.position = i + 1; }); return null; },
  set_lesson_stage({ p_lesson, p_stage, p_value }) {
    if (!['learned', 'revised1', 'revised2', 'qcm'].includes(p_stage)) throw new ApiError(`Unknown stage ${p_stage}`, { code: '22023' });
    requireApproved();
    if (!DB.lessons.some((l) => l.id === p_lesson && l.active)) throw new ApiError('Lesson not found', { status: 404 });
    const id = currentUid(); const t = now();
    let r = DB.lesson_progress.find((x) => x.user_id === id && x.lesson_id === p_lesson);
    if (!r) {
      r = { user_id: id, lesson_id: p_lesson, learned: false, revised1: false, revised2: false, qcm: false,
        learned_at: null, revised1_at: null, revised2_at: null, qcm_at: null, created_at: t, updated_at: t };
      DB.lesson_progress.push(r);
    }
    r[p_stage] = !!p_value; r[`${p_stage}_at`] = p_value ? (r[`${p_stage}_at`] || t) : null; r.updated_at = t;
    return r;
  },
  save_weekly_notes({ p_week, p_notes, p_expected_version }) {
    requireApproved();
    if (new Date(`${p_week}T12:00:00`).getDay() !== 1) throw new ApiError('Week must start on a Monday', { code: '23514' });
    const id = currentUid(); const t = now();
    const fields = ['goals', 'reminders', 'study_notes', 'review_topics', 'planning_notes'];
    let r = DB.weekly_notes.find((x) => x.user_id === id && x.week_start === p_week);
    if (p_expected_version === 0) {
      if (r) throw new ApiError('version_conflict', { code: 'P0001' });
      r = { user_id: id, week_start: p_week, version: 1, created_at: t, updated_at: t };
      fields.forEach((f) => { r[f] = (p_notes && p_notes[f]) || ''; });
      DB.weekly_notes.push(r); return r;
    }
    if (!r || r.version !== p_expected_version) throw new ApiError('version_conflict', { code: 'P0001' });
    fields.forEach((f) => { if (p_notes && typeof p_notes[f] === 'string') r[f] = p_notes[f]; });
    r.version += 1; r.updated_at = t; return r;
  },
  timer_sync() {
    const s = timerEnsure(); let fin = null;
    if (s.status === 'running' && elapsed(s) >= s.duration_seconds) { fin = s.phase; finish(s); }
    return timerJson(s, { finished_phase: fin });
  },
  timer_start({ p_module = null, p_lesson = null, p_task = null } = {}) {
    const s = timerEnsure();
    if (s.status === 'running') return timerJson(s);
    if (s.status === 'idle') {
      Object.assign(s, { status: 'running', running_since: now(), started_at: now(), accumulated_seconds: 0, duration_seconds: phaseSeconds(s.user_id, s.phase) });
      if (p_module) s.module_id = p_module;
      if (p_module || p_lesson) s.lesson_id = p_lesson;
      if (p_task) s.task_id = p_task;
    } else { s.status = 'running'; s.running_since = now(); }
    s.updated_at = now(); return timerJson(s);
  },
  timer_pause() {
    const s = timerEnsure(); let fin = null;
    if (s.status === 'running') {
      if (elapsed(s) >= s.duration_seconds) { fin = s.phase; finish(s); }
      else Object.assign(s, { accumulated_seconds: elapsed(s), running_since: null, status: 'paused', updated_at: now() });
    }
    return timerJson(s, { finished_phase: fin });
  },
  timer_resume() {
    const s = timerEnsure();
    if (s.status === 'paused') Object.assign(s, { status: 'running', running_since: now(), updated_at: now() });
    return timerJson(s);
  },
  timer_complete() {
    const s = timerEnsure(); let fin = null;
    if (s.status === 'running') {
      if (elapsed(s) >= s.duration_seconds - 2) { fin = s.phase; finish(s); }
      else throw new ApiError('timer_not_finished', { code: 'P0001' });
    }
    return timerJson(s, { finished_phase: fin });
  },
  timer_reset() {
    const s = timerEnsure(); const act = elapsed(s);
    if (s.status !== 'idle' && s.phase === 'focus' && act >= 60) recordSession(s, 'interrupted', act, Date.now());
    idleReset(s, s.phase); return timerJson(s);
  },
  timer_skip() {
    const s = timerEnsure(); const act = elapsed(s); let nxt;
    if (s.phase === 'focus') {
      if (s.status !== 'idle' && act >= 60) recordSession(s, 'interrupted', act, Date.now());
      nxt = s.focus_in_cycle + 1 >= settingsOf(s.user_id).sessions_before_long_break ? 'long_break' : 'short_break';
    } else nxt = 'focus';
    idleReset(s, nxt); return timerJson(s);
  },
  timer_set_phase({ p_phase }) {
    const s = timerEnsure();
    if (s.status !== 'idle') throw new ApiError('timer_busy', { code: 'P0001' });
    idleReset(s, p_phase); return timerJson(s);
  },
  timer_set_association({ p_module, p_lesson, p_task }) {
    const s = timerEnsure(); Object.assign(s, { module_id: p_module, lesson_id: p_lesson, task_id: p_task, updated_at: now() }); return timerJson(s);
  },
  timer_apply_settings() {
    const s = timerEnsure();
    if (s.status === 'idle') { s.duration_seconds = phaseSeconds(s.user_id, s.phase); s.updated_at = now(); }
    return timerJson(s);
  },
  server_now() { return now(); },
};
