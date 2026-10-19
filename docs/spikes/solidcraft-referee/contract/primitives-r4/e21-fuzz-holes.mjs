// E21 (round 4): the eight curved holes that fuzz seed 1 found in the first round 4 guard. Each is rebuilt from its stored document, then varied to find the cause.
import { readFileSync } from 'node:fs';
import path from 'node:path';
const seed = JSON.parse(readFileSync(path.join(import.meta.dir, 'results', 'fuzz-seed1.json'), 'utf8'));
const byId = Object.fromEntries(seed.map((r) => [r.id, r.doc.features[0]]));
const D = (f) => ({ version: 1, features: [{ ...f, id: f.kind + '1' }] });
const out = [];
const orig = ['fz1-c0006', 'fz1-c0079', 'fz1-c0090', 'fz1-c0118', 'fz1-c0130', 'fz1-c0137', 'fz1-c0143', 'fz1-c0145'];
for (const id of orig) {
  const f = byId[id];
  out.push({ id: `e21-${id}-orig`, doc: D(f), occt: true });
  out.push({ id: `e21-${id}-origin`, doc: D({ ...f, center: [0, 0, 0] }), occt: true });
  if (f.rotate) out.push({ id: `e21-${id}-norot`, doc: D({ ...f, rotate: undefined }), occt: true });
  if (f.rotate) out.push({ id: `e21-${id}-origin-norot`, doc: D({ ...f, center: [0, 0, 0], rotate: undefined }), occt: true });
}
// turned cones, all sizes, at the origin, turned about each axis alone and about all three
for (const [r, h] of [[0.921, 0.7261], [2.449, 0.2], [2.5465, 1.943], [72.95, 2625], [10, 15]]) {
  for (const rot of [[90, 0, 0], [0, 90, 0], [0, 0, 90], [20, 35, 50], [90, -90, 90], [180, 90, 90], [180, 0, 0]]) {
    out.push({ id: `e21-tcone-r${r}-h${h}-${rot.join('_')}`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0], rotate: rot }), occt: true });
  }
}
// turned cylinder / ring / box-round / sphere on the same angles (does the turn itself hurt curved shapes?)
for (const rot of [[90, -90, 90], [180, 90, 90], [20, 35, 50]]) {
  out.push({ id: `e21-tcyl-${rot.join('_')}`, doc: D({ kind: 'cylinder', radius: 5, height: 12, center: [0, 0, 0], rotate: rot }), occt: true });
  out.push({ id: `e21-tring-${rot.join('_')}`, doc: D({ kind: 'torus', ringRadius: 8, tubeRadius: 2, center: [0, 0, 0], rotate: rot }), occt: true });
  out.push({ id: `e21-tboxr-${rot.join('_')}`, doc: D({ kind: 'box', size: [10, 12, 14], round: 2, center: [0, 0, 0], rotate: rot }), occt: true });
}
// big spheres far away
for (const s of [2000, 10000, 29440, 50000]) for (const e of [0, 1e3, 1e4, 1e5, 2e5, 5e5, 1e6]) {
  if (e > 400 * s) continue;
  out.push({ id: `e21-sph-s${s}-e${e}`, doc: D({ kind: 'sphere', radius: s / 2, center: [e, 0, e ? 1402 : 0] }), occt: true });
}
// big thin disc with a rim round
for (const [R, H, c] of [[10670, 87.62, 23.96], [10670, 87.62, 1], [10670, 87.62, 10], [10670, 87.62, 40], [10670, 87.62, 0], [5000, 40, 10], [1000, 20, 5], [100, 10, 2], [10670, 600, 23.96], [3000, 30, 12]]) {
  out.push({ id: `e21-disc-R${R}-H${H}-c${c}`, doc: D({ kind: 'cylinder', radius: R, height: H, round: c || undefined, center: [0, 0, 0] }), occt: true });
}
export default out;
