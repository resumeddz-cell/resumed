import React, { useState } from 'react';
import {
  LuHouse, LuCalendarDays, LuBookOpen, LuNotebookPen, LuChartColumn, LuTimer, LuHistory, LuSettings,
  LuShieldCheck, LuMenu, LuX, LuLogOut, LuWifiOff,
} from 'react-icons/lu';
import { navigate } from '../lib/router.js';
import { useAuth } from '../state/auth.jsx';
import { useTimer, PHASE_LABEL } from '../state/timer.jsx';
import { fmtClock } from '../lib/dates.js';
import { t } from '../lib/i18n.js';

const NAV = [
  { to: '/', label: 'home', icon: LuHouse, match: (p) => p === '/' },
  { to: '/modules', label: 'courses', icon: LuBookOpen, match: (p) => p.startsWith('/modules') },
  { to: '/planner', label: 'planner', icon: LuCalendarDays, match: (p) => p.startsWith('/planner') },
  { to: '/pomodoro', label: 'pomodoro', icon: LuTimer, match: (p) => p.startsWith('/pomodoro') },
  { to: '/tracker', label: 'tracker', icon: LuHistory, match: (p) => p.startsWith('/tracker') },
  { to: '/notes', label: 'notes', icon: LuNotebookPen, match: (p) => p.startsWith('/notes') },
  { to: '/progress', label: 'progress', icon: LuChartColumn, match: (p) => p.startsWith('/progress') },
  { to: '/settings', label: 'settings', icon: LuSettings, match: (p) => p.startsWith('/settings') },
];
// bottom bar on phones mirrors the PDF: Accueil · Planning · Cours · Notes · Progression
const BOTTOM = ['/', '/planner', '/modules', '/notes', '/progress'];

function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  React.useEffect(() => {
    const a = () => setOn(true); const b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

function TimerChip({ path }) {
  const { timer, remaining } = useTimer();
  if (!timer || timer.status === 'idle' || path.startsWith('/pomodoro')) return null;
  return (
    <button className={`timer-chip ${timer.status}`} onClick={() => navigate('/pomodoro')} aria-label="Open Pomodoro timer">
      <img src="assets/art/tomato.webp" alt="" />
      <span>{fmtClock(remaining)}</span>
      <small>{timer.status === 'paused' ? 'Paused' : PHASE_LABEL[timer.phase]}</small>
    </button>
  );
}

export default function Layout({ path, children }) {
  const { profile, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const items = isAdmin ? [...NAV, { to: '/admin', label: 'admin', icon: LuShieldCheck, match: (p) => p.startsWith('/admin') }] : NAV;
  const go = (to) => { setOpen(false); navigate(to); };
  const name = (profile && (profile.display_name || profile.email.split('@')[0])) || '';

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="sb-head">
          <img src="assets/art/logo_light.webp" alt="Resumed Planner" className="sb-logo" />
          <button className="icon-btn sb-close" aria-label="Close menu" onClick={() => setOpen(false)}><LuX /></button>
        </div>
        <nav>
          {items.map((n) => {
            const Icon = n.icon; const active = n.match(path);
            return (
              <button key={n.to} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => go(n.to)}>
                <Icon aria-hidden /> <span>{t(n.label)}</span>
              </button>
            );
          })}
        </nav>
        <div className="sb-foot">
          <img src="assets/mascot/mascot_wave_small.webp" alt="" className="sb-mascot" />
          <div className="sb-user"><strong>{name}</strong><span className="muted small">{profile && profile.email}</span></div>
          <button className="nav-item" onClick={signOut}><LuLogOut aria-hidden /> <span>{t('signOut')}</span></button>
        </div>
      </aside>
      {open && <div className="sb-backdrop" onClick={() => setOpen(false)} />}

      <div className="main">
        <div className="topbar">
          <button className="icon-btn menu-btn" aria-label={t('menu')} onClick={() => setOpen(true)}><LuMenu /></button>
          <img src="assets/art/logo_light.webp" alt="Resumed Planner" className="tb-logo" onClick={() => go('/')} />
          <div className="tb-right"><TimerChip path={path} /></div>
        </div>
        {!online && <div className="offline-banner" role="alert"><LuWifiOff aria-hidden /> {t('offline')}</div>}
        <main className="content" id="main">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="Quick navigation">
        {BOTTOM.map((to) => {
          const n = NAV.find((x) => x.to === to); const Icon = n.icon; const active = n.match(path);
          return (
            <button key={to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => go(to)}>
              <Icon aria-hidden /><span>{t(n.label)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
