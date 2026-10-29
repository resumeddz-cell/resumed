import React, { useEffect, useMemo, useState } from 'react';
import { LuPlay, LuPause, LuRotateCcw, LuSkipForward, LuVolume2, LuVolumeX, LuSettings } from 'react-icons/lu';
import { useTimer, PHASE_LABEL, playChime } from '../state/timer.jsx';
import { useCurriculum } from '../state/data.jsx';
import { plannerApi } from '../lib/api.js';
import { fmtClock, toISODate, today, addDays } from '../lib/dates.js';
import { navigate } from '../lib/router.js';
import { useToast } from '../state/toast.jsx';
import { useModuleOptions } from './Planner.jsx';
import { Loader, ErrorBox, Field } from '../components/ui.jsx';
import { StudyingMascot } from '../components/Mascot.jsx';

function Ring({ fraction, phase, children }) {
  const R = 118; const C = 2 * Math.PI * R;
  return (
    <div className={`ring ring-${phase}`}>
      <svg viewBox="0 0 280 280" aria-hidden>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--pink-400)" /><stop offset="100%" stopColor="var(--teal-400)" />
          </linearGradient>
        </defs>
        <circle cx="140" cy="140" r={R} className="ring-track" />
        <circle cx="140" cy="140" r={R} className="ring-fill" stroke="url(#ringGrad)"
                strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, fraction)))} transform="rotate(-90 140 140)" />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export default function PomodoroPage() {
  const tm = useTimer();
  const toast = useToast();
  const { ready } = useCurriculum();
  const opts = useModuleOptions();
  const [tasks, setTasks] = useState([]);
  const [confirmSkip, setConfirmSkip] = useState(false);

  // always show the server's current state when the page opens (e.g. started on another device)
  useEffect(() => { tm.sync(); tm.refreshToday(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = today();
    plannerApi.tasksBetween(toISODate(addDays(d, -1)), toISODate(addDays(d, 6)))
      .then((ts) => setTasks(ts.filter((x) => x.status === 'todo'))).catch(() => {});
  }, []);

  const st = tm.timer;
  const lessons = useMemo(() => (st ? opts.lessonsFor(st.module_id) : []), [st && st.module_id, opts]); // eslint-disable-line

  if (tm.error && !st) return <ErrorBox error={tm.error} onRetry={tm.sync} title="The timer could not be loaded" />;
  if (!st || !tm.settings) return <Loader />;

  const fraction = st.duration_seconds ? tm.elapsed / st.duration_seconds : 0;
  const longEvery = tm.settings.sessions_before_long_break || 4;
  const assoc = (patch) => {
    const next = { module_id: st.module_id, lesson_id: st.lesson_id, task_id: st.task_id, ...patch };
    if (patch.task_id) {
      const task = tasks.find((x) => x.id === patch.task_id);
      if (task && task.module_id && !patch.module_id) { next.module_id = task.module_id; next.lesson_id = task.lesson_id; }
    }
    tm.associate(next.module_id, next.lesson_id, next.task_id).catch(() => {});
  };
  const doSkip = async () => { setConfirmSkip(false); await tm.skip().catch(() => {}); };
  const todayN = tm.completedToday;
  const circles = Math.max(8, (todayN || 0) + 1);

  return (
    <div className="page pomodoro">
      <div className="pomo-grid">
        <section className="card pomo-main">
          <StudyingMascot className="pomo-art" />
          <div className="seg" role="tablist" aria-label="Session type">
            {Object.entries(PHASE_LABEL).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={st.phase === k} className={st.phase === k ? 'active' : ''}
                      disabled={st.status !== 'idle' || tm.busy}
                      title={st.status !== 'idle' ? 'Reset or finish the current session to switch' : undefined}
                      onClick={() => tm.setPhase(k).catch(() => {})}>{label}</button>
            ))}
          </div>
          <Ring fraction={fraction} phase={st.phase}>
            <img src="assets/art/tomato.webp" alt="" className="ring-tomato" />
            <div className="ring-time" aria-live="off">{fmtClock(tm.remaining)}</div>
            <div className="ring-label">{st.status === 'paused' ? 'Paused' : PHASE_LABEL[st.phase]}</div>
          </Ring>
          <p className="sr-only" aria-live="polite">{st.status === 'running' ? `${PHASE_LABEL[st.phase]} running` : st.status === 'paused' ? 'Timer paused' : 'Timer ready'}</p>
          <div className="pomo-controls">
            <button className="ctl" onClick={() => tm.reset().catch(() => {})} disabled={tm.busy || st.status === 'idle'}>
              <LuRotateCcw aria-hidden /><span>Reset</span></button>
            {st.status === 'running'
              ? <button className="ctl ctl-main" onClick={() => tm.pause().catch(() => {})} disabled={tm.busy} aria-label="Pause"><LuPause aria-hidden /><span>Pause</span></button>
              : st.status === 'paused'
                ? <button className="ctl ctl-main" onClick={() => tm.resume().catch(() => {})} disabled={tm.busy} aria-label="Resume"><LuPlay aria-hidden /><span>Resume</span></button>
                : <button className="ctl ctl-main" onClick={() => tm.start(st.module_id, st.lesson_id, st.task_id).catch(() => {})} disabled={tm.busy} aria-label="Start"><LuPlay aria-hidden /><span>Start</span></button>}
            <button className="ctl" onClick={() => (st.phase === 'focus' && st.status !== 'idle' ? setConfirmSkip(true) : doSkip())} disabled={tm.busy}>
              <LuSkipForward aria-hidden /><span>Skip</span></button>
          </div>
          {confirmSkip && (
            <div className="notice notice-warn">Skip this focus session? It will not count as a completed session.
              <div className="row gap"><button className="btn btn-small btn-primary" onClick={doSkip}>Skip</button>
                <button className="btn btn-small" onClick={() => setConfirmSkip(false)}>Keep going</button></div></div>
          )}
          <p className="muted small center">Concentre-toi aujourd'hui pour la version meilleure de toi demain ♡</p>
        </section>

        <aside className="pomo-side">
          <section className="card">
            <h2 className="h3">Your progress</h2>
            <div className="kv"><span>Completed focus sessions today</span><strong>{todayN === null ? '…' : todayN}</strong></div>
            <div className="pomo-circles" aria-label={`${todayN || 0} focus sessions completed today`}>
              {Array.from({ length: circles }, (_, i) => <span key={i} className={i < (todayN || 0) ? 'on' : ''} />)}
            </div>
            <div className="kv"><span>Cycle before long break</span>
              <span className="cycle">{Array.from({ length: longEvery }, (_, i) => <i key={i} className={i < st.focus_in_cycle ? 'on' : ''} />)}</span></div>
            <button className="link" onClick={() => navigate('/tracker')}>See study history →</button>
          </section>

          <section className="card">
            <h2 className="h3">What are you studying?</h2>
            <p className="muted small">Optional — the session will be saved with this module, lesson or task.</p>
            {!ready ? <Loader /> : (
              <>
                <Field label="Module">
                  <select value={st.module_id || ''} onChange={(e) => assoc({ module_id: e.target.value || null, lesson_id: null })}>
                    <option value="">—</option>{opts.modules.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                </Field>
                <Field label="Lesson">
                  <select value={st.lesson_id || ''} disabled={!st.module_id} onChange={(e) => assoc({ lesson_id: e.target.value || null })}>
                    <option value="">—</option>{lessons.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
                </Field>
                <Field label="Planner task">
                  <select value={st.task_id || ''} onChange={(e) => assoc({ task_id: e.target.value || null })}>
                    <option value="">—</option>{tasks.map((x) => <option key={x.id} value={x.id}>{x.task_date.slice(5)} · {x.title}</option>)}</select>
                </Field>
              </>
            )}
          </section>

          <section className="card">
            <h2 className="h3">Settings</h2>
            <div className="kv"><span>Focus</span><strong>{tm.settings.focus_minutes} min</strong></div>
            <div className="kv"><span>Short break</span><strong>{tm.settings.short_break_minutes} min</strong></div>
            <div className="kv"><span>Long break</span><strong>{tm.settings.long_break_minutes} min</strong></div>
            <div className="kv"><span>Sound</span><span>{tm.settings.sound_enabled ? <><LuVolume2 aria-hidden /> On</> : <><LuVolumeX aria-hidden /> Off</>}</span></div>
            <div className="row gap wrap">
              <button className="btn btn-small" onClick={() => navigate('/settings')}><LuSettings aria-hidden /> Change</button>
              <button className="btn btn-small" onClick={() => { playChime(); toast.info('This is the end-of-session sound.'); }}>Test sound</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
