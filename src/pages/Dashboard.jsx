import React, { useCallback, useEffect, useState } from 'react';
import { LuPlay, LuCalendarDays, LuArrowRight, LuTimer, LuCircleCheck, LuClock, LuBookOpen } from 'react-icons/lu';
import { useAuth } from '../state/auth.jsx';
import { useCurriculum } from '../state/data.jsx';
import { useTimer, PHASE_LABEL } from '../state/timer.jsx';
import { plannerApi, sessionsApi, prefsApi, errorMessage } from '../lib/api.js';
import { mondayOf, addDays, toISODate, today, DAY_SHORT, fmtDuration, fmtClock, localDayKey } from '../lib/dates.js';
import { stats, allLessons, fmtPct, moduleStats } from '../lib/progress.js';
import { navigate } from '../lib/router.js';
import { useToast } from '../state/toast.jsx';
import { Loader, ErrorBox, Stat, ProgressBar, ProgressLine, Img, Empty } from '../components/ui.jsx';
import { BarChart } from '../components/Charts.jsx';
import { SemesterTabs, useSemester } from './Modules.jsx';

const FEATURES = [
  { to: '/planner', title: 'Weekly Planner', text: 'Plan your week, organise your courses and manage your time.', art: 'feat_planner', tone: 'teal' },
  { to: '/pomodoro', title: 'Pomodoro', text: 'Stay focused with the Pomodoro method and boost your productivity.', art: 'feat_pomodoro', tone: 'pink' },
  { to: '/modules', title: 'Lesson Tracker', text: 'Follow your courses, tick what you have done and see your progress.', art: 'feat_lessons', tone: 'lilac' },
  { to: '/notes', title: 'Notes', text: 'Take notes, organise your sheets and keep everything in one place.', art: 'feat_notes', tone: 'teal' },
];

export default function Dashboard() {
  const { profile } = useAuth();
  const cur = useCurriculum();
  const timer = useTimer();
  const toast = useToast();
  const [sem, setSem] = useSemester();
  const [week, setWeek] = useState(null);   // { tasks, sessions }
  const [err, setErr] = useState(null);
  const [lastModule, setLastModule] = useState(null);
  const monday = mondayOf(today());

  const load = useCallback(async () => {
    try {
      setErr(null);
      const [tasks, sessions, prefs] = await Promise.all([
        plannerApi.tasksBetween(toISODate(monday), toISODate(addDays(monday, 6))),
        sessionsApi.since(monday.toISOString()),
        prefsApi.get().catch(() => null),
      ]);
      setWeek({ tasks, sessions });
      setLastModule(prefs && prefs.data && prefs.data.last_module_id);
    } catch (e) { setErr(e); }
  }, [monday.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const toggleTask = async (task) => {
    try {
      const row = await plannerApi.update(task.id, { status: task.status === 'done' ? 'todo' : 'done' });
      setWeek((w) => ({ ...w, tasks: w.tasks.map((x) => (x.id === row.id ? row : x)) }));
    } catch (e) { toast.error(`Not saved: ${errorMessage(e)}`, { action: 'Retry', onAction: () => toggleTask(task) }); }
  };

  const continueSession = async () => {
    if (timer.timer && timer.timer.status === 'paused') { await timer.resume().catch(() => {}); navigate('/pomodoro'); return; }
    if (timer.timer && timer.timer.status === 'running') { navigate('/pomodoro'); return; }
    if (timer.timer && timer.timer.phase === 'focus' && lastModule) {
      try { await timer.start(lastModule, null, null); } catch { /* toast shown */ }
    }
    navigate('/pomodoro');
  };

  const name = profile.display_name || profile.email.split('@')[0];
  const todayISO = toISODate(today());
  const loading = !week || !cur.ready;
  const roots = cur.ready ? cur.tree.roots.filter((m) => m.semester === sem && m.active !== false) : [];
  const semStats = cur.ready ? stats(roots.flatMap(allLessons), cur.pmap) : null;
  const todays = week ? week.tasks.filter((x) => x.task_date === todayISO) : [];
  const weekDone = week ? week.tasks.filter((x) => x.status === 'done').length : 0;
  const sessions = week ? week.sessions : [];
  const completedSessions = sessions.filter((s) => s.status === 'completed');
  const studySeconds = sessions.reduce((n, s) => n + s.active_seconds, 0);
  const todaysSessions = completedSessions.filter((s) => localDayKey(s.started_at) === todayISO).length;
  const perDay = DAY_SHORT.map((label, i) => {
    const key = toISODate(addDays(monday, i));
    const sec = sessions.filter((s) => localDayKey(s.started_at) === key).reduce((n, s) => n + s.active_seconds, 0);
    return { label, key, value: Math.round(sec / 60), title: label };
  });
  const tm = timer.timer;
  const sessionLabel = tm && tm.status === 'running' ? `${PHASE_LABEL[tm.phase]} · ${fmtClock(timer.remaining)} left`
    : tm && tm.status === 'paused' ? `Paused · ${fmtClock(timer.remaining)} left` : 'Start a focus session';

  return (
    <div className="page dashboard">
      <section className="dash-hero card">
        <img src="assets/mascot/mascot_wave_small.webp" alt="" className="dash-mascot" />
        <div className="dash-hello">
          <p className="hand muted">Bienvenue en</p>
          <h1 className="ph-title"><span className="brush">1ère année de médecine</span></h1>
          <p className="ph-sub">Hello {name} — organise your year with the right tools and move forward step by step.</p>
          <SemesterTabs value={sem} onChange={setSem} />
        </div>
        <div className="dash-actions">
          <button className="btn btn-primary" onClick={continueSession}><LuPlay aria-hidden /> Continue study session
            <small>{sessionLabel}</small></button>
          <button className="btn btn-pink" onClick={() => navigate('/planner')}><LuCalendarDays aria-hidden /> Open weekly planner</button>
        </div>
      </section>

      {err && <ErrorBox error={err} onRetry={load} title="Your activity could not be loaded" />}
      {loading && !err ? <Loader /> : !err && (
        <>
          <div className="stats-grid">
            <Stat icon={<LuCircleCheck />} label="Today's tasks done" value={`${todays.filter((x) => x.status === 'done').length} / ${todays.length}`}
                  sub={`${weekDone} done this week`} />
            <Stat icon={<LuTimer />} tone="pink" label="Focus sessions today" value={todaysSessions} sub={`${completedSessions.length} this week`} />
            <Stat icon={<LuClock />} tone="lilac" label="Study time this week" value={fmtDuration(studySeconds)} sub="active time, pauses excluded" />
            <Stat icon={<LuBookOpen />} tone="blue" label={`Lessons learned (${sem})`} value={fmtPct(semStats.pct)}
                  sub={`${semStats.learned} / ${semStats.total} lessons`} />
          </div>

          <div className="dash-grid">
            <section className="card">
              <div className="row between"><h2 className="h3">Today's tasks</h2>
                <button className="link" onClick={() => navigate('/planner')}>Planner <LuArrowRight aria-hidden /></button></div>
              {todays.length === 0 ? <p className="muted">Nothing planned for today. <button className="link" onClick={() => navigate('/planner')}>Add a task</button></p> : (
                <ul className="task-mini">
                  {todays.map((x) => (
                    <li key={x.id} className={x.status === 'done' ? 'done' : ''}>
                      <label><input type="checkbox" checked={x.status === 'done'} onChange={() => toggleTask(x)} />
                        <span>{x.start_time ? `${x.start_time.slice(0, 5)} · ` : ''}{x.title}</span></label>
                      <span className={`prio prio-${x.priority}`}>{x.priority}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <div className="row between"><h2 className="h3">Weekly activity</h2>
                <button className="link" onClick={() => navigate('/progress')}>Progress <LuArrowRight aria-hidden /></button></div>
              {studySeconds === 0 ? <p className="muted">No study session recorded this week yet.</p>
                : <BarChart data={perDay} unit=" min" ariaLabel="Minutes studied per day this week" height={150} />}
            </section>
          </div>

          <section className="card">
            <div className="row between"><h2 className="h3">Course progress — {sem}</h2>
              <button className="link" onClick={() => navigate('/modules')}>All courses <LuArrowRight aria-hidden /></button></div>
            <ProgressBar pct={semStats.pct} size="lg" label="Semester progress" />
            <div className="mini-modules">
              {roots.map((m) => (
                <button key={m.id} className="mini-module" onClick={() => navigate(`/modules/${m.id}`)}>
                  <span className="icon-circle sm"><Img src={m.icon} alt="" /></span>
                  <span className="mm-body"><span className="mm-title">{m.title}</span><ProgressLine s={moduleStats(m, cur.pmap)} compact /></span>
                </button>
              ))}
              {roots.length === 0 && <Empty title="No subjects yet" />}
            </div>
          </section>
        </>
      )}

      <div className="feature-grid">
        {FEATURES.map((f) => (
          <button key={f.to} className={`feature card tone-${f.tone}`} onClick={() => navigate(f.to)}>
            <img src={`assets/art/${f.art}.webp`} alt="" />
            <span><strong className="hand big">{f.title}</strong><span className="muted small">{f.text}</span>
              <span className="btn btn-small">Open <LuArrowRight aria-hidden /></span></span>
          </button>
        ))}
      </div>
    </div>
  );
}
