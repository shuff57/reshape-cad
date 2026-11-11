// browser-cases.mjs <site folder> <cases.json> <out.json>: each {id, script} in the host page at the NORMAL budget (no cap, probe on), one fresh page each, in one headless
// Chrome (set up as packages/solidcraft-host/test/live-hollow-budget.mjs). Records the wall time of the run, what the feature table shows, every probe, and the scene volume.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const [ROOT, CASES, OUT] = process.argv.slice(2);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const out = [];
for (const c of JSON.parse(fs.readFileSync(CASES, 'utf8'))) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
  page.setDefaultTimeout(1800000);
  const r = await page.evaluate(async (s) => {
    const t0 = performance.now(); const n0 = window.__host.probeLog.length;
    window.__host.setScript(s); await window.__host.run({ confirmed: true });
    const wallMs = Math.round(performance.now() - t0);
    const insp = await window.__host.bridge.inspect();
    return { wallMs, features: document.getElementById('features').innerText, probes: window.__host.probeLog.slice(n0), volume: (insp.bodies ?? []).reduce((a, b) => a + (b.volume_mm3 ?? 0), 0) };
  }, c.script);
  out.push({ id: c.id, ...r }); console.log(c.id, r.wallMs, JSON.stringify(r).slice(0, 400));
  await page.close();
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close(); srv.close();
