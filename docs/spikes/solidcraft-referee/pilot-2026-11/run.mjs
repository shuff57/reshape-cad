// run.mjs <site folder> <out dir>: every pilot task in the host page at the normal budget, one fresh page each; records the feature table, the scene volume,
// the wall time, the status line and a screenshot.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { TASKS } from './tasks.mjs';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const [ROOT, OUT] = process.argv.slice(2);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const out = fs.existsSync(path.join(OUT, "pilot.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "pilot.json"), "utf8")) : [];
for (const t of TASKS) { if (out.some((o) => o.id === t.id)) continue;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const r = await page.evaluate(async (s) => {
    const t0 = performance.now(); let threw = null;
    window.__host.setScript(s); try { await window.__host.run({ confirmed: true }); } catch (e) { threw = String(e && e.message || e); }
    const wallMs = Math.round(performance.now() - t0);
    const insp = await window.__host.bridge.inspect();
    const bodies = (insp.measure && insp.measure.bodies) ?? [];
    const txt = (id) => { const el = document.getElementById(id); return el ? el.innerText : null; };
    return { wallMs, threw, features: txt('features'), status: txt('status'), diag: txt('diag') ?? txt('report') ?? null, ids: [...document.querySelectorAll('[id]')].map((e) => e.id).slice(0, 60), volume: bodies.reduce((a, b) => a + (b.volume_mm3 ?? 0), 0), bodies: bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces })) };
  }, t.script);
  await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, t.id + '.png') });
  out.push({ id: t.id, title: t.title, script: t.script, expect: t.expect, ...r }); console.log(t.id, r.wallMs, r.volume, (r.features || '').split('\n').length);
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'pilot.json'), JSON.stringify(out, null, 1));
await browser.close(); srv.close();
