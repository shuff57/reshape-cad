#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group). The raw solidcraft probes that the extrude-pocket.json evidence quotes (no translator, no oracle:
// just what solid.extrude / solid.loft do with their parameters at the pinned commit fe3717f).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-probes.mjs   (output kept in extrude-pocket-probes.txt)
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const run = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { error: `TRAP ${e.message}` } }; } };
const sketch = (name, origin, shapes) => [{ command: 'sketch.create', params: { name, plane: { origin, x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, ...shapes, { command: 'sketch.finish', params: {} }];
const rect = (x0, y0, x1, y1) => ({ command: 'sketch.line', params: { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true } });
const circ = (cx, cy, r) => ({ command: 'sketch.circle.center', params: { center: [cx, cy], radius: r } });
const vol = (r) => (r.ok ? r.measure.bodies.map((b) => `${b.volume_mm3.toFixed(6)} bbox ${JSON.stringify(b.bbox.min.map((v) => +v.toFixed(4)))}..${JSON.stringify(b.bbox.max.map((v) => +v.toFixed(4)))}`).join(' + ') : `REFUSED ${JSON.stringify(r.failed)}`);
console.log('--- 1. solid.extrude parameters on a 20 x 10 rectangle at z=0 (what each parameter means at fe3717f)');
for (const [lab, ex] of [['distance 5', { distance: 5 }], ['distance -5', { distance: -5 }], ['distance 5 direction negative', { distance: 5, direction: 'negative' }],
  ['distance 5 direction symmetric (per side! total span 10)', { distance: 5, direction: 'symmetric' }], ['distance 5 distance2 3', { distance: 5, distance2: 3 }],
  ['distance 5 distance2 3 direction negative (direction ignored)', { distance: 5, distance2: 3, direction: 'negative' }], ['taper +10', { distance: 5, taper: 10 }], ['taper -10', { distance: 5, taper: -10 }],
  ['direction [1,0,1] (an ARRAY: silently read as positive, plain prism, 1000)', { distance: 5, direction: [1, 0, 1] }], ['through_all with nothing to cut', { through_all: true }], ['distance 0', { distance: 0 }]]) {
  console.log(lab.padEnd(70), vol(run([...sketch('s', [0, 0, 0], [rect(0, 0, 20, 10)]), { command: 'solid.extrude', params: { sketch: 's', operation: 'new', body_name: 'B', ...ex } }])));
}
console.log('--- 2. all-profiles default fills a hole: rect 40 x 30 with a circle r5 inside, distance 15');
const nested = sketch('s', [0, 0, 0], [rect(0, 0, 40, 30), circ(20, 15, 5)]);
console.log('profiles omitted (all)'.padEnd(70), vol(run([...nested, { command: 'solid.extrude', params: { sketch: 's', distance: 15, operation: 'new', body_name: 'B' } }])), ' <- hole filled; closed form 18000 - 25*pi*15 = ', (18000 - 25 * Math.PI * 15).toFixed(4));
console.log('profiles [{point:[5,5]}] (the plate region only)'.padEnd(70), vol(run([...nested, { command: 'solid.extrude', params: { sketch: 's', distance: 15, operation: 'new', body_name: 'B', profiles: [{ point: [5, 5] }] } }])));
console.log('--- 3. annulus R20 / r10, distance 10, taper 5 on the ring region only');
const ring = sketch('s', [0, 0, 0], [circ(0, 0, 20), circ(0, 0, 10)]);
const tn = Math.tan(5 * Math.PI / 180); const A = (d) => Math.PI * ((20 + d) ** 2 - (10 - d) ** 2);
console.log('taper 5 (ring pick)'.padEnd(70), vol(run([...ring, { command: 'solid.extrude', params: { sketch: 's', distance: 10, taper: 5, operation: 'new', body_name: 'B', profiles: [{ point: [15, 0] }] } }])), ' closed form material-grows (hole shrinks):', (10 / 6 * (A(0) + 4 * A(5 * tn) + A(10 * tn))).toFixed(4));
console.log('--- 4. crossing rectangles: all profiles (union) versus the even-odd faces (XOR), distance 15');
const cross = sketch('s', [0, 0, 0], [rect(-20, -10, 10, 10), rect(-10, -20, 20, 0)]);
console.log('all profiles'.padEnd(70), vol(run([...cross, { command: 'solid.extrude', params: { sketch: 's', distance: 15, operation: 'new', body_name: 'B' } }])), ' (union 15000)');
console.log('picks in the A-only and B-only faces'.padEnd(70), vol(run([...cross, { command: 'solid.extrude', params: { sketch: 's', distance: 15, operation: 'new', body_name: 'B', profiles: [{ point: [-15, 5] }, { point: [15, -15] }] } }])), ' (XOR 12000)');
console.log('--- 5. solid.loft of two copies of an outline S apart = the slanted pull (S = (5,3,6))');
for (const [lab, shape, exact] of [['rect 20 x 10', rect(0, 0, 20, 10), 200 * 6], ['circle r4', circ(10, 5, 4), Math.PI * 16 * 6]]) {
  console.log(lab.padEnd(70), vol(run([...sketch('a', [0, 0, 0], [shape]), ...sketch('b', [5, 3, 6], [shape]), { command: 'solid.loft', params: { sections: [{ sketch: 'a' }, { sketch: 'b' }], operation: 'new', body_name: 'L' } }])), ' exact', exact.toFixed(4));
}

// ---- round 2 -------------------------------------------------------------------------------------------------------------------------------------
console.log('--- 6. raw truck taper on the fold cases (no mapping): what a mapping WITHOUT the fold guard would have built (rect 20 x 12, h 10)');
for (const t of [-30, -31.5, -35, -45, -55, -60, -70, -80, -89]) {
  const r = run([...sketch('s', [0, 0, 0], [rect(0, 0, 20, 12)]), { command: 'solid.extrude', params: { sketch: 's', distance: 10, taper: t, operation: 'new', body_name: 'B' } }]);
  console.log(`taper ${t}`.padEnd(70), vol(r));
}
console.log('--- 7. the direction-based forms are wrong at the pinned commit (the mapping never uses them): extent along z of a 20 x 10 rectangle at z=0');
for (const [lab, ex] of [['distance 10 direction symmetric (a student asking for a 10 mm midplane pad gets 20)', { distance: 10, direction: 'symmetric' }],
  ['distance 10 distance2 4 direction negative (direction IGNORED: extent is [-4,10], not [-10,4])', { distance: 10, distance2: 4, direction: 'negative' }],
  ['distance 10 distance2 4 (the form the mapping uses: [-4,10])', { distance: 10, distance2: 4 }]]) {
  console.log(lab.padEnd(100), vol(run([...sketch('s', [0, 0, 0], [rect(0, 0, 20, 10)]), { command: 'solid.extrude', params: { sketch: 's', operation: 'new', body_name: 'B', ...ex } }])));
}
console.log('--- 8. raw truck messages at degenerate scale (what the mapping turns into one plain sentence)');
for (const d of [1e-9, 1e-7, 2e-7, 5e-7, 1e-6, 1e-5]) console.log(`pull 10 x 10 by ${d}`.padEnd(70), vol(run([...sketch('s', [0, 0, 0], [rect(0, 0, 10, 10)]), { command: 'solid.extrude', params: { sketch: 's', distance: d, operation: 'new', body_name: 'B' } }])));
for (const w of [1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) console.log(`pull a ${w} x ${w} square by 1`.padEnd(70), vol(run([...sketch('s', [0, 0, 0], [rect(0, 0, w, w)]), { command: 'solid.extrude', params: { sketch: 's', distance: 1, operation: 'new', body_name: 'B' } }])));
console.log('--- 9. a wall or sliver thinner than ~0.3% of the part is LOST by a boolean (plate 40 x 30 x 10, pocket 20-w wide leaving a wall w, 5 deep)');
const plateCmds = [...sketch('p', [0, 0, 0], [rect(0, 0, 40, 30)]), { command: 'solid.extrude', params: { sketch: 'p', distance: 10, operation: 'new', body_name: 'plate' } }];
for (const w of [0.01, 0.1, 0.12, 0.15, 0.3, 1]) {
  const r = run([...plateCmds, ...sketch('q', [0, 0, 10], [rect(w, 5, 20, 25)]), { command: 'solid.extrude', params: { sketch: 'q', distance: 5, direction: 'negative', operation: 'cut', targets: ['plate'] } }]);
  console.log(`wall w=${w}`.padEnd(70), vol(r), ' expected', (12000 - (20 - w) * 100).toFixed(4));
}
