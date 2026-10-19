// round 3: prism/wedge turn as the interpreter emits it (RotateFeature step) vs the doc a primitive-own rotate[3] would give. Both against live OCCT, SC via the guard translator.
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const ownRotate = (doc) => {
  const feats = []; let pending = null;
  for (const f of doc.features) {
    if (f.kind === 'rotate') { const t = feats.find((x) => x.id === f.target); t.rotate = f.angles; continue; }
    feats.push(structuredClone(f));
  }
  return { ...doc, features: feats };
};
const out = [];
for (const [kind, ctor] of [['prism', 'prism(6, 20, 12)'], ['wedge', 'wedge(20, 10, 8)']]) for (const a of [[30, 40, 50], [0, 90, 0], [10, 20, 300], [45, 45, 45]]) {
  const script = `const t = ${ctor};\nturn(t, [${a}]);`;
  const step = runCase({ script, translateFn: guard });
  const own = runCase({ script, translateFn: guard, mutate: ownRotate });
  const ids = [step.features.at(-1).id, own.features.at(-1).id];
  const o1 = Object.values(step.occt)[0]; const o2 = Object.values(own.occt)[0];
  const t1 = step.truck[ids[0]]; const t2 = own.truck[ids[1]];
  const d = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - y[i])));
  const row = { kind, angles: a, stepFeatures: step.features.map((f) => f.kind), ownFeatures: own.features.map((f) => f.kind + (f.rotate ? JSON.stringify(f.rotate) : '')), step: { v: verdict(step, ids[0]), dVol: t1.dVol, dBbox: t1.dBbox, dCom: t1.dCom, faces: [t1.faces, t1.occtFaces] }, own: t2.refused ? { refused: t2.refused } : { v: verdict(own, ids[1]), dVol: t2.dVol, dBbox: t2.dBbox, dCom: t2.dCom, faces: [t2.faces, t2.occtFaces] }, occtStepVsOwn: { dVol: Math.abs(o1.volume - o2.volume) / o1.volume, dBbox: d(o1.bbox, o2.bbox), dCom: d(o1.com, o2.com) }, ownOcctRefusals: own.occtRefusals, brepOwn: own.brep[ids[1]] };
  out.push(row); console.log(JSON.stringify({ k: kind, a, step: row.step.v, own: row.own.v ?? row.own.refused, occtDelta: row.occtStepVsOwn, brepOwn: row.brepOwn.refused ?? row.brepOwn.dVol }));
}
writeFileSync('r3-prismrot-results.json', JSON.stringify(out, null, 1));
