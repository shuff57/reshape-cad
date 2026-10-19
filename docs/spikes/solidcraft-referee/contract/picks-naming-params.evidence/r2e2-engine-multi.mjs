// Round 2: does the ENGINE build two adjacent edges in one fillet/chamfer command? Compare with an independent numeric closed form
// (union of the two removal prisms; mitred corner) and live OCCT built with ONE BRepFilletAPI_MakeFillet over both edges.
import * as L from './lib.mjs';
const f = L.fromScript(`const b=box(40,30,20,{at:[5,-3,2]})\nround(b.edge('top','front'),2)`);
const row = await L.scored(f.doc);
console.log(JSON.stringify(row.commands));
const fil = row.commands.find((c) => c.command === 'solid.fillet'); console.log('fillet params', JSON.stringify(fil.params));
const run = (cmd, edges, r) => { const cs = JSON.parse(JSON.stringify(row.commands)); const c = cs.find((x) => x.command === cmd); c.params.edges = edges; if (c.params.radius !== undefined) c.params.radius = r; if (c.params.distance !== undefined) c.params.distance = r; const m = L.runSC(cs); return m.ok ? m.measure.bodies.at(-1).volume_mm3 : m.failed; };
const E1 = [5, -18, 12], E2 = [25, -3, 12], E3 = [5, 12, -8]; // top|front, top|right, (unused)
const w = 40, d = 30, h = 20;
// numeric union volume of the two removal zones (r): zone1 along x at the front-top edge, zone2 along y at the right-top edge
const zone = (r, a, b) => (a < r && b < r && (a - r) ** 2 + (b - r) ** 2 > r * r); // a,b inward distances from the two faces
const num = (r, n = 700) => { // integrate over x in [0,w], y in [0,d], z depth in [0,h] but only the corner column matters: do exact for the rest
  let both = 0; const hh = r / n; // overlap/union only inside the corner column x in [w-r,w], y in [0,r], depth [0,r]
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) { const xr = (i + 0.5) * hh; /* inward from right face */ const yf = (j + 0.5) * hh; /* inward from front */ const dz = (k + 0.5) * hh; if (zone(r, dz, yf) && zone(r, dz, xr)) both++; }
  const A = (1 - Math.PI / 4) * r * r; return { A, overlap: both * hh ** 3 };
};
const r = 2; const { A, overlap } = num(r, 400);
const base = w * d * h; const cfUnion = base - (A * w + A * d - overlap);
console.log('numeric union closed form r=2:', cfUnion.toFixed(4), '(overlap', overlap.toFixed(5), ')');
console.log('engine one fillet cmd, 2 edges r=2   :', run('solid.fillet', [E1, E2], 2));
console.log('engine sequential-equivalent single  :', run('solid.fillet', [E1], 2));
const A2 = (r * r) / 2;
console.log('engine one chamfer cmd? -> reuse fillet row for bevel:');
const f2 = L.fromScript(`const b=box(40,30,20,{at:[5,-3,2]})\nbevel(b.edge('top','front'),2)`); const row2 = await L.scored(f2.doc);
const cs2 = JSON.parse(JSON.stringify(row2.commands)); const ch = cs2.find((x) => x.command === 'solid.chamfer'); console.log('chamfer params', JSON.stringify(ch.params));
ch.params.edges = [E1, E2]; const m2 = L.runSC(cs2); console.log('engine one chamfer cmd, 2 edges d=2 :', m2.ok ? m2.measure.bodies.at(-1).volume_mm3 : JSON.stringify(m2.failed));
// bevel closed form: two triangular prisms, overlap = corner tetra-ish region: exact via numeric
let ov = 0; const n = 400, hh = 2 / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) { const x = (i + 0.5) * hh, y = (j + 0.5) * hh, z = (k + 0.5) * hh; if (z + y < 2 && z + x < 2) ov++; }
console.log('bevel union closed form d=2:', (base - (2 * w + 2 * d - ov * hh ** 3)).toFixed(4), '(overlap', (ov * hh ** 3).toFixed(5), ')');
// OCCT: one MakeFillet with both edges
import { REPO } from './lib.mjs';
