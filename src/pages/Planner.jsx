import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuPlus, LuCalendarCheck, LuTrash2, LuCheck, LuTriangleAlert } from 'react-icons/lu';
import { plannerApi, currentUserId, errorMessage } from '../lib/api.js';
import { mondayOf, addDays, toISODate, parseISODate, today, DAY_NAMES, fmtDate, minutesBetween, fmtDuration } from '../lib/dates.js';
import { useAuth } from '../state/auth.jsx';
import { sectionInfo } from '../lib/years.js';
import { useCurriculum } from '../state/data.jsx';
import { useToast } from '../state/toast.jsx';
import { navigate } from '../lib/router.js';
import { allLessons } from '../lib/progress.js';
import { useAutosave, drafts } from '../lib/autosave.js';
import { Loader, ErrorBox, PageHeader, Modal, Field, SaveStatus } from '../components/ui.jsx';

export const CATEGORIES = [
  ['lectures', 'Lectures'], ['revision', 'Revision'], ['qcm', 'QCM Practice'],
  ['practical', 'Practical Work'], ['personal', 'Personal Tasks'], ['other', 'Other'],
];
export const CAT_LABEL = Object.fromEntries(CATEGORIES);
const PRIORITIES = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const NOTE_FIELDS = [
  ['goals', 'Weekly goals', 'Objectif de la semaine…'],
  ['reminders', 'Important reminders', 'Rappelle-toi…'],
  ['study_notes', 'Study notes', ''],
  ['review_topics', 'Topics to review', ''],
  ['planning_notes', 'Personal planning notes', ''],
];
const EMPTY_NOTES = { goals: '', reminders: '', study_notes: '', review_topics: '', planning_notes: '' };
const DAY_TONES = ['teal', 'pink', 'teal', 'pink', 'teal', 'pink', 'teal'];

export function useModuleOptions() {
  const { ready, tree } = useCurriculum();
  const { profile } = useAuth();
  const year = profile.selected_year || 1;
  return useMemo(() => {
    if (!ready) return { modules: [], lessonsFor: () => [] };
    const out = [];
    const walk = (n, prefix) => {
      if (n.active === false) return;
      const label = prefix ? `${prefix} › ${n.title}` : `${sectionInfo(n.semester, n.year).short} · ${n.title}`;
      out.push({ id: n.id, label }); n.children.forEach((c) => walk(c, label));
    };
    tree.roots.filter((r) => r.year === year).forEach((r) => walk(r, ''));
    const lessonsFor = (id) => {
      const n = id && tree.nodes.get(id); if (!n) return [];
      return allLessons(n).map((l) => ({ id: l.id, label: `${l.number ? `${l.number}. ` : ''}${l.title}`, module_id: l.module_id }));
    };
    return { modules: out, lessonsFor, lessonModule: (lid) => { const l = lid && (tree && [...tree.nodes.values()].flatMap((n) => n.lessons).find((x) => x.id === lid)); return l ? l.module_id : null; } };
  }, [ready, tree, year]);
}

function TaskModal({ task, onClose, onSaved, onDeleted }) {
  const opts = useModuleOptions();
  const isNew = !task.id;
  const [f, setF] = useState(() => ({
    title: task.title || '', description: task.description || '', task_date: task.task_date,
    start_time: task.start_time ? task.start_time.slice(0, 5) : '', end_time: task.end_time ? task.end_time.slice(0, 5) : '',
    priority: task.priority || 'medium', category: task.category || 'other', status: task.status || 'todo',
    notes: task.notes || '', module_id: task.module_id || '', lesson_id: task.lesson_id || '',
  }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [confirmDel, setConfirmDel] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'module_id' ? { lesson_id: '' } : {}) }));
  const timeErr = f.start_time && f.end_time && f.end_time <= f.start_time ? 'End time must be after start time.' : null;
  const save = async (e) => {
    e && e.preventDefault();
    if (!f.title.trim() || timeErr || !f.task_date) return;
    setBusy(true); setErr(null);
    const payload = { ...f, title: f.title.trim(), start_time: f.start_time || null, end_time: f.end_time || null,
      module_id: f.module_id || null, lesson_id: f.lesson_id || null, description: f.description || null, notes: f.notes || null };
    try {
      const row = isNew ? await plannerApi.create(payload) : await plannerApi.update(task.id, payload);
      onSaved(row, task);
    } catch (x) { setErr(errorMessage(x)); }      // the form keeps everything that was typed
    finally { setBusy(false); }
  };
  const del = async () => {
    setBusy(true); setErr(null);
    try { await plannerApi.remove(task.id); onDeleted(task); } catch (x) { setErr(errorMessage(x)); setBusy(false); }
  };
  const lessons = opts.lessonsFor(f.module_id);
  return (
    <Modal open title={isNew ? 'New task' : 'Edit task'} onClose={onClose} wide footer={(
      <>
        {!isNew && (confirmDel
          ? <span className="row gap"><span className="small">Delete this task?</span><button className="btn btn-danger" disabled={busy} onClick={del}>Yes, delete</button>
              <button className="btn" onClick={() => setConfirmDel(false)}>No</button></span>
          : <button className="btn btn-ghost-danger" onClick={() => setConfirmDel(true)}><LuTrash2 aria-hidden /> Delete</button>)}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.title.trim() || !!timeErr} onClick={save}>{busy ? 'Saving…' : 'Save task'}</button>
      </>
    )}>
      <form className="form-grid" onSubmit={save}>
        <Field label="Title *"><input value={f.title} onChange={set('title')} maxLength={200} required /></Field>
        <Field label="Date (reschedule here)"><input type="date" value={f.task_date} onChange={set('task_date')} required /></Field>
        <div className="two">
          <Field label="Start time"><input type="time" value={f.start_time} onChange={set('start_time')} /></Field>
          <Field label="End time" error={timeErr}><input type="time" value={f.end_time} onChange={set('end_time')} /></Field>
        </div>
        <div className="two">
          <Field label="Priority"><select value={f.priority} onChange={set('priority')}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Category"><select value={f.category} onChange={set('category')}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <Field label="Medical module (optional)">
          <select value={f.module_id} onChange={set('module_id')}><option value="">—</option>
            {opts.modules.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        </Field>
        <Field label="Lesson (optional)">
          <select value={f.lesson_id} onChange={set('lesson_id')} disabled={!f.module_id}><option value="">—</option>
            {lessons.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
        </Field>
        <Field label="Description"><textarea rows={2} value={f.description} onChange={set('description')} maxLength={5000} /></Field>
        <Field label="Personal notes"><textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={5000} /></Field>
        {!isNew && (
          <label className="check-line"><input type="checkbox" checked={f.status === 'done'} onChange={(e) => setF((x) => ({ ...x, status: e.target.checked ? 'done' : 'todo' }))} /> Completed</label>
        )}
        {err && <p className="form-error" role="alert">Not saved: {err}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function WeeklyNotes({ weekISO }) {
  const uid = currentUserId();
  const draftKey = `resumed.draft.week.${uid}.${weekISO}`;
  const [notes, setNotes] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState('goals');
  const [conflict, setConflict] = useState(null);
  const version = useRef(0);
  const toast = useToast();

  const save = useCallback(async (payload) => {
    const row = await plannerApi.saveWeekNotes(weekISO, payload, version.current);
    version.current = row.version;
    drafts.clear(draftKey);
  }, [weekISO, draftKey]);
  const auto = useAutosave(save, 900);

  const load = useCallback(async () => {
    setNotes(null); setLoadErr(null); setConflict(null); auto.discard();
    try {
      const row = await plannerApi.weekNotes(weekISO);
      version.current = row ? row.version : 0;
      const server = row ? Object.fromEntries(NOTE_FIELDS.map(([k]) => [k, row[k] || ''])) : { ...EMPTY_NOTES };
      const d = drafts.get(draftKey);
      if (d && JSON.stringify(d.notes) !== JSON.stringify(server)) {
        if (d.baseVersion === version.current) { setNotes(d.notes); auto.schedule(d.notes); toast.info('Restored unsaved weekly notes — saving them now.'); return; }
        setConflict({ mine: d.notes, theirs: server });
      }
      setNotes(server);
    } catch (e) { setLoadErr(e); }
  }, [weekISO, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const change = (k, v) => {
    const next = { ...notes, [k]: v };
    setNotes(next);
    drafts.set(draftKey, { notes: next, baseVersion: version.current, at: Date.now() });
    auto.schedule(next);
  };
  const keepMine = async () => {
    const mine = conflict ? conflict.mine : notes;
    const row = await plannerApi.weekNotes(weekISO).catch(() => null);
    version.current = row ? row.version : 0;
    setConflict(null); setNotes(mine);
    drafts.set(draftKey, { notes: mine, baseVersion: version.current, at: Date.now() });
    auto.schedule(mine); auto.flush();
  };
  const takeTheirs = () => { drafts.clear(draftKey); auto.discard(); load(); };

  useEffect(() => { if (auto.status === 'conflict') setConflict({ mine: notes, theirs: null }); }, [auto.status]); // eslint-disable-line

  if (loadErr) return <ErrorBox error={loadErr} onRetry={load} title="Weekly notes could not be loaded" />;
  if (!notes) return <Loader label="Loading weekly notes…" />;
  return (
    <section className="card weekly-notes">
      <div className="row between wrap">
        <h2 className="h3">Weekly notes</h2>
        <SaveStatus status={auto.status === 'conflict' ? 'error' : auto.status} onRetry={() => auto.flush()} />
      </div>
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <LuTriangleAlert aria-hidden /> These notes were changed on another device after your last save.
          <div className="row gap wrap"><button className="btn btn-small btn-primary" onClick={keepMine}>Keep my version</button>
            <button className="btn btn-small" onClick={takeTheirs}>Load the other version</button></div>
        </div>
      )}
      <div className="tabs" role="tablist">
        {NOTE_FIELDS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}{notes[k] ? ' •' : ''}</button>
        ))}
      </div>
      {NOTE_FIELDS.filter(([k]) => k === tab).map(([k, label, ph]) => (
        <textarea key={k} className="lined" rows={8} aria-label={label} placeholder={ph} value={notes[k]}
                  onChange={(e) => change(k, e.target.value)} onBlur={() => auto.flush()} />
      ))}
    </section>
  );
}

export default function PlannerPage({ query }) {
  const weekParam = query.get('week');
  const monday = useMemo(() => mondayOf(weekParam ? parseISODate(weekParam) : today()), [weekParam]);
  const weekISO = toISODate(monday);
  const [tasks, setTasks] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [past, setPast] = useState([]);
  const toast = useToast();
  const opts = useModuleOptions();
  const { ready, tree } = useCurriculum();

  const load = useCallback(async () => {
    setTasks(null); setErr(null);
    try { setTasks(await plannerApi.tasksBetween(weekISO, toISODate(addDays(monday, 6)))); }
    catch (e) { setErr(e); }
    plannerApi.weeksWithNotes().then(setPast).catch(() => {});
  }, [weekISO]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  // "Plan it" from a lesson: open a prefilled task
  const lessonParam = query.get('lesson');
  useEffect(() => {
    if (!lessonParam || !ready) return;
    const l = [...tree.nodes.values()].flatMap((n) => n.lessons).find((x) => x.id === lessonParam);
    if (l) setEditing({ task_date: toISODate(today()), title: l.title, category: 'revision', module_id: l.module_id, lesson_id: l.id });
    navigate(`/planner${weekParam ? `?week=${weekParam}` : ''}`, { replace: true });
  }, [lessonParam, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const goWeek = (d) => navigate(`/planner?week=${toISODate(mondayOf(d))}`);
  const toggle = async (task) => {
    try {
      const row = await plannerApi.update(task.id, { status: task.status === 'done' ? 'todo' : 'done' });
      setTasks((ts) => ts.map((x) => (x.id === row.id ? row : x)));
    } catch (e) { toast.error(`Not saved: ${errorMessage(e)}`, { action: 'Retry', onAction: () => toggle(task) }); }
  };
  const onSaved = (row) => {
    setEditing(null);
    const inWeek = row.task_date >= weekISO && row.task_date <= toISODate(addDays(monday, 6));
    setTasks((ts) => { const rest = ts.filter((x) => x.id !== row.id); return inWeek ? [...rest, row] : rest; });
    toast.ok(inWeek ? 'Task saved' : `Task saved and moved to ${fmtDate(row.task_date)}`);
  };
  const onDeleted = (task) => { setEditing(null); setTasks((ts) => ts.filter((x) => x.id !== task.id)); toast.ok('Task deleted'); };

  const isCurrent = weekISO === toISODate(mondayOf(today()));
  const sunday = addDays(monday, 6);
  const plannedMin = tasks ? tasks.reduce((n, x) => n + minutesBetween(x.start_time, x.end_time), 0) : 0;
  const done = tasks ? tasks.filter((x) => x.status === 'done').length : 0;
  const moduleName = (id) => { const m = opts.modules.find((x) => x.id === id); return m ? m.label.split(' › ').pop().replace(/^S\d · /, '') : null; };
  const sortTasks = (a, b) => (a.start_time || '99').localeCompare(b.start_time || '99') || a.created_at.localeCompare(b.created_at);

  return (
    <div className="page planner">
      <PageHeader title="Weekly Planner" subtitle="Petit pas chaque jour = grands résultats ♡" hero="art/feat_planner.webp" />
      <div className="week-bar card">
        <button className="icon-btn" aria-label="Previous week" onClick={() => goWeek(addDays(monday, -7))}><LuChevronLeft /></button>
        <div className="week-label">
          <strong>Week of {fmtDate(monday, { day: 'numeric', month: 'long' })} – {fmtDate(sunday, { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
          {tasks && <span className="muted small">{done}/{tasks.length} tasks done · planned {fmtDuration(plannedMin * 60)}</span>}
        </div>
        <button className="icon-btn" aria-label="Next week" onClick={() => goWeek(addDays(monday, 7))}><LuChevronRight /></button>
        <div className="week-tools">
          {!isCurrent && <button className="btn btn-small" onClick={() => navigate('/planner')}><LuCalendarCheck aria-hidden /> This week</button>}
          <input type="date" aria-label="Go to a date" value="" onChange={(e) => e.target.value && goWeek(parseISODate(e.target.value))} />
          <button className="btn btn-small btn-primary" onClick={() => setEditing({ task_date: isCurrent ? toISODate(today()) : weekISO })}><LuPlus aria-hidden /> Add task</button>
        </div>
      </div>
      {past.length > 0 && (
        <details className="past-weeks"><summary>Weeks with notes ({past.length})</summary>
          <div className="chips">{past.map((w) => (
            <button key={w.week_start} className={`chip ${w.week_start === weekISO ? 'active' : ''}`} onClick={() => navigate(`/planner?week=${w.week_start}`)}>
              {fmtDate(w.week_start, { day: 'numeric', month: 'short', year: 'numeric' })}</button>))}</div>
        </details>
      )}
      {err ? <ErrorBox error={err} onRetry={load} title="Tasks could not be loaded" /> : !tasks ? <Loader /> : (
        <div className="week-grid">
          {DAY_NAMES.map((dn, i) => {
            const d = addDays(monday, i); const iso = toISODate(d);
            const list = tasks.filter((x) => x.task_date === iso).sort(sortTasks);
            const isToday = iso === toISODate(today());
            return (
              <section key={iso} className={`day card tone-${DAY_TONES[i]} ${isToday ? 'today' : ''}`} aria-label={`${dn} ${fmtDate(d)}`}>
                <header><strong>{dn}</strong><span className="muted small">{fmtDate(d)}</span></header>
                <ul>
                  {list.map((x) => (
                    <li key={x.id} className={`task ${x.status === 'done' ? 'done' : ''}`}>
                      <input type="checkbox" checked={x.status === 'done'} onChange={() => toggle(x)} aria-label={`${x.status === 'done' ? 'Reopen' : 'Complete'} ${x.title}`} />
                      <button className="task-body" onClick={() => setEditing(x)}>
                        <span className="task-title"><i className={`dot prio-${x.priority}`} aria-label={`${x.priority} priority`} />{x.title}</span>
                        <span className="task-meta">
                          {x.start_time && <span>{x.start_time.slice(0, 5)}{x.end_time ? `–${x.end_time.slice(0, 5)}` : ''}</span>}
                          <span className={`cat cat-${x.category}`}>{CAT_LABEL[x.category]}</span>
                          {x.module_id && moduleName(x.module_id) && <span className="tag">{moduleName(x.module_id)}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {list.length === 0 && <p className="muted small empty-day">No tasks</p>}
                <button className="add-day" onClick={() => setEditing({ task_date: iso })}><LuPlus aria-hidden /> Add</button>
              </section>
            );
          })}
          <section className="day card reminder-card">
            <header><strong>Rappelle-toi :</strong></header>
            <ul className="affirm">
              <li><LuCheck aria-hidden /> Tu fais de ton mieux</li><li><LuCheck aria-hidden /> Tu progresses chaque jour</li>
              <li><LuCheck aria-hidden /> Tes efforts comptent</li><li><LuCheck aria-hidden /> Tu vas y arriver</li>
            </ul>
          </section>
        </div>
      )}
      <WeeklyNotes key={weekISO} weekISO={weekISO} />
      {editing && <TaskModal task={editing} onClose={() => setEditing(null)} onSaved={onSaved} onDeleted={onDeleted} />}
    </div>
  );
}

