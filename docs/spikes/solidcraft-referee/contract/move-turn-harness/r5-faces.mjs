// round 5: explain the face-count deltas (truck 1-2 faces fewer than OCCT) that the critic saw on through-holes (deep:60) in prisms and cylinders.
// For each script: OCCT / brep-rs / truck face counts per surface type, the faceVerdict explanation, and the same hole with NO move/turn (is the delta inherited from the hole alone?).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5-faces.mjs
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
const S = {
  'prism8 through-hole at [-1,3], then move (fz7-1)': `let a = prism(8, 10, 14, { at: [-6, -7, 0] })\nhole(a, { across: 4, deep: 60, at: [-1, 3] })\nmove(a, [-20, 34, 4])`,
  'prism8 through-hole at [-1,3], NO move (control)': `let a = prism(8, 10, 14, { at: [-6, -7, 0] })\nhole(a, { across: 4, deep: 60, at: [-1, 3] })`,
  'prism8 through-hole centred, NO move (control)': `let a = prism(8, 10, 14)\nhole(a, { across: 4, deep: 60 })`,
  'prism8 blind hole default depth, NO move (control)': `let a = prism(8, 10, 14)\nhole(a, { across: 4 })`,
  'cylinder through-hole at [-3,0], then move (fz7-8)': `let a = cylinder(7, 24, { at: [-10, -15, 9] })\nhole(a, { across: 3, deep: 60, at: [-3, 0] })\nmove(a, [-8, 6, 14])`,
  'cylinder through-hole at [-3,0], NO move (control)': `let a = cylinder(7, 24, { at: [-10, -15, 9] })\nhole(a, { across: 3, deep: 60, at: [-3, 0] })`,
  'prism3 through-hole at [1,1], move, copy (fz7-17)': `let a = prism(3, 16, 11, { at: [16, 13, -4] })\nhole(a, { across: 5, deep: 60, at: [1, 1] })\nmove(a, [-37, -29, 17])\nlet c0 = move(a, [-1, 32, 3], { copy: true })`,
  'prism3 through-hole at [1,1], NO move (control)': `let a = prism(3, 16, 11, { at: [16, 13, -4] })\nhole(a, { across: 5, deep: 60, at: [1, 1] })`,
  'cylinder + box join after through-hole (fz7-14)': `let a = cylinder(4, 18, { at: [5, -1, 9] })\nlet b = box(18, 9, 18, { at: [15, -1, -4] })\nhole(a, { across: 3, deep: 60, at: [0, 1] })\nmove(b, [5, 1, 20])\njoin(a, b)`,
  'cylinder + box join, hole omitted (control)': `let a = cylinder(4, 18, { at: [5, -1, 9] })\nlet b = box(18, 9, 18, { at: [15, -1, -4] })\nmove(b, [5, 1, 20])\njoin(a, b)`,
};
const out = {};
for (const [name, script] of Object.entries(S)) {
  const r = runCase({ script });
  const ids = Object.keys(r.truck);
  for (const id of ids.slice(-1)) {
    const t = r.truck[id]; const o = r.occt[id]; const b = r.brep[id];
    const rec = t.refused ? { refused: t.refused } : { truckFaces: t.faces, occtFaces: t.occtFaces, brepFaces: b?.faces, truckTypes: t.faceTypes, occtTypes: t.occtTypes, faceKeys: t.faceKeys, faceOk: t.faceOk, verdict: verdict(r, id), dVol: t.dVol, dCom: t.dCom };
    out[name] = rec; console.log(name.padEnd(54), JSON.stringify(rec));
  }
}
writeFileSync('r5-faces-results.json', JSON.stringify(out, null, 1));
