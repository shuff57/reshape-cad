// Mechanism check for the family-C path-A wrong solid: a 40x30x10 box, its four bottom edges rounded R 1.5 either in ONE solid.fillet call
// or in four single-edge calls in the script's order (front, back, left, right), on the rc.2 kernel (and on any pkg given). Closed form for the
// doc's solid (only the four bottom edges rounded, mitred corners): 12000 - (1 - pi/4) R^2 (2*40 + 2*30) + corner terms; taken here from the
// fuzz oracle's S (fuzz/oracle.mjs, convex bfillet), which agrees with OCCT direct to 1e-7 (evidence/family-c.json).
//   node fillet-sequence-probe.mjs [pkg]
import { kernelRun, PKG } from './lib.mjs';
import { oracle } from '../fuzz/oracle.mjs';
const pkg = process.argv[2] || PKG; const R = 1.5;
const box = { command: 'solid.box', params: { length: 40, width: 30, height: 10, center: [0, 0, 5], body_name: 'b1' } };
const E = { front: [0, -15, 0], back: [0, 15, 0], left: [-20, 0, 0], right: [20, 0, 0] };
const one = [box, { command: 'solid.fillet', params: { edges: Object.values(E), radius: R, body: 'b1' } }];
const seq = [box, ...Object.values(E).map((p) => ({ command: 'solid.fillet', params: { edges: [p], radius: R, body: 'b1' } }))];
const S = oracle({ t: 1, mode: 'convex', convex: { W: 40, D: 30, H: 10, kind: 'bfillet', s: R }, holes: [], opens: [{ axis: 'z', dir: 1, coord: 10, rect: [-20, 20, -15, 15], minus: [] }] }).S;
const out = { pkg, S };
for (const [name, cmds] of [['one call', one], ['four calls', seq], ['three calls (front, back, left)', seq.slice(0, 4)], ['two calls (front, back)', seq.slice(0, 3)]]) {
  const r = kernelRun(cmds, { pkg, limitS: 120 }); const b = r.ok ? r.measure.bodies[0] : null;
  out[name] = b ? { volume: b.volume_mm3, faces: b.faces, face_types: b.face_types, bbox: b.bbox } : { error: r.failed?.error ?? r };
  console.log(name.padEnd(32), b ? `V=${b.volume_mm3.toFixed(4)} faces=${b.faces} ${JSON.stringify(b.face_types)}` : JSON.stringify(out[name]).slice(0, 200));
}
console.log('S (four bottom edges only) =', S.toFixed(4));
console.log('@@JSON@@' + JSON.stringify(out));
