import React, { useLayoutEffect, useRef, useState } from 'react';
import { LuMail, LuLock, LuArrowRight, LuRefreshCw, LuLogOut } from 'react-icons/lu';
import { auth, DEMO_ACCOUNTS } from '../lib/supabase.js';
import { navigate } from '../lib/router.js';
import { useAuth } from '../state/auth.jsx';
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

// Login / sign-up screens: the illustrated poster from the PDF (page 1) with a real form placed where
// the drawn one was. Everything is sized in "u" = 1% of the poster width, so the layout matches the
// artwork at every screen size; inputs keep a 16px minimum so phones don't zoom in.
export function AuthShell({ title, children, tall = false }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const set = () => el.style.setProperty('--u', `${el.clientWidth / 100}px`);
    set();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', set); return () => window.removeEventListener('resize', set); }
    const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect();
  }, []);
  return (
    <div className="auth-shell">
      <div className={`auth-poster${tall ? ' is-tall' : ''}`} ref={ref}>
        <img className="auth-bg" src="assets/art/login_poster.webp" srcSet="assets/art/login_poster_sm.webp 812w, assets/art/login_poster.webp 1624w"
             sizes="(min-aspect-ratio: 1624/2293) 71vh, 100vw" alt="Resumed Planner — Plan · Study · Track · Succeed" />
        <img className="auth-better" src="assets/art/login_better.webp" alt="" aria-hidden />
        <div className="auth-zone">
          <div className="lp-head">
            <img className="lp-spark lp-spark-l" src="assets/art/login_spark_l.webp" alt="" aria-hidden />
            <h1 className="lp-title" style={{ '--fs': Math.min(3.9, 30 / (0.39 * String(title).length)).toFixed(2) }}>{title}</h1>
            <img className="lp-spark lp-spark-r" src="assets/art/login_spark_r.webp" alt="" aria-hidden />
          </div>
          <img className="lp-arrow" src="assets/art/login_arrow.webp" alt="" aria-hidden />
          {children}
        </div>
      </div>
    </div>
  );
}

function PillInput({ icon: Icon, label, ...props }) {
  return (
    <label className="lp-input">
      <span className="sr-only">{label}</span>
      <Icon aria-hidden />
      <input {...props} />
    </label>
  );
}

function Notice() {
  const { notice } = useAuth();
  if (!notice) return null;
  return <p className={`lp-msg lp-msg-${notice.type}`} role="alert">{notice.text}</p>;
}

const validEmail = (v) => /^\S+@\S+\.\S+$/.test(v.trim());

export function LoginPage() {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const { setNotice } = useAuth();
  const next = (e) => {
    e.preventDefault(); setErr(null);
    if (!validEmail(email)) { setErr('Please enter a valid e-mail address.'); return; }
    setStep('password');
  };
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
  const demo = __DEMO__ && DEMO_ACCOUNTS;
  return (
    <AuthShell title={step === 'email' ? 'Enter your email' : 'Enter your password'} tall={!!demo || step === 'password' || !!err}>
      {step === 'email' ? (
        <form className="lp-form" onSubmit={next} noValidate>
          <PillInput icon={LuMail} label="E-mail" type="email" autoComplete="username email" inputMode="email" autoFocus
                     value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your email address" />
          {err && <p className="lp-msg lp-msg-error" role="alert">{err}</p>}
          <button className="lp-btn" disabled={busy}>Continue <LuArrowRight aria-hidden /></button>
        </form>
      ) : (
        <form className="lp-form" onSubmit={submit} noValidate>
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <p className="lp-who"><span>{email.trim()}</span>
            <button type="button" className="lp-link" onClick={() => { setStep('email'); setPassword(''); setErr(null); }}>change</button></p>
          <PillInput icon={LuLock} label="Password" type="password" autoComplete="current-password" autoFocus
                     value={password} onChange={(e) => setPassword(e.target.value)} placeholder="your password" />
          {err && <p className="lp-msg lp-msg-error" role="alert">{err}</p>}
          <button className="lp-btn" disabled={busy}>{busy ? 'Signing in…' : 'Continue'} <LuArrowRight aria-hidden /></button>
        </form>
      )}
      <div className="lp-links">
        {step === 'password' && <a href="#/forgot">Forgot password?</a>}
        <span>New here? <a href="#/register">Create an account</a></span>
      </div>
      <Notice />
      {demo && (
        <div className="lp-demo">
          <p><strong>Try the demo</strong> — sign in with one tap:</p>
          <div className="row gap wrap center">
            <button className="btn btn-primary btn-small" disabled={busy} onClick={() => demoLogin(DEMO_ACCOUNTS.student)}>Student account</button>
            <button className="btn btn-pink btn-small" disabled={busy} onClick={() => demoLogin(DEMO_ACCOUNTS.admin)}>Administrator account</button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [done, setDone] = useState(false);
  const next = (e) => {
    e.preventDefault(); setErr(null);
    if (!validEmail(email)) { setErr('Please enter a valid e-mail address.'); return; }
    setStep('password');
  };
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw.length < 8) { setErr('Your password needs at least 8 characters.'); return; }
    if (pw !== pw2) { setErr(t('pwMismatch')); return; }
    setBusy(true);
    try {
      const res = await auth.signUp(email.trim(), pw);
      if (res.session) navigate('/', { replace: true }); else setDone(true);
    } catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <AuthShell title="Check your inbox">
        <p className="lp-text">{t('checkEmail')}</p>
        <p className="lp-text lp-small">After confirming, your registration will wait for the administrator's approval.</p>
        <a className="lp-btn" href="#/login">Sign in <LuArrowRight aria-hidden /></a>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={step === 'email' ? 'Create your account' : 'Choose a password'} tall={step === 'password' || !!err}>
      {step === 'email' ? (
        <form className="lp-form" onSubmit={next} noValidate>
          <PillInput icon={LuMail} label="E-mail" type="email" autoComplete="email" inputMode="email" autoFocus
                     value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your email address" />
          {err && <p className="lp-msg lp-msg-error" role="alert">{err}</p>}
          <button className="lp-btn" disabled={busy}>Continue <LuArrowRight aria-hidden /></button>
        </form>
      ) : (
        <form className="lp-form" onSubmit={submit} noValidate>
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <p className="lp-who"><span>{email.trim()}</span>
            <button type="button" className="lp-link" onClick={() => { setStep('email'); setErr(null); }}>change</button></p>
          <PillInput icon={LuLock} label="Password" type="password" autoComplete="new-password" autoFocus
                     value={pw} onChange={(e) => setPw(e.target.value)} placeholder="password (8+ characters)" />
          <PillInput icon={LuLock} label="Confirm password" type="password" autoComplete="new-password"
                     value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="confirm password" />
          {err && <p className="lp-msg lp-msg-error" role="alert">{err}</p>}
          <button className="lp-btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'} <LuArrowRight aria-hidden /></button>
        </form>
      )}
      <div className="lp-links">
        <span>Already have an account? <a href="#/login">Sign in</a></span>
      </div>
    </AuthShell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false); const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (!validEmail(email)) { setErr('Please enter a valid e-mail address.'); return; }
    setBusy(true);
    try { await auth.resetPasswordForEmail(email.trim()); setSent(true); }
    catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Reset your password" tall={!!err || sent}>
      {sent ? <p className="lp-msg lp-msg-ok">{t('resetSent')}</p> : (
        <form className="lp-form" onSubmit={submit} noValidate>
          <PillInput icon={LuMail} label="E-mail" type="email" autoComplete="email" inputMode="email" autoFocus
                     value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your email address" />
          {err && <p className="lp-msg lp-msg-error" role="alert">{err}</p>}
          <button className="lp-btn" disabled={busy}>{busy ? 'Sending…' : t('sendResetLink')}</button>
        </form>
      )}
      <div className="lp-links"><a href="#/login">← Back to sign in</a></div>
    </AuthShell>
  );
}

export function NewPasswordPage({ onDone }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw.length < 8) { setErr('Your password needs at least 8 characters.'); return; }
    if (pw !== pw2) { setErr(t('pwMismatch')); return; }
    setBusy(true);
    try { await auth.updatePassword(pw); onDone(); }
    catch (x) { setErr(authError(x)); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Choose a new password" tall>
      <form className="lp-form" onSubmit={submit} noValidate>
        <PillInput icon={LuLock} label={t('newPassword')} type="password" autoComplete="new-password" autoFocus
                   value={pw} onChange={(e) => setPw(e.target.value)} placeholder="new password (8+ characters)" />
        <PillInput icon={LuLock} label={t('confirmPassword')} type="password" autoComplete="new-password"
                   value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="confirm password" />
        {err && <p className="lp-msg lp-msg-error" role="alert">{err}</p>}
        <button className="lp-btn" disabled={busy}>{busy ? t('saving') : t('savePassword')}</button>
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
