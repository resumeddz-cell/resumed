import React, { useState } from 'react';
import { LuArrowRight, LuGraduationCap, LuLock } from 'react-icons/lu';
import { useAuth } from '../state/auth.jsx';
import { profileApi, errorMessage } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { useToast } from '../state/toast.jsx';
import { WavingMascot } from '../components/Mascot.jsx';

const LATER_YEARS = [2, 3, 4, 5, 6, 7];

export function YearSelectPage() {
  const { profile } = useAuth();
  const name = profile.display_name || profile.email.split('@')[0];
  return (
    <div className="page year-page">
      <section className="welcome-hero card">
        <img src="assets/mascot/mascot_wave.webp" alt="" className="welcome-mascot" />
        <div>
          <img src="assets/art/logo_light.webp" alt="Resumed Planner" className="welcome-logo" />
          <h1 className="ph-title"><span className="brush">Welcome, {name}!</span></h1>
          <p className="ph-sub">Choose your academic year to open your personalised planner.</p>
        </div>
      </section>
      <div className="year-grid">
        <article className="year-card card year-active">
          <img src="assets/art/books.webp" alt="" className="year-art" />
          <div className="year-badge">Year 1</div>
          <h2>First-Year Medical Student</h2>
          <p className="hand">1ère année de médecine</p>
          <p className="muted">Semester 1 and Semester 2 courses, lesson tracking, revisions, QCM, planner and Pomodoro.</p>
          <button className="btn btn-primary" onClick={() => navigate('/year/1')}>Enter <LuArrowRight aria-hidden /></button>
        </article>
        {LATER_YEARS.map((y) => (
          <article key={y} className="year-card card year-locked" aria-disabled="true">
            <LuGraduationCap aria-hidden className="year-icon" />
            <div className="year-badge">Year {y}</div>
            <p className="muted small"><LuLock aria-hidden /> Not available yet</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function SemesterSelectPage() {
  const { profile, setProfile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const choose = async (sem) => {
    setBusy(sem);
    try {
      const p = await profileApi.update({ selected_year: 1, selected_semester: sem });
      setProfile(p); navigate('/', { replace: true });
    } catch (e) { toast.error(`Not saved: ${errorMessage(e)}`, { action: 'Retry', onAction: () => choose(sem) }); }
    finally { setBusy(null); }
  };
  return (
    <div className="page sem-page">
      <section className="sem-hero">
        <WavingMascot className="sem-mascot" />
        <div>
          <h1 className="ph-title"><span className="brush">Bienvenue !</span></h1>
          <p className="ph-sub">Choose the semester you want to study and go straight to your personalised planner.</p>
        </div>
      </section>
      <h2 className="sem-year"><img src="assets/art/books.webp" alt="" /> <span className="brush-pink">1ère année de médecine</span> <img src="assets/art/clipboard.webp" alt="" /></h2>
      <div className="sem-grid">
        {[['S1', '1er semestre', 'sem_s1', 'teal'], ['S2', '2ème semestre', 'sem_s2', 'pink']].map(([sem, label, art, tone]) => (
          <article key={sem} className={`sem-card card tone-${tone} ${profile.selected_semester === sem ? 'current' : ''}`}>
            <h3>{label}</h3>
            <img src={`assets/art/${art}.webp`} alt={sem} className="sem-art" />
            <p className="muted">Planning, courses, revisions and QCM of the {sem === 'S1' ? '1st' : '2nd'} semester.</p>
            <button className={`btn ${tone === 'pink' ? 'btn-pink' : 'btn-primary'}`} disabled={!!busy} onClick={() => choose(sem)}>
              {busy === sem ? 'Saving…' : 'View plan'} <LuArrowRight aria-hidden /></button>
          </article>
        ))}
      </div>
      <p className="slogan">Une bonne organisation aujourd'hui, c'est un grand pas vers ton rêve !</p>
    </div>
  );
}
