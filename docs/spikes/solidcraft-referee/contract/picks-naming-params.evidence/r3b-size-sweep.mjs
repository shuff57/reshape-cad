// Round 3 B. Size sweeps of the pick consumers on the PAGE translator with independent closed forms:
//   hollow(b,{wall:t,open:word}) on boxes and cylinders   valid iff t < D (depth of the cavity along the open axis) and 2t < smallest lateral width
//   bevel(b.edge(top,front), d) and round(...) on boxes   valid iff d <= both adjacent face extents measured across the edge (at equality that face vanishes; closed form still exact)
// Verdict is against the closed form (truth), not against whether an oracle answered. Also records face counts for the guard rule.
//   bun r3b-size-sweep.mjs [--out=file]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { guardedTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3b-size-sweep.json';
const rows = [];
async function run(kind, label, src, feasible, closedV, extra) {
  const r = L.fromScript(src); if (r.errors.length) { rows.push({ kind, label, src, scriptError: r.errors[0].message }); return; }
  const ref = L.references(r.doc); const row = await L.scored(r.doc, { ref });
  // faces of the target BEFORE the consumer: build the doc without the last feature
  const o = { kind, label, src, feasible, closedV, ...extra, outcome: row.outcome, sentence: row.sentence?.slice(0, 200), truck: row.truck && { V: row.truck.volume, faces: row.truck.faces, curved: row.truck.curved, bbox: row.truck.bbox }, occtV: ref.occt?.volume, occtFaces: ref.occt?.faces, occtRefusals: ref.occtRefusals, brepV: ref.brep?.volume, brepRefusals: ref.brepRefusals };
  const tol = row.truck?.curved ? 3e-4 : 1e-9;
  o.dClosed = row.truck && closedV !== null ? Math.abs(row.truck.volume - closedV) / closedV : null;
  if (row.outcome === 'REFUSED') o.verdict = feasible ? 'OVER-REFUSAL' : 'REFUSED-OK';
  else if (!feasible) o.verdict = 'SILENT-WRONG';
  else o.verdict = closedV === null ? 'NO-CLOSED-FORM' : o.dClosed <= tol ? 'EXACT' : 'WRONG-VOLUME';
  const g = await guardedTranslate(r.doc); const gm = g.features.find((f) => f.id === row.id);
  o.g = { status: gm.status, sentence: gm.refusal, raw: gm.rawRefusal?.slice(0, 120), V: gm.measure?.volume, unmapped: g.unmapped.length };
  const eq = extra.sz !== undefined && Math.abs(extra.sz - Math.min(extra.d, extra.h)) < 1e-9;
  o.eq = eq;
  if (gm.status === 'refused' && /has to be under ([0-9]+(?:\.[0-9]+)?)/.test(gm.refusal ?? '')) {
    const stated = +/has to be under ([0-9]+(?:\.[0-9]+)?)/.exec(gm.refusal)[1];
    const indep = kind === 'hollow-box' ? Math.min(extra.word === 'top' ? extra.h : extra.w, (extra.word === 'top' ? Math.min(extra.w, extra.d) : Math.min(extra.d, extra.h)) / 2) : Math.min(extra.h, 12);
    o.limitStated = stated; o.limitIndep = indep; o.limitOK = Math.abs(stated - indep) < 1e-3;
  }
  o.gVerdict = gm.status === 'refused' ? (feasible ? (eq ? 'REFUSED-AT-EQUALITY' : 'OVER-REFUSAL') : 'REFUSED-OK') : !feasible ? 'SILENT-WRONG' : (row.truck && Math.abs(gm.measure.volume - row.truck.volume) < 1e-9 * Math.max(1, Math.abs(row.truck.volume)) ? 'EXACT' : 'CHANGED');
  rows.push(o);
}
// ---- hollow, boxes
const boxes = [[40, 30, 20], [40, 30, 5], [40, 30, 3], [40, 30, 2], [40, 30, 1], [10, 30, 20], [40, 6, 20]];
const walls = [0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 14.5, 15, 15.5, 20];
for (const [w, d, h] of boxes) for (const word of ['top', 'left']) for (const t of walls) {
  const D = word === 'top' ? h : w; const lat = word === 'top' ? Math.min(w, d) : Math.min(d, h);
  const feasible = t < D - 1e-9 && 2 * t < lat - 1e-9;
  const cav = word === 'top' ? (w - 2 * t) * (d - 2 * t) * (h - t) : (d - 2 * t) * (h - 2 * t) * (w - t);
  await run('hollow-box', `${w}x${d}x${h} open ${word} wall ${t}`, `const b=box(${w},${d},${h})\nhollow(b,{wall:${t},open:'${word}'})`, feasible, feasible ? w * d * h - cav : null, { w, d, h, word, t });
}
// ---- hollow, cylinders (diameter 24, so radius 12)
for (const h of [1, 2, 3, 20]) for (const t of [0.5, 1, 2, 2.5, 5, 11, 12, 13]) {
  const feasible = t < h - 1e-9 && t < 12 - 1e-9;
  const V = Math.PI * 144 * h - Math.PI * (12 - t) ** 2 * (h - t);
  await run('hollow-cyl', `cyl d24 h${h} open top wall ${t}`, `const c=cylinder(24,${h})\nhollow(c,{wall:${t},open:'top'})`, feasible, feasible ? V : null, { h, t });
}
// ---- bevel and round of edge(top,front): the edge runs along x (length w); the top face is d deep, the front face h high
const bb = [[40, 30, 20], [40, 1, 20], [40, 30, 1], [40, 3, 20], [40, 30, 2.5], [40, 4, 4]];
const sizes = [0.5, 1, 2, 2.5, 3, 4, 5, 10, 19, 20, 21, 29, 30, 31];
for (const [w, d, h] of bb) for (const sz of sizes) {
  const feasible = sz <= Math.min(d, h) + 1e-9; // equality = the adjacent face is consumed whole: the solid is still exact (closed form), both oracles refuse it
  await run('bevel', `${w}x${d}x${h} bevel(top,front) ${sz}`, `const b=box(${w},${d},${h})\nbevel(b.edge('top','front'),${sz})`, feasible, feasible ? w * d * h - sz * sz / 2 * w : null, { w, d, h, sz });
  await run('round', `${w}x${d}x${h} round(top,front) ${sz}`, `const b=box(${w},${d},${h})\nround(b.edge('top','front'),${sz})`, feasible, feasible ? w * d * h - (1 - Math.PI / 4) * sz * sz * w : null, { w, d, h, sz });
}
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const c = {}; for (const r of rows) { const k = r.kind + ' ' + (r.verdict ?? 'SCRIPTERR'); c[k] = (c[k] ?? 0) + 1; }
const cg = {}; for (const r of rows) { const k = r.kind + ' ' + (r.gVerdict ?? 'SCRIPTERR'); cg[k] = (cg[k] ?? 0) + 1; }
console.log('cases', rows.length, 'PAGE', JSON.stringify(c, null, 1), 'GUARDED', JSON.stringify(cg, null, 1));
console.log('limit stated in the hollow sentence == independent min(depth, lateral/2): ' + rows.filter((r) => r.limitOK).length + ' / ' + rows.filter((r) => r.limitStated !== undefined).length + '\nexample guard sentences:', [...new Set(rows.filter((r) => r.g?.status === 'refused').map((r) => r.g.sentence))].slice(0, 10).join('\n   '));
for (const r of rows.filter((r) => ['SILENT-WRONG', 'OVER-REFUSAL', 'CHANGED'].includes(r.gVerdict))) console.log(r.verdict, r.kind, r.label, 'truckV', r.truck?.V?.toFixed(3), 'closed', r.closedV?.toFixed?.(3), 'faces', r.truck?.faces, 'occt', r.occtV?.toFixed?.(3) ?? '-', JSON.stringify(r.occtRefusals ?? {}).slice(0, 50), r.sentence ?? '');
