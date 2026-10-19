// round 5: mirror after a turn. The critic: box turned [0,0,30] then mirrored is refused by the engine ("lumps: shell boundaries intersect or touch; cavity ownership is
// ambiguous") while OCCT and brep-rs build it; the student sees only "Mirror 1 could not be built by this engine". Find what the refused cases have in common (the part
// touches the mirror plane along an edge, a line or a point instead of a face?) so the sentence can say why.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5-mirror.mjs
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const NL = String.fromCharCode(10);
const C = [
  // [label, contact the part makes with the mirror plane (analytic), script lines]
  ['box, no turn (control)', 'face', ['const a = box(30, 20, 10);', "mirror(a, 'front-back');"]],
  ['box turned z 90', 'face', ['const a = box(30, 20, 10);', 'turn(a, [0, 0, 90]);', "mirror(a, 'front-back');"]],
  ['box turned z 180', 'face', ['const a = box(30, 20, 10);', 'turn(a, [0, 0, 180]);', "mirror(a, 'front-back');"]],
  ['box turned z 30', 'edge', ['const a = box(30, 20, 10);', 'turn(a, [0, 0, 30]);', "mirror(a, 'front-back');"]],
  ['box turned z 45', 'edge', ['const a = box(30, 20, 10);', 'turn(a, [0, 0, 45]);', "mirror(a, 'front-back');"]],
  ['box turned z 30, left-right', 'edge', ['const a = box(30, 20, 10);', 'turn(a, [0, 0, 30]);', "mirror(a, 'left-right');"]],
  ['box turned x 30', 'edge', ['const a = box(30, 20, 10);', 'turn(a, [30, 0, 0]);', "mirror(a, 'front-back');"]],
  ['box turned [30,40,50]', 'point or edge', ['const a = box(30, 20, 10);', 'turn(a, [30, 40, 50]);', "mirror(a, 'front-back');"]],
  ['cylinder, no turn (control)', 'face', ['const a = cylinder(10, 20);', "mirror(a, 'front-back');"]],
  ['cylinder turned x 90 (axis lies in the plane side)', 'line', ['const a = cylinder(10, 20);', 'turn(a, [90, 0, 0]);', "mirror(a, 'front-back');"]],
  ['cylinder turned x 30', 'point or edge', ['const a = cylinder(10, 20);', 'turn(a, [30, 0, 0]);', "mirror(a, 'front-back');"]],
  ['prism(6) turned z 20', 'edge', ['const a = prism(6, 12, 10);', 'turn(a, [0, 0, 20]);', "mirror(a, 'front-back');"]],
  ['wedge turned z 30', 'edge', ['const a = wedge(20, 10, 8);', 'turn(a, [0, 0, 30]);', "mirror(a, 'front-back');"]],

  ['mirror then turn (control)', 'n/a', ['const a = box(30, 20, 10);', "const m = mirror(a, 'front-back');", 'turn(m, [0, 0, 30]);']],
  ['move then mirror (control)', 'face', ['const a = box(30, 20, 10);', 'move(a, [0, 5, 0]);', "mirror(a, 'front-back');"]],
];
const out = [];
for (const [label, contact, L] of C) {
  const script = L.join(NL);
  const s = runCase({ script }); const g = runCase({ script, translateFn: guard });
  const id = s.features.at(-1).id; const t = s.truck[id];
  const rec = { label, contact, script, shipped: verdict(s, id), shippedWhy: t.refused ? t.refused.replace(/\s+/g, ' ').slice(0, 170) : null, guard: verdict(g, id), guardSentence: g.truck[id].refused ?? null, dVol: t.dVol, dCom: t.dCom, occtVol: s.occt[id]?.volume, brep: s.brep[id]?.refused ?? s.brep[id]?.dVol };
  out.push(rec);
  console.log(label.padEnd(52), contact.padEnd(14), 'shipped', rec.shipped.padEnd(8), rec.shippedWhy ? '| engine: ' + rec.shippedWhy.slice(-90) : `dVol=${t.dVol.toExponential(1)} dCom=${t.dCom.toExponential(1)}`, '| guard', rec.guard, '| brep', typeof rec.brep === 'number' ? rec.brep.toExponential(1) : rec.brep);
}
writeFileSync('r5-mirror-results.json', JSON.stringify(out, null, 1));
