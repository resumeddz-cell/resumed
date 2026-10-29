// Smoke test of the self-contained demo build (dist-demo/).
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const ROOT = join(process.cwd(), 'dist-demo');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
const srv = http.createServer(async (q, r) => { try { const p = join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); r.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); r.end(await readFile(p)); } catch { r.writeHead(404); r.end(); } }).listen(54500);
const B = 'http://localhost:54500';
const errs = []; let ok = 0;
const check = (c, m) => { if (!c) throw new Error(m); ok++; console.log('PASS', m); };
const b = await chromium.launch();
try {
  for (const vp of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_/.test(m.text())) errs.push(m.text()); });
    await p.goto(B);
    await p.getByRole('button', { name: 'Student account' }).click();
    await p.getByRole('button', { name: 'Enter' }).click();
    await p.getByRole('button', { name: /view plan/i }).nth(1).click();
    await p.locator('.dash-hero').waitFor();
    await p.goto(`${B}/#/modules`);
    await p.getByRole('tab', { name: /Semester 2/, selected: true }).waitFor();
    await p.locator('.module-row', { hasText: 'Biochimie' }).click();
    await p.locator('.module-row', { hasText: 'Les lipides' }).click();
    for (let i = 0; i < 4; i++) {
      await p.locator('.lesson-row').nth(i).locator('.stage', { hasText: 'Learned' }).click();
      await p.waitForFunction((n) => document.querySelectorAll('.lesson-row .stage-learned.on').length === n, i + 1);
    }
    check((await p.locator('.overall .pct.big').textContent()).trim() === '40%', `4/10 lessons = 40% (${vp.width}px)`);
    await p.reload(); await p.locator('.overall .pct.big').waitFor();
    check((await p.locator('.overall .pct.big').textContent()).trim() === '40%', `still 40% after reload (${vp.width}px)`);
    await p.goto(`${B}/#/pomodoro`); await p.getByRole('button', { name: 'Start' }).click(); await p.getByRole('button', { name: 'Pause' }).waitFor();
    await p.getByRole('button', { name: 'Pause' }).click(); await p.getByRole('button', { name: 'Resume' }).waitFor();
    check(true, `pomodoro start/pause (${vp.width}px)`);
    await p.goto(`${B}/#/planner`); await p.getByRole('button', { name: 'Add task' }).click();
    await p.getByLabel('Title *').fill('Réviser les lipides'); await p.getByRole('button', { name: 'Save task' }).click();
    await p.locator('.task', { hasText: 'Réviser les lipides' }).waitFor();
    await p.getByLabel('Weekly goals').fill('Finir la biochimie'); await p.locator('.save-status.saved').waitFor();
    check(true, `planner task + weekly notes saved (${vp.width}px)`);
    await p.goto(`${B}/#/notes`); await p.getByRole('button', { name: 'New note' }).click();
    await p.getByLabel('Note title').fill('Cycle de Krebs'); await p.locator('.save-status.saved').waitFor();
    check(true, `note saved (${vp.width}px)`);
    for (const r of ['/', '/progress', '/tracker', '/settings']) { await p.goto(`${B}/#${r}`); await p.waitForTimeout(400);
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal scroll ${r} (${vp.width}px)`); }
    await p.goto(`${B}/#/settings`); await p.getByRole('button', { name: /^log out$/i }).last().click();
    await p.getByRole('button', { name: 'Administrator account' }).click();
    await p.locator('.welcome-hero, .dash-hero').first().waitFor();
    await p.goto(`${B}/#/admin`);
    await p.locator('tr', { hasText: 'nouvelle.inscription' }).getByRole('button', { name: 'Approve' }).click();
    await p.locator('tr', { hasText: 'nouvelle.inscription' }).locator('.badge.approved').waitFor();
    check(true, `admin approves the pending demo registration (${vp.width}px)`);
    await p.screenshot({ path: `/tmp/claude-0/demo-admin-${vp.width}.png`, fullPage: true });
    await ctx.close();
  }
  check(errs.length === 0, `no console errors ${errs.slice(0, 3).join(' | ')}`);
  console.log(`\n${ok} demo checks passed`);
} catch (e) { console.log('FAIL', e.message.split('\n').slice(0,4).join(' / ')); for (const c of b.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: '/tmp/claude-0/demo-fail.png' }).catch(() => {}); process.exitCode = 1; }
await b.close(); srv.close();
