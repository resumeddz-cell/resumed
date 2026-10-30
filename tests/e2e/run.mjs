// End-to-end tests: drives the built app in Chromium against tests/e2e/fake-supabase.mjs
// (real PostgreSQL + real RLS). Prerequisite: `node build.mjs` and `sh tests/e2e/reset-db.sh`.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:54400';
const SHOTS = process.env.SHOTS || 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });
const ADMIN = { email: 'ckm25.dz@gmail.com', password: 'AdminPass#2026' };
const ALICE = { email: 'alice@e2e.test', password: 'Alice#Study1' };
const BOB = { email: 'bob@e2e.test', password: 'Bob#Study1' };
const CAROL = { email: 'carol@e2e.test', password: 'Carol#Study1' };

const results = []; const consoleErrors = []; const openPages = [];
let server;
async function startServer() {
  server = spawn('node', ['tests/e2e/fake-supabase.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
}
async function api(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const sql = async (q) => (await api('/__test/sql', { sql: q })).out;
// completed focus sessions that started since local midnight (what "today" means in the app)
async function todayCompleted(email) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  return Number(await sql(`select count(*) from study_sessions s join profiles p on p.id = s.user_id where p.email = '${email}' and s.status = 'completed' and s.started_at >= '${midnight.toISOString()}'`));
}

async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`PASS  ${name}`); }
  catch (e) { results.push({ name, ok: false, error: String(e && e.message || e).split('\n')[0] }); console.log(`FAIL  ${name}\n      ${String(e && e.message || e).split('\n').slice(0, 3).join('\n      ')}`);
    if (process.env.FAILFAST) { for (const pg of openPages) await pg.screenshot({ path: `${SHOTS}/FAIL-${openPages.indexOf(pg)}.png` }).catch(() => {}); if (server) server.kill(); process.exit(1); } }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

async function newUser(browser, viewport = { width: 1366, height: 900 }, label = 'page') {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage(); openPages.push(page);
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.googleapis|fonts\.gstatic|Failed to load resource: net::ERR_|status of (4\d\d|503)/.test(t)) return;   // offline fonts / expected API errors
    consoleErrors.push(`[${label}] console: ${t}`);
  });
  return { ctx, page };
}
async function login(page, u, { expectFail = false } = {}) {
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type=email]').fill(u.email);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.locator('input[type=password]').fill(u.password);
  await page.getByRole('button', { name: /continue/i }).click();
  if (expectFail) return;
  await page.locator('.auth-shell').waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.loader-full'));
}
async function logout(page) {
  await page.goto(`${BASE}/#/settings`);
  await page.getByRole('button', { name: /^log out$/i }).last().click();
  await page.locator('input[type=email]').waitFor();
}
async function register(page, u) {
  await page.goto(`${BASE}/#/register`);
  const pw = page.locator('input[type=password]');
  await page.locator('input[type=email]').fill(u.email);
  await page.getByRole('button', { name: /continue/i }).click();
  await pw.nth(0).fill(u.password); await pw.nth(1).fill(u.password);
  await page.getByRole('button', { name: /create account/i }).click();
}
const pctText = async (page) => (await page.locator('.overall .pct.big').first().textContent()).trim();
async function openLipides(page) {
  await page.goto(`${BASE}/#/modules`);
  await page.getByRole('tab', { name: /Semester 2/ }).click();
  await page.getByRole('tab', { name: /Semester 2/, selected: true }).waitFor();
  await page.locator('.module-row', { hasText: 'Biochimie' }).click();
  await page.locator('.module-row', { hasText: 'Les lipides' }).click();
  await page.locator('.lesson-row').first().waitFor();
}
async function lessonTitles(page) { return page.locator('.lesson-row .lesson-title').allTextContents(); }
async function toggleStage(page, idx, stage = 'Learned') {
  const row = page.locator('.lesson-row').nth(idx);
  const btn = row.locator('.stage', { hasText: stage });
  const before = await btn.getAttribute('aria-pressed');
  await btn.click();
  await page.waitForFunction(([i, s, b]) => {
    const r = document.querySelectorAll('.lesson-row')[i];
    const el = [...r.querySelectorAll('.stage')].find((x) => x.textContent.includes(s));
    return el && el.getAttribute('aria-pressed') !== b && !el.disabled;
  }, [idx, stage, before], { timeout: 8000 });
}
async function settled(page) {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('.loader'), null, { timeout: 10000 });
}
async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

(async () => {
  await startServer();
  const browser = await chromium.launch();
  const A = await newUser(browser, { width: 1366, height: 900 }, 'alice');
  const ADM = await newUser(browser, { width: 1366, height: 900 }, 'admin');

  // ------------------------------------------------------------------ 1. registration -> pending
  await step('T1 registration creates a pending account (student sees awaiting-approval page)', async () => {
    await register(A.page, ALICE);
    await A.page.getByRole('heading', { name: /awaiting approval/i }).waitFor();
    await A.page.screenshot({ path: `${SHOTS}/01-pending.png` });
    expect((await sql(`select status from profiles where email = '${ALICE.email}'`)) === 'pending', 'db status is not pending');
  });
  await step('Pending user cannot bypass approval by typing protected URLs', async () => {
    for (const r of ['#/modules', '#/planner', '#/admin', '#/progress']) {
      await A.page.goto(`${BASE}/${r}`);
      await A.page.getByRole('heading', { name: /awaiting approval/i }).waitFor();
    }
    const rows = await A.page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('resumed.session.v1'));
      const r = await fetch(`${window.__RESUMED_CONFIG__.supabaseUrl}/rest/v1/modules?select=id`, { headers: { apikey: window.__RESUMED_CONFIG__.supabaseAnonKey, Authorization: `Bearer ${s.access_token}` } });
      return (await r.json()).length;
    });
    expect(rows === 0, `pending user received ${rows} modules from the API`);
  });
  await step('Duplicate e-mail registration shows a clear error', async () => {
    const X = await newUser(browser, undefined, 'dup');
    await register(X.page, ALICE);
    await X.page.getByText(/already exists/i).waitFor();
    await X.ctx.close();
  });
  await step('Invalid login credentials show an error', async () => {
    const X = await newUser(browser, undefined, 'badlogin');
    await login(X.page, { email: ALICE.email, password: 'wrong-password' }, { expectFail: true });
    await X.page.getByText(/incorrect e-mail or password/i).waitFor();
    await X.page.screenshot({ path: `${SHOTS}/00-login.png` });
    await X.ctx.close();
  });

  // ------------------------------------------------------------------ 2. admin approval
  const B = await newUser(browser, { width: 390, height: 844 }, 'bob');
  await step('T2 admin dashboard lists registrations; approve grants access, reject denies it', async () => {
    await register(B.page, BOB);
    await B.page.getByRole('heading', { name: /awaiting approval/i }).waitFor();
    await login(ADM.page, ADMIN);
    await ADM.page.goto(`${BASE}/#/admin`);
    await ADM.page.locator('tr', { hasText: ALICE.email }).waitFor();
    const pending = (await ADM.page.locator('.tile-pending .stat-value').textContent()).trim();
    expect(pending === '2', `pending tile shows ${pending}`);
    await ADM.page.screenshot({ path: `${SHOTS}/02-admin-pending.png`, fullPage: true });
    await ADM.page.locator('tr', { hasText: ALICE.email }).getByRole('button', { name: 'Approve' }).click();
    await ADM.page.locator('tr', { hasText: ALICE.email }).locator('.badge.approved').waitFor();
    await ADM.page.locator('tr', { hasText: BOB.email }).getByRole('button', { name: 'Reject' }).click();
    await ADM.page.getByRole('button', { name: 'Confirm' }).click();
    await ADM.page.locator('tr', { hasText: BOB.email }).locator('.badge.rejected').waitFor();
    // search + filter
    await ADM.page.getByLabel('Search by e-mail').fill('bob');
    await ADM.page.waitForFunction(() => document.querySelectorAll('table.accounts tbody tr').length === 1);
    await ADM.page.getByLabel('Search by e-mail').fill('');
    await ADM.page.getByLabel('Filter by status').selectOption('approved');
    await ADM.page.waitForFunction(() => [...document.querySelectorAll('table.accounts tbody tr')].every((r) => !r.textContent.includes('bob@')));
    await ADM.page.getByLabel('Filter by status').selectOption('');
    // student side
    await A.page.getByRole('button', { name: /check again/i }).click();
    await A.page.getByRole('heading', { name: /welcome/i }).waitFor();
    await B.page.reload();
    await B.page.getByRole('heading', { name: /not approved/i }).waitFor();
    await B.page.screenshot({ path: `${SHOTS}/03-rejected-mobile.png` });
  });

  // ------------------------------------------------------------------ 3. students cannot change permissions
  await step('T3 students cannot change their own role or status (API returns 403)', async () => {
    const out = await A.page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('resumed.session.v1'));
      const { supabaseUrl: u, supabaseAnonKey: k } = window.__RESUMED_CONFIG__;
      const sub = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
      const h = { apikey: k, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
      const a = await fetch(`${u}/rest/v1/profiles?id=eq.${sub}`, { method: 'PATCH', headers: h, body: JSON.stringify({ role: 'admin' }) });
      const b = await fetch(`${u}/rest/v1/profiles?id=eq.${sub}`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'approved' }) });
      const c = await fetch(`${u}/rest/v1/rpc/admin_set_status`, { method: 'POST', headers: h, body: JSON.stringify({ p_user: sub, p_status: 'approved' }) });
      const d = await fetch(`${u}/rest/v1/modules`, { method: 'POST', headers: h, body: JSON.stringify({ title: 'hack', year: 1 }) });
      return [a.status, b.status, c.status, d.status];
    });
    expect(out.every((s) => s === 403), `statuses ${out}`);
    expect((await sql(`select role from profiles where email = '${ALICE.email}'`)) === 'student', 'role changed!');
  });

  // ------------------------------------------------------------------ year selection
  await step('Year selection: Year 1 card -> semester S2 is saved and restored', async () => {
    await A.page.getByRole('button', { name: 'Enter' }).first().click();
    await A.page.screenshot({ path: `${SHOTS}/04-semester.png` });
    await A.page.getByRole('button', { name: /view plan/i }).nth(1).click();
    await A.page.locator('.dash-hero').waitFor();
    expect((await sql(`select selected_year || selected_semester from profiles where email = '${ALICE.email}'`)) === '1S2', 'year not saved');
    await A.page.screenshot({ path: `${SHOTS}/05-dashboard-empty.png`, fullPage: true });
  });

  // ------------------------------------------------------------------ 5. progress 4/10 = 40%
  let titles = [];
  await step('T5 completing 4 of 10 lessons of "Les lipides" shows 40%', async () => {
    await openLipides(A.page);
    titles = await lessonTitles(A.page);
    expect(titles.length === 10, `expected 10 lessons, got ${titles.length}`);
    expect(titles[0].includes('Caractères généraux des lipides') && titles[9].includes('Révision générale des lipides'), 'lesson order differs from the PDF');
    expect((await pctText(A.page)) === '0%', 'did not start at 0%');
    for (let i = 0; i < 4; i++) await toggleStage(A.page, i);
    await A.page.waitForFunction(() => document.querySelector('.overall .pct.big').textContent.trim() === '40%');
    await A.page.screenshot({ path: `${SHOTS}/06-lipides-40.png`, fullPage: true });
    expect((await sql(`select count(*) from lesson_progress lp join profiles p on p.id = lp.user_id where p.email = '${ALICE.email}' and learned`)) === '4', 'db does not have 4 learned');
  });
  await step('T6 logging out and in again preserves 40%', async () => {
    await logout(A.page);
    await login(A.page, ALICE);
    await A.page.locator('.dash-hero').waitFor();
    await openLipides(A.page);
    expect((await pctText(A.page)) === '40%', `got ${await pctText(A.page)}`);
  });
  await step('T7 refreshing the page does not reset progress (and no misleading 0% while loading)', async () => {
    const seen = [];
    await A.page.exposeFunction('__seen', (t) => seen.push(t)).catch(() => {});
    await A.page.reload();
    await A.page.locator('.overall .pct.big').waitFor();
    expect((await pctText(A.page)) === '40%', 'after reload not 40%');
    // the first value rendered after a reload must already be the saved one
    await A.page.evaluate(() => { window.__first = null; });
    await A.page.reload();
    const first = await A.page.waitForFunction(() => { const el = document.querySelector('.overall .pct.big'); return el && el.textContent.trim(); });
    expect((await first.jsonValue()) === '40%', `first rendered value was ${await first.jsonValue()}`);
  });
  const A2 = await newUser(browser, { width: 820, height: 1180 }, 'alice-tablet');
  await step('T8 logging in on another device (tablet) restores the same 40%', async () => {
    await login(A2.page, ALICE);
    await A2.page.locator('.dash-hero').waitFor();
    await openLipides(A2.page);
    expect((await pctText(A2.page)) === '40%', `tablet shows ${await pctText(A2.page)}`);
    await A2.page.screenshot({ path: `${SHOTS}/07-tablet-lipides.png`, fullPage: true });
  });
  await step('T9 completing another lesson updates progress to 50%', async () => {
    await toggleStage(A.page, 4);
    await A.page.waitForFunction(() => document.querySelector('.overall .pct.big').textContent.trim() === '50%');
  });
  await step('T10 reopening a lesson updates the percentage (50% -> 40%)', async () => {
    await toggleStage(A.page, 1);
    await A.page.waitForFunction(() => document.querySelector('.overall .pct.big').textContent.trim() === '40%');
    // other stages are independent and do not change completion
    await toggleStage(A.page, 0, 'Revised 1'); await toggleStage(A.page, 0, 'QCM');
    expect((await pctText(A.page)) === '40%', 'revision stages changed completion %');
  });
  await step('T11 each module keeps independent progress', async () => {
    await A.page.goto(`${BASE}/#/modules`);
    await A.page.getByRole('tab', { name: /Semester 2/ }).click();
    await A.page.locator('.module-row', { hasText: 'Biochimie' }).click();
    const enzymes = await A.page.locator('.module-row', { hasText: 'Les enzymes' }).locator('.pct').textContent();
    const lipides = await A.page.locator('.module-row', { hasText: 'Les lipides' }).locator('.pct').textContent();
    expect(enzymes.trim() === '0%' && lipides.trim() === '40%', `enzymes ${enzymes} lipides ${lipides}`);
    await A.page.screenshot({ path: `${SHOTS}/08-biochimie-chapters.png`, fullPage: true });
    await A.page.getByRole('tab', { name: /Semester 1/ }).isVisible().catch(() => {});
    await A.page.goto(`${BASE}/#/modules`);
    await A.page.getByRole('tab', { name: /Semester 1/ }).click();
    await A.page.getByRole('heading', { name: /Semestre 1/ }).waitFor();
    const s1 = await A.page.locator('.overall .pct.big').textContent();
    expect(s1.trim() === '0%', `S1 shows ${s1}`);
    await A.page.screenshot({ path: `${SHOTS}/09-courses-s1.png`, fullPage: true });
    await A.page.getByRole('tab', { name: /Semester 2/ }).click();
  });
  await step('Empty module shows an empty state, not 0%', async () => {
    const id = await sql(`select id from modules where title = 'Généralités' and semester = 'S2'`);
    await A.page.goto(`${BASE}/#/modules/${id}`);
    await A.page.getByText(/no lessons in this module yet/i).waitFor();
  });

  // ------------------------------------------------------------------ 4. cross-user isolation
  const C = await newUser(browser, { width: 390, height: 844 }, 'carol');
  await step('T4 a student cannot access another student\'s data', async () => {
    await register(C.page, CAROL);
    await ADM.page.goto(`${BASE}/#/admin`); await ADM.page.reload();
    await ADM.page.locator('tr', { hasText: CAROL.email }).getByRole('button', { name: 'Approve' }).click();
    await ADM.page.locator('tr', { hasText: CAROL.email }).locator('.badge.approved').waitFor();
    await C.page.getByRole('button', { name: /check again/i }).click();
    await C.page.getByRole('button', { name: 'Enter' }).first().click();
    await C.page.getByRole('button', { name: /view plan/i }).first().click();
    await C.page.locator('.dash-hero').waitFor();
    const aliceId = await sql(`select id from profiles where email = '${ALICE.email}'`);
    const out = await C.page.evaluate(async (aid) => {
      const s = JSON.parse(localStorage.getItem('resumed.session.v1'));
      const { supabaseUrl: u, supabaseAnonKey: k } = window.__RESUMED_CONFIG__;
      const h = { apikey: k, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
      const get = async (p) => (await (await fetch(`${u}/rest/v1/${p}`, { headers: h })).json());
      const prog = await get(`lesson_progress?user_id=eq.${aid}`);
      const prof = await get('profiles?select=email');
      const del = await (await fetch(`${u}/rest/v1/lesson_progress?user_id=eq.${aid}`, { method: 'DELETE', headers: h })).json();
      const ins = await fetch(`${u}/rest/v1/planner_tasks`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: aid, title: 'x', task_date: '2026-10-29' }) });
      return { prog: prog.length, prof: prof.length, del: del.length, ins: ins.status };
    }, aliceId);
    expect(out.prog === 0 && out.prof === 1 && out.del === 0 && out.ins === 403, JSON.stringify(out));
    await A.page.reload(); await A.page.locator('main .page').first().waitFor();
    expect((await sql(`select count(*) from lesson_progress lp join profiles p on p.id = lp.user_id where p.email = '${ALICE.email}' and learned`)) === '4', 'alice lost data');
    await C.page.goto(`${BASE}/#/modules`);
    await C.page.locator('.module-row').first().waitFor();
    await C.page.screenshot({ path: `${SHOTS}/10-courses-mobile.png`, fullPage: true });
  });

  // ------------------------------------------------------------------ 12/13. planner and weekly notes
  await step('T12 planner tasks and weekly notes survive logout and login', async () => {
    await A.page.goto(`${BASE}/#/planner`);
    await A.page.locator('.week-grid').waitFor();
    await A.page.getByRole('button', { name: 'Add task' }).click();
    await A.page.getByLabel('Title *').fill('Réviser les lipides');
    await A.page.getByLabel('Start time').fill('09:00'); await A.page.getByLabel('End time').fill('10:30');
    await A.page.getByLabel('Priority').selectOption('high'); await A.page.getByLabel('Category').selectOption('revision');
    const modSel = A.page.getByLabel('Medical module (optional)');
    const lipOpt = await modSel.locator('option', { hasText: 'Les lipides' }).getAttribute('value');
    await modSel.selectOption(lipOpt);
    await A.page.getByLabel('Lesson (optional)').selectOption({ index: 1 });
    await A.page.getByRole('button', { name: 'Save task' }).click();
    await A.page.locator('.task', { hasText: 'Réviser les lipides' }).waitFor();
    await A.page.getByRole('tab', { name: /Weekly goals/ }).click();
    await A.page.getByLabel('Weekly goals').fill('Finir la biochimie des lipides');
    await A.page.locator('.save-status.saved').waitFor({ timeout: 8000 });
    await A.page.screenshot({ path: `${SHOTS}/11-planner.png`, fullPage: true });
    await logout(A.page); await login(A.page, ALICE); await A.page.locator('.dash-hero').waitFor();
    await A.page.goto(`${BASE}/#/planner`);
    await A.page.locator('.task', { hasText: 'Réviser les lipides' }).waitFor();
    expect((await A.page.getByLabel('Weekly goals').inputValue()) === 'Finir la biochimie des lipides', 'weekly goals not restored');
  });
  await step('Task can be completed, reopened, edited, rescheduled and deleted', async () => {
    const task = A.page.locator('.task', { hasText: 'Réviser les lipides' });
    await task.locator('input[type=checkbox]').click();
    await A.page.waitForFunction(() => document.querySelector('.task.done'));
    await task.locator('input[type=checkbox]').click();
    await A.page.waitForFunction(() => !document.querySelector('.task.done'));
    await task.locator('.task-body').click();
    await A.page.getByLabel('Title *').fill('Réviser les lipides (ch. 1-4)');
    await A.page.getByRole('button', { name: 'Save task' }).click();
    await A.page.locator('.task', { hasText: '(ch. 1-4)' }).waitFor();
    // add a temp task and delete it
    await A.page.getByRole('button', { name: 'Add task' }).click();
    await A.page.getByLabel('Title *').fill('Tâche temporaire');
    await A.page.getByRole('button', { name: 'Save task' }).click();
    await A.page.locator('.task', { hasText: 'Tâche temporaire' }).locator('.task-body').click();
    await A.page.getByRole('button', { name: 'Delete' }).click();
    await A.page.getByRole('button', { name: 'Yes, delete' }).click();
    await A.page.locator('.task', { hasText: 'Tâche temporaire' }).waitFor({ state: 'detached' });
  });
  await step('T13 previous weeks remain accessible and a new week never erases data', async () => {
    await A.page.getByRole('button', { name: 'Previous week' }).click();
    await settled(A.page);
    await A.page.getByRole('tab', { name: /Weekly goals/ }).click();
    expect((await A.page.getByLabel('Weekly goals').inputValue()) === '', 'previous week not empty initially');
    await A.page.getByLabel('Weekly goals').fill('Semaine précédente: Embryologie');
    await A.page.locator('.save-status.saved').waitFor({ timeout: 8000 });
    await A.page.getByRole('button', { name: 'Next week' }).click();
    await A.page.getByRole('button', { name: 'Next week' }).click();   // a brand-new future week
    await A.page.locator('.week-grid').waitFor();
    await A.page.getByRole('button', { name: /this week/i }).click();
    await A.page.waitForTimeout(1500);
    const cw = await A.page.getByLabel('Weekly goals').inputValue();
    expect(cw === 'Finir la biochimie des lipides', `current week notes changed: "${cw}" url=${A.page.url()}`);
    await A.page.getByRole('button', { name: 'Previous week' }).click();
    await A.page.waitForFunction(() => document.querySelector('textarea[aria-label="Weekly goals"]') && document.querySelector('textarea[aria-label="Weekly goals"]').value.includes('Embryologie'));
    expect((await sql(`select count(*) from weekly_notes w join profiles p on p.id = w.user_id where p.email = '${ALICE.email}'`)) === '2', 'expected 2 weeks stored');
  });

  // ------------------------------------------------------------------ 16. database failures
  await step('T16 a failed save never shows "Saved", keeps the input, retries, and never erases progress', async () => {
    await A.page.getByRole('button', { name: /this week/i }).click();
    await settled(A.page);
    await api('/__test/fail', { match: 'rpc/save_weekly_notes', count: 1, status: 503 });
    await A.page.getByLabel('Weekly goals').fill('Finir la biochimie des lipides + enzymes');
    await A.page.locator('.save-status.failed').waitFor({ timeout: 8000 });
    expect(!(await A.page.locator('.save-status.saved').isVisible()), '"Saved" shown although the save failed');
    expect((await A.page.getByLabel('Weekly goals').inputValue()).endsWith('+ enzymes'), 'input lost after failure');
    await A.page.screenshot({ path: `${SHOTS}/12-save-failed.png` });
    await A.page.locator('.save-status.failed').click();
    await A.page.locator('.save-status.saved').waitFor({ timeout: 8000 });
    await A.page.reload();
    await A.page.getByLabel('Weekly goals').waitFor();
    expect((await A.page.getByLabel('Weekly goals').inputValue()).endsWith('+ enzymes'), 'retry did not persist');
    // a failing lesson toggle must leave progress untouched
    await api('/__test/fail', { match: 'rpc/set_lesson_stage', count: 1, status: 503 });
    await openLipides(A.page);
    await A.page.locator('.lesson-row').nth(6).locator('.stage', { hasText: 'Learned' }).click();
    await A.page.getByText(/not saved/i).first().waitFor();
    expect((await A.page.locator('.lesson-row').nth(6).locator('.stage', { hasText: 'Learned' }).getAttribute('aria-pressed')) === 'false', 'tile shows done after failed save');
    expect((await pctText(A.page)) === '40%', 'percentage changed after failed save');
    // a failing initial load shows an error with retry, never zeros
    await api('/__test/fail', { match: 'lesson_progress', count: 1, status: 503 });
    await A.page.reload();
    await A.page.getByRole('button', { name: 'Retry' }).waitFor();
    expect(!(await A.page.locator('.overall .pct.big').isVisible()), 'progress displayed although loading failed');
    await A.page.getByRole('button', { name: 'Retry' }).click();
    await A.page.waitForFunction(() => document.querySelector('.overall .pct.big') && document.querySelector('.overall .pct.big').textContent.trim() === '40%');
    expect((await sql(`select count(*) from lesson_progress lp join profiles p on p.id = lp.user_id where p.email = '${ALICE.email}' and learned`)) === '4', 'progress erased');
  });
  await step('Weekly notes: edit from another device is detected (no silent overwrite)', async () => {
    await A2.page.goto(`${BASE}/#/planner`);
    await A2.page.getByLabel('Weekly goals').waitFor();
    await A.page.goto(`${BASE}/#/planner`);
    await A.page.getByLabel('Weekly goals').waitFor();
    await A.page.getByLabel('Weekly goals').fill('Version ordinateur');
    await A.page.locator('.save-status.saved').waitFor({ timeout: 8000 });
    await A2.page.getByLabel('Weekly goals').fill('Version tablette');
    await A2.page.getByText(/changed on another device/i).waitFor({ timeout: 8000 });
    await A2.page.screenshot({ path: `${SHOTS}/13-conflict-tablet.png` });
    await A2.page.getByRole('button', { name: 'Keep my version' }).click();
    await A2.page.locator('.save-status.saved').waitFor({ timeout: 8000 });
    expect((await sql(`select goals from weekly_notes w join profiles p on p.id = w.user_id where p.email = '${ALICE.email}' order by week_start desc limit 1`)) === 'Version tablette', 'kept version not saved');
  });

  // ------------------------------------------------------------------ 14. pomodoro
  await step('Settings: custom Pomodoro durations are saved (focus = 1 min)', async () => {
    await A.page.goto(`${BASE}/#/settings`);
    await A.page.getByLabel('Focus (minutes)').fill('1');
    await A.page.getByRole('button', { name: 'Save' }).nth(1).click();
    await A.page.getByText(/pomodoro settings saved/i).waitFor();
    expect((await sql(`select focus_minutes from pomodoro_settings s join profiles p on p.id = s.user_id where p.email = '${ALICE.email}'`)) === '1', 'not saved');
  });
  await step('T14 Pomodoro: start, refresh, pause, resume, complete — restored correctly, one record only', async () => {
    await A.page.goto(`${BASE}/#/pomodoro`);
    await A.page.locator('.ring-time').waitFor();
    expect((await A.page.locator('.ring-time').textContent()) === '01:00', 'focus duration not 1 min');
    const modSel = A.page.getByLabel('Module');
    await modSel.selectOption(await modSel.locator('option', { hasText: 'Les lipides' }).getAttribute('value'));
    await A.page.waitForTimeout(500);
    await A.page.getByRole('button', { name: 'Start' }).click();
    await A.page.getByRole('button', { name: 'Pause' }).waitFor();
    await A.page.waitForTimeout(3000);
    await A.page.reload();
    await A.page.getByRole('button', { name: 'Pause' }).waitFor();
    const t1 = await A.page.locator('.ring-time').textContent();
    expect(t1 <= '00:57' && t1 >= '00:50', `after refresh shows ${t1}`);
    await A.page.getByRole('button', { name: 'Pause' }).click();
    await A.page.getByRole('button', { name: 'Resume' }).waitFor();
    const paused = await A.page.locator('.ring-time').textContent();
    await A.page.waitForTimeout(4000);
    await A.page.reload();
    await A.page.getByRole('button', { name: 'Resume' }).waitFor();
    const paused2 = await A.page.locator('.ring-time').textContent();
    expect(Math.abs(toSec(paused2) - toSec(paused)) <= 1, `paused time moved: ${paused} -> ${paused2}`);
    await A.page.screenshot({ path: `${SHOTS}/14-pomodoro-paused.png`, fullPage: true });
    // the running timer is visible from other pages and on the other device
    await A2.page.goto(`${BASE}/#/pomodoro`); await A2.page.getByRole('button', { name: 'Resume' }).waitFor();
    await A.page.getByRole('button', { name: 'Resume' }).click();
    await A.page.getByRole('button', { name: 'Pause' }).waitFor();
    await A.page.getByText(/focus session complete/i).waitFor({ timeout: 75000 });
    await A.page.locator('.ring-label', { hasText: 'Short break' }).waitFor();
    await A.page.reload(); await A.page.locator('.ring-time').waitFor();
    await A2.page.reload(); await A2.page.locator('.ring-time').waitFor();
    const n = await sql(`select count(*) || ':' || min(active_seconds) || ':' || bool_and(module_id is not null) from study_sessions s join profiles p on p.id = s.user_id where p.email = '${ALICE.email}'`);
    expect(n === '1:60:true', `sessions in db: ${n}`);
  });
  await step('Pomodoro: session that ends while the browser is closed is recorded once with the right time', async () => {
    await A.page.getByRole('button', { name: 'Skip' }).click();                   // skip the break
    await A.page.locator('.ring-label', { hasText: 'Focus' }).waitFor();
    await A.page.getByRole('button', { name: 'Start' }).click();
    await A.page.getByRole('button', { name: 'Pause' }).waitFor();
    await A.page.goto('about:blank');                                              // "close" the app
    await sql(`update timer_state set running_since = running_since - interval '3 hours', started_at = started_at - interval '3 hours' where user_id = (select id from profiles where email = '${ALICE.email}')`);
    await A.page.goto(`${BASE}/#/pomodoro`);
    await A.page.locator('.ring-label', { hasText: 'Short break' }).waitFor();
    await A.page.reload(); await A.page.locator('.ring-time').waitFor();
    const n = await sql(`select count(*) || ':' || sum(active_seconds) from study_sessions s join profiles p on p.id = s.user_id where p.email = '${ALICE.email}'`);
    const span = await sql(`select extract(epoch from ended_at - started_at)::int from study_sessions s join profiles p on p.id = s.user_id where p.email = '${ALICE.email}' order by s.created_at desc limit 1`);
    expect(n === '2:120' && span === '60', `sessions in db: ${n}, last span ${span}s`);
    const todayN = await todayCompleted(ALICE.email);
    expect((await A.page.locator('.pomo-side .kv strong').first().textContent()).trim() === String(todayN), `today counter not ${todayN}`);
  });

  // ------------------------------------------------------------------ 15. stats reflect saved data
  await step('T15 Study Tracker and Progress dashboard reflect the saved data exactly', async () => {
    await A.page.goto(`${BASE}/#/tracker`);
    await A.page.locator('.stat', { hasText: 'Completed focus sessions' }).waitFor();
    const fs = (await A.page.locator('.stat', { hasText: 'Completed focus sessions' }).locator('.stat-value').textContent()).trim();
    const time = (await A.page.locator('.stat', { hasText: 'Completed study time' }).locator('.stat-value').textContent()).trim();
    const planned = (await A.page.locator('.stat', { hasText: 'Planned study time' }).locator('.stat-value').textContent()).trim();
    expect(fs === '2' && time === '2 min' && planned === '1 h 30 min', `tracker: ${fs} / ${time} / ${planned}`);
    await A.page.screenshot({ path: `${SHOTS}/15-tracker.png`, fullPage: true });
    await A.page.goto(`${BASE}/#/progress`);
    await A.page.locator('.stat', { hasText: 'Overall lesson completion' }).waitFor();
    const overall = (await A.page.locator('.stat', { hasText: 'Overall lesson completion' }).locator('.stat-sub').textContent()).trim();
    const total = await sql(`select count(*) from lessons l join modules m on m.id = l.module_id where l.active and m.year = 1`);
    expect(overall === `4 / ${total} lessons (S1 + S2)`, `progress: ${overall}`);
    await A.page.getByRole('tab', { name: 'Weekly' }).click();
    await A.page.screenshot({ path: `${SHOTS}/16-progress.png`, fullPage: true });
    await A.page.goto(`${BASE}/#/`);
    await A.page.locator('.stat', { hasText: 'Focus sessions today' }).waitFor();
    const today = (await A.page.locator('.stat', { hasText: 'Focus sessions today' }).locator('.stat-value').textContent()).trim();
    const todayN = await todayCompleted(ALICE.email);
    expect(today === String(todayN), `dashboard today sessions ${today}, expected ${todayN}`);
    await A.page.screenshot({ path: `${SHOTS}/17-dashboard.png`, fullPage: true });
  });

  // ------------------------------------------------------------------ notes
  await step('Global notes: create, autosave, search, sort, persist, delete (separate from weekly notes)', async () => {
    await A.page.goto(`${BASE}/#/notes`);
    await A.page.getByRole('button', { name: 'New note' }).click();
    await A.page.getByLabel('Note title').fill('Cycle de Krebs');
    await A.page.getByLabel('Note content').fill('Acétyl-CoA + oxaloacétate → citrate');
    await A.page.locator('.save-status.saved').waitFor({ timeout: 8000 });
    await A.page.goto(`${BASE}/#/notes`);
    await A.page.getByRole('button', { name: 'New note' }).click();
    await A.page.getByLabel('Note title').fill('Anatomie — plexus');
    await A.page.locator('.save-status.saved').waitFor({ timeout: 8000 });
    await A.page.reload();
    await A.page.locator('.note-item', { hasText: 'Cycle de Krebs' }).waitFor();
    await A.page.getByLabel('Search notes').fill('citrate');
    await A.page.waitForFunction(() => document.querySelectorAll('.note-item').length === 1);
    await A.page.getByLabel('Search notes').fill('');
    await A.page.getByLabel('Sort notes').selectOption('title');
    const first = await A.page.locator('.note-item strong').first().textContent();
    expect(first === 'Anatomie — plexus', `sorted first: ${first}`);
    await A.page.screenshot({ path: `${SHOTS}/18-notes.png`, fullPage: true });
    await A.page.locator('.note-item', { hasText: 'Anatomie' }).click();
    await A.page.getByRole('button', { name: 'Delete note' }).click();
    await A.page.getByRole('button', { name: 'Delete', exact: true }).click();
    await A.page.locator('.note-item', { hasText: 'Anatomie' }).waitFor({ state: 'detached' });
    expect((await sql(`select count(*) from notes n join profiles p on p.id = n.user_id where p.email = '${ALICE.email}'`)) === '1', 'notes count');
  });

  // ------------------------------------------------------------------ admin curriculum management
  await step('Admin adds a lesson without code changes; student percentage recomputes (4/11 = 36.4%)', async () => {
    await ADM.page.goto(`${BASE}/#/admin/curriculum`);
    await ADM.page.getByRole('tab', { name: /Semester 2/ }).click();
    const bio = ADM.page.locator('.adm-node', { hasText: 'Biochimie' }).first();
    await bio.locator('> .adm-row').getByRole('button', { name: 'Expand' }).click();
    const lip = ADM.page.locator('.adm-node.depth-1', { hasText: 'Les lipides' });
    await lip.locator('> .adm-row').getByRole('button', { name: 'Expand' }).click();
    await lip.getByRole('button', { name: 'Add lesson' }).click();
    await ADM.page.getByLabel('Title *').fill('Leçon test ajoutée');
    await ADM.page.getByRole('button', { name: 'Save', exact: true }).click();
    await lip.getByText('Leçon test ajoutée').waitFor();
    await ADM.page.screenshot({ path: `${SHOTS}/19-admin-curriculum.png`, fullPage: true });
    await A.page.reload(); await settled(A.page);
    await openLipides(A.page);
    expect((await lessonTitles(A.page)).length === 11, 'student does not see 11 lessons');
    expect((await pctText(A.page)) === '36.4%', `got ${await pctText(A.page)}`);
    // admin deactivates it again -> back to 40%
    await lip.locator('li', { hasText: 'Leçon test ajoutée' }).getByRole('button', { name: 'Edit lesson' }).click();
    await ADM.page.getByLabel(/Active \(counted in progress\)/).uncheck();
    await ADM.page.getByRole('button', { name: 'Save', exact: true }).click();
    await ADM.page.waitForTimeout(500);
    await A.page.reload(); await A.page.locator('.overall .pct.big').waitFor();
    expect((await pctText(A.page)) === '40%', `after deactivation ${await pctText(A.page)}`);
  });

  // ------------------------------------------------------------------ suspension, reactivation, expiry
  await step('Suspension revokes access immediately; reactivation restores the intact data', async () => {
    await ADM.page.goto(`${BASE}/#/admin`); await ADM.page.reload();
    await ADM.page.locator('tr', { hasText: ALICE.email }).getByRole('button', { name: 'Suspend' }).click();
    await ADM.page.getByRole('button', { name: 'Confirm' }).click();
    await ADM.page.locator('tr', { hasText: ALICE.email }).locator('.badge.suspended').waitFor();
    const apiRows = await A.page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('resumed.session.v1'));
      const { supabaseUrl: u, supabaseAnonKey: k } = window.__RESUMED_CONFIG__;
      return (await (await fetch(`${u}/rest/v1/lesson_progress`, { headers: { apikey: k, Authorization: `Bearer ${s.access_token}` } })).json()).length;
    });
    expect(apiRows === 0, `suspended user still gets ${apiRows} rows`);
    await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await A.page.getByRole('heading', { name: /account suspended/i }).waitFor({ timeout: 8000 });
    await A.page.screenshot({ path: `${SHOTS}/20-suspended.png` });
    await ADM.page.locator('tr', { hasText: ALICE.email }).getByRole('button', { name: 'Reactivate' }).click();
    await ADM.page.locator('tr', { hasText: ALICE.email }).locator('.badge.approved').waitFor();
    // sessions were revoked by the suspension: Alice signs in again and finds everything
    await A.page.reload();
    if (await A.page.locator('input[type=email]').isVisible().catch(() => false)) await login(A.page, ALICE);
    await A.page.goto(`${BASE}/#/modules`);
    if (await A.page.locator('input[type=email]').isVisible().catch(() => false)) { await login(A.page, ALICE); await A.page.goto(`${BASE}/#/modules`); }
    await openLipides(A.page);
    expect((await pctText(A.page)) === '40%', 'progress not intact after reactivation');
  });
  await step('Expired access tokens are refreshed silently; revoked sessions are sent back to sign-in', async () => {
    await api('/__test/ttl', { ttl: 3 });
    const X = await newUser(browser, undefined, 'carol-expiry');
    await login(X.page, CAROL); await X.page.locator('.dash-hero').waitFor();
    await X.page.waitForTimeout(4500);
    await X.page.goto(`${BASE}/#/modules`); await X.page.locator('.module-row').first().waitFor();   // works after expiry -> refreshed
    await api('/__test/ttl', { ttl: 3600 });
    await sql(`delete from auth.sessions where user_id = (select id from profiles where email = '${CAROL.email}')`);
    await X.page.waitForTimeout(3500);
    await X.page.goto(`${BASE}/#/planner`);
    await X.page.getByText(/session has expired/i).waitFor({ timeout: 10000 });
    await X.ctx.close();
  });
  await step('Password recovery by e-mail link sets a new password', async () => {
    const X = await newUser(browser, undefined, 'recovery');
    await X.page.goto(`${BASE}/#/forgot`);
    await X.page.locator('input[type=email]').fill(CAROL.email);
    await X.page.getByRole('button', { name: /send reset link/i }).click();
    await X.page.getByText(/reset link is on its way/i).waitFor();
    const mail = (await api(`/__test/mailbox?email=${encodeURIComponent(CAROL.email)}`)).pop();
    await X.page.goto(mail.link);
    await X.page.getByRole('heading', { name: /choose a new password/i }).waitFor();
    const pw = X.page.locator('input[type=password]');
    await pw.nth(0).fill('Carol#New2026'); await pw.nth(1).fill('Carol#New2026');
    await X.page.getByRole('button', { name: /save new password/i }).click();
    await X.page.locator('.dash-hero').waitFor();
    await logout(X.page);
    await login(X.page, { email: CAROL.email, password: 'Carol#New2026' });
    await X.page.locator('.dash-hero').waitFor();
    await X.ctx.close();
  });

  // ------------------------------------------------------------------ 17. routes, buttons, responsive
  await step('T17 every route renders without errors and without horizontal scrolling (phone, tablet, desktop)', async () => {
    const routes = ['/', '/modules', `/modules/${await sql(`select id from modules where title = 'Les lipides'`)}`, `/modules/${await sql(`select id from modules where title = 'Anatomie' and semester = 'S1'`)}`,
      '/planner', '/pomodoro', '/tracker', '/notes', '/progress', '/settings', '/year', '/year/1'];
    const sizes = [['phone', { width: 375, height: 812 }], ['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1440, height: 900 }]];
    for (const [label, vp] of sizes) {
      const X = await newUser(browser, vp, `routes-${label}`);
      await login(X.page, ALICE); await X.page.locator('.dash-hero').waitFor();
      for (const r of routes) {
        await X.page.goto(`${BASE}/#${r}`);
        await X.page.waitForFunction(() => !document.querySelector('.loader'), null, { timeout: 10000 });
        await X.page.waitForTimeout(150);
        expect(await noHorizontalScroll(X.page), `horizontal scroll on ${label} ${r}`);
        if (label !== 'desktop' || ['/', '/pomodoro', '/progress'].includes(r)) {
          const name = r === '/' ? 'home' : r.replace(/\//g, '_').replace(/[0-9a-f-]{36}/, 'module');
          await X.page.screenshot({ path: `${SHOTS}/r-${label}${name}.png`, fullPage: true });
        }
      }
      // admin routes for the admin, at this size
      await X.ctx.close();
    }
    for (const r of ['/admin', '/admin/curriculum']) {
      await ADM.page.setViewportSize({ width: 375, height: 812 });
      await ADM.page.goto(`${BASE}/#${r}`); await ADM.page.waitForFunction(() => !document.querySelector('.loader'));
      expect(await noHorizontalScroll(ADM.page), `horizontal scroll on admin ${r}`);
      await ADM.page.screenshot({ path: `${SHOTS}/r-phone${r.replace(/\//g, '_')}.png`, fullPage: true });
    }
    // a student cannot open the admin page
    await A.page.goto(`${BASE}/#/admin`); await A.page.getByText(/administrator only/i).waitFor();
  });
  await step('Mobile navigation: menu drawer and bottom bar work', async () => {
    const X = await newUser(browser, { width: 390, height: 844 }, 'nav');
    await login(X.page, ALICE); await X.page.locator('.dash-hero').waitFor();
    await X.page.locator('.bottom-nav').getByRole('button', { name: 'Planner' }).click();
    await X.page.locator('.week-grid').waitFor();
    await X.page.getByRole('button', { name: 'Menu', exact: true }).click();
    await X.page.locator('.sidebar.open').getByRole('button', { name: 'Study Tracker' }).click();
    await X.page.getByRole('heading', { name: 'Study Tracker' }).waitFor();
    await X.ctx.close();
  });

  await step('Year 2: units and modules from the course folder; progress is separate from Year 1', async () => {
    const X = await newUser(browser, undefined, 'year2');
    await login(X.page, ALICE); await X.page.locator('.dash-hero').waitFor();
    await openLipides(X.page);
    const y1pct = await pctText(X.page);
    await X.page.goto(`${BASE}/#/year`);
    await X.page.locator('.year-card', { hasText: 'Year 2' }).getByRole('button', { name: 'Enter' }).click();
    await X.page.locator('.sem-card', { hasText: 'Unités' }).getByRole('button', { name: /view plan/i }).click();
    await X.page.locator('.dash-hero', { hasText: '2ème année de médecine' }).waitFor();
    expect((await sql(`select selected_year || selected_semester from profiles where email = '${ALICE.email}'`)) === '2U', 'year 2 not saved');
    await X.page.goto(`${BASE}/#/modules`); await settled(X.page);
    const units = await X.page.locator('.module-row .module-title').allTextContents();
    expect(units.length === 5 && units[0].startsWith('Unité 01') && units[4].includes('nerveux'), `units: ${units.join(' / ')}`);
    await X.page.locator('.module-row', { hasText: 'Unité 03' }).click();
    await X.page.locator('.module-row', { hasText: 'Physiologie' }).click(); await settled(X.page);
    const t = await lessonTitles(X.page);
    expect(t.length === 6 && t[0].includes('Circulation rénale') && t[5].includes('dilution des urines'), `lessons: ${t.join(' / ')}`);
    await toggleStage(X.page, 0);
    expect((await pctText(X.page)) === '16.7%', `expected 16.7%, got ${await pctText(X.page)}`);
    await X.page.goto(`${BASE}/#/modules`); await settled(X.page);
    await X.page.getByRole('tab', { name: 'Modules' }).click(); await settled(X.page);
    const mods = await X.page.locator('.module-row .module-title').allTextContents();
    expect(mods.join('|') === 'Génétique|Immunologie', `modules: ${mods.join(' / ')}`);
    await X.page.screenshot({ path: `${SHOTS}/40-year2-modules.png`, fullPage: true });
    // back to Year 1: its progress is untouched
    await X.page.goto(`${BASE}/#/year/1`);
    await X.page.getByRole('button', { name: /view plan/i }).nth(1).click();
    await X.page.locator('.dash-hero', { hasText: '1ère année de médecine' }).waitFor();
    await openLipides(X.page);
    expect((await pctText(X.page)) === y1pct, `Year 1 progress changed: ${y1pct} -> ${await pctText(X.page)}`);
    await X.ctx.close();
  });

  await step('No unexpected JavaScript errors in the browser console', async () => {
    expect(consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  });

  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  writeFileSync('tests/e2e/results.json', JSON.stringify({ results, consoleErrors }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });

function toSec(t) { const [m, s] = t.split(':').map(Number); return m * 60 + s; }
