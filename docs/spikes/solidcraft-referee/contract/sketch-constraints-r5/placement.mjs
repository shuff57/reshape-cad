// Constrained sketches on an OFFSET plane or a LITERAL FRAME (critic, round 3: round 2's guarded route rebuilt the sketch from `plane` alone and built every one at offset 0).
//   Shapes: dimensioned rectangle (planar), slot with tangent joints (curved), plate with a hole (two profiles).  Planes: xy/xz/yz with several offsets; four literal frames.
//   Oracles: live brep-rs (script -> solveDoc -> build), live OCCT (same doc), closed form (area x height, and bbox mapped through the frame).
//   Controls: the round-2 route (_dropFrame: placement dropped on the way to the mapper) with the placement check ON (must refuse) and OFF (must build at the wrong place).
//   bun placement.mjs [--out=out/placement.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { refsOfScript } from './refs.mjs';
import { CASES, H, fmt, roughen, plainRules } from './cases.mjs';
import { ladderSketch, placementOf } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/placement.json').slice(6);
const rowsTxt = (rs) => rs.map((r) => `  { ${Object.entries(r).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')} }`).join(',\n');
const scriptAt = (head, geoms, rules) => `const sk = ${head}\nsk.geom([\n${rowsTxt(geoms)}\n])\nsk.rules([\n${rowsTxt(rules)}\n])\nconst part = extrude(sk, ${H})`;
const WORD = { xy: 'top', xz: 'front', yz: 'side' };
const FRAMES = [
  { name: 'axis-aligned, origin (3,4,5)', frame: { origin: [3, 4, 5], u: [1, 0, 0], v: [0, 1, 0] } },
  { name: 'turned 36.87 deg about z, origin (3,4,5)', frame: { origin: [3, 4, 5], u: [0.8, 0.6, 0], v: [-0.6, 0.8, 0] } },
  { name: 'tilted: u=x, v=(0,0.6,0.8), origin (-2,1,6)', frame: { origin: [-2, 1, 6], u: [1, 0, 0], v: [0, 0.6, 0.8] } },
  { name: 'swapped axes (u=y, v=x, normal -z), origin (0,0,9)', frame: { origin: [0, 0, 9], u: [0, 1, 0], v: [1, 0, 0] } },
];
const SHAPES = ['rect-origin-dims', 'slot-hand-rows-R10-L40', 'plate-with-hole-default-profiles'].map((id) => CASES.find((c) => c.id === id));
const out = [];
const tally = { cases: 0, guardedRight: 0, guardedRefused: 0, guardedWrong: 0, dropRefused: 0, dropBuiltWrongPlace: 0, dropBuiltRightPlace: 0, noCheckBuiltWrongPlace: 0 };
const bboxMax = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
function run(cs, place, start, label, mode) {
  const head = place.frame ? `sketch({ origin: [${place.frame.origin}], u: [${place.frame.u}], v: [${place.frame.v}] })` : `sketch('${WORD[place.plane]}'${place.offset ? ', ' + place.offset : ''})`;
  const rules = plainRules(cs.rules);
  const ref = refsOfScript(scriptAt(head, start, rules));
  const sk = { geoms: start, rules, ...(place.frame ? { frame: place.frame } : { plane: place.plane, offset: place.offset }) };
  const tol = cs.curved ? 3e-4 : 1e-9, btol = cs.curved ? 2e-3 : 1e-6;
  const g = ladderSketch(sk);
  const rec = { shape: cs.id, mode, place: label, curved: !!cs.curved, brep: ref.brep ?? { error: ref.error ?? ref.scriptError }, occt: ref.occt };
  const want = cs.area * H;
  if (!g.ok) { rec.guarded = { refused: g.sentence, stage: g.stage }; tally.guardedRefused++; }
  else {
    const vsBrep = ref.brep?.bbox ? { vol: lib.rel(g.body.volume, ref.brep.volume), bbox: bboxMax(g.body.bbox, ref.brep.bbox) } : null;
    const vsOcct = ref.occt?.bbox ? { vol: lib.rel(g.body.volume, ref.occt.volume), bbox: bboxMax(g.body.bbox, ref.occt.bbox) } : null;
    const vsClosed = lib.rel(g.body.volume, want);
    const ok = vsClosed <= tol && (!vsBrep || vsBrep.bbox <= btol) && (!vsOcct || vsOcct.bbox <= btol) && (!!vsBrep || !!vsOcct);
    rec.guarded = { volume: g.body.volume, bbox: g.body.bbox, vsClosedVol: vsClosed, vsBrep, vsOcct, faces: g.body.faces, brepFaces: ref.brep?.faces, ok };
    if (ok) tally.guardedRight++; else tally.guardedWrong++;
  }
  // controls: the round-2 route (placement lost on the way to the mapper)
  const refBox = ref.brep?.bbox ?? ref.occt?.bbox;
  const d1 = ladderSketch(sk, { _dropFrame: true });
  const d2 = ladderSketch(sk, { _dropFrame: true, noPlacement: true });
  rec.round2Route = d2.ok ? { bbox: d2.body.bbox, atRightPlace: refBox ? bboxMax(d2.body.bbox, refBox) <= btol : null } : { refused: d2.sentence };
  rec.round2RouteWithPlacementCheck = d1.ok ? { builtAnyway: true, bbox: d1.body.bbox } : { refused: d1.sentence, stage: d1.stage };
  const isPlaced = place.frame || place.offset;
  if (isPlaced) {
    if (!d1.ok) tally.dropRefused++;
    if (d2.ok && !rec.round2Route.atRightPlace) tally.noCheckBuiltWrongPlace++;
    if (d1.ok) { if (refBox && bboxMax(d1.body.bbox, refBox) <= btol) tally.dropBuiltRightPlace++; else tally.dropBuiltWrongPlace++; }
  }
  tally.cases++;
  out.push(rec);
  return rec;
}
for (const cs of SHAPES) {
  const places = [];
  for (const plane of ['xy', 'xz', 'yz']) for (const offset of [0, 7, -5, 3, 12.5]) places.push({ plane, offset, label: `${plane} offset ${offset}` });
  for (const f of FRAMES) places.push({ frame: f.frame, label: `frame ${f.name}` });
  for (const pl of places) {
    for (const mode of ['stored', 'rough']) {
      if (mode === 'rough' && cs.id !== 'rect-origin-dims' && !(cs.id === 'slot-hand-rows-R10-L40' && (pl.offset === 7 || pl.frame))) continue;
      const start = mode === 'rough' ? roughen(cs.geoms, cs.rules, `${cs.id}#place#${pl.label}`, 0.035) : cs.geoms;
      const r = run(cs, pl, start, pl.label, mode);
      console.log(cs.id.padEnd(36), mode.padEnd(6), pl.label.padEnd(54), r.guarded.refused ? 'REFUSED[' + r.guarded.stage + '] ' + r.guarded.refused.slice(0, 90) : `${r.guarded.ok ? 'RIGHT' : 'WRONG'} bbox ${r.guarded.bbox.map((v) => +v.toFixed(3))} vs brep-rs ${r.guarded.vsBrep ? r.guarded.vsBrep.bbox.toExponential(1) : 'n/a'} OCCT ${r.guarded.vsOcct ? r.guarded.vsOcct.bbox.toExponential(1) : 'n/a'}`, '| r2 route:', r.round2Route.refused ? 'refused' : (r.round2Route.atRightPlace ? 'right place' : 'WRONG PLACE'), '| r2 route + check:', r.round2RouteWithPlacementCheck.refused ? 'refused[' + r.round2RouteWithPlacementCheck.stage + ']' : 'built');
    }
  }
}
// bad placements must be refused in one sentence
const bad = [];
for (const [name, sk] of [['unknown plane word', { plane: 'top' }], ['offset not a number', { plane: 'xy', offset: 'high' }], ['offset NaN', { plane: 'xy', offset: NaN }], ['frame with a 2-vector', { frame: { origin: [0, 0], u: [1, 0, 0], v: [0, 1, 0] } }], ['frame axes not unit', { frame: { origin: [0, 0, 0], u: [2, 0, 0], v: [0, 1, 0] } }], ['frame axes not at right angles', { frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0.6, 0.8, 0.1] } }]]) {
  const cs = SHAPES[0];
  const g = ladderSketch({ geoms: cs.geoms, rules: plainRules(cs.rules), ...sk });
  bad.push({ name, built: g.ok, sentence: g.sentence ?? null, stage: g.stage ?? null });
  console.log('bad placement:', name.padEnd(34), g.ok ? 'BUILT' : g.sentence);
}
console.log('TALLY', JSON.stringify(tally));
writeFileSync(OUTF, JSON.stringify({ tally, bad, rows: out }, null, 1));
