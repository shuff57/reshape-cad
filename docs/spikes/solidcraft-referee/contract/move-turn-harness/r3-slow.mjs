// round 3: speed and hangs of booleans that involve a turned or copied part. Each solidcraft call runs in a child process killed at SC_BOX_MS (a stand-in for
// "run solidcraft in a Worker and terminate it"). Output: wall time per case, verdict vs live OCCT, the sentence a student sees on a timeout.
// Usage: SC_BOX_MS=30000 bun r3-slow.mjs [--only=id,id] [--out=file.json]      (the machine is shared: wall times are upper bounds)
import { writeFileSync } from 'node:fs';
import { runCase, scCalls } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard, TIME_NOTE } from './translate-guard.mjs';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const only = arg('only')?.split(',');
const out = arg('out') ?? `r3-slow-${process.env.SC_BOX_MS}.json`;
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const C = {
  's01 box cut by cylinder turned [30,0,0]': `const a = box(40, 40, 20, { at: [0, 0, 0] });\nconst c = cylinder(10, 60, { at: [0, 0, 0] });\nturn(c, [30, 0, 0]);\ncut(a, c);`,
  's02 box cut by cylinder turned [30,45,60]': `const a = box(40, 40, 20, { at: [0, 0, 0] });\nconst c = cylinder(10, 60, { at: [0, 0, 0] });\nturn(c, [30, 45, 60]);\ncut(a, c);`,
  's03 box cut by cylinder turned [90,0,0] (axis-aligned)': `const a = box(40, 40, 20, { at: [0, 0, 0] });\nconst c = cylinder(10, 60, { at: [0, 0, 0] });\nturn(c, [90, 0, 0]);\ncut(a, c);`,
  's04 box cut by cylinder turned [0,90,0] (axis-aligned)': `const a = box(40, 40, 20, { at: [0, 0, 0] });\nconst c = cylinder(10, 60, { at: [0, 0, 0] });\nturn(c, [0, 90, 0]);\ncut(a, c);`,
  's05 box cut by box turned [30,0,0] (planar control)': `const a = box(40, 40, 20, { at: [0, 0, 0] });\nconst c = box(10, 60, 10, { at: [0, 0, 0] });\nturn(c, [30, 0, 0]);\ncut(a, c);`,
  's06 two perpendicular equal cylinders join': `const a = cylinder(20, 40, { at: [0, 0, 0] });\nconst b = cylinder(20, 40, { at: [0, 0, 0] });\nturn(b, [0, 90, 0]);\njoin(a, b);`,
  's07 two perpendicular UNEQUAL cylinders join (control)': `const a = cylinder(20, 40, { at: [0, 0, 0] });\nconst b = cylinder(12, 40, { at: [0, 0, 0] });\nturn(b, [0, 90, 0]);\njoin(a, b);`,
  's08 join two overlapping copied rings': `const t = ring(30, 6, { at: [0, 0, 0] });\nconst c = move(t, [10, 0, 0], { copy: true });\njoin(t, c);`,
  's09 cylinder + turned ring join': `const a = cylinder(20, 40, { at: [0, 0, 0] });\nconst t = ring(30, 6, { at: [0, 0, 0] });\nturn(t, [90, 0, 0]);\njoin(a, t);`,
  's10 sphere, hole, turn': `const s = sphere(30, { at: [0, 0, 0] });\nhole(s, { across: 6 });\nturn(s, [10, 20, 30]);`,
  's11 ring, hole': `const t = ring(30, 6, { at: [0, 0, 0] });\nhole(t, { across: 3 });`,
  's12 cone, hole, turn': `const c = cone(30, 40, { at: [0, 0, 0] });\nhole(c, { across: 4 });\nturn(c, [10, 20, 30]);`,
  's15 ring, hole through the tube': `const t = ring(30, 6, { at: [0, 0, 0] });\nhole(t, { across: 2, at: [12, 0] });`,
  's13 box copy joined (the common copy use)': `const a = box(20, 10, 6, { at: [0, 0, 0] });\nconst b = move(a, [10, 0, 0], { copy: true });\njoin(a, b);`,
  's14 cylinder copy joined': `const a = cylinder(20, 30, { at: [0, 0, 0] });\nconst b = move(a, [10, 0, 0], { copy: true });\njoin(a, b);`,
};
const rows = [];
for (const [k, script] of Object.entries(C)) {
  const id0 = k.split(' ')[0];
  if (only && !only.includes(id0)) continue;
  scCalls.length = 0;
  const t0 = Date.now();
  let r;
  try { r = runCase({ script, translateFn: guard }); } catch (e) { console.log(k, 'THROW', e.message); rows.push({ case: k, script, error: e.message }); continue; }
  const wall = (Date.now() - t0) / 1000;
  if (r.errors.length) { console.log(k, 'SCRIPT ERROR', r.errors[0]); rows.push({ case: k, script, errors: r.errors }); continue; }
  const id = r.features.at(-1).id; const t = r.truck[id]; const v = verdict(r, id);
  const slowest = Math.max(0, ...scCalls.map((c) => c.ms)) / 1000;
  const cpuSec = scCalls.reduce((a, c) => a + (c.cpuMs ?? 0), 0) / 1000;
  const timedOut = scCalls.filter((c) => c.timedOut).length;
  const row = { case: k, script, wallSec: wall, scCalls: scCalls.length, slowestCallSec: slowest, scCpuSec: cpuSec, timedOutCalls: timedOut, verdict: v, refusal: t.refused ?? null, dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom, faces: t.faces, occtFaces: t.occtFaces, occtVolume: t.occtVolume ?? r.occt[id]?.volume, brep: r.brep[id], occtRefusals: r.occtRefusals, boxMs: Number(process.env.SC_BOX_MS) };
  rows.push(row);
  console.log(k.padEnd(56), `wall=${wall.toFixed(1)}s calls=${scCalls.length} slowest=${slowest.toFixed(1)}s cpu=${cpuSec.toFixed(1)}s timeouts=${timedOut}`, v.padEnd(8), t.refused ? t.refused : `dVol=${f(t.dVol)} dCom=${f(t.dCom)} f=${t.faces}/${t.occtFaces}`);
}
writeFileSync(out, JSON.stringify({ boxMs: Number(process.env.SC_BOX_MS), TIME_NOTE, rows }, null, 1));
