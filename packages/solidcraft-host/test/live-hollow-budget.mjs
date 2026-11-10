// Live check that a HOLLOW goes through the time budget (kernel in a worker), against the real SolidCraft web build (setup as test/live-budget.mjs), in one headless Chrome.
//   node test/live-hollow-budget.mjs <site folder> <out.json>
// Four runs: a plain open hollow with every budget cut to 0.05 s (its probe must time out: the hollow is refused with the budget sentence, the box stands),
// the same uncapped (probed under 45 s, built), a family-C hollow uncapped (probed, then the hollow check decides), and the plain one with the probe off.
// Measured 2026-11-09 on v0.30.1: test/hollow-budget-0.30.1.json (README, "Pin").
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const ROOT = process.argv[2]; const OUT = process.argv[3];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const PLAIN = "const b = box(40, 30, 10, { at: [0, 0, 5] });\nhollow(b, { wall: 1, open: 'top' });";
const FAMC = "const b = box(40, 30, 10, { at: [0, 0, 5] });\n" + ['front', 'back', 'left', 'right'].map((e) => `fillet(b.edge('bottom','${e}'), 3);`).join('\n') + "\nhollow(b, { wall: 2, open: 'top' });";
const out = [];
for (const [label, qs, src] of [['plain hollow, cap 0.05 s', '?budgetCapS=0.05', PLAIN], ['plain hollow, no cap', '', PLAIN], ['family-C hollow, no cap', '', FAMC], ['plain hollow, probe off', '?probe=off', PLAIN]]) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(base + qs);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
  const r = await page.evaluate(async (s) => {
    const t0 = performance.now(); const n0 = window.__host.probeLog.length;
    window.__host.setScript(s); const x = await window.__host.run({ confirmed: true });
    const insp = await window.__host.bridge.inspect();
    return { wallMs: Math.round(performance.now() - t0), features: document.getElementById('features').innerText, probes: window.__host.probeLog.slice(n0), bodies: (insp.bodies ?? []).map((b) => ({ name: b.name, volume: b.volume_mm3 })) };
  }, src);
  out.push({ label, ...r }); console.log(label, JSON.stringify(r).slice(0, 700));
  await page.close();
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close(); srv.close();
