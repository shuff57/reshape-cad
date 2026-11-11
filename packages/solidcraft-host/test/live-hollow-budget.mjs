// Live check that a HOLLOW goes through the time budget (kernel in a worker), against the real SolidCraft web build (setup as test/live-budget.mjs), in one headless Chrome.
//   node test/live-hollow-budget.mjs <site folder> <out.json>
// Five runs: a plain open hollow with every budget cut to 0.05 s (its probe must time out: the hollow is refused with the budget sentence, the box stands),
// the same uncapped (probed under 45 s, built), a family-C hollow uncapped (probed, then the hollow check decides), the plain one with the probe off, and
// (since 2026-11-10, one budget per hollow) a hollow after a centred through hole. Its first open-face point must be sent 45 s + 1.5 x the last accepted run.
// If the hollow tries more points, each must be sent only what is left of the ONE budget; on 0.30.1 this hollow builds at its first point, so that part is
// not exercised in the browser (it is pinned by packages/layer/test/hollow-budget.test.mjs and recorded in the output as exercised: false). Exits 1 on a failed check.
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
const HOLED = "const b = box(40, 30, 10, { at: [0, 0, 5] });\nhole(b, { across: 4 });\nhollow(b, { wall: 1, open: 'top' });";
const out = [];
for (const [label, qs, src] of [['plain hollow, cap 0.05 s', '?budgetCapS=0.05', PLAIN], ['plain hollow, no cap', '', PLAIN], ['family-C hollow, no cap', '', FAMC], ['plain hollow, probe off', '?probe=off', PLAIN], ['hollow after a centred hole, one budget', '', HOLED]]) {
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
// the one-budget check: every hollow probe after the first is sent the previous probe's budget minus that probe's computing; a probe the host clamps up to
// its 1 s floor is the only exception
const H = out.find((o) => o.label.startsWith('hollow after a centred hole'));
const sh = H.probes.filter((p) => p.last === 'solid.shell');
const checks = [];
checks.push({ what: 'the first point is sent 45 s + 1.5 x the last accepted run, no more', ok: sh.length > 0 && sh[0].budgetS >= 45 && sh[0].budgetS < 60, sent: sh[0]?.budgetS });
for (let i = 1; i < sh.length; i++) {
  const want = Math.max(1, sh[i - 1].budgetS - sh[i - 1].cpuMs / 1000);
  checks.push({ what: `point ${i + 1} is sent what is left`, ok: Math.abs(sh[i].budgetS - want) < 1e-6, sent: sh[i].budgetS, want });
}
out.push({ label: 'one-budget checks', points: sh.length, laterPointsExercised: sh.length >= 2, checks });
console.log(JSON.stringify({ points: sh.length, checks }));
if (checks.some((c) => !c.ok)) process.exitCode = 1;
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close(); srv.close();
