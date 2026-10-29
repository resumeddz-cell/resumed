// Build: bundles src/ with esbuild into dist/, copies public/ assets.
//   node build.mjs            -> production build in dist/
//   node build.mjs --watch    -> rebuild on change (serve dist/ with any static server)
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const watch = process.argv.includes('--watch');
const demo = process.argv.includes('--demo');          // self-contained demo: in-browser backend, no Supabase
const out = demo ? 'dist-demo' : 'dist';
const stamp = Date.now().toString(36);

function listFiles(dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? listFiles(p) : [p]; });
}

function copyStatic() {
  mkdirSync(out, { recursive: true });
  cpSync('public', out, { recursive: true });
  if (demo) writeFileSync(join(out, 'config.js'), "window.__RESUMED_CONFIG__ = { supabaseUrl: 'https://demo.local', supabaseAnonKey: 'demo' };\n");
  else if (!existsSync(join(out, 'config.js'))) cpSync('public/config.example.js', join(out, 'config.js'));
  // list of assets extracted from the PDF, used by the admin icon picker
  const assets = listFiles('public/assets').filter((f) => /\.(webp|png)$/.test(f)).map((f) => relative('public/assets', f).split('\\').join('/')).sort();
  writeFileSync(join(out, 'assets/manifest.json'), JSON.stringify(assets));
  writeFileSync(join(out, 'index.html'), readFileSync('index.html', 'utf8').replaceAll('__BUILD__', stamp));
  cpSync('src/styles.css', join(out, 'styles.css'));
  // page used to publish the demo as a claude.ai artifact (the host adds <html>/<head>/<body> itself)
  if (demo) writeFileSync(join(out, 'resumed-demo.html'), [
    '<title>Resumed Study Tracker</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&family=Nunito:wght@400;600;700;800&family=Patrick+Hand&display=swap" rel="stylesheet">',
    `<link rel="stylesheet" href="styles.css?v=${stamp}">`,
    '<div id="root"></div>',
    '<script src="config.js"></script>',
    `<script src="app.js?v=${stamp}"></script>`, ''].join('\n'));
}

const options = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  outfile: join(out, 'app.js'),
  format: 'iife',
  target: ['es2020', 'safari15', 'ios15', 'chrome87', 'firefox78', 'edge88'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"', __DEMO__: demo ? 'true' : 'false' },
  plugins: demo ? [{ name: 'demo-backend', setup(b) {
    b.onResolve({ filter: /\/supabase\.js$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/supabase\.js$/, 'supabase-demo.js')) }));
  } }] : [],
  legalComments: 'none',
  logLevel: 'info',
};

if (!watch) rmSync(out, { recursive: true, force: true });
copyStatic();
if (watch) {
  const ctx = await esbuild.context({ ...options, plugins: [...options.plugins, { name: 'static', setup(b) { b.onEnd(copyStatic); } }] });
  await ctx.watch();
} else {
  await esbuild.build(options);
}
