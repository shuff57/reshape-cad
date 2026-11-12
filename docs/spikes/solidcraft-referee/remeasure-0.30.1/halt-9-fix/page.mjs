// page.mjs <site folder> <out.json>: the HALT-9 scripts in the real page (headless Chrome), one fresh page each
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const [ROOT, OUT] = process.argv.slice(2);
const CASES = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).filter((c) => ['alone-from-bottom', 'alone-neutral-0', 'after-stale-draft', 'after-stale-draft-top', 'after-kept-draft'].includes(c.id));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const out = [];
for (const t of CASES) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 }); page.setDefaultTimeout(300000);
  const r = await page.evaluate(async (s) => { window.__host.setScript(s); const sum = await window.__host.run({ confirmed: true }); return { status: document.getElementById('status').innerText, volume: sum.volume, bodies: (sum.bodies ?? []).map((b) => b.volume), features: sum.features.map((f) => [f.id, f.kind, f.status, f.refusal]) }; }, t.script);
  out.push({ id: t.id, script: t.script, ...r }); console.log(t.id, r.status, r.volume, JSON.stringify(r.features.filter((f) => f[1] === 'draft').map((f) => [f[0], f[2], (f[3] ?? '').slice(0, 60)])));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); await page.close();
}
await browser.close(); srv.close();
