// node drive.mjs <site> <cases.json> <out.json>
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [ROOT, CASES, OUT] = process.argv.slice(2);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(`http://127.0.0.1:${srv.address().port}/host.html?storage=off`);
await page.waitForFunction(() => { const f = document.getElementById('sc'); return f && f.contentWindow && f.contentWindow.solidcraft; }, null, { timeout: 120000 });
const rows = [];
for (const c of JSON.parse(fs.readFileSync(CASES, 'utf8'))) {
  const t0 = Date.now();
  const r = await Promise.race([
    page.evaluate(async (code) => { window.__lastRun = null; window.__host.setScript(code); const s = await window.__host.run({ confirmed: true }); const lr = window.__lastRun; return { doc: lr?.doc ?? null, features: lr?.tr?.features?.map((f) => ({ id: f.id, status: f.status, refusal: f.refusal ?? null, guard: typeof f.guard === 'string' ? f.guard : null })) ?? null, bodies: (lr?.fin?.measure?.bodies ?? []).map((b) => ({ volume: b.volume_mm3 ?? b.volume, faces: b.faces })) }; }, c.code),
    new Promise((res) => setTimeout(() => res({ timeout: true }), 150000)),
  ]).catch((e) => ({ error: String(e).slice(0, 300) }));
  const row = { id: c.id, expected: c.expected ?? null, seconds: (Date.now() - t0) / 1000, ...r };
  if (c.expected && r.bodies?.length) row.relErr = Math.abs(r.bodies.reduce((s, b) => s + b.volume, 0) - c.expected) / c.expected;
  rows.push(row); fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  if (r.timeout) break;
}
await browser.close(); srv.close();
for (const r of rows) console.log(r.id, '|', r.seconds + 's', '|', r.timeout ? 'TIMEOUT' : r.error ? 'ERROR ' + r.error : (r.features ?? []).map((f) => f.id + ':' + f.status + (f.refusal ? ' (' + f.refusal.slice(0, 110) + ')' : '')).join(' ; '), '|', r.bodies ? 'vol ' + r.bodies.map((b) => b.volume?.toFixed(3)).join('+') : '', r.relErr !== undefined ? 'relErr ' + r.relErr.toExponential(2) : '');
