// a bore across a SOLID cylinder, asked of the engine directly in the page (the layer refuses it: G-CURVED): how long, and is it right?
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json'); const { chromium } = require('playwright-core');
const ROOT = process.argv[2];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${srv.address().port}/host.html`);
await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
page.setDefaultTimeout(600000);
const out = await page.evaluate(async () => {
  const B = window.__host.bridge; const res = [];
  const cyl = (R, h) => ({ command: 'solid.cylinder', params: { radius: R, height: h, base: [0, 0, -h / 2], axis: 'Z', body_name: 'b_c1' } });
  const bore = (r, ax, at = [0, 0, 0]) => ({ command: 'solid.cylinder', params: { radius: r, height: 60, base: ax === 'X' ? [-30, at[1], at[2]] : ax === 'Y' ? [at[0], -30, at[2]] : [at[0], at[1], -30], axis: ax, operation: 'cut', targets: ['b_c1'] } });
  for (const [what, cmds] of [
    ['solid cylinder R 10 x 30, cross bore r 3 along X through the axis', [cyl(10, 30), bore(3, 'X')]],
    ['the same, r 1', [cyl(10, 30), bore(1, 'X')]],
    ['the same, r 3, off the axis by 4', [cyl(10, 30), bore(3, 'X', [0, 4, 0])]],
    ['solid cylinder, bore r 3 along its own axis, off centre by 4 (control)', [cyl(10, 30), bore(3, 'Z', [4, 0, 0])]],
  ]) { const t0 = performance.now(); const r = await B.execute(cmds, { fresh: true }); res.push({ what, ms: Math.round(performance.now() - t0), ok: r.ok, failed: r.failed ? String(r.failed.error).slice(0, 120) : null, volume: r.measure?.bodies?.[0]?.volume_mm3 ?? null, faces: r.measure?.bodies?.[0]?.faces ?? null }); }
  return res;
});
// the volume a bore of radius r along x at height offset d (in y) takes out of a cylinder of radius R along z: over the bore's cross-section (y, z), the chord of the big circle at y
const cut = (R, r, d) => { const n = 4000; let s = 0; const h = 2 * r / n; for (let i = 0; i < n; i++) { const y = d - r + (i + 0.5) * h; const half = Math.sqrt(Math.max(0, r * r - (y - d) ** 2)); if (Math.abs(y) < R) s += 2 * half * 2 * Math.sqrt(R * R - y * y) * h; } return s; };
const V = Math.PI * 100 * 30; const want = [V - cut(10, 3, 0), V - cut(10, 1, 0), V - cut(10, 3, 4), V - Math.PI * 9 * 30];
out.forEach((r, i) => console.log(`${r.what}: ${r.ms} ms, ok ${r.ok}${r.failed ? ' (' + r.failed + ')' : ''}, volume ${r.volume}, by hand ${want[i].toFixed(4)}${r.volume ? ', rel ' + ((r.volume - want[i]) / want[i]).toExponential(2) : ''}, faces ${r.faces}`));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]); process.exit(0);
