// Minimal, dependency-free client for Supabase Auth (GoTrue) and the REST API (PostgREST).
// Only the public "anon" key is used in the browser. The service-role key must NEVER be put here.
import { config } from './config.js';

const STORAGE_KEY = 'resumed.session.v1';

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, details = null, kind = 'api' } = {}) {
    super(message);
    this.status = status; this.code = code; this.details = details; this.kind = kind;
  }
}

function safeStorage() {
  try { const k = '__t'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return window.localStorage; }
  catch { return null; }
}
const store = safeStorage();
const memory = {};
function readSession() {
  try { const raw = store ? store.getItem(STORAGE_KEY) : memory[STORAGE_KEY]; return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function writeSession(s) {
  const raw = s ? JSON.stringify(s) : null;
  try {
    if (store) { raw ? store.setItem(STORAGE_KEY, raw) : store.removeItem(STORAGE_KEY); }
    else if (raw) memory[STORAGE_KEY] = raw; else delete memory[STORAGE_KEY];
  } catch { /* storage full or blocked: session stays in memory for this tab */ memory[STORAGE_KEY] = raw; }
}

async function request(url, { method = 'GET', headers = {}, body, signal } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError('Network problem — check your connection and try again.', { kind: 'network' });
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `Request failed (${res.status})`;
    throw new ApiError(String(msg), {
      status: res.status,
      code: (data && (data.error_code || data.code)) || null,
      details: data && (data.details || data.hint) || null,
      kind: res.status === 401 ? 'auth' : 'api',
    });
  }
  return data;
}

// ------------------------------------------------------------------ auth
const listeners = new Set();
let session = readSession();
let refreshing = null;

function emit(event) { listeners.forEach((fn) => { try { fn(event, session); } catch { /* ignore */ } }); }

function setSession(s, event = 'SIGNED_IN') {
  session = s ? { ...s, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) } : null;
  writeSession(session);
  emit(event);
}

const authUrl = (p) => `${config.supabaseUrl}/auth/v1${p}`;
const baseHeaders = () => ({ apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' });

export const auth = {
  getSession: () => session,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async signUp(email, password) {
    const redirect = `${window.location.origin}${window.location.pathname}`;
    const data = await request(authUrl(`/signup?redirect_to=${encodeURIComponent(redirect)}`), {
      method: 'POST', headers: baseHeaders(), body: { email, password },
    });
    if (data && data.access_token) { setSession(data); return { session: data, user: data.user }; }
    const user = (data && data.user) || data;
    // With e-mail confirmation enabled, Supabase hides duplicates by returning a user without identities.
    if (user && Array.isArray(user.identities) && user.identities.length === 0) {
      throw new ApiError('An account with this e-mail already exists. Sign in or reset your password.', { code: 'user_already_exists' });
    }
    return { session: null, user };
  },

  async signIn(email, password) {
    const data = await request(authUrl('/token?grant_type=password'), {
      method: 'POST', headers: baseHeaders(), body: { email, password },
    });
    setSession(data);
    return data;
  },

  async refresh() {
    if (!session || !session.refresh_token) throw new ApiError('Not signed in', { kind: 'auth', status: 401 });
    if (!refreshing) {
      const token = session.refresh_token;
      refreshing = request(authUrl('/token?grant_type=refresh_token'), {
        method: 'POST', headers: baseHeaders(), body: { refresh_token: token },
      }).then((data) => { setSession(data, 'TOKEN_REFRESHED'); return data; })
        .catch((e) => {
          if (e.kind !== 'network') { setSession(null, 'SESSION_EXPIRED'); }
          throw e;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  },

  // Returns a valid access token, refreshing it shortly before expiry.
  async accessToken() {
    if (!session) return null;
    if (session.expires_at - 60 < Date.now() / 1000) await auth.refresh();
    return session && session.access_token;
  },

  async signOut() {
    const s = session;
    setSession(null, 'SIGNED_OUT');            // local sign-out always succeeds; data is never touched
    if (s && s.access_token) {
      try { await request(authUrl('/logout'), { method: 'POST', headers: { ...baseHeaders(), Authorization: `Bearer ${s.access_token}` } }); }
      catch { /* token already invalid: nothing to do */ }
    }
  },

  async resetPasswordForEmail(email) {
    const redirect = `${window.location.origin}${window.location.pathname}?reset=1`;
    await request(authUrl(`/recover?redirect_to=${encodeURIComponent(redirect)}`), {
      method: 'POST', headers: baseHeaders(), body: { email },
    });
  },

  async updatePassword(password) {
    const token = await auth.accessToken();
    const data = await request(authUrl('/user'), {
      method: 'PUT', headers: { ...baseHeaders(), Authorization: `Bearer ${token}` }, body: { password },
    });
    return data;
  },

  // Handles links coming back from Supabase e-mails (#access_token=...&type=recovery|signup, or #error=...)
  consumeUrlHash() {
    const h = window.location.hash || '';
    if (!h.includes('access_token=') && !h.includes('error=')) return null;
    const p = new URLSearchParams(h.replace(/^#\/?/, ''));
    const clean = () => window.history.replaceState(null, '', window.location.pathname + '#/');
    if (p.get('error')) {
      clean();
      return { error: p.get('error_description') || p.get('error') };
    }
    const s = {
      access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
      expires_in: Number(p.get('expires_in') || 3600), expires_at: Number(p.get('expires_at')) || undefined,
      token_type: 'bearer',
    };
    const type = p.get('type');
    clean();
    if (s.access_token && s.refresh_token) { setSession(s, type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN'); }
    return { type };
  },
};

// ------------------------------------------------------------------ database (PostgREST)
function enc(v) { return encodeURIComponent(v); }
function filterParam([col, op, val]) {
  if (op === 'in') return `${enc(col)}=in.(${val.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).map(enc).join(',')})`;
  if (op === 'is') return `${enc(col)}=is.${val === null ? 'null' : val}`;
  return `${enc(col)}=${op}.${enc(val)}`;
}

async function rest(path, { method = 'GET', query = [], body, prefer, signal, retry = true } = {}) {
  // Signed in: send the user's JWT. Signed out: send only the apikey header (works with both the
  // legacy anon JWT and the new sb_publishable_ keys, which must not be sent as a Bearer token).
  const token = await auth.accessToken();
  const headers = { ...baseHeaders(), Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const qs = query.filter(Boolean).join('&');
  const url = `${config.supabaseUrl}/rest/v1/${path}${qs ? `?${qs}` : ''}`;
  try {
    return await request(url, { method, headers, body, signal });
  } catch (e) {
    // expired/invalid JWT: refresh once and retry
    if (retry && e.status === 401 && session) {
      await auth.refresh();
      return rest(path, { method, query, body, prefer, signal, retry: false });
    }
    throw e;
  }
}

export const db = {
  select(table, { columns = '*', filters = [], order = [], limit, signal } = {}) {
    const query = [`select=${enc(columns)}`, ...filters.map(filterParam)];
    if (order.length) query.push(`order=${order.map(enc).join(',')}`);
    if (limit) query.push(`limit=${limit}`);
    return rest(table, { query, signal });
  },
  insert(table, rows) {
    return rest(table, { method: 'POST', body: rows, prefer: 'return=representation' });
  },
  upsert(table, rows, onConflict) {
    return rest(table, { method: 'POST', body: rows, query: [`on_conflict=${enc(onConflict)}`],
      prefer: 'return=representation,resolution=merge-duplicates' });
  },
  update(table, patch, filters) {
    if (!filters || !filters.length) throw new Error('update() requires filters');
    return rest(table, { method: 'PATCH', body: patch, query: filters.map(filterParam), prefer: 'return=representation' });
  },
  remove(table, filters) {
    if (!filters || !filters.length) throw new Error('remove() requires filters');
    return rest(table, { method: 'DELETE', query: filters.map(filterParam), prefer: 'return=representation' });
  },
  rpc(fn, args = {}) {
    return rest(`rpc/${fn}`, { method: 'POST', body: args });
  },
};

// Present only in the demo build (see supabase-demo.js); kept here so both builds share one interface.
export const DEMO_ACCOUNTS = null;
export function resetDemo() {}
