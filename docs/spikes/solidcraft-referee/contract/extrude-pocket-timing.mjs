#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 4. How long do ordinary round tools take? One synchronous sc.run per step, nothing can interrupt it.
// For each case: the contract translator end to end (mapping + guards + the after-build scratch sessions), the shipped translator (translate-p4) end to end,
// and ONE raw run of the accepted command list. Wall clock in Bun on this box; the load average is printed because every figure is inflated by it.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-timing.mjs > extrude-pocket-timing.txt
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { docOf, contract, arc, mt, runSC } from './extrude-pocket-r3-lib.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const shipped = await import(pathToFileURL(path.join(HERE, '..', 'phase7', 'pane', 'lib', 'translate-p4.mjs')).href);
const BIG = "const s1 = sketch('top'); s1.polygon([[0,0],[100,0],[100,100],[0,100]]); const plate = pull(s1, 10);";
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = pull(s1, 10);";
const grid = (n, cols = 9) => { let s = ''; for (let i = 0; i < n; i++) s += `sk.circle(4, { at: [${5 + 10 * (i % cols)}, ${5 + 10 * Math.floor(i / cols)}] }); `; return s; };
const CASES = [
  ...[1, 2, 4, 8, 12, 24, 25, 48].map((n) => ({ id: `${n} round holes in one pocket (d4, 4 deep, 100 x 100 plate)`, script: `${BIG} const sk = sketch('top', 10); ${grid(n)} pocket(sk, plate, 4);` })),
  { id: '12 round holes as 12 separate pockets', script: `${BIG} ${Array.from({ length: 12 }, (_, i) => `const sp${i} = sketch('top', 10); sp${i}.circle(4, { at: [${5 + 10 * (i % 9)}, ${5 + 10 * Math.floor(i / 9)}] }); const q${i} = pocket(sp${i}, ${i ? `q${i - 1}` : 'plate'}, 4);`).join(' ')}` },
  { id: 'a d10 circle tangent to the plate edge (pocket 5 deep)', script: `${PLATE} const sk = sketch('top', 10); sk.circle(10, { at: [5, 15] }); pocket(sk, plate, 5);` },
  { id: 'a deep tapered cone pocket (d8, 9 deep, taper 5)', script: `${PLATE} const sk = sketch('top', 10); sk.circle(8, { at: [20, 15] }); pocket(sk, plate, 9, { taper: 5 });` },
  { id: 'a plain d8 round pocket (control)', script: `${PLATE} const sk = sketch('top', 10); sk.circle(8, { at: [20, 15] }); pocket(sk, plate, 5);` },
  { id: 'a plain round pull d20 (control)', script: "const sk = sketch('top'); sk.circle(20); pull(sk, 10);" },
];
console.log(`# wall clock in Bun ${Bun.version}, load average ${os.loadavg().map((x) => x.toFixed(1)).join(' ')} on ${os.cpus().length} cores, ${new Date().toISOString().slice(0, 10)}`);
console.log('# columns: contract translator end to end | shipped translator end to end | one raw run of the accepted commands | outcome');
for (const c of CASES) {
  const doc = docOf(c.script);
  const t0 = Date.now();
  const tr = await contract.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  const tc = Date.now() - t0;
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  let raw = '-';
  if (last?.status === 'built') { const t1 = Date.now(); await runSC(tr.commands); raw = `${((Date.now() - t1) / 1000).toFixed(1)} s`; }
  let ship = '-';
  if (!/^(25|48) /.test(c.id)) { const t2 = Date.now(); await shipped.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null }); ship = `${((Date.now() - t2) / 1000).toFixed(1)} s`; }
  console.log(`${c.id.padEnd(66)} | contract ${(tc / 1000).toFixed(1).padStart(5)} s | shipped ${ship.padStart(7)} | raw ${raw.padStart(7)} | ${last?.status === 'built' ? 'built' : `refused: ${String(last?.refusal).slice(0, 110)}`}`);
}
