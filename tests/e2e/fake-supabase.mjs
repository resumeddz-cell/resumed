// Local stand-in for Supabase used ONLY for automated end-to-end tests.
// It implements the subset of the Auth (GoTrue) and REST (PostgREST) protocols the app uses,
// and executes every data request inside the real PostgreSQL database as role `authenticated`
// with the caller's JWT claims — so the real RLS policies, triggers and functions are exercised.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 54400);
const DB = process.env.PGDATABASE || 'resumed_e2e';
const DIST = process.env.DIST || join(process.cwd(), 'dist');
const AUTO_CONFIRM = process.env.AUTO_CONFIRM !== '0';
let TOKEN_TTL = Number(process.env.TOKEN_TTL || 3600);
const SECRET = crypto.randomBytes(32);
const ORIGIN = `http://localhost:${PORT}`;

// ---------------------------------------------------------------- jwt
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())}`;
}
function verify(token) {
  const [h, p, s] = String(token).split('.');
  if (!s) return null;
  const ok = b64u(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest()) === s;
  if (!ok) return null;
  return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
}
const ANON_KEY = sign({ role: 'anon', iss: 'fake-supabase' });

// ---------------------------------------------------------------- psql
function psql(sql) {
  return new Promise((resolve) => {
    const p = spawn('psql', ['-h', '/tmp', '-p', '54329', '-U', 'postgres', '-d', DB, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']);
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(`\\set VERBOSITY verbose\n${sql}\n`);
  });
}
const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw httpError(400, 'PGRST100', `bad identifier ${s}`); return `"${s}"`; };
function httpError(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

function pgError(err, role) {
  const m = err.match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/);
  const code = m ? m[1] : 'XX000'; const message = m ? m[2] : err;
  const status = code === '42501' ? (role === 'anon' ? 401 : 403) : ['23505', '23503'].includes(code) ? 409 : code === 'P0002' ? 404 : 400;
  return httpError(status, code, message);
}

async function asRole(claims, statement) {
  const role = claims ? 'authenticated' : 'anon';
  const sql = `begin;\nset local role ${role};\ndo $q$ begin perform set_config('request.jwt.claims', ${lit(JSON.stringify(claims || { role: 'anon' }))}, true); end $q$;\n${statement};\ncommit;`;
  const r = await psql(sql);
  if (r.code !== 0) throw pgError(r.err, role);
  return r.out === '' ? null : JSON.parse(r.out);
}
async function superuser(sql) { const r = await psql(sql); if (r.code !== 0) throw pgError(r.err, 'postgres'); return r.out; }

// ---------------------------------------------------------------- PostgREST subset
function parseFilters(params, alias) {
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) continue;
    const col = `${alias}.${ident(k)}`;
    const dot = v.indexOf('.'); const op = v.slice(0, dot); const val = v.slice(dot + 1);
    const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    if (ops[op]) where.push(`${col} ${ops[op]} ${lit(val)}`);
    else if (op === 'ilike') where.push(`${col}::text ilike ${lit(val.replace(/\*/g, '%'))}`);
    else if (op === 'is') where.push(`${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`);
    else if (op === 'in') {
      const inner = val.replace(/^\(/, '').replace(/\)$/, '');
      const items = inner.match(/"([^"]*)"|[^,]+/g) || [];
      where.push(`${col} in (${items.map((x) => lit(x.replace(/^"|"$/g, ''))).join(',') || 'NULL'})`);
    } else throw httpError(400, 'PGRST100', `unsupported operator ${op}`);
  }
  return where.length ? `where ${where.join(' and ')}` : '';
}
function parseOrder(o, alias) {
  if (!o) return '';
  return `order by ${o.split(',').map((part) => {
    const [c, ...mods] = part.split('.');
    return `${alias}.${ident(c)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullslast') ? ' nulls last' : mods.includes('nullsfirst') ? ' nulls first' : ''}`;
  }).join(', ')}`;
}
const fnTypes = new Map();
async function rpc(claims, fn, args) {
  ident(fn);
  if (!fnTypes.has(fn)) {
    const t = await superuser(`select format_type(prorettype, null) from pg_proc where proname = ${lit(fn)} and pronamespace = 'public'::regnamespace limit 1`);
    if (!t) throw httpError(404, 'PGRST202', `function ${fn} not found`);
    fnTypes.set(fn, t);
  }
  const argSql = Object.entries(args || {}).map(([k, v]) => {
    let val;
    if (v === null || v === undefined) val = 'NULL';
    else if (Array.isArray(v)) val = lit(`{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}`);
    else if (typeof v === 'object') val = lit(JSON.stringify(v));
    else if (typeof v === 'boolean' || typeof v === 'number') val = String(v);
    else val = lit(v);
    return `${ident(k)} => ${val}`;
  }).join(', ');
  const call = `public.${ident(fn)}(${argSql})`;
  const type = fnTypes.get(fn);
  if (type === 'void') { await asRole(claims, `select 1 from (select ${call}) x where false`); return null; }
  return asRole(claims, `select to_json(r) from (select (${call}) as r) s`);
}

async function rest(req, claims, path, params, body) {
  if (path.startsWith('rpc/')) return rpc(claims, path.slice(4), body);
  const table = `public.${ident(path)}`;
  const prefer = req.headers.prefer || '';
  if (req.method === 'GET') {
    const cols = (params.get('select') || '*').split(',').map((c) => (c === '*' ? 'x.*' : `x.${ident(c)}`)).join(', ');
    const limit = params.get('limit') ? `limit ${Number(params.get('limit'))}` : '';
    return asRole(claims, `select coalesce(json_agg(t), '[]'::json) from (select ${cols} from ${table} x ${parseFilters(params, 'x')} ${parseOrder(params.get('order'), 'x')} ${limit}) t`);
  }
  if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].map(ident);
    const conflict = params.get('on_conflict');
    let onc = '';
    if (conflict && prefer.includes('merge-duplicates')) {
      const cc = conflict.split(',').map(ident);
      const upd = keys.filter((k) => !cc.includes(k)).map((k) => `${k} = excluded.${k}`);
      onc = `on conflict (${cc.join(',')}) ${upd.length ? `do update set ${upd.join(', ')}` : 'do nothing'}`;
    }
    return asRole(claims, `with r as (insert into ${table} (${keys.join(',')}) select ${keys.join(',')} from json_populate_recordset(null::${table}, ${lit(JSON.stringify(rows))}) ${onc} returning *) select coalesce(json_agg(r), '[]'::json) from r`);
  }
  if (req.method === 'PATCH') {
    const keys = Object.keys(body || {}).map(ident);
    const where = parseFilters(params, 'x');
    if (!where) throw httpError(400, 'PGRST000', 'PATCH requires filters');
    return asRole(claims, `with r as (update ${table} as x set ${keys.map((k) => `${k} = j.${k}`).join(', ')} from json_populate_record(null::${table}, ${lit(JSON.stringify(body))}) j ${where} returning x.*) select coalesce(json_agg(r), '[]'::json) from r`);
  }
  if (req.method === 'DELETE') {
    const where = parseFilters(params, 'x');
    if (!where) throw httpError(400, 'PGRST000', 'DELETE requires filters');
    return asRole(claims, `with r as (delete from ${table} as x ${where} returning x.*) select coalesce(json_agg(r), '[]'::json) from r`);
  }
  throw httpError(405, 'PGRST000', 'method not allowed');
}

// ---------------------------------------------------------------- GoTrue subset
const refreshTokens = new Map();   // token -> { sessionId, userId }
const mailbox = [];                 // { email, type, link }
const verifyTokens = new Map();     // token -> { userId, type }

async function userRow(where) {
  const out = await superuser(`select row_to_json(u) from (select id, email, email_confirmed_at, created_at from auth.users where ${where}) u`);
  return out ? JSON.parse(out) : null;
}
async function issueSession(user) {
  const sid = await superuser(`with s as (insert into auth.sessions (user_id) values (${lit(user.id)}) returning id) select id from s`);
  const rt = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(rt, { sessionId: sid, userId: user.id });
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const access = sign({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp, session_id: sid });
  return { access_token: access, token_type: 'bearer', expires_in: TOKEN_TTL, expires_at: exp, refresh_token: rt, user: { ...user, identities: [{ provider: 'email' }] } };
}
function authErr(status, error_code, msg) { const e = httpError(status, error_code, msg); e.gotrue = true; return e; }
function claimsFrom(req) {
  const h = req.headers.authorization || '';
  const tok = h.replace(/^Bearer\s+/i, '');
  if (!tok || tok === ANON_KEY) return null;
  const c = verify(tok);
  if (!c) throw httpError(401, 'PGRST301', 'JWT invalid');
  if (c.exp && c.exp < Date.now() / 1000) throw httpError(401, 'PGRST301', 'JWT expired');
  return c;
}

async function gotrue(req, path, params, body) {
  if (path === '/signup' && req.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw authErr(400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (String(body.password || '').length < 6) throw authErr(422, 'weak_password', 'Password should be at least 6 characters.');
    const existing = await userRow(`lower(email) = ${lit(email)}`);
    if (existing) {
      if (AUTO_CONFIRM) throw authErr(422, 'user_already_exists', 'User already registered');
      return { id: crypto.randomUUID(), email, identities: [] };
    }
    await superuser(`insert into auth.users (email, encrypted_password, email_confirmed_at) values (${lit(email)}, crypt(${lit(body.password)}, gen_salt('bf', 4)), ${AUTO_CONFIRM ? 'now()' : 'null'})`);
    const user = await userRow(`lower(email) = ${lit(email)}`);
    if (AUTO_CONFIRM) return issueSession(user);
    const tok = crypto.randomBytes(16).toString('hex'); verifyTokens.set(tok, { userId: user.id, type: 'signup' });
    mailbox.push({ email, type: 'signup', link: `${ORIGIN}/auth/v1/verify?token=${tok}&type=signup&redirect_to=${encodeURIComponent(params.get('redirect_to') || ORIGIN)}` });
    return { ...user, identities: [{ provider: 'email' }] };
  }
  if (path === '/token' && params.get('grant_type') === 'password') {
    const u = await userRow(`lower(email) = ${lit(String(body.email || '').toLowerCase())} and encrypted_password = crypt(${lit(body.password || '')}, encrypted_password)`);
    if (!u) throw authErr(400, 'invalid_credentials', 'Invalid login credentials');
    if (!u.email_confirmed_at) throw authErr(400, 'email_not_confirmed', 'Email not confirmed');
    return issueSession(u);
  }
  if (path === '/token' && params.get('grant_type') === 'refresh_token') {
    const rt = refreshTokens.get(body.refresh_token);
    if (!rt) throw authErr(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    const alive = await superuser(`select count(*) from auth.sessions where id = ${lit(rt.sessionId)}`);
    refreshTokens.delete(body.refresh_token);
    if (alive !== '1') throw authErr(400, 'session_not_found', 'Invalid Refresh Token: Session Expired (Revoked by Newer Login)');
    await superuser(`delete from auth.sessions where id = ${lit(rt.sessionId)}`);
    return issueSession(await userRow(`id = ${lit(rt.userId)}`));
  }
  if (path === '/logout' && req.method === 'POST') {
    const c = claimsFrom(req); if (c && c.session_id) await superuser(`delete from auth.sessions where id = ${lit(c.session_id)}`);
    return null;
  }
  if (path === '/recover' && req.method === 'POST') {
    const u = await userRow(`lower(email) = ${lit(String(body.email || '').toLowerCase())}`);
    if (u) {
      const tok = crypto.randomBytes(16).toString('hex'); verifyTokens.set(tok, { userId: u.id, type: 'recovery' });
      mailbox.push({ email: u.email, type: 'recovery', link: `${ORIGIN}/auth/v1/verify?token=${tok}&type=recovery&redirect_to=${encodeURIComponent(params.get('redirect_to') || ORIGIN)}` });
    }
    return {};
  }
  if (path === '/user' && req.method === 'GET') { const c = claimsFrom(req); if (!c) throw authErr(401, 'no_authorization', 'Unauthorized'); return userRow(`id = ${lit(c.sub)}`); }
  if (path === '/user' && req.method === 'PUT') {
    const c = claimsFrom(req); if (!c) throw authErr(401, 'no_authorization', 'Unauthorized');
    if (body.password) {
      if (String(body.password).length < 6) throw authErr(422, 'weak_password', 'Password should be at least 6 characters.');
      await superuser(`update auth.users set encrypted_password = crypt(${lit(body.password)}, gen_salt('bf', 4)) where id = ${lit(c.sub)}`);
    }
    return userRow(`id = ${lit(c.sub)}`);
  }
  throw authErr(404, 'not_found', `unsupported auth endpoint ${path}`);
}

async function verifyLink(params, res) {
  const v = verifyTokens.get(params.get('token'));
  const redirect = params.get('redirect_to') || ORIGIN;
  if (!v) { res.writeHead(303, { Location: `${redirect}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired` }); return res.end(); }
  verifyTokens.delete(params.get('token'));
  if (v.type === 'signup') await superuser(`update auth.users set email_confirmed_at = now() where id = ${lit(v.userId)}`);
  const s = await issueSession(await userRow(`id = ${lit(v.userId)}`));
  res.writeHead(303, { Location: `${redirect}#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=${v.type}` });
  return res.end();
}

// ---------------------------------------------------------------- fault injection & helpers for tests
const faults = [];   // { match, count, status }
function takeFault(path) {
  const f = faults.find((x) => x.count > 0 && path.includes(x.match));
  if (!f) return null; f.count -= 1; return f;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

function send(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extra });
  res.end(data === null || data === undefined ? '' : JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' });
    return res.end();
  }
  let raw = ''; for await (const c of req) raw += c;
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { message: 'invalid json' }); }
  try {
    if (path.startsWith('/__test/')) {
      if (path === '/__test/mailbox') return send(res, 200, mailbox.filter((m) => !url.searchParams.get('email') || m.email === url.searchParams.get('email')));
      if (path === '/__test/fail') { faults.push({ match: body.match, count: body.count || 1, status: body.status || 503 }); return send(res, 200, { ok: true }); }
      if (path === '/__test/clear-faults') { faults.length = 0; return send(res, 200, { ok: true }); }
      if (path === '/__test/sql') return send(res, 200, { out: await superuser(body.sql) });
      if (path === '/__test/ttl') { TOKEN_TTL = Number(body.ttl); return send(res, 200, { ok: true }); }
    }
    if ((path.startsWith('/auth/v1/') && path !== '/auth/v1/verify') || path.startsWith('/rest/v1/')) {
      if (req.headers.apikey !== ANON_KEY) return send(res, 401, { message: 'Invalid API key' });
      const f = takeFault(path + url.search);
      if (f) return send(res, f.status, { code: 'PGRST503', message: 'Simulated database failure' });
    }
    if (path === '/auth/v1/verify') return verifyLink(url.searchParams, res);
    if (path.startsWith('/auth/v1')) return send(res, 200, await gotrue(req, path.slice(8), url.searchParams, body));
    if (path.startsWith('/rest/v1/')) {
      const claims = claimsFrom(req);
      return send(res, 200, await rest(req, claims, path.slice(9), url.searchParams, body));
    }
    if (path === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`window.__RESUMED_CONFIG__ = ${JSON.stringify({ supabaseUrl: ORIGIN, supabaseAnonKey: ANON_KEY })};`);
    }
    const file = normalize(join(DIST, path === '/' ? 'index.html' : decodeURIComponent(path)));
    if (!file.startsWith(DIST)) return send(res, 403, { message: 'forbidden' });
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    return res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, { message: 'not found' });
    if (e.gotrue) return send(res, e.status, { code: e.status, error_code: e.code, msg: e.message });
    return send(res, e.status || 500, { code: e.code || 'XX000', message: e.message, details: null, hint: null });
  }
});
server.listen(PORT, () => console.log(`fake-supabase listening on ${ORIGIN} (db=${DB}, autoconfirm=${AUTO_CONFIRM})`));
