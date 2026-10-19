// round 5: the three chains the wide fuzz (seed 5150, n 120) reported as GUARD FAIL. Per shape: shipped and guard against live OCCT, step by step, with the cause of each FAIL.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5-guardwrong.mjs
import { writeFileSync } from 'node:fs';
import { runCase, mt, runScript } from './runner.mjs';
import { verdict, TOL } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const NL = String.fromCharCode(10);
const S = {
  gw1: ['let a = cone(6, 12, { at: [12,-6,13] })', 'move(a, [-6,-39,-30])', 'turn(a, [180,135,60])', 'move(a, [35,39,5])', 'turn(a, [45,0,45])', 'turn(a, [90,60,30])', 'move(a, [-27,15,9])', 'turn(a, [60,135,90])'],
  gw2: ['let a = cone(12, 18, { at: [3,3,-7] })', 'turn(a, [0,135,45])', 'move(a, [-38,0,22])', 'move(a, [-14,22,24])', 'turn(a, [45,30,180])', 'move(a, [-24,-4,8])'],
  gw3: ['let a = cone(8, 15)', 'let c0 = move(a, [26,-17,20], { copy: true })', 'turn(c0, [135,60,45])', 'let c2 = move(c0, [-6,-25,4], { copy: true })', 'let c3 = move(c2, [3,-3,-17], { copy: true })', 'turn(c3, [30,180,15])', 'turn(c3, [135,-30,135])'],
};
const e = (v) => (typeof v === 'number' ? v.toExponential(2) : String(v));
const out = {};
for (const [k, L] of Object.entries(S)) {
  const script = L.join(NL);
  const r0 = runScript(script);
  const ids = mt.topLevel(r0.doc).map((x) => x.id).filter((id) => { const ft = r0.doc.features.find((x) => x.id === id); return ft.kind !== 'sketch' && ft.kind !== 'datum'; });
  const s = runCase({ script, ids }); const g = runCase({ script, ids, translateFn: guard });
  console.log('##', k, JSON.stringify(script));
  out[k] = { script, steps: [] };
  for (const id of ids) {
    const row = (r) => { const t = r.truck[id]; if (t.refused) return { v: 'REFUSED', why: t.refused }; return { v: verdict(r, id), vol: t.volume, occt: t.occtVolume, dVol: t.dVol, dCom: t.dCom, dBbox: t.dBbox, bboxAbsMax: Math.max(...t.bbox.map((x, i) => Math.abs(x - t.occtBbox[i]))), faceOk: t.faceOk }; };
    const a = row(s), b = row(g);
    out[k].steps.push({ id, shipped: a, guard: b, repaired: g.truckFeatures.find((x) => x.id === id)?.repaired });
    console.log(' ', id.padEnd(7), 'shipped', a.v, a.v === 'REFUSED' ? '' : `dVol=${e(a.dVol)} dCom=${e(a.dCom)} dBbox=${e(a.dBbox)} (abs ${e(a.bboxAbsMax)})`, '| guard', b.v, b.v === 'REFUSED' ? b.why : `dVol=${e(b.dVol)} dCom=${e(b.dCom)} dBbox=${e(b.dBbox)} (abs ${e(b.bboxAbsMax)}) comBar=${TOL.curved ? 3e-5 : ''}`);
  }
}
writeFileSync('r5-guardwrong-results.json', JSON.stringify(out, null, 1));
