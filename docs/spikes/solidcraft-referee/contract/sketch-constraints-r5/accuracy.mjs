// Endpoint tangency / contact accuracy, measured as the distance of SolidCraft's BUILT solid from the exact solid of the independently solved sketch (bbox, volume, centre of mass); plus the DoF readout (independent solver) against brep-rs and FreeCAD.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun accuracy.mjs [--out=out/accuracy.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, H, roughen, plainRules, slotArea } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch } from './guard.mjs';
import { dist, sub, dot, cross, len, unit, tangentAt } from './geom.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/accuracy.json').slice(6);
const IDS = ['slot-hand-rows-R10-L40', 'slot-dims-from-points', 'oval-four-arcs-endpoint-tangent', 'gauntlet:sk-circle-arc-tangent__slot-r6-L30-anchored', 'gauntlet:sk-circle-arc-tangent__slot-r12-L18-anchored', 'gauntlet:sk-circle-arc-tangent__slot-arc-first-order'];
const stat = (xs) => xs.length ? { n: xs.length, max: Math.max(...xs), median: [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] } : { n: 0 };
const out = { accuracy: [], dof: [] };
for (const id of IDS) {
  const cs = CASES.find((c) => c.id === id);
  const rules = plainRules(cs.rules);
  const bboxErr = [], volErr = [], comErr = [], faces = new Set();
  let built = 0, refused = 0; const refusals = {};
  const starts = [{ name: 'stored', g: cs.geoms }, ...Array.from({ length: 30 }, (_, k) => ({ name: 'rough', g: roughen(cs.geoms, cs.rules, `${id}#acc#${k}`, 0.035) }))];
  for (const s of starts) {
    const g = ladderSketch({ geoms: s.g, rules });
    if (!g.ok) { refused++; refusals[g.stage] = (refusals[g.stage] ?? 0) + 1; continue; }
    built++;
    // contact / tangent accuracy of SolidCraft's build = how far the built solid is from the EXACT solid of the independently solved sketch (the tangent joints and the arc ends are where an error would show up)
    const e = g.expected;
    bboxErr.push(Math.max(...[0, 1, 2, 3, 4, 5].map((i) => Math.abs(g.body.bbox[i] - e.bbox[i]))));
    volErr.push(Math.abs(g.body.volume - e.volume) / e.volume);
    comErr.push(Math.max(...[0, 1, 2].map((i) => Math.abs(g.body.com[i] - e.com[i]))));
    faces.add(g.body.faces);
  }
  const row = { id, built, refused, refusals, bboxAbsErrMm: stat(bboxErr), volumeRelErr: stat(volErr), comAbsErrMm: stat(comErr), faceCounts: [...faces] };
  out.accuracy.push(row);
  console.log(id.padEnd(60), JSON.stringify(row));
}
// DoF readout: SolidCraft report vs brep-rs diagnosis vs FreeCAD ref for the gauntlet fixtures and the slot cases
for (const cs of CASES.filter((c) => c.geoms && !c.legacy && !c.probe && c.expect !== 'refuse' && (c.gauntlet || /^(slot|oval|rect-origin|tangent-line-circle$|triangle-length|hexagon)/.test(c.id)))) {
  const rules = plainRules(cs.rules);
  const ind = lib.indepSolve(cs.geoms, rules); const b = lib.brepSolve(cs.geoms, rules);
  const row = { id: cs.id, indep: { dof: ind.dof, rank: ind.rank, residualAfter: ind.residualAfter, source: 'independent solve (SolidCraft SolveReport is not readable on the supplied pkg)' }, brep: b.open ? { open: b.open } : { dof: b.diag?.dof ?? null, bucket: b.diag?.bucket ?? null }, freecad: cs.fc ? { dof: cs.fc.dof, conflicting: cs.fc.conflicting?.length, redundant: cs.fc.redundant?.length } : null };
  out.dof.push(row);
  console.log('dof', cs.id.padEnd(60), JSON.stringify(row));
}
writeFileSync(OUTF, JSON.stringify(out, null, 1));
