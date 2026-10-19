// SPIKE, referee only. Round 4 raw-engine probe (no translator in the loop): what solid.draft does to a HOLLOWED part when it is asked for a
// whole-shape draft (outer side faces, pull z). The guarded translator refuses this (G-WHOLE-HOLLOW) because the engine's answer is not a solid.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/shell-draft-r2-probe.mjs > shell-draft-r2-probe.txt
import * as B from './holes-base.mjs';
import * as P from './shell-draft-polytope.mjs';
const { runSC, rel } = B;
const SIGMA = -1;
const meas = (r) => (r.ok ? r.measure.bodies.map((b) => ({ vol: b.volume_mm3, faces: b.faces })) : r.failed);
const box = { command: 'solid.box', params: { length: 40, width: 30, height: 20, center: [0, 0, 0], body_name: 'B' } };
const shell = (t) => ({ command: 'solid.shell', params: { faces: [[0, 0, 10]], thickness: t, body: 'B' } });
const sides = [[20, 0, 0], [-20, 0, 0], [0, 15, 0], [0, -15, 0]];
const pl = P.boxPlanes([-20, -15, -10], [20, 15, 10]);
console.log('whole-shape draft (4 outer side faces, one solid.draft call) of a box hollowed open:top, 40x30x20, pull z');
for (const t of [2, 3]) for (const nu of [-10, 0, 10]) for (const a of [1, 2, 3, 5, 10, -3, -10]) {
  const r = meas(runSC([box, shell(t), { command: 'solid.draft', params: { faces: sides, angle: a, neutral: { origin: [0, 0, nu], normal: [0, 0, 1] }, pull: [0, 0, 1], body: 'B' } }]));
  // reference for "outer drafted, cavity unchanged and clipped by the tilted planes"
  const dr = pl.map((p) => (Math.abs(p.n[2]) > 1e-9 ? p : P.draftPlane(p, 'z', nu, a, SIGMA)));
  const outer = P.measure(dr);
  const top = 4; const cav = pl.map((p, i) => (i === top ? p : { n: p.n, d: p.d - t })); for (let i = 0; i < 4; i++) cav.push(dr[i]);
  const cm = P.measure(cav); const ref = outer.volume - cm.volume;
  const v = Array.isArray(r) ? r[0] : r;
  const bad = v.vol === undefined || Math.abs(v.vol - ref) > 1e-6 * Math.abs(ref);
  console.log(`wall ${t} neutral ${nu} angle ${a}: engine ${v.vol !== undefined ? v.vol.toFixed(4) + ' (' + v.faces + ' faces)' : JSON.stringify(v).slice(0, 120)}   outer-drafted-minus-clipped-cavity ${ref.toFixed(4)}   hollow before draft ${P.hollow(pl, 4, t).volume.toFixed(4)}${bad ? '   <-- ENGINE DISAGREES' : ''}`);
}

// "Body draft" of a hollow part in the sense of model-types.ts DraftFeature.whole (every face except the two the pull points at) includes the CAVITY walls.
// One solid.draft call with the four outer AND the four inner side faces:
const inner = [[18, 0, 0], [-18, 0, 0], [0, 13, 0], [0, -13, 0]];
console.log('whole-shape draft with the cavity walls too (4 outer + 4 inner side faces), wall 2, open:top, 40x30x20, neutral -10 / 0 / 10');
for (const nu of [-10, 0, 10]) for (const a of [1, 3, 5, 10, -3, -10]) {
  const r = meas(runSC([box, shell(2), { command: 'solid.draft', params: { faces: [...sides, ...inner], angle: a, neutral: { origin: [0, 0, nu], normal: [0, 0, 1] }, pull: [0, 0, 1], body: 'B' } }]));
  const v = Array.isArray(r) ? r[0] : r;
  console.log(`neutral ${nu} angle ${a}: engine ${v.vol !== undefined ? v.vol.toFixed(4) + ' (' + v.faces + ' faces)' : JSON.stringify(v).slice(0, 120)}${v.vol < 0 ? '   <-- NEGATIVE VOLUME, ok:true' : ''}`);
}
