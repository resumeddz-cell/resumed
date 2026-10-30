import React, { useCallback, useEffect, useState } from 'react';
import { sessionsApi, plannerApi } from '../lib/api.js';
import { useCurriculum } from '../state/data.jsx';
import { addDays, toISODate, today, mondayOf, fmtDuration, localDayKey, fmtDate, DAY_SHORT } from '../lib/dates.js';
import { stats, allLessons, moduleStats, fmtPct, STAGES } from '../lib/progress.js';
import { navigate } from '../lib/router.js';
import { Loader, ErrorBox, PageHeader, Stat, ProgressBar, Empty, Img } from '../components/ui.jsx';
import { BarChart, LineChart, SplitBar } from '../components/Charts.jsx';
import { t } from '../lib/i18n.js';
import { sectionsOf } from '../lib/years.js';
import { useAuth } from '../state/auth.jsx';

export default function ProgressPage() {
  const cur = useCurriculum();
  const { profile } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState('daily');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [sessions, tasks] = await Promise.all([sessionsApi.all(), plannerApi.allTasks()]);
      setData({ sessions, tasks });
    } catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <ErrorBox error={err} onRetry={load} title="Your statistics could not be loaded" />;
  if (!data || !cur.ready) return <Loader />;

  const { sessions, tasks } = data;
  const completed = sessions.filter((s) => s.status === 'completed');
  const totalSec = sessions.reduce((n, s) => n + s.active_seconds, 0);
  const done = tasks.filter((x) => x.status === 'done').length;
  const year = profile.selected_year || 1;
  const roots = cur.tree.roots.filter((m) => m.active !== false && m.year === year);
  const overall = stats(roots.flatMap(allLessons), cur.pmap);
  const hasActivity = sessions.length > 0 || tasks.length > 0 || cur.rows.some((r) => r.learned || r.revised1 || r.revised2 || r.qcm);

  // daily (last 14 days) / weekly (last 12 weeks) study minutes
  const daily = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today(), i - 13); const k = toISODate(d);
    const sec = sessions.filter((s) => localDayKey(s.started_at) === k).reduce((n, s) => n + s.active_seconds, 0);
    return { key: k, label: i % 2 === 1 || i === 13 ? `${d.getDate()}` : '', title: fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }), value: Math.round(sec / 60) };
  });
  const week0 = mondayOf(today());
  const weekly = Array.from({ length: 12 }, (_, i) => {
    const m = addDays(week0, (i - 11) * 7); const end = addDays(m, 7);
    const sec = sessions.filter((s) => { const d = new Date(s.started_at); return d >= m && d < end; }).reduce((n, s) => n + s.active_seconds, 0);
    return { key: toISODate(m), label: fmtDate(m, { day: 'numeric', month: 'numeric' }), title: `Week of ${fmtDate(m)}`, sec };
  });
  // hours when there is a lot of study time, minutes otherwise (so small amounts never show as "0 h")
  const weeklyInHours = Math.max(...weekly.map((w) => w.sec)) >= 2 * 3600;
  weekly.forEach((w) => { w.value = weeklyInHours ? Math.round((w.sec / 3600) * 10) / 10 : Math.round(w.sec / 60); });
  // cumulative lessons learned over the last 12 weeks (from saved completion dates)
  const learnedDates = cur.rows.filter((r) => r.learned && r.learned_at).map((r) => new Date(r.learned_at));
  const growth = Array.from({ length: 12 }, (_, i) => {
    const end = addDays(week0, (i - 10) * 7);
    return { label: fmtDate(addDays(end, -7), { day: 'numeric', month: 'numeric' }), value: learnedDates.filter((d) => d < end).length };
  });
  const weekdays = DAY_SHORT.map((label, i) => ({
    label, value: Math.round(sessions.filter((s) => (new Date(s.started_at).getDay() + 6) % 7 === i).reduce((n, s) => n + s.active_seconds, 0) / 60),
  }));

  return (
    <div className="page">
      <PageHeader title="Progress Dashboard" subtitle="Tu vas y arriver ♡" hero="art/hero_p22.webp" />
      {!hasActivity ? (
        <Empty title="No activity yet" art="mascot/mascot_wave.webp"
               action={<div className="row gap wrap"><button className="btn btn-primary" onClick={() => navigate('/modules')}>Open my courses</button>
                 <button className="btn" onClick={() => navigate('/pomodoro')}>Start a focus session</button></div>}>
          Complete lessons, plan tasks and run Pomodoro sessions — your statistics are calculated from what you actually save.
        </Empty>
      ) : (
        <>
          <div className="stats-grid">
            <Stat label="Completed focus sessions" value={completed.length} sub={`${sessions.length - completed.length} interrupted`} />
            <Stat tone="lilac" label="Total recorded study time" value={fmtDuration(totalSec)} />
            <Stat tone="pink" label="Tasks completed" value={`${done} / ${tasks.length}`} sub={`${tasks.length - done} incomplete`} />
            <Stat tone="blue" label="Overall lesson completion" value={fmtPct(overall.pct)} sub={`${overall.learned} / ${overall.total} lessons (${sectionsOf(year).map((x) => x.short).join(' + ')})`} />
          </div>

          <section className="card">
            <div className="row between wrap">
              <h2 className="h3">Study activity</h2>
              <div className="seg seg-sm" role="tablist">
                {[['daily', 'Daily'], ['weekly', 'Weekly']].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>{l}</button>)}
              </div>
            </div>
            {view === 'daily'
              ? <BarChart data={daily} unit=" min" highlightLast ariaLabel="Minutes studied per day, last 14 days" />
              : <BarChart data={weekly} unit={weeklyInHours ? ' h' : ' min'} color="var(--lilac-500)" highlightLast ariaLabel="Study time per week, last 12 weeks" />}
            <p className="muted small">{view === 'daily' ? 'Minutes of active focus time per day (last 14 days).' : `${weeklyInHours ? 'Hours' : 'Minutes'} of active focus time per week (last 12 weeks).`}</p>
          </section>

          <div className="dash-grid">
            <section className="card">
              <h2 className="h3">Lessons learned over time</h2>
              <LineChart data={growth} ariaLabel="Cumulative lessons learned, last 12 weeks" />
              <p className="muted small">Cumulative number of lessons marked “Learned”, based on their saved completion dates.</p>
            </section>
            <section className="card">
              <h2 className="h3">Tasks: completed vs incomplete</h2>
              <SplitBar ariaLabel="Completed versus incomplete tasks" parts={[
                { label: 'Completed', value: done, color: 'var(--teal-500)' },
                { label: 'Incomplete', value: tasks.length - done, color: 'var(--pink-300)' }]} />
              <h2 className="h3 mt">Study time by weekday</h2>
              <BarChart data={weekdays} unit=" min" height={130} color="var(--blue-500)" ariaLabel="Minutes studied by weekday (all time)" />
            </section>
          </div>

          <section className="card">
            <h2 className="h3">Revision stages (all lessons)</h2>
            <div className="stage-summary">
              {STAGES.map((st) => (
                <div key={st} className={`ss ss-${st}`}><span>{t(st)}</span><strong>{overall[st]}/{overall.total}</strong>
                  <ProgressBar pct={overall.total ? (100 * overall[st]) / overall.total : 0} size="sm" tone={st} label={t(st)} /></div>
              ))}
            </div>
          </section>

          {sectionsOf(year).map(({ id: sem, short }) => (
            <section key={sem} className="card">
              <h2 className="h3">Module completion — {short}</h2>
              <div className="module-bars">
                {roots.filter((r) => r.semester === sem).map((m) => {
                  const s = moduleStats(m, cur.pmap);
                  return (
                    <button key={m.id} className="mb-row" onClick={() => navigate(`/modules/${m.id}`)}>
                      <span className="icon-circle sm"><Img src={m.icon} alt="" /></span>
                      <span className="mb-title">{m.title}</span>
                      <ProgressBar pct={s.pct} label={`${m.title} completion`} />
                      <strong className="pct">{fmtPct(s.pct)}</strong>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
