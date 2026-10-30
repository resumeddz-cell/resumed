import React, { useMemo, useState } from 'react';
import { LuChevronRight, LuBookOpen, LuRefreshCw, LuRotateCw, LuSquareCheckBig, LuTimer, LuCalendarPlus } from 'react-icons/lu';
import { useCurriculum } from '../state/data.jsx';
import { useAuth } from '../state/auth.jsx';
import { useTimer } from '../state/timer.jsx';
import { profileApi, prefsApi, errorMessage } from '../lib/api.js';
import { moduleStats, stats, allLessons, STAGES, fmtPct } from '../lib/progress.js';
import { navigate } from '../lib/router.js';
import { fmtDateTime } from '../lib/dates.js';
import { useToast } from '../state/toast.jsx';
import { Loader, ErrorBox, PageHeader, ProgressLine, ProgressBar, Empty, Img, Modal, Slogan } from '../components/ui.jsx';
import { t } from '../lib/i18n.js';
import { sectionsOf, sectionInfo, validSection } from '../lib/years.js';

const STAGE_ICON = { learned: LuBookOpen, revised1: LuRefreshCw, revised2: LuRotateCw, qcm: LuSquareCheckBig };

export function SemesterTabs({ value, onChange, year }) {
  const { profile } = useAuth();
  const secs = sectionsOf(year || profile.selected_year || 1);
  return (
    <div className="seg" role="tablist" aria-label={secs[0].noun}>
      {secs.map((s) => (
        <button key={s.id} role="tab" aria-selected={value === s.id} className={value === s.id ? 'active' : ''} onClick={() => onChange(s.id)}>
          {s.tab}
        </button>
      ))}
    </div>
  );
}

// current year + section (semester for Year 1, units / modules for Year 2), saved on the profile
export function useSemester() {
  const { profile, setProfile } = useAuth();
  const toast = useToast();
  const year = profile.selected_year || 1;
  const sem = validSection(year, profile.selected_semester);
  const setSem = async (s) => {
    if (s === sem) return;
    try { setProfile(await profileApi.update({ selected_semester: s })); }
    catch (e) { toast.error(`Not saved: ${errorMessage(e)}`); }
  };
  return [sem, setSem, year];
}

function ModuleRow({ node, pmap }) {
  const s = moduleStats(node, pmap);
  return (
    <button className="module-row card" onClick={() => navigate(`/modules/${node.id}`)}>
      <span className="icon-circle"><Img src={node.icon} alt="" /></span>
      <span className="module-main">
        <span className="module-title">{node.title}</span>
        {node.description && <span className="muted small module-desc">{node.description}</span>}
        <ProgressLine s={s} />
      </span>
      <LuChevronRight className="chev" aria-hidden />
    </button>
  );
}

export function ModulesPage() {
  const { ready, error, reload, tree, pmap } = useCurriculum();
  const [sem, setSem, year] = useSemester();
  if (error) return <ErrorBox error={error} onRetry={reload} title="Courses could not be loaded" />;
  if (!ready) return <Loader />;
  const roots = tree.roots.filter((m) => m.year === year && m.semester === sem && m.active !== false);
  const info = sectionInfo(sem);
  const all = stats(roots.flatMap((r) => allLessons(r)), pmap);
  return (
    <div className="page">
      <PageHeader title={info.title} subtitle={year === 2 && sem === 'U' ? 'Choose a unit' : 'Choose a subject'} hero={info.hero} />
      <SemesterTabs value={sem} onChange={setSem} />
      <section className="card overall">
        <div className="row between"><h2 className="h3">{year === 1 ? 'Semester progress' : `${info.tab} — progress`}</h2><strong className="pct big">{fmtPct(all.pct)}</strong></div>
        <ProgressBar pct={all.pct} size="lg" label={`${info.tab} progress`} />
        <p className="muted small">{all.learned} of {all.total} lessons learned · {all.remaining} remaining</p>
      </section>
      {roots.length === 0 ? <Empty title="No subjects yet">The administrator has not added subjects here yet.</Empty> : (
        <div className="module-list">{roots.map((m) => <ModuleRow key={m.id} node={m} pmap={pmap} />)}</div>
      )}
      <Slogan />
    </div>
  );
}

function StageTiles({ lesson, row, pending, onToggle, size = 'md' }) {
  return (
    <div className={`stages stages-${size}`}>
      {STAGES.map((st) => {
        const Icon = STAGE_ICON[st]; const on = !!(row && row[st]); const busy = pending[`${lesson.id}:${st}`];
        return (
          <button key={st} className={`stage stage-${st} ${on ? 'on' : ''} ${busy ? 'busy' : ''}`} aria-pressed={on} disabled={!!busy}
                  aria-label={`${t(st)} — ${lesson.title}`} title={t(st)} onClick={(e) => { e.stopPropagation(); onToggle(lesson, st, !on); }}>
            <Icon aria-hidden className="stage-icon" />
            <span className="stage-label">{t(st)}</span>
            <span className="stage-dot" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function LessonModal({ lesson, node, onClose }) {
  const { pmap, pending, setStage } = useCurriculum();
  const timer = useTimer();
  const toast = useToast();
  if (!lesson) return null;
  const row = pmap.get(lesson.id);
  const focus = async () => {
    try {
      if (timer.timer && timer.timer.status !== 'idle') { toast.info('A session is already in progress — open the Pomodoro to manage it.'); navigate('/pomodoro'); return; }
      await timer.associate(node.id, lesson.id, null);
      await timer.start(node.id, lesson.id, null);
      prefsApi.merge({ last_module_id: node.id, last_lesson_id: lesson.id }).catch(() => {});
      navigate('/pomodoro');
    } catch { /* toast already shown */ }
  };
  return (
    <Modal open title={`${lesson.number ? `${lesson.number}. ` : ''}${lesson.title}`} onClose={onClose}>
      <div className="lesson-modal">
        <div className="row gap">
          <span className="icon-circle big"><Img src={lesson.icon || node.icon} alt="" /></span>
          <div><p className="muted small">{node.title}</p><p className="hand big">{lesson.title}</p></div>
        </div>
        {lesson.note && <p className="notice notice-info">{lesson.note}</p>}
        <ul className="stage-list">
          {STAGES.map((st) => (
            <li key={st}>
              <span className={`stage-pill stage-${st}`}>{t(st)}</span>
              <span className="muted small">{row && row[st] && row[`${st}_at`] ? `Done ${fmtDateTime(row[`${st}_at`])}` : 'Not done yet'}</span>
            </li>
          ))}
        </ul>
        <StageTiles lesson={lesson} row={row} pending={pending} onToggle={(l, st, v) => setStage(l.id, st, v).catch(() => {})} size="lg" />
        <div className="row gap wrap">
          <button className="btn btn-primary" onClick={focus}><LuTimer aria-hidden /> Focus on this lesson</button>
          <button className="btn" onClick={() => navigate(`/planner?lesson=${lesson.id}`)}><LuCalendarPlus aria-hidden /> Plan it</button>
        </div>
      </div>
    </Modal>
  );
}

export function ModuleDetailPage({ id }) {
  const { ready, error, reload, tree, pmap, pending, setStage } = useCurriculum();
  const [open, setOpen] = useState(null);
  const node = ready ? tree.nodes.get(id) : null;
  const trail = useMemo(() => {
    const out = []; let cur = node;
    while (cur && cur.parent_id) { cur = tree.nodes.get(cur.parent_id); if (cur) out.unshift(cur); }
    return out;
  }, [node, tree]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!ready) return <Loader />;
  if (!node) return <Empty title="Module not found">It may have been removed by the administrator.</Empty>;
  const s = moduleStats(node, pmap);
  const children = node.children.filter((c) => c.active !== false);
  const lessons = node.lessons.filter((l) => l.active !== false);
  const back = trail.length ? `/modules/${trail[trail.length - 1].id}` : '/modules';
  const toggle = (l, st, v) => {
    setStage(l.id, st, v).catch(() => {});
    prefsApi.merge({ last_module_id: node.id, last_lesson_id: l.id }).catch(() => {});
  };
  return (
    <div className="page">
      <PageHeader title={node.title} subtitle={children.length ? 'Choose a chapter' : 'My courses'} hero={node.hero} back={back}>
        {trail.length > 0 && <p className="crumbs">{trail.map((x) => x.title).join(' › ')}</p>}
      </PageHeader>
      {(children.length > 0 || lessons.length > 0) && (
        <section className="card overall">
          <div className="row between"><h2 className="h3">Course progress</h2><strong className="pct big">{fmtPct(s.pct)}</strong></div>
          <ProgressBar pct={s.pct} size="lg" label={`${node.title} progress`} />
          <p className="muted small">{s.learned} completed · {s.remaining} remaining · {s.total} lessons</p>
          <div className="stage-summary">
            {STAGES.map((st) => (
              <div key={st} className={`ss ss-${st}`}><span>{t(st)}</span><strong>{s[st]}/{s.total}</strong>
                <ProgressBar pct={s.total ? (100 * s[st]) / s.total : 0} size="sm" tone={st} label={t(st)} /></div>
            ))}
          </div>
        </section>
      )}
      {node.description && <p className="muted module-note">{node.description}</p>}
      {children.length > 0 && <div className="module-list">{children.map((c) => <ModuleRow key={c.id} node={c} pmap={pmap} />)}</div>}
      {lessons.length > 0 && (
        <div className="lesson-list">
          {lessons.map((l) => (
            <div key={l.id} className={`lesson-row card ${pmap.get(l.id) && pmap.get(l.id).learned ? 'is-learned' : ''}`}>
              <button className="lesson-open" onClick={() => setOpen(l)} aria-label={`Open ${l.title}`}>
                <span className="icon-circle"><Img src={l.icon || node.icon} alt="" /></span>
                <span className="lesson-title"><span className="lesson-num">{l.number ? `${l.number}.` : ''}</span> {l.title}</span>
              </button>
              <StageTiles lesson={l} row={pmap.get(l.id)} pending={pending} onToggle={toggle} />
              <button className="icon-btn chev-btn" aria-label={`Details of ${l.title}`} onClick={() => setOpen(l)}><LuChevronRight /></button>
            </div>
          ))}
        </div>
      )}
      {children.length === 0 && lessons.length === 0 && (
        <Empty title="No lessons in this module yet">
          {node.description || 'The administrator has not added lessons to this module.'}
        </Empty>
      )}
      <Slogan />
      {open && <LessonModal lesson={open} node={node} onClose={() => setOpen(null)} />}
    </div>
  );
}
