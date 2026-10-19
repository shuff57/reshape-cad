#!/usr/bin/env node
// SPIKE, referee only (contract / booleans group, round 2). The page-side time budget for a combine: sc.run is ONE synchronous wasm call with no cancel, so the
// page runs it in a Worker and terminates the Worker when BUDGET_S runs out; a wasm trap (RuntimeError: unreachable) is caught in the Worker, which is then also
// replaced. Measured here on real combine command lists (the ones the pristine phase0 translator emits, i.e. what the page would send if the static guard had
// not already refused the case):
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/bool-watchdog.mjs --case=<id> [--budget=45]
//   - a hang case (x-cyl-cross-cyl-cut: 130+ s unguarded): KILLED at the budget, the page's own timer keeps ticking, a fresh Worker then builds a box;
//   - a trap case (trap-*): the Worker reports the trap at once; the SAME instance is probed afterwards (does it still work?) and so is a fresh Worker.
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(import.meta.url);
const BOX = [{ command: 'solid.box', params: { length: 10, width: 10, height: 10, center: [0, 0, 0], body_name: 'b' } }];
if (!isMainThread) {
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const go = (commands) => { const t0 = Date.now(); try { const r = JSON.parse(sc.run(JSON.stringify({ commands }))); return { ok: r.ok, ms: Date.now() - t0, bodies: r.ok ? r.measure.bodies.map((b) => `${b.name}=${b.volume_mm3.toFixed(3)}`) : r.failed?.error }; } catch (e) { return { ok: false, trap: true, ms: Date.now() - t0, error: String(e.message).slice(0, 100) }; } };
  const first = go(workerData.commands);
  parentPort.postMessage({ phase: 'first', ...first });
  if (workerData.probeAfter) parentPort.postMessage({ phase: 'same-instance-after', ...go(BOX) });
  process.exit(0);
}
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const budgetMs = Number(arg('budget', 45)) * 1000;
const id = arg('case');
const REPO = path.join(path.dirname(here), '..', '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { CASES } = await import('./boolean-cases.mjs'); await import('./boolean-cases-r2.mjs');
const { translateDoc } = await import('../phase0/translate.mjs');
const arc = await load('packages/sketch/dist/sketch-arc.js'); const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js'); const { runScript } = await load('packages/script/dist/reshape-script.js');
const c = CASES.find((x) => x.id === id);
const features = c.script !== undefined ? runScript(c.script).doc.features : c.features;
const stub = (cmds) => { const names = new Set(); for (const k of cmds) if (k.params.body_name) names.add(k.params.body_name); return { ok: true, measure: { bodies: [...names].map((n) => ({ name: n, volume_mm3: 1, faces: 1, kernel: { faces: 1 }, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, center_of_mass: [0, 0, 0], face_types: { plane: 1 } })) } }; };
const tr = translateDoc(solveDoc({ version: 1, features }), { arc, mt, runSC: stub, resolveAt: () => null });
const run = (commands, ms, probeAfter = false) => new Promise((resolve) => {
  const t0 = Date.now(); const w = new Worker(here, { workerData: { commands, probeAfter }, env: process.env }); const msgs = []; let done = false;
  const finish = async (o) => { if (done) return; done = true; clearTimeout(timer); const t1 = Date.now(); await w.terminate(); resolve({ ...o, messages: msgs, waitedMs: t1 - t0, terminateMs: Date.now() - t1 }); };
  const timer = setTimeout(() => finish({ outcome: 'KILLED by the watchdog' }), ms);
  w.on('message', (m) => { msgs.push(m); if (m.phase === (probeAfter ? 'same-instance-after' : 'first')) finish({ outcome: 'finished' }); });
  w.once('error', (e) => finish({ outcome: 'worker error', error: String(e.message).slice(0, 120) }));
  w.once('exit', () => finish({ outcome: 'exited' }));
});
let ticks = 0; const ticker = setInterval(() => { ticks++; }, 100);
console.log(`case ${id}: ${tr.commands.length} commands (pristine phase0 translator), budget ${budgetMs / 1000} s`);
const a = await run(tr.commands, budgetMs, true);
console.log('combine    :', JSON.stringify(a), `| the page's own 100 ms timer ticked ${ticks} times meanwhile (waited ${(a.waitedMs / 100).toFixed(0)} expected)`);
const b = await run(BOX, 60000);
console.log('next call  :', JSON.stringify(b), '(a FRESH worker after the kill / trap)');
clearInterval(ticker);
process.exit(0);
