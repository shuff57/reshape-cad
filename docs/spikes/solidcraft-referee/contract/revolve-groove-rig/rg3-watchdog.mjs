#!/usr/bin/env node
// SPIKE, referee only (contract / revolve-groove, round 3). The page-side time budget for a groove: sc.run is ONE synchronous wasm call with no cancel, so the page runs it
// in a Worker and terminates the Worker when BUDGET_S runs out (the same rule and the same 45 s as the booleans and holes groups, contract/bool-watchdog.mjs). Measured on
// the real command list the guarded translator emits for a groove that the static cost rule would have refused (RG_OFF=G8 lets it through):
//   SOLIDCRAFT_REFEREE_PKG=<pkg> RG_OFF=G8,G9,G7 bun rg3-watchdog.mjs --src='<script>' [--budget=45]
//   --bbox=x0,y0,z0,x1,y1,z1 is the box the stub reports for every body (default +-100).
//   - the groove: KILLED at the budget (or finished, with its time), the page's own 100 ms timer keeps ticking;
//   - then a FRESH Worker builds a box (the page is usable again).
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);
const BOX = [{ command: 'solid.box', params: { length: 10, width: 10, height: 10, center: [0, 0, 0], body_name: 'b' } }];
if (!isMainThread) {
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const go = (commands) => { const t0 = Date.now(); try { const r = JSON.parse(sc.run(JSON.stringify({ commands }))); return { ok: r.ok, ms: Date.now() - t0, bodies: r.ok ? r.measure.bodies.map((b) => `${b.name}=${b.volume_mm3.toFixed(3)}`) : r.failed?.error }; } catch (e) { return { ok: false, trap: true, ms: Date.now() - t0, error: String(e.message).slice(0, 100) }; } };
  parentPort.postMessage({ phase: 'first', ...go(workerData.commands) });
  process.exit(0);
}
const { init } = await import('./rg3-lib.mjs');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const budgetMs = Number(arg('budget', 45)) * 1000;
const L = await init({});
// collect the command list the translator would send, without running the slow cut: the stub answers every call with a plausible one-body measure
const BB = arg('bbox', '-100,-100,-100,100,100,100').split(',').map(Number);   // the stub's body box: pass the real box of the target (--bbox=-20,-20,0,20,20,30) or the guard sees a part the ring misses
const stub = (cmds) => { const names = new Set(); for (const k of cmds) if (k.params.body_name) names.add(k.params.body_name); return { ok: true, measure: { bodies: [...names].map((n) => ({ name: n, volume_mm3: 1e5, area_mm2: 1, faces: 1, kernel: { faces: 1 }, bbox: { min: BB.slice(0, 3), max: BB.slice(3) }, center_of_mass: [(BB[0] + BB[3]) / 2, (BB[1] + BB[4]) / 2, (BB[2] + BB[5]) / 2], face_types: { plane: 1 } })) } }; };
const rs = L.runScript(arg('src'));
if (rs.errors?.length) { console.log('script errors', rs.errors); process.exit(1); }
const { translateDoc } = await import('./rg-translate-p0.mjs');
const tr = translateDoc(L.solveDoc(rs.doc), { arc: L.arc, mt: L.mt, runSC: stub, resolveAt: () => null });
const run = (commands, ms) => new Promise((resolve) => {
  const t0 = Date.now(); const w = new Worker(here, { workerData: { commands }, env: process.env }); const msgs = []; let done = false;
  const finish = async (o) => { if (done) return; done = true; clearTimeout(timer); const t1 = Date.now(); await w.terminate(); resolve({ ...o, messages: msgs, waitedMs: t1 - t0, terminateMs: Date.now() - t1 }); };
  const timer = setTimeout(() => finish({ outcome: 'KILLED by the watchdog' }), ms);
  w.on('message', (m) => { msgs.push(m); if (m.phase === 'first') finish({ outcome: 'finished' }); });
  w.once('error', (e) => finish({ outcome: 'worker error', error: String(e.message).slice(0, 120) }));
  w.once('exit', () => finish({ outcome: 'exited' }));
});
let ticks = 0; const ticker = setInterval(() => { ticks++; }, 100);
console.log(`src: ${arg('src').slice(-160)}\n${tr.commands.length} commands (guarded translator), budget ${budgetMs / 1000} s`);
const a = await run(tr.commands, budgetMs);
console.log('groove     :', JSON.stringify(a), `| the page's own 100 ms timer ticked ${ticks} times meanwhile (${(a.waitedMs / 100).toFixed(0)} expected)`);
const b = await run(BOX, 60000);
console.log('next call  :', JSON.stringify(b), '(a FRESH worker after the kill / finish)');
clearInterval(ticker);
process.exit(0);
