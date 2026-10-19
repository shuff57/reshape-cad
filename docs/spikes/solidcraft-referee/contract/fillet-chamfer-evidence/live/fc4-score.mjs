// SPIKE, referee only. ROUND 4 scorer: re-reads fc4-results-*.json (live runs of fc4-run.mjs) and classifies every case on each path against the independent truth, in one place,
// so the classification does not depend on which version of the runner produced the record.
//   truth, in order:  closed form of the case (exact geometry)  >  OCCT simultaneous  >  OCCT sequential (a refused blend is NOT a result)  >  brep-rs
//   path outcome   :  built-match | built-WRONG (truck built, truth built, they differ) | built-oracle-refused (truck built, every oracle refused, no closed form) |
//                     refused (at least one blend feature refused: the part is shown without it) | partial
//   bars           :  planar 1e-9 relative (truck planar solids are exact), curved 3e-4 (tessellation), face count equal; bbox 1e-3 of the diagonal
//   bun live/fc4-score.mjs ../fc4-results-a.json [more.json ...] [--table] [--json=out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const bboxDelta = (a, b) => { if (!a || !b) return null; const diag = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) || 1; return Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / diag; };

/** face-count differences that are NOT blend errors (volume agrees to the bar), each explained once; everything else that differs is built-WRONG */
export const EXPLAINED = {
  'rg-bo-union-unambiguous-round': 'the JOIN itself differs between kernels (truck 9 faces, OCCT 14: truck merges the coplanar faces of the union before any blend; brep-rs agrees with truck, round 3 row 38); volume agrees to 7.5e-7',
  'rg-bo-union-unambiguous-bevel': 'same join difference (9 faces against 14), volume exact',
  'rg-r3-hpref-y12': 'hole tangent to the filleted front face: the kernels split the hole wall differently (8 faces against 10 or 11), volume agrees to 6.7e-7 (round 3 rows 54 and 55 explain the tangent hole)',
  'rg-r3-hpref-y12b': 'same tangent hole (8 faces against 10 or 11), volume agrees to 4.1e-7',
};
/** cases where every oracle refuses or none applies but an exact number is available (each one derived in the comment) */
export const OVERRIDES = {
  // size EXACTLY half the thinnest side / half the height: OCCT and brep-rs refuse, the closed forms are the round 3 ones (rows 4 and 19): Minkowski sum of the 40x30x20 box with a ball of radius 10 (10 faces), Pappus for cylinder(30,20) round 10 and for its chamfer 10
  'a5-box-whole-10': { volume: 17613.5682, faces: 10 },
  'a5-cyl-whole-10': { volume: 10694.3887, faces: 3 },
  'a5-cyl-doc-chamfer-10': { volume: 6806.7841, faces: 4 },
  // rim r1 of the 20x10x4 pocket in a 60x40x12 plate (OCCT simultaneous 27986.7404, a4-rect20x10-rim-round-1) minus the r2 fillet prism along the 60 long top/front edge: (1 - pi/4) 2^2 60
  'rg-p-rim-then-plate-edge': { volume: 27986.74040 - (1 - Math.PI / 4) * 4 * 60, faces: 16 },
  // plate 40x30x10 minus the 10x6x4 pocket (11760) minus the r2 fillet prism along the 40 long top/front edge, (1 - pi/4) 2^2 40; the pocket sits exactly 2 mm from the edge (the blend ends on the pocket wall: OCCT refuses, the closed form agrees with the kernel)
  'rg-r3-pk-fillet-r2': { volume: 11760 - (1 - Math.PI / 4) * 4 * 40, faces: 12 },
};
export function truthOf(rec, cf) {
  if (!cf && OVERRIDES[rec.id]) return { src: 'closed-form', ...OVERRIDES[rec.id], bbox: null };
  if (cf) return { src: 'closed-form', volume: cf.volume, faces: cf.faces, bbox: null };
  const o = rec.oracle ?? {};
  const sim = o.occtSim && !o.occtSim.refused && !o.occtSim.notTail ? o.occtSim : null;
  if (sim) return { src: 'occt-simultaneous', volume: sim.volume, faces: sim.faces, bbox: sim.bbox };
  const seq = o.occtSeq && !o.occtSeq.refused && !o.occtSeq.refusals ? o.occtSeq : null;
  if (seq) return { src: 'occt-sequential', volume: seq.volume, faces: seq.faces, bbox: seq.bbox };
  const br = o.brepSeq && !o.brepSeq.refused && !o.brepSeq.refusals ? o.brepSeq : null;
  if (br) return { src: 'brep-rs', volume: br.volume, faces: br.faces, bbox: br.bbox };
  return null;
}
const blendFeatures = (run) => (run?.features ?? []).filter((f) => /^(round|bevel)/.test(f.id) || f.guard || f.status === 'refused');
export function classify(rec, pathName, cf) {
  const run = rec[pathName];
  if (!run || run.sameAsContract) return null;
  if (run.scriptError) return { out: 'script-error' };
  if (run.hang) return { out: 'hang' };
  if (run.recorded && (run.refused ?? []).length) return { out: 'refused', n: run.refused.length, of: null, sentence: null, raw: null, partialVolume: run.volume, recorded: true };
  const refused = (run.features ?? []).filter((f) => f.status === 'refused');
  if (refused.length) return { out: 'refused', n: refused.length, of: (run.features ?? []).filter((f) => /^(round|bevel)/.test(f.id)).length, sentence: refused[0].sentence ?? null, raw: refused[0].refusal ?? null, partialVolume: run.volume };
  const t = truthOf(rec, cf);
  // invariants that need no oracle: a blend never changes the bounding box of the part it is applied to by more than the tessellation (it only trims inside it), and never leaves it with MORE volume than the unblended part
  // unless it is a concave blend (those add material: only the bbox test is applied to every case)
  let inv = null;
  const bb0 = rec.tailOnlyBlends === false ? null : rec.base?.bbox; const bb1 = run.bodies?.[0]?.bbox; // a move / turn / shell AFTER the blends changes the bbox legitimately
  if (bb0 && bb1) {
    const diag = Math.hypot(bb0[3] - bb0[0], bb0[4] - bb0[1], bb0[5] - bb0[2]) || 1;
    const shrink = Math.max(...[0, 1, 2].flatMap((i) => [bb1[i] - bb0[i], bb0[i + 3] - bb1[i + 3]])) / diag; // positive = the blended part is SMALLER than the base box
    const grow = Math.max(...[0, 1, 2].flatMap((i) => [bb0[i] - bb1[i], bb1[i + 3] - bb0[i + 3]])) / diag;
    inv = { shrink, grow, facesBase: rec.base.faces, volumeBase: rec.base.volume };
  }
  const invBad = inv && (inv.shrink > 1e-3 || inv.grow > 1e-3);
  // one straight convex edge (or one cylinder rim) of a plain box / plate / cylinder adds exactly ONE face; fewer means the blend consumed a face it should only have cut into
  const single = ['a1-oversize', 'a1-tiny', 'a1-cyl-rim', 'fz-single'].includes(rec.group) && rec.base?.faces != null && !/-same-edge/.test(rec.id);
  const faceBad = single && run.faces !== rec.base.faces + 1;
  if (!t && !rec.oracle) return { out: 'built-no-oracle', volume: run.volume, faces: run.faces };
  if (!t) return invBad || faceBad ? { out: 'built-WRONG', why: invBad ? 'bbox invariant' : 'face count', inv, volume: run.volume, faces: run.faces, facesTruth: rec.base.faces + 1, facesTruck: run.faces, truth: 'invariant' } : { out: 'built-oracle-refused', volume: run.volume, faces: run.faces, inv };
  const bodiesForTypes = (run.bodies && run.bodies.length ? run.bodies : rec.contract?.bodies) ?? []; // a recorded pane run carries no face types: the contract run of the same case does
  const curved = bodiesForTypes.some((b) => b.faceTypes && Object.keys(b.faceTypes).some((k) => k !== 'plane'));
  const tol = curved ? 3e-4 : 1e-9;
  const dv = rel(run.volume, t.volume);
  const bb = t.bbox ? bboxDelta(run.bodies?.[0]?.bbox, t.bbox) : null;
  const facesOk = t.faces == null || run.faces === t.faces;
  const ok = dv <= tol && facesOk && (bb == null || bb <= 1e-3) && !invBad;
  const explained = !ok && dv <= tol && !invBad && (bb == null || bb <= 1e-3) && EXPLAINED[rec.id];
  if (explained) return { out: 'built-match-faces-explained', why: EXPLAINED[rec.id], dVol: dv, facesTruck: run.faces, facesTruth: t.faces, truth: t.src, volume: run.volume };
  return { out: ok ? 'built-match' : 'built-WRONG', inv, dVol: dv, facesTruck: run.faces, facesTruth: t.faces, bbox: bb, truth: t.src, volume: run.volume, truthVolume: t.volume, curved };
}
export function scoreAll(records) {
  return records.map((rec) => {
    const cf = rec.oracle?.closedForm ?? null;
    const cfOverride = cf ?? null;
    return { id: rec.id, group: rec.group, note: rec.note, pane: classify(rec, 'pane', cfOverride), grouped: classify(rec, 'grouped', cfOverride), contract: classify(rec, 'contract', cfOverride), truth: truthOf(rec, cfOverride)?.src ?? null };
  });
}
if (process.argv[1]?.endsWith('fc4-score.mjs') && files.length) {
  const recs = files.flatMap((f) => JSON.parse(readFileSync(path.resolve(HERE, f), 'utf8')));
  const sc = scoreAll(recs);
  const by = {};
  for (const s of sc) { const g = s.group ?? '-'; const b = (by[g] ??= { n: 0, pane: {}, contract: {}, grouped: {} }); b.n++; for (const k of ['pane', 'grouped', 'contract']) { const o = s[k]?.out; if (o) b[k][o] = (b[k][o] ?? 0) + 1; } }
  console.log(JSON.stringify(by, null, 1));
  if (process.argv.includes('--table')) for (const s of sc) console.log(s.id.padEnd(42), 'pane', (s.pane?.out ?? '-').padEnd(20), 'grouped', (s.grouped?.out ?? '-').padEnd(20), 'contract', (s.contract?.out ?? '-').padEnd(20), s.truth ?? '', s.contract?.out === 'built-WRONG' ? `MISS dVol ${s.contract.dVol?.toExponential(2)} faces ${s.contract.facesTruck}/${s.contract.facesTruth}` : '');
  const jo = process.argv.find((a) => a.startsWith('--json='));
  if (jo) writeFileSync(path.resolve(HERE, jo.slice(7)), JSON.stringify(sc, null, 1));
}
