import React, { useEffect } from 'react';
import { isConfigured } from './lib/config.js';
import { resetDemo } from './lib/supabase.js';
import { useRoute, match, navigate } from './lib/router.js';
import { AuthProvider, useAuth } from './state/auth.jsx';
import { CurriculumProvider } from './state/data.jsx';
import { TimerProvider } from './state/timer.jsx';
import { ToastProvider, useToast } from './state/toast.jsx';
import { Loader, ErrorBox, Empty } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { LoginPage, RegisterPage, ForgotPage, NewPasswordPage, StatusPage, NotConfigured } from './pages/AuthPages.jsx';
import { YearSelectPage, SemesterSelectPage } from './pages/YearSelect.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { ModulesPage, ModuleDetailPage } from './pages/Modules.jsx';
import PlannerPage from './pages/Planner.jsx';
import PomodoroPage from './pages/Pomodoro.jsx';
import TrackerPage from './pages/Tracker.jsx';
import NotesPage from './pages/Notes.jsx';
import ProgressPage from './pages/Progress.jsx';
import SettingsPage from './pages/Settings.jsx';
import AdminAccounts from './pages/admin/AdminAccounts.jsx';
import AdminCurriculum from './pages/admin/AdminCurriculum.jsx';

function ApprovedApp({ route }) {
  const { profile, isAdmin } = useAuth();
  const { path, query } = route;
  // Students pick their academic year first; admin and settings pages never require it.
  const needsYear = !profile.selected_year && !path.startsWith('/admin') && path !== '/settings';

  useEffect(() => {
    if (['/login', '/register', '/forgot'].includes(path)) navigate('/', { replace: true });
  }, [path]);

  let page; let m;
  if (path === '/year') page = <YearSelectPage />;
  else if (path === '/year/1') page = <SemesterSelectPage key="y1" year={1} />;
  else if (path === '/year/2') page = <SemesterSelectPage key="y2" year={2} />;
  else if (needsYear) page = <YearSelectPage />;                        // first visit after approval
  else if (path === '/' || path === '/login' || path === '/register') page = <Dashboard />;
  else if (path === '/modules') page = <ModulesPage />;
  else if ((m = match('/modules/:id', path))) page = <ModuleDetailPage key={m.id} id={m.id} />;
  else if (path === '/planner') page = <PlannerPage query={query} />;
  else if (path === '/pomodoro') page = <PomodoroPage />;
  else if (path === '/tracker') page = <TrackerPage />;
  else if (path === '/notes') page = <NotesPage />;
  else if ((m = match('/notes/:id', path))) page = <NotesPage id={m.id} />;
  else if (path === '/progress') page = <ProgressPage />;
  else if (path === '/settings') page = <SettingsPage />;
  else if (path === '/admin' || path === '/admin/curriculum') {
    page = isAdmin ? (path === '/admin' ? <AdminAccounts /> : <AdminCurriculum />)
      : <Empty title="Administrator only">You do not have access to this page.</Empty>;
  } else page = <Empty title="Page not found" action={<button className="btn btn-primary" onClick={() => navigate('/')}>Go home</button>} />;

  return <Layout path={needsYear && !path.startsWith('/year') ? '/year' : path}>{page}</Layout>;
}

function Gate() {
  const { state, profile, session, recovery, setRecovery, error, reloadProfile, signOut } = useAuth();
  const route = useRoute();
  const toast = useToast();

  if (recovery && session) {
    return <NewPasswordPage onDone={() => { setRecovery(false); toast.ok('Password updated'); navigate('/', { replace: true }); }} />;
  }
  if (state === 'signedOut') {
    if (route.path === '/register') return <RegisterPage />;
    if (route.path === '/forgot') return <ForgotPage />;
    return <LoginPage />;
  }
  if (state === 'loading') return <Loader full label="Opening your planner…" />;
  if (state === 'error' || !profile) {
    return (
      <div className="status-page"><ErrorBox error={error} onRetry={reloadProfile} title="We could not load your account" />
        <button className="btn" onClick={signOut}>Log out</button></div>
    );
  }
  if (profile.status !== 'approved') return <StatusPage status={profile.status} />;
  return (
    <CurriculumProvider>
      <TimerProvider>
        <ApprovedApp route={route} />
      </TimerProvider>
    </CurriculumProvider>
  );
}

function DemoBanner() {
  if (!__DEMO__) return null;
  return (
    <div className="demo-banner" role="note">
      <span dir="rtl" lang="ar">نسخة تجريبية للعرض — البيانات محفوظة في هذا المتصفح فقط.</span>
      <span>Demo version — data stays in this browser only.</span>
      <button className="btn btn-small" onClick={() => { resetDemo(); window.location.hash = '#/'; window.location.reload(); }}>Reset demo</button>
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <ToastProvider>
      <DemoBanner />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
