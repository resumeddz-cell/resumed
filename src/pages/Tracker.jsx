import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LuTrash2 } from 'react-icons/lu';
import { sessionsApi, plannerApi, errorMessage } from '../lib/api.js';
import { useCurriculum } from '../state/data.jsx';
import { useToast } from '../state/toast.jsx';
import { mondayOf, addDays, toISODate, today, fmtDate, fmtTime, fmtDuration, minutesBetween, localDayKey, parseISODate } from '../lib/dates.js';
import { Loader, ErrorBox, PageHeader, Stat, Empty } from '../components/ui.jsx';

const RANGES = [['week', 'This week'], ['30', 'Last 30 days'], ['all', 'All time']];

function rangeStart(r) {
  if (r === 'week') return mondayOf(today());
  if (r === '30') return addDays(today(), -29);
  return null;
}

export default function TrackerPage() {
  const [range, setRange] = useState('week');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const cur = useCurriculum();
  const toast = useToast();

  const load = useCallback(async () => {
    setData(null); setErr(null);
    const start = rangeStart(range);
    try {
      const [sessions, tasks] = await Promise.all([
        sessionsApi.since(start ? start.toISOString() : null),
        start ? plannerApi.tasksBetween(toISODate(start), toISODate(range === 'week' ? addDays(mondayOf(today()), 6) : today()))
              : plannerApi.allTasks(),
      ]);
      setData({ sessions, tasks });
    } catch (e) { setErr(e); }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const names = useMemo(() => {
    if (!cur.ready) return { mod: () => null, les: () => null };
    const les = new Map(cur.lessons.map((l) => [l.id, l]));
    return { mod: (id) => (cur.tree.nodes.get(id) || {}).title, les: (id) => (les.get(id) || {}).title };
  }, [cur.ready, cur.lessons, cur.tree]);

  const remove = async (s) => {
    setConfirm(null);
    try { await sessionsApi.remove(s.id); setData((d) => ({ ...d, sessions: d.sessions.filter((x) => x.id !== s.id) })); toast.ok('Session deleted from your history'); }
    catch (e) { toast.error(`Not deleted: ${errorMessage(e)}`); }
  };

  const start = rangeStart(range);
  const learnedInRange = cur.ready ? cur.rows.filter((r) => r.learned && r.learned_at && (!start || new Date(r.learned_at) >= start)).length : null;

  let body;
  if (err) body = <ErrorBox error={err} onRetry={load} title="Your history could not be loaded" />;
  else if (!data || !cur.ready) body = <Loader />;
  else {
    const { sessions, tasks } = data;
    const completed = sessions.filter((s) => s.status === 'completed');
    const interrupted = sessions.filter((s) => s.status === 'interrupted');
    const studySec = sessions.reduce((n, s) => n + s.active_seconds, 0);
    const studyTasks = tasks.filter((x) => x.category !== 'personal');
    const plannedSec = studyTasks.reduce((n, x) => n + minutesBetween(x.start_time, x.end_time) * 60, 0);
    const tasksDone = tasks.filter((x) => x.status === 'done').length;
    // per-day table
    const days = new Map();
    const day = (k) => { if (!days.has(k)) days.set(k, { key: k, planned: 0, done: 0, sessions: 0, tasks: 0 }); return days.get(k); };
    studyTasks.forEach((x) => { day(x.task_date).planned += minutesBetween(x.start_time, x.end_time) * 60; });
    tasks.forEach((x) => { if (x.status === 'done') day(x.task_date).tasks += 1; });
    sessions.forEach((s) => { const d = day(localDayKey(s.started_at)); d.done += s.active_seconds; if (s.status === 'completed') d.sessions += 1; });
    const rows = [...days.values()].sort((a, b) => b.key.localeCompare(a.key));
    const byDay = new Map();
    sessions.forEach((s) => { const k = localDayKey(s.started_at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); });

    body = (
      <>
        <div className="stats-grid">
          <Stat label="Completed study time" value={fmtDuration(studySec)} sub="active focus time (pauses excluded)" />
          <Stat tone="lilac" label="Planned study time" value={fmtDuration(plannedSec)} sub="from planner tasks with start & end times" />
          <Stat tone="pink" label="Completed focus sessions" value={completed.length} sub={`${interrupted.length} interrupted`} />
          <Stat tone="blue" label="Tasks · lessons completed" value={`${tasksDone} · ${learnedInRange}`} sub={`${tasks.length - tasksDone} tasks still open`} />
        </div>
        {plannedSec > 0 && (
          <section className="card">
            <h2 className="h3">Planned vs completed</h2>
            <div className="pvc">
              <div><span className="muted small">Planned</span><div className="pvc-bar"><i style={{ width: `${Math.min(100, (100 * plannedSec) / Math.max(plannedSec, studySec))}%` }} className="planned" /></div><strong>{fmtDuration(plannedSec)}</strong></div>
              <div><span className="muted small">Completed</span><div className="pvc-bar"><i style={{ width: `${Math.min(100, (100 * studySec) / Math.max(plannedSec, studySec))}%` }} className="completed" /></div><strong>{fmtDuration(studySec)}</strong></div>
            </div>
          </section>
        )}
        {rows.length === 0 ? (
          <Empty title="No study activity in this period" art="mascot/mascot_wave_small.webp">
            Start a Pomodoro focus session or plan tasks — your real activity will appear here.
          </Empty>
        ) : (
          <>
            <section className="card table-card">
              <h2 className="h3">Daily activity</h2>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Day</th><th>Planned</th><th>Completed</th><th>Focus sessions</th><th>Tasks done</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.key}><td>{fmtDate(parseISODate(r.key), { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                    <td>{r.planned ? fmtDuration(r.planned) : '—'}</td><td>{r.done ? fmtDuration(r.done) : '—'}</td><td>{r.sessions}</td><td>{r.tasks}</td></tr>
                ))}</tbody>
              </table></div>
            </section>
            <section className="card">
              <h2 className="h3">Study session history</h2>
              {sessions.length === 0 ? <p className="muted">No focus sessions recorded in this period.</p> : [...byDay.entries()].map(([k, list]) => (
                <div key={k} className="hist-day">
                  <h3 className="hist-date">{fmtDate(parseISODate(k), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
                  <ul className="hist">
                    {list.map((s) => (
                      <li key={s.id}>
                        <span className="hist-time">{fmtTime(s.started_at)} – {fmtTime(s.ended_at)}</span>
                        <span className="hist-what">
                          <strong>{fmtDuration(s.active_seconds)}</strong>
                          <span className={`badge ${s.status}`}>{s.status === 'completed' ? 'Completed' : 'Interrupted'}</span>
                          <span className="muted small">{[names.mod(s.module_id), names.les(s.lesson_id)].filter(Boolean).join(' › ') || 'No module'}
                            {s.task_id && data.tasks.find((x) => x.id === s.task_id) ? ` · ${data.tasks.find((x) => x.id === s.task_id).title}` : ''}</span>
                        </span>
                        {confirm === s.id
                          ? <span className="row gap"><button className="btn btn-small btn-danger" onClick={() => remove(s)}>Delete</button><button className="btn btn-small" onClick={() => setConfirm(null)}>Keep</button></span>
                          : <button className="icon-btn" aria-label="Delete this session from history" onClick={() => setConfirm(s.id)}><LuTrash2 /></button>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}
      </>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Study Tracker" subtitle="Your real study activity, day by day" hero="art/feat_lessons.webp" />
      <div className="seg" role="tablist" aria-label="Period">
        {RANGES.map(([k, l]) => <button key={k} role="tab" aria-selected={range === k} className={range === k ? 'active' : ''} onClick={() => setRange(k)}>{l}</button>)}
      </div>
      {body}
    </div>
  );
}

