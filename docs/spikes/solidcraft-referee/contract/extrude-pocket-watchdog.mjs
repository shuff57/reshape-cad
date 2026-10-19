#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 3. Can the PAGE stop a SolidCraft call that takes minutes? sc.run is one synchronous wasm call, so the only way is to run it
// in a Worker and terminate the Worker from the page when a budget runs out (browsers: Worker.terminate() stops a busy worker at once; here: Bun's Worker, measured below).
// This is an addition, not what protects the student: the contract refuses a slanted round cut into anything but a plain block BEFORE calling the kernel (translate-ep.mjs), so this watchdog
// only matters for a call the mapping could not foresee. The probe runs the slow command list the round-2 mapping sent for sx-hole-cross-b (40 s unguarded, extrude-pocket-slant-timing.txt)
// in a Worker with a 8 s budget, terminates it, then checks that the process is still responsive and that a FRESH worker still builds a box.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-watchdog.mjs [--budget=8]
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);
if (!isMainThread) {
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const t0 = Date.now();
  const r = JSON.parse(sc.run(JSON.stringify({ commands: workerData.commands })));
  parentPort.postMessage({ ok: r.ok, ms: Date.now() - t0, bodies: r.ok ? r.measure.bodies.map((b) => `${b.name}=${b.volume_mm3.toFixed(3)}`) : r.failed?.error });
  process.exit(0);
}
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const budgetMs = Number(arg('budget', 8)) * 1000;
const { contract, arc, mt, docOf, runSC } = await import('./extrude-pocket-r3-lib.mjs');
const { CASES } = await import('./extrude-pocket-cases.mjs');
await import('./extrude-pocket-cases-r2.mjs'); await import('./extrude-pocket-cases-r3.mjs');
const id = arg('case', 'sx-hole-cross-b');
const c = CASES.find((x) => x.id === id);
const collect = async (cmds) => { const last = cmds[cmds.length - 1]; return (last.command === 'solid.loft' && last.params.operation === 'cut') ? runSC(cmds.slice(0, -1)) : runSC(cmds); };
const tr = await contract.translateDoc(docOf(c.script), { arc, mt, runSC: collect, skipVerify: true, unguardedSlant: true, resolveAt: () => null });
const run = (commands, ms) => new Promise((resolve) => {
  const t0 = Date.now();
  const w = new Worker(here, { workerData: { commands }, env: process.env });
  let done = false;
  const timer = setTimeout(async () => { if (done) return; done = true; const t1 = Date.now(); await w.terminate(); resolve({ outcome: 'KILLED by the watchdog', waitedMs: t1 - t0, terminateReturnedMs: Date.now() - t1 }); }, ms);
  w.once('message', (m) => { if (done) return; done = true; clearTimeout(timer); resolve({ outcome: 'finished', ...m, waitedMs: Date.now() - t0 }); });
  w.once('error', (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ outcome: 'worker error', error: String(e.message).slice(0, 120), waitedMs: Date.now() - t0 }); });
});
let ticks = 0; const ticker = setInterval(() => { ticks++; }, 100);
console.log(`case ${id}: ${tr.commands.length} commands, budget ${budgetMs / 1000} s`);
const a = await run(tr.commands, budgetMs);
console.log('slow call  :', JSON.stringify(a), `| the page's own timer ticked ${ticks} times in the meantime (100 ms each) = the page stayed responsive`);
const b = await run([{ command: 'solid.box', params: { length: 10, width: 10, height: 10, center: [0, 0, 0], body_name: 'b' } }], 60000);
console.log('next call  :', JSON.stringify(b), '(a FRESH worker builds a box after the kill)');
clearInterval(ticker);
const sentence = `${id}: SolidCraft needed more than ${budgetMs / 1000} seconds for this feature and was stopped, so nothing is built; simplify the sketch or cut it in a different order`;
console.log('sentence   :', sentence);
process.exit(0);
