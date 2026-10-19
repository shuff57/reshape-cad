#!/usr/bin/env node
// SPIKE (phase 4), referee only. INDEPENDENT reference for the b2-stub shell family. Nothing here uses OCCT's `shell`
// (buildDoc silently no-ops it on these) or solidcraft. Two independent methods that must agree with each other:
//   (A) box composition on live OCCT: outer = b1 U b2, minus a cavity composed from boxes only;
//   (B) a voxel estimator: cavity = { p in S : dist(p, B) > t }, B = boundary of S except the open face.
// Convention (the open face is the +z face of b1, i.e. the part of b1's top NOT covered by b2; t = 1 from every other face):
//   P  "plane offset": every remaining face moves 1 mm inward along its own plane, the open plane is not offset. For a
//      stub standing on the opened top this leaves b2's tube resting on nothing (a free-floating second shell) unless b2
//      is flush with b1's wall. cavity_P = b1 inner box (|x|<19,|y|<14,-4<z<5) U b2 inner box (b2 shrunk 1 on its 5 faces).
//   L  "distance/mitre erosion": cavity = points farther than 1 (Chebyshev) from every non-open face. Keeps the stub
//      attached: material within 1 of the stub's wall foot (z 4..5, a ring around the footprint) stays.
//      cavity_L = (c1 - ring) U c2.  Also reported: E = Euclidean (ball) distance, voxel only.
//   node docs/spikes/solidcraft-referee/phase4/verify-stub-reference.mjs [voxel-step=0.1]   (needs npm run build)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const vol = (sh) => { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(sh, g, 1e-7, false, false); return g.Mass(); };

const STUBS = { // size, centre of b2; b1 is 40 x 30 x 10 centred at the origin (top at z = 5)
  'stub-centre': [[10, 10, 8], [0, 0, 9]], 'stub-offset-x': [[10, 10, 8], [10, 0, 9]], 'stub-corner': [[10, 10, 8], [15, 10, 9]],
  'stub-edge-flush': [[10, 10, 8], [15, 0, 9]], 'stub-tall': [[8, 8, 30], [-8, 5, 20]], 'stub-low': [[12, 12, 2], [5, -5, 6]],
};
const t = 1;
const bx = (id, lo, hi) => ({ id, kind: 'box', size: lo.map((_, i) => hi[i] - lo[i]), center: lo.map((v, i) => (v + hi[i]) / 2) });
const comb = (id, op, a, b) => ({ id, kind: 'combine', op, targets: [a, b] });
const measure = (features, id) => { const b = buildDoc(oc, { version: 1, features }, arc); const s = b.shapes.get(id); return s ? vol(s) : null; };

const h = +process.argv[2] || 0.1;
const out = {};
for (const [id, [sz, c]] of Object.entries(STUBS)) {
  const lo = c.map((v, i) => v - sz[i] / 2), hi = c.map((v, i) => v + sz[i] / 2);
  const f = [bx('b1', [-20, -15, -5], [20, 15, 5]), bx('b2', lo, hi), comb('S', 'union', 'b1', 'b2'),
    bx('c1', [-19, -14, -4], [19, 14, 5]),                                  // b1 inner box, open at z = 5
    bx('c2', [lo[0] + t, lo[1] + t, 5], [hi[0] - t, hi[1] - t, hi[2] - t]), // b2 inner box, bottom not offset
    bx('ringO', [lo[0] - t, lo[1] - t, 5 - t], [hi[0] + t, hi[1] + t, 5]),
    bx('ringI', [lo[0] + t, lo[1] + t, 5 - t], [hi[0] - t, hi[1] - t, 5]),
    comb('ring', 'subtract', 'ringO', 'ringI'),
    comb('c1L', 'subtract', 'c1', 'ring'),
    comb('solP0', 'subtract', 'S', 'c1'), comb('solP', 'subtract', 'solP0', 'c2'),
    comb('solL0', 'subtract', 'S', 'c1L'), comb('solL', 'subtract', 'solL0', 'c2')];
  // sanity: the cavity pieces must not overlap (c2 is above z = 5), so P = outer - |c1| - |c2|
  const outer = measure(f, 'S');
  const P = measure(f, 'solP'), L = measure(f, 'solL');
  // voxel
  const b1 = { lo: [-20, -15, -5], hi: [20, 15, 5] }, b2 = { lo, hi };
  const inB = (p, b) => p[0] >= b.lo[0] && p[0] <= b.hi[0] && p[1] >= b.lo[1] && p[1] <= b.hi[1] && p[2] >= b.lo[2] && p[2] <= b.hi[2];
  const rects = (b, skip) => { const r = []; for (let ax = 0; ax < 3; ax++) for (const s of [0, 1]) { if (skip(ax, s)) continue;
    const a = b.lo.slice(), z = b.hi.slice(); a[ax] = z[ax] = s ? b.hi[ax] : b.lo[ax]; r.push({ lo: a, hi: z }); } return r; };
  const B = [...rects(b1, (ax, s) => ax === 2 && s === 1), ...rects(b2, (ax, s) => ax === 2 && s === 0)];
  const dist = (p, linf) => { let m = 1e9; for (const r of B) { let a = 0, mx = 0;
    for (let i = 0; i < 3; i++) { const d = Math.max(r.lo[i] - p[i], 0, p[i] - r.hi[i]); a += d * d; if (d > mx) mx = d; }
    const dd = linf ? mx : Math.sqrt(a); if (dd < m) m = dd; } return m; };
  let nS = 0, cE = 0, cL = 0, cP = 0;
  for (let x = -20 + h / 2; x < 20; x += h) for (let y = -15 + h / 2; y < 15; y += h) for (let z = -5 + h / 2; z < hi[2] + 0.5; z += h) {
    const p = [x, y, z]; if (!(inB(p, b1) || inB(p, b2))) continue; nS++;
    if (dist(p, false) > t) cE++; if (dist(p, true) > t) cL++;
    // P cavity by its two boxes
    if ((x > -19 && x < 19 && y > -14 && y < 14 && z > -4 && z < 5) || (x > lo[0] + t && x < hi[0] - t && y > lo[1] + t && y < hi[1] - t && z > 5 && z < hi[2] - t)) cP++; }
  const u = h ** 3;
  out[id] = { outer, occt_P: P, occt_L: L, voxel_P: (nS - cP) * u, voxel_L: (nS - cL) * u, voxel_E: (nS - cE) * u };
  console.log(id.padEnd(16), 'outer', outer.toFixed(1), '| P occt', P.toFixed(3), 'vox', ((nS - cP) * u).toFixed(2), '| L occt', L.toFixed(3), 'vox', ((nS - cL) * u).toFixed(2), '| E vox', ((nS - cE) * u).toFixed(2));
}
writeFileSync(path.join(HERE, 'stub-reference-results.json'), JSON.stringify({ voxelStep: h, thickness: t, results: out }, null, 1) + '\n');
