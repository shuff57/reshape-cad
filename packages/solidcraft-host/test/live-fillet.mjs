// Live check of fillet / chamfer scripts through the pane against the real SolidCraft web build (setup as test/live-examples.mjs).
//   node test/live-fillet.mjs <site folder> <out.json>
// Each case has either a closed-form volume (built and right, or WRONG) or an expected refusal (REFUSED; anything built is WRONG).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const ROOT = process.argv[2];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
}).listen(0);
await new Promise((r) => srv.on('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/host.html`;
const rd = (r, L) => (1 - Math.PI / 4) * r * r * L; // material a fillet of radius r takes off an edge of length L
const cb = (c, L) => 0.5 * c * c * L;
// Pappus: the corner a rim fillet f takes off a cylinder of radius R (square f x f minus the quarter disc) turned about the axis
const rimFillet = (R, H, f) => { const A = f * f * (1 - Math.PI / 4); const xc = (f * f * (R - f / 2) - (Math.PI * f * f / 4) * (R - f + 4 * f / (3 * Math.PI))) / A; return Math.PI * R * R * H - 2 * Math.PI * xc * A; };
const V = 40 * 40 * 20;
const BOX = 'const b = cuboid(40, 40, 20)\n';
const cases = [
  { id: 'fillet-plain-edge', script: BOX + "round(b.edge('top', 'front'), 3)", vol: V - rd(3, 40), tol: 1e-3 },
  { id: 'fillet-big-valid', script: BOX + "round(b.edge('top', 'front'), 10)", vol: V - rd(10, 40), tol: 1e-3 },
  { id: 'chamfer-plain-edge', script: BOX + "chamfer(b.edge('top', 'right'), 3)", vol: V - cb(3, 40), tol: 1e-9 },
  { id: 'fillet-two-far-edges', script: BOX + "round(b.edge('top', 'front'), 3)\nround(b.edge('bottom', 'back'), 3)", vol: V - 2 * rd(3, 40), tol: 1e-3 },
  { id: 'fillet-box-placed-at', script: "const b = cuboid(40, 40, 20, { at: [15, 5, 7] })\nround(b.edge('top', 'front'), 3)", vol: V - rd(3, 40), tol: 1e-3 },
  { id: 'fillet-box-moved', script: BOX + "move(b, [15, 5, 7])\nround(b.edge('top', 'front'), 3)", vol: V - rd(3, 40), tol: 1e-3, mayRefuse: true },
  { id: 'chamfer-box-moved', script: BOX + "move(b, [15, 5, 7])\nchamfer(b.edge('top', 'right'), 3)", vol: V - cb(3, 40), tol: 1e-9, mayRefuse: true },
  { id: 'fillet-radius-too-large', script: BOX + "round(b.edge('top', 'front'), 30)", refuse: true },
  { id: 'fillet-radius-equals-height', script: BOX + "round(b.edge('top', 'front'), 20)", refuse: true },
  { id: 'fillet-radius-zero', script: BOX + "round(b.edge('top', 'front'), 0)", refuse: true },
  { id: 'fillet-radius-negative', script: BOX + "round(b.edge('top', 'front'), -2)", refuse: true },
  { id: 'chamfer-too-large', script: BOX + "chamfer(b.edge('top', 'right'), 25)", refuse: true },
  { id: 'cylinder-rim-fillet', script: "const c = cylinder(12, 30)\nround(c.edge('top', 'side'), 3)", vol: rimFillet(6, 30, 3), tol: 3e-3 }, // cylinder(12, 30) is 12 ACROSS (radius 6), 30 tall
];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(url);
await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft; }, null, { timeout: 90000 });
const rows = [];
for (const c of cases) {
  const r = await Promise.race([
    page.evaluate(async (s) => { window.__host.setScript(s); const x = await window.__host.run({ confirmed: true }); return { volume: x.volume, bodies: x.bodies, features: x.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal })), refusals: x.refusals }; }, c.script),
    new Promise((res) => setTimeout(() => res({ timeout: true }), 90000)),
  ]).catch((e) => ({ error: String(e).slice(0, 200) }));
  const blend = (r.features ?? []).find((f) => f.kind === 'fillet');
  let verdict;
  if (r.timeout || r.error) verdict = 'ERROR';
  else if (blend && blend.status === 'refused') verdict = c.refuse || c.mayRefuse ? 'REFUSED (as expected)' : 'REFUSED (unexpected)';
  else if (!blend) verdict = 'NO BLEND FEATURE';
  else if (c.refuse) verdict = 'BUILT-WRONG (expected a refusal)';
  else { const d = Math.abs(r.volume - c.vol) / c.vol; verdict = d <= c.tol ? `BUILT, RIGHT (volume ${r.volume.toFixed(6)} vs closed form ${c.vol.toFixed(6)}, rel ${d.toExponential(2)})` : `BUILT-WRONG (volume ${r.volume} vs ${c.vol}, rel ${d.toExponential(2)})`; }
  rows.push({ id: c.id, script: c.script, verdict, sentence: blend?.status === 'refused' ? blend.refusal : null, volume: r.volume ?? null, bodies: r.bodies ?? null });
  console.log(c.id, '->', verdict, blend?.refusal ? '\n    ' + blend.refusal : '');
  fs.writeFileSync(process.argv[3], JSON.stringify(rows, null, 1));
}
await browser.close(); srv.close();
