import React, { useState } from 'react';
import { LuMail, LuLock, LuArrowRight, LuRefreshCw, LuLogOut } from 'react-icons/lu';
import { auth, DEMO_ACCOUNTS } from '../lib/supabase.js';
import { navigate } from '../lib/router.js';
import { useAuth } from '../state/auth.jsx';
import { Field } from '../components/ui.jsx';
import { WavingMascot } from '../components/Mascot.jsx';
import { t } from '../lib/i18n.js';

function authError(e) {
  const m = (e && e.message) || '';
  const c = (e && e.code) || '';
  if (e && e.kind === 'network') return e.message;
  if (/invalid login credentials|invalid_credentials|invalid_grant/i.test(m + c)) return 'Incorrect e-mail or password.';
  if (/email not confirmed|email_not_confirmed/i.test(m + c)) return 'Please confirm your e-mail address first (check your inbox), then sign in.';
  if (/already registered|already exists|user_already_exists/i.test(m + c)) return 'An account with this e-mail already exists. Sign in or reset your password.';
  if (/rate limit|too many|over_email_send_rate_limit/i.test(m + c)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/password/i.test(m) && /(weak|short|least)/i.test(m)) return 'This password is too weak. Use at least 8 characters.';
  return m || 'Something went wrong. Please try again.';
}

export function AuthShell({ children }) {
  return (
    <div className="auth-shell">
      <div className="auth-art">
        <WavingMascot className="auth-mascot" float />
      </div>
      <div className="auth-panel">
        <WavingMascot className="auth-mascot-mobile" float />
        <img src="assets/art/logo_teal.webp" alt="Resumed Planner — Plan · Study · Track · Succeed" className="auth-logo" />
        <div className="auth-card card">{children}</div>
        <p className="auth-foot">Better study, better future ♡</p>
      </div>
    </div>
  );
}

function Notice() {
  const { notice } = useAuth();
  if (!notice) return null;
  return <p className={`notice notice-${notice.type}`} role="alert">{notice.text}</p>;
}

export function LoginPage() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const { setNotice } = useAuth();
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setNotice(null); await auth.signIn(email.trim(), password); navigate('/', { replace: true }); }
    catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  const demoLogin = async (acc) => {
    setErr(null); setBusy(true);
    try { await auth.signIn(acc.email, acc.password); navigate('/', { replace: true }); }
    catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="auth-title">{t('welcomeBack')}</h1>
      <Notice />
      {__DEMO__ && DEMO_ACCOUNTS && (
        <div className="demo-login">
          <p className="small"><strong>Try the demo</strong> — sign in with one tap:</p>
          <div className="row gap wrap">
            <button className="btn btn-primary btn-small" disabled={busy} onClick={() => demoLogin(DEMO_ACCOUNTS.student)}>Student account</button>
            <button className="btn btn-pink btn-small" disabled={busy} onClick={() => demoLogin(DEMO_ACCOUNTS.admin)}>Administrator account</button>
          </div>
          <p className="muted xsmall">Or create a new account below: it will wait for approval in the administrator dashboard.</p>
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <Field label={t('email')}>
          <div className="input-icon"><LuMail aria-hidden /><input type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="your email address" /></div>
        </Field>
        <Field label={t('password')}>
          <div className="input-icon"><LuLock aria-hidden /><input type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} /></div>
        </Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Continue'} <LuArrowRight aria-hidden /></button>
      </form>
      <div className="auth-links">
        <a href="#/forgot">{t('forgotPassword')}</a>
        <span>{t('noAccount')} <a href="#/register">{t('signUp')}</a></span>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [done, setDone] = useState(false);
  const pwErr = pw && pw.length < 8 ? t('pwRule') : null;
  const mismatch = pw2 && pw !== pw2 ? t('pwMismatch') : null;
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Please enter a valid e-mail address.'); return; }
    if (pw.length < 8 || pw !== pw2) return;
    setBusy(true);
    try {
      const res = await auth.signUp(email.trim(), pw);
      if (res.session) navigate('/', { replace: true }); else setDone(true);
    } catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <AuthShell>
        <h1 className="auth-title">Check your inbox</h1>
        <p>{t('checkEmail')}</p>
        <p className="muted small">After confirming, your registration will wait for the administrator's approval.</p>
        <a className="btn btn-primary btn-block" href="#/login">{t('signIn')}</a>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <h1 className="auth-title">{t('createYourAccount')}</h1>
      <p className="muted small">New accounts are reviewed by the administrator before access is granted.</p>
      <form onSubmit={submit} noValidate>
        <Field label={t('email')}><div className="input-icon"><LuMail aria-hidden />
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></Field>
        <Field label={t('password')} hint={t('pwRule')} error={pwErr}><div className="input-icon"><LuLock aria-hidden />
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div></Field>
        <Field label={t('confirmPassword')} error={mismatch}><div className="input-icon"><LuLock aria-hidden />
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div></Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !email || pw.length < 8 || pw !== pw2}>
          {busy ? 'Creating…' : t('signUp')} <LuArrowRight aria-hidden /></button>
      </form>
      <div className="auth-links"><span>{t('haveAccount')} <a href="#/login">{t('signIn')}</a></span></div>
    </AuthShell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false); const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await auth.resetPasswordForEmail(email.trim()); setSent(true); }
    catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="auth-title">Reset your password</h1>
      {sent ? <p className="notice notice-ok">{t('resetSent')}</p> : (
        <form onSubmit={submit} noValidate>
          <Field label={t('email')}><div className="input-icon"><LuMail aria-hidden />
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></Field>
          {err && <p className="form-error" role="alert">{err}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !email}>{busy ? 'Sending…' : t('sendResetLink')}</button>
        </form>
      )}
      <div className="auth-links"><a href="#/login">← {t('signIn')}</a></div>
    </AuthShell>
  );
}

export function NewPasswordPage({ onDone }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw.length < 8 || pw !== pw2) return;
    setBusy(true);
    try { await auth.updatePassword(pw); onDone(); }
    catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="auth-title">Choose a new password</h1>
      <form onSubmit={submit} noValidate>
        <Field label={t('newPassword')} hint={t('pwRule')} error={pw && pw.length < 8 ? t('pwRule') : null}>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label={t('confirmPassword')} error={pw2 && pw !== pw2 ? t('pwMismatch') : null}>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || pw.length < 8 || pw !== pw2}>{busy ? t('saving') : t('savePassword')}</button>
      </form>
    </AuthShell>
  );
}

export function StatusPage({ status }) {
  const { profile, reloadProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const map = {
    pending: { title: t('pendingTitle'), body: t('pendingBody'), art: 'mascot/mascot_wave.webp' },
    rejected: { title: t('rejectedTitle'), body: t('rejectedBody'), art: 'mascot/mascot_wave_small.webp' },
    suspended: { title: t('suspendedTitle'), body: t('suspendedBody'), art: 'mascot/mascot_wave_small.webp' },
  };
  const m = map[status] || map.pending;
  return (
    <div className="status-page">
      <div className="card status-card">
        {status === 'pending' ? <WavingMascot className="status-art" /> : <img src={`assets/${m.art}`} alt="" className="status-art" />}
        <h1>{m.title}</h1>
        <p>{m.body}</p>
        <p className="muted small">Signed in as <strong>{profile && profile.email}</strong>
          {profile && status === 'pending' && <> · registered {new Date(profile.created_at).toLocaleDateString()}</>}</p>
        <div className="row gap center">
          {status === 'pending' && (
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await reloadProfile(); setBusy(false); }}>
              <LuRefreshCw aria-hidden /> {t('checkAgain')}</button>
          )}
          <button className="btn" onClick={signOut}><LuLogOut aria-hidden /> {t('signOut')}</button>
        </div>
      </div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className="status-page">
      <div className="card status-card">
        <img src="assets/mascot/mascot_wave_small.webp" alt="" className="status-art" />
        <h1>Almost ready</h1>
        <p>The app is not connected to its database yet. Copy <code>config.example.js</code> to <code>config.js</code> and fill in your Supabase project URL and anon key (see README).</p>
      </div>
    </div>
  );
}
