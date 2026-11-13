// run.mjs <site folder> <out dir> [tasks module]: every task in the host page, one fresh page each; records the steps (result, sentence, note), the sketch check,
// the part card, the warnings, the scene volume and bodies, the wall time and a screenshot.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const [ROOT, OUT, MOD] = process.argv.slice(2);
const { TASKS } = await import(pathToFileURL(path.resolve(MOD ?? new URL('./tasks.mjs', import.meta.url).pathname)).href);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'pilot.json'); const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
for (const t of TASKS) { if (out.some((o) => o.id === t.id)) continue;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const r = await page.evaluate(async (s) => {
    const t0 = performance.now(); let threw = null; let sum = null;
    window.__host.setScript(s); try { sum = await window.__host.run({ confirmed: true }); } catch (e) { threw = String(e && e.message || e); }
    const txt = (id) => { const el = document.getElementById(id); return el ? el.innerText : null; };
    return { wallMs: Math.round(performance.now() - t0), threw, status: txt('status'), error: sum?.error ?? null,
      steps: (sum?.features ?? []).map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, note: f.note })),
      sketchCheck: (sum?.sketchCheck ?? []).map((c) => `${c.id}: ${c.result} -- ${c.text}`), card: txt('result'), warnings: txt('warnings'),
      volume: sum?.volume ?? null, bodies: (sum?.bodies ?? []).map((b) => ({ name: b.name, volume: b.volume, faces: b.faces, bbox: b.bbox })) };
  }, t.script);
  await page.waitForTimeout(1200); await page.screenshot({ path: path.join(OUT, t.id + '.png') });
  out.push({ id: t.id, title: t.title, script: t.script, expect: t.expect ?? null, ...r }); console.log(t.id, r.wallMs, r.status, r.volume);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  await page.close();
}
await browser.close(); srv.close();
