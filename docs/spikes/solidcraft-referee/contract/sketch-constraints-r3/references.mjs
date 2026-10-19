// driving:false reference dimensions. A reference adds no equation and its stored number is stale by design (brep-rs session.rs reference_values: "this is the number to show"),
// so the contract builds whatever the OTHER rows fix, on either side of the drawing, and reports the MEASURED value. Compared with: the same doc with the reference row deleted
// (volume + bbox), live brep-rs (build + diagnose().references), closed-form measured values, and (for the refusals) brep-rs's own refusal.
//   bun references.mjs [--out=out/references.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { refsOfScript } from './refs.mjs';
import { H, L, C, A, tj, loopJoins, len, rectG, rectShape, atOrigin, dX, dY, dist, soupScript, roughen, slotArea } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/references.json').slice(6);
const ref = (r) => ({ ...r, driving: false });
const rectG0 = rectG(0.3, 0.2, 28.4, 17.1), rectR = [...rectShape(), atOrigin(1), len(1, 30), len(2, 20)];
const rectN = rectG(-9.2, -5.1, 18.4, 13.1), rectNR = [...rectShape(), dX(-1, 'a', 1, 'a', -8), dY(-1, 'a', 1, 'a', -4), len(1, 30), len(2, 20)];
const tri = [L(1, [0.5, 0.4], [39, 1]), L(2, [39, 1], [25, 26.5]), L(3, [25, 26.5], [0.5, 0.4])], triR = [...loopJoins(3), { k: 'horizontal', a: 1 }, atOrigin(1), len(1, 40), len(2, 30), { k: 'angle', a: 1, b: 2, value: 120 }];
const plate = [...rectG(0.3, 0.2, 39, 25.6), C(5, [19, 13.5], 4.4)], plateR = [...rectShape(), atOrigin(1), len(1, 40), len(2, 25), { k: 'diameter', a: 5, value: 10 }, dX(1, 'a', 5, 'c', 20), dY(1, 'a', 5, 'c', 12.5)];
const slotG = [A(1, [0, 10], 10, [0, 0], [0, 20], 'cw'), A(2, [40, 10], 10, [40, 20], [40, 0], 'cw'), L(3, [0, 20], [40.2, 19.9]), L(4, [40, 0.1], [0, 0])];
const slotR = [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'), { k: 'radius', a: 1, value: 10 }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, 40), { k: 'lock', a: 1, aEnd: 'c' }];
const CASES = [
  // [id, geoms, rules, extra reference rows, expected measured values (same order), area, bbox, curved]
  ['reference diagonal, correct value', rectG0, rectR, [ref(dist(1, 'a', 3, 'a', Math.hypot(30, 20)))], [Math.hypot(30, 20)], 600, [0, 0, 30, 20]],
  ['reference diagonal, STALE value 99', rectG0, rectR, [ref(dist(1, 'a', 3, 'a', 99))], [Math.hypot(30, 20)], 600, [0, 0, 30, 20]],
  ['reference width 35 on a 30 wide rectangle (would conflict if driving)', rectG0, rectR, [ref(len(3, 35))], [30], 600, [0, 0, 30, 20]],
  ['reference distanceX +30, drawn side', rectG0, rectR, [ref(dX(1, 'a', 2, 'a', 30))], [30], 600, [0, 0, 30, 20]],
  ['reference distanceX -30, OPPOSITE of the drawn side (mapper refused this)', rectG0, rectR, [ref(dX(1, 'a', 2, 'a', -30))], [30], 600, [0, 0, 30, 20]],
  ['reference distanceY -20, OPPOSITE of the drawn side', rectG0, rectR, [ref(dY(1, 'a', 3, 'a', -20))], [20], 600, [0, 0, 30, 20]],
  ['reference distanceX 0 (mapper refused: "a reference offset of 0")', rectG0, rectR, [ref(dX(1, 'a', 4, 'a', 0))], [0], 600, [0, 0, 30, 20]],
  ['reference distanceX with the sketch drawn on the negative side, stored +8 (measured -8)', rectN, rectNR, [ref(dX(-1, 'a', 1, 'a', 8))], [-8], 600, [-8, -4, 22, 16]],
  ['reference angle, stale value 60 (measured 120)', tri, triR, [ref({ k: 'angle', a: 1, b: 2, value: 60 })], [120], 0.5 * 40 * 30 * Math.sin(Math.PI / 3), [0, 0, 40, 30 * Math.sin(Math.PI / 3)]],
  ['reference diameter on a hole, stale 7 (measured 10)', plate, plateR, [ref({ k: 'diameter', a: 5, value: 7 })], [10], 40 * 25 - Math.PI * 25, [0, 0, 40, 25], true],
  ['reference radius on a hole, stale 9 (measured 5)', plate, plateR, [ref({ k: 'radius', a: 5, value: 9 })], [5], 40 * 25 - Math.PI * 25, [0, 0, 40, 25], true],
  ['reference length of a slot side, stale 5 (measured 40)', slotG, slotR, [ref(len(3, 5))], [40], slotArea(40, 10), [-10, 0, 50, 20], true],
  ['two references, one right one stale', rectG0, rectR, [ref(len(3, 30)), ref(dist(1, 'a', 3, 'a', 10))], [30, Math.hypot(30, 20)], 600, [0, 0, 30, 20]],
];
const out = [];
const tally = { cases: 0, built: 0, builtRight: 0, measuredRight: 0, brepMeasuredMatches: 0, mapperRefusedBefore: 0 };
for (const [id, geoms, base, refs, wantMeasured, area, bbox, curved] of CASES) {
  const rules = [...base, ...refs];
  const g = ladderSketch({ geoms, rules });
  const ctl = ladderSketch({ geoms, rules: base });
  const u = lib.scSketch(geoms, rules); // the shipped mapper, the round-2 starting point
  const rec = { id, shippedMapper: u.mapperRefused ? 'refused: ' + u.mapperRefused.join(' | ') : u.firstRefusal ? 'refused: ' + u.firstRefusal.error : u.body ? 'built' : 'no body' };
  if (/^refused/.test(rec.shippedMapper)) tally.mapperRefusedBefore++;
  if (!g.ok) rec.guarded = { refused: g.sentence, stage: g.stage };
  else {
    tally.built++;
    const tol = curved ? 3e-4 : 1e-9, btol = curved ? 2e-3 : 1e-6;
    const vsCtl = ctl.ok ? { vol: lib.rel(g.body.volume, ctl.body.volume), bbox: Math.max(...g.body.bbox.map((v, i) => Math.abs(v - ctl.body.bbox[i]))) } : null;
    const right = lib.rel(g.body.volume, area * H) <= tol && Math.max(...[bbox[0], bbox[1], 0, bbox[2], bbox[3], H].map((w, i) => Math.abs(g.body.bbox[i] - w))) <= btol && vsCtl && vsCtl.vol <= 1e-12 && vsCtl.bbox <= 1e-9;
    if (right) tally.builtRight++;
    const mine = g.references.map((x) => x.measured);
    const mOk = wantMeasured.every((w, i) => mine[i] !== null && Math.abs(mine[i] - w) <= (curved ? 2e-3 : 1e-6) * Math.max(1, Math.abs(w)));
    if (mOk) tally.measuredRight++;
    const bs = lib.brepSolve(geoms, rules);
    const bRefs = bs.diag?.references ?? null;
    const bOk = bRefs && wantMeasured.every((w, i) => bRefs[i] && Math.abs(bRefs[i].value - w) <= 1e-6 * Math.max(1, Math.abs(w)));
    if (bOk) tally.brepMeasuredMatches++;
    const rb = refsOfScript(soupScript(geoms, rules));
    rec.guarded = { volume: g.body.volume, bbox: g.body.bbox, vsReferenceDeleted: vsCtl, builtRight: !!right, references: g.references, measuredMatchesClosedForm: mOk, brepReferences: bRefs, brepMatchesClosedForm: !!bOk, brepBuild: rb.brep?.volume !== undefined ? { volume: rb.brep.volume, vsGuarded: lib.rel(g.body.volume, rb.brep.volume) } : { refused: rb.brep?.refused ?? rb.error } };
  }
  tally.cases++;
  out.push(rec);
  console.log(id.padEnd(88), rec.guarded.refused ? 'REFUSED ' + rec.guarded.refused : `${rec.guarded.builtRight ? 'RIGHT' : 'WRONG'} measured ${JSON.stringify(rec.guarded.references.map((x) => +(+x.measured).toFixed(6)))} stale=${JSON.stringify(rec.guarded.references.map((x) => x.stale))} brep-rs refs ${JSON.stringify(rec.guarded.brepReferences?.map((x) => +x.value.toFixed(6)))} brep vs guarded vol ${rec.guarded.brepBuild.vsGuarded?.toExponential(1) ?? rec.guarded.brepBuild.refused}`, '| shipped mapper:', rec.shippedMapper.slice(0, 80));
}
// a reference on something that is not a dimension: refused, one sentence, brep-rs refuses it too
const bad = [];
for (const [name, row] of [['horizontal as a reference', { k: 'horizontal', a: 3, driving: false }], ['parallel as a reference', { k: 'parallel', a: 1, b: 3, driving: false }], ['lock as a reference', { k: 'lock', a: 1, aEnd: 'a', driving: false }], ['coincident as a reference', { k: 'coincident', a: 1, aEnd: 'a', b: 4, bEnd: 'b', driving: false }]]) {
  const rules = [...rectR, row];
  const g = ladderSketch({ geoms: rectG0, rules });
  const bs = lib.brepSolve(rectG0, rules);
  bad.push({ name, guarded: g.ok ? 'BUILT' : g.sentence, brepOpen: bs.open ?? bs.lastError ?? 'opened' });
  console.log('non-dimension reference:', name.padEnd(30), g.ok ? 'BUILT' : g.sentence, '| brep-rs:', String(bs.open ?? bs.lastError ?? 'opened').slice(0, 100));
}
// rough starts (3.5%) with a stale reference: builds the same solid as without it
const rough = { n: 30, built: 0, refused: 0, wrong: 0 };
for (let k = 0; k < rough.n; k++) {
  const st = roughen(rectG0, rectR, `ref-rough#${k}`, 0.035);
  const g = ladderSketch({ geoms: st, rules: [...rectR, ref(dist(1, 'a', 3, 'a', 99)), ref(dX(1, 'a', 2, 'a', -7))] });
  if (!g.ok) rough.refused++; else if (lib.rel(g.body.volume, 600 * H) <= 1e-9 && Math.max(...g.body.bbox.map((v, i) => Math.abs(v - [0, 0, 0, 30, 20, H][i]))) <= 1e-6) rough.built++; else rough.wrong++;
}
console.log('rough starts with two stale references', JSON.stringify(rough), 'TALLY', JSON.stringify(tally));
writeFileSync(OUTF, JSON.stringify({ tally, rough, bad, rows: out }, null, 1));
