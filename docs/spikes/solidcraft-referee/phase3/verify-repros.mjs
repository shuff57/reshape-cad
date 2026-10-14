#!/usr/bin/env node
// SPIKE (phase 3). Critic repros against the real page (playwright-cli session `spike`, servers from run.sh up):
// stale panels after error paths, caps with timings, custom script numbers, tampered refusal expectation, residual marker,
// embedder block. Writes repro-results.json and screenshots/repro-*.png.   node phase3/verify-repros.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const pw = (...a) => execFileSync('playwright-cli', ['-s=spike', ...a], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 200000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn) => { const out = pw('eval', fn); const m = out.match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error(out.slice(0, 300)); const v = JSON.parse(m[1]); return typeof v === 'string' ? JSON.parse(v) : v; };
const snap = `() => ({ status: document.getElementById('status').textContent, verdictClass: document.getElementById('verdict').className, verdict: document.getElementById('verdict').textContent, detail: document.getElementById('verdict-detail').textContent, features: document.getElementById('features').textContent.slice(0, 400), result: document.getElementById('result').textContent.slice(0, 200), sketches: document.getElementById('sketches').textContent.slice(0, 400) })`;
const runCustom = (code) => ev(`async () => { const t = document.getElementById('src'); t.value = ${JSON.stringify(code)}; t.dispatchEvent(new Event('input')); const t0 = performance.now(); const r = await window.__host.run(); const s = (${snap})(); s.ms = Math.round(performance.now() - t0); s.volume = r.volume ?? null; s.bodies = r.bodies?.length ?? null; s.faces = r.bodies?.reduce((a, b) => a + b.faces, 0) ?? null; return JSON.stringify(s); }`);
const runEx = (id) => ev(`async () => { const r = await window.__host.runExample(${JSON.stringify(id)}); return JSON.stringify({ ...(${snap})(), volume: r.volume ?? null }); }`);
const shot = (n) => pw('screenshot', `--filename=${path.join(HERE, 'screenshots', n + '.png')}`);
try { pw('open', 'http://127.0.0.1:8795/'); } catch { pw('goto', 'http://127.0.0.1:8795/'); }
pw('resize', '1500', '1500'); await sleep(5000);
const R = {};
// 1. stale panels
R.baseline = await runEx('refuse-edge-pick');
R.syntaxError = await runCustom('const b = cuboid(40,'); shot('repro-syntax-error'); await sleep(500);
await runEx('refuse-edge-pick');
R.zeroSize = await runCustom('const b = cuboid(0,10,5)'); shot('repro-zero-size');
await runEx('refuse-edge-pick');
R.runaway = await runCustom('while (true) {}'); shot('repro-runaway');
R.afterRunaway = await runCustom('const b = cuboid(10,10,10)');
// 5. misc
R.custom = await runCustom('const b = cuboid(37, 11, 5.5)'); shot('repro-custom-37x11x5.5');
R.huge = await runCustom('const b = cuboid(1e9,1e9,1e9)'); shot('repro-huge');
R.huge1e7 = await runCustom('const b = cuboid(1e7,10,10)');
// 2. caps
R.pattern1000 = await runCustom('const b = cuboid(10,10,5)\nlinearPattern(b, { count: 1000, step: 15 })');
R.pattern101 = await runCustom('const b = cuboid(10,10,5)\nlinearPattern(b, { count: 101, step: 15 })');
R.pattern100 = await runCustom('const b = cuboid(10,10,5)\nlinearPattern(b, { count: 100, step: 15 })'); shot('repro-pattern-100');
R.features61 = await runCustom('for (let i = 0; i < 61; i++) { cuboid(5, 5, 5, { at: [i * 10, 0, 0] }) }');
R.features60 = await runCustom('for (let i = 0; i < 60; i++) { cuboid(5, 5, 5, { at: [i * 10, 0, 0] }) }');
// 3. negative test: tamper the expected refused id
await runEx('refuse-edge-pick');
R.tamperId = ev(`async () => { const ex = window.__host.EXAMPLES.find((e) => e.id === 'refuse-edge-pick'); const keep = ex.expectRefused[0].id; ex.expectRefused[0].id = 'box1'; const r = await window.__host.runExample('refuse-edge-pick'); ex.expectRefused[0].id = keep; return JSON.stringify((${snap})()); }`); shot('repro-tampered-id');
R.tamperSentence = ev(`async () => { const ex = window.__host.EXAMPLES.find((e) => e.id === 'refuse-edge-pick'); const keep = ex.expectRefused[0].contains; ex.expectRefused[0].contains = 'a sentence that is not there'; await window.__host.runExample('refuse-edge-pick'); ex.expectRefused[0].contains = keep; return JSON.stringify((${snap})()); }`);
R.tamperVolume = ev(`async () => { const ex = window.__host.EXAMPLES.find((e) => e.id === 'refuse-edge-pick'); const keep = ex.ref.builtVolume; ex.ref.builtVolume = 12345; await window.__host.runExample('refuse-edge-pick'); ex.ref.builtVolume = keep; return JSON.stringify((${snap})()); }`);
R.untampered = await runEx('refuse-edge-pick');
// 4. residual marker in the table row
R.conflictRow = ev(`async () => { await window.__host.runExample('diag-conflict'); return JSON.stringify({ rowText: document.querySelector('#sketches table tr:nth-child(2)').textContent, hasMarker: !!document.querySelector('#sketches .fail') }); }`);
shot('repro-conflict-row');
writeFileSync(path.join(HERE, 'repro-results.json'), JSON.stringify(R, null, 1) + '\n');
for (const [k, v] of Object.entries(R)) console.log(k.padEnd(16), JSON.stringify({ cls: v.verdictClass, ms: v.ms, vol: v.volume, bodies: v.bodies, verdict: (v.verdict ?? v.rowText ?? '').slice(0, 150) }));
