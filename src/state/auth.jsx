import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { auth } from '../lib/supabase.js';
import { profileApi, currentUserId } from '../lib/api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Status of the gate: 'loading' | 'signedOut' | 'ready' | 'error'
export function AuthProvider({ children }) {
  // Links from Supabase e-mails (#access_token=...&type=recovery|signup) must be consumed BEFORE
  // the session state is initialised, so the new session is picked up on the very first render.
  const [fromLink] = useState(() => auth.consumeUrlHash());
  const [session, setSession] = useState(auth.getSession());
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState(session ? 'loading' : 'signedOut');
  const [notice, setNotice] = useState(() => (fromLink && fromLink.error ? { type: 'error', text: fromLink.error }
    : fromLink && fromLink.type === 'signup' ? { type: 'ok', text: 'E-mail confirmed. Welcome!' } : null));
  const [recovery, setRecovery] = useState(() => !!(fromLink && fromLink.type === 'recovery'));   // arrived from a password-reset e-mail
  const [error, setError] = useState(null);
  const lastUid = useRef(currentUserId());

  const loadProfile = useCallback(async () => {
    if (!auth.getSession()) { setProfile(null); setState('signedOut'); return null; }
    try {
      const p = await profileApi.me();
      if (!p) throw new Error('Your profile could not be found.');
      setProfile(p); setError(null); setState('ready');
      return p;
    } catch (e) {
      if (e.status === 401 || e.kind === 'auth') { setState('signedOut'); return null; }
      setError(e); setState((s) => (s === 'ready' ? 'ready' : 'error'));   // keep the app usable if a background re-check fails
      return null;
    }
  }, []);

  useEffect(() => {
    const off = auth.onChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SESSION_EXPIRED') setNotice({ type: 'error', text: 'Your session has expired. Please sign in again.' });
      if (!s) { setProfile(null); setState('signedOut'); lastUid.current = null; return; }
      const id = currentUserId();
      if (id !== lastUid.current) { lastUid.current = id; setState('loading'); loadProfile(); }
    });
    if (auth.getSession()) loadProfile();
    return off;
  }, [loadProfile]);

  // Re-check the account status regularly and when the tab regains focus, so an approval,
  // rejection or suspension is reflected right away.
  useEffect(() => {
    if (!session) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') loadProfile(); };
    const id = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [session, loadProfile]);

  const value = {
    session, profile, state, error, notice, recovery,
    setNotice, setRecovery, setProfile, reloadProfile: loadProfile,
    isAdmin: !!profile && profile.role === 'admin' && profile.status === 'approved',
    signOut: async () => { await auth.signOut(); setNotice(null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
