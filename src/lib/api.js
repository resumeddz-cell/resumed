// Data access layer. Every function talks to the real database; nothing is faked or cached as "truth".
import { db, auth, ApiError } from './supabase.js';

export function currentUserId() {
  const s = auth.getSession();
  if (!s || !s.access_token) return null;
  try {
    const part = s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part)))).sub || null;
  } catch { return null; }
}
const uid = () => { const id = currentUserId(); if (!id) throw new ApiError('Not signed in', { kind: 'auth', status: 401 }); return id; };
const one = (rows) => (Array.isArray(rows) ? rows[0] || null : rows);

// ------------------------------------------------------------- profile & preferences
export const profileApi = {
  async me() { return one(await db.select('profiles', { filters: [['id', 'eq', uid()]] })); },
  async update(patch) {
    const row = one(await db.update('profiles', patch, [['id', 'eq', uid()]]));
    if (!row) throw new ApiError('Your profile could not be updated.');
    return row;
  },
};
export const prefsApi = {
  async get() { return one(await db.select('user_preferences', { filters: [['user_id', 'eq', uid()]] })); },
  async merge(dataPatch) {
    const cur = await prefsApi.get();
    const data = { ...((cur && cur.data) || {}), ...dataPatch };
    return one(await db.upsert('user_preferences', [{ user_id: uid(), data }], 'user_id'));
  },
};

// ------------------------------------------------------------- curriculum & progress
export const curriculumApi = {
  modules: async () => db.select('modules', { order: ['position.asc', 'title.asc'] }),
  lessons: async () => db.select('lessons', { order: ['position.asc'] }),
  myProgress: async () => db.select('lesson_progress', { filters: [['user_id', 'eq', uid()]] }),
  setStage: async (lessonId, stage, value) => db.rpc('set_lesson_stage', { p_lesson: lessonId, p_stage: stage, p_value: value }),
};

// ------------------------------------------------------------- planner
export const plannerApi = {
  tasksBetween: async (fromISO, toISO) => db.select('planner_tasks', {
    filters: [['user_id', 'eq', uid()], ['task_date', 'gte', fromISO], ['task_date', 'lte', toISO]],
    order: ['task_date.asc', 'start_time.asc.nullslast', 'created_at.asc'],
  }),
  allTasks: async () => db.select('planner_tasks', { filters: [['user_id', 'eq', uid()]], order: ['task_date.asc'] }),
  async create(task) { return one(await db.insert('planner_tasks', [{ ...task, user_id: uid() }])); },
  async update(id, patch) {
    const row = one(await db.update('planner_tasks', patch, [['id', 'eq', id], ['user_id', 'eq', uid()]]));
    if (!row) throw new ApiError('This task no longer exists (it may have been deleted on another device).');
    return row;
  },
  async remove(id) { await db.remove('planner_tasks', [['id', 'eq', id], ['user_id', 'eq', uid()]]); },
  async weekNotes(weekISO) {
    return one(await db.select('weekly_notes', { filters: [['user_id', 'eq', uid()], ['week_start', 'eq', weekISO]] }));
  },
  saveWeekNotes: async (weekISO, notes, expectedVersion) =>
    db.rpc('save_weekly_notes', { p_week: weekISO, p_notes: notes, p_expected_version: expectedVersion }),
  weeksWithNotes: async () => db.select('weekly_notes', { columns: 'week_start,updated_at', filters: [['user_id', 'eq', uid()]], order: ['week_start.desc'] }),
};

// ------------------------------------------------------------- global notes
export const notesApi = {
  list: async () => db.select('notes', { filters: [['user_id', 'eq', uid()]], order: ['updated_at.desc'] }),
  async create(title = '', content = '') { return one(await db.insert('notes', [{ user_id: uid(), title, content }])); },
  // Optimistic concurrency: only updates if nobody saved a newer version meanwhile.
  async update(id, version, patch) {
    const row = one(await db.update('notes', patch, [['id', 'eq', id], ['version', 'eq', version], ['user_id', 'eq', uid()]]));
    if (!row) {
      const latest = one(await db.select('notes', { filters: [['id', 'eq', id]] }));
      throw new ApiError(latest ? 'version_conflict' : 'This note was deleted on another device.', { code: latest ? 'version_conflict' : 'gone', details: latest });
    }
    return row;
  },
  async remove(id) { await db.remove('notes', [['id', 'eq', id], ['user_id', 'eq', uid()]]); },
};

// ------------------------------------------------------------- pomodoro
export const DEFAULT_POMODORO = { focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, sessions_before_long_break: 4, sound_enabled: true };
export const pomodoroApi = {
  async settings() { return one(await db.select('pomodoro_settings', { filters: [['user_id', 'eq', uid()]] })); },
  async saveSettings(s) {
    const row = one(await db.upsert('pomodoro_settings', [{ ...s, user_id: uid(), updated_at: new Date().toISOString() }], 'user_id'));
    await db.rpc('timer_apply_settings');
    return row;
  },
  sync: async () => db.rpc('timer_sync'),
  start: async (moduleId = null, lessonId = null, taskId = null) => db.rpc('timer_start', { p_module: moduleId, p_lesson: lessonId, p_task: taskId }),
  pause: async () => db.rpc('timer_pause'),
  resume: async () => db.rpc('timer_resume'),
  complete: async () => db.rpc('timer_complete'),
  reset: async () => db.rpc('timer_reset'),
  skip: async () => db.rpc('timer_skip'),
  setPhase: async (phase) => db.rpc('timer_set_phase', { p_phase: phase }),
  associate: async (moduleId, lessonId, taskId) => db.rpc('timer_set_association', { p_module: moduleId || null, p_lesson: lessonId || null, p_task: taskId || null }),
};

// ------------------------------------------------------------- study history
export const sessionsApi = {
  since: async (iso) => db.select('study_sessions', {
    filters: [['user_id', 'eq', uid()], ...(iso ? [['started_at', 'gte', iso]] : [])], order: ['started_at.desc'],
  }),
  all: async () => db.select('study_sessions', { filters: [['user_id', 'eq', uid()]], order: ['started_at.desc'] }),
  async remove(id) { await db.remove('study_sessions', [['id', 'eq', id], ['user_id', 'eq', uid()]]); },
};

// ------------------------------------------------------------- administration
export const adminApi = {
  stats: async () => db.rpc('admin_stats'),
  profiles({ search = '', status = '' } = {}) {
    const filters = [];
    if (search.trim()) filters.push(['email', 'ilike', `*${search.trim()}*`]);
    if (status) filters.push(['status', 'eq', status]);
    return db.select('profiles', { filters, order: ['created_at.desc'], limit: 1000 });
  },
  setStatus: async (userId, status) => db.rpc('admin_set_status', { p_user: userId, p_status: status }),
  audit: async () => db.select('admin_audit_log', { order: ['created_at.desc'], limit: 50 }),
  async createModule(m) { return one(await db.insert('modules', [m])); },
  async updateModule(id, patch) { return one(await db.update('modules', patch, [['id', 'eq', id]])); },
  async deleteModule(id) { await db.remove('modules', [['id', 'eq', id]]); },
  async createLesson(l) { return one(await db.insert('lessons', [l])); },
  async updateLesson(id, patch) { return one(await db.update('lessons', patch, [['id', 'eq', id]])); },
  async deleteLesson(id) { await db.remove('lessons', [['id', 'eq', id]]); },
  reorderModules: async (ids) => db.rpc('admin_reorder_modules', { p_ids: ids }),
  reorderLessons: async (ids) => db.rpc('admin_reorder_lessons', { p_ids: ids }),
};

export function errorMessage(e) {
  if (!e) return 'Something went wrong.';
  if (e.kind === 'network') return e.message;
  if (e.status === 403 || e.code === '42501') return 'You are not allowed to do this. Your access may have changed — try reloading.';
  if (e.code === '23505') return 'This already exists.';
  if (e.code === '23514') return 'Some values are not valid.';
  return e.message || 'Something went wrong.';
}
