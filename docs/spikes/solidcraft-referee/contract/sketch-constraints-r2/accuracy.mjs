// Endpoint tangency / contact accuracy, read from SolidCraft's own solved points (the @sketch dump), plus the DoF / SolveReport readout against brep-rs and FreeCAD.
//   SOLIDCRAFT_REFEREE_PKG2=<p2 pkg> bun accuracy.mjs [--out=out/accuracy.json]
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
  const joint = [], gap = [], rmis = [], dv = [], dirErr = [], scRes = [];
  let built = 0, refused = 0;
  const starts = [{ name: 'stored', g: cs.geoms }, ...Array.from({ length: 30 }, (_, k) => ({ name: 'rough', g: roughen(cs.geoms, cs.rules, `${id}#acc#${k}`, 0.035) }))];
  for (const s of starts) {
    const g = ladderSketch({ geoms: s.g, rules });
    if (!g.ok) { refused++; continue; }
    built++;
    dv.push(classify(cs, g.body).dv);
    scRes.push(g.report.max_residual);
    const by = new Map(g.solved.map((x) => [x.id, x]));
    for (const r of rules) {
      if (r.k === 'tangent' && r.aEnd !== undefined) {
        const a = by.get(r.a), b = by.get(r.b); const L0 = a.k === 'line' ? a : b, Ar = a.k === 'line' ? b : a; if (a.k === 'arc' && b.k === 'arc') { const Pj = r.aEnd === 'b' ? a.b : a.a; const dc = sub(b.c, a.c); joint.push(Math.abs(cross(sub(Pj, a.c), dc)) / len(dc)); continue; }
        const P = a.k === 'line' ? (r.aEnd === 'b' ? a.b : a.a) : (r.bEnd === 'b' ? b.b : b.a);
        const Pc = Ar === a ? (r.aEnd === 'b' ? a.b : a.a) : (r.bEnd === 'b' ? b.b : b.a);
        const d = unit(sub(L0.b, L0.a));
        if (L0.k === 'line' && Ar.k === 'arc') { joint.push(Math.abs(dot(sub(Pc, Ar.c), d))); const ra = unit(sub(Pc, Ar.c)); dirErr.push(Math.abs(dot(ra, d))); }
      }
      if (r.k === 'coincident' && ['a', 'b'].includes(r.aEnd) && ['a', 'b'].includes(r.bEnd)) { const a = by.get(r.a), b = by.get(r.b); if (a && b && a.k !== 'point' && b.k !== 'point') gap.push(dist(r.aEnd === 'b' ? a.b : a.a, r.bEnd === 'b' ? b.b : b.a)); }
    }
    for (const x of g.solved) if (x.k === 'arc') rmis.push(Math.abs(x.rEnd - x.r));
  }
  const row = { id, built, refused, tangentPerpendicularityMm: stat(joint), tangentRadiusDirectionDot: stat(dirErr), jointGapMm: stat(gap), arcEndRadiusMismatchMm: stat(rmis), volumeRel: stat(dv), scMaxResidual: stat(scRes) };
  out.accuracy.push(row);
  console.log(id.padEnd(60), JSON.stringify(row));
}
// DoF readout: SolidCraft report vs brep-rs diagnosis vs FreeCAD ref for the gauntlet fixtures and the slot cases
for (const cs of CASES.filter((c) => c.geoms && !c.legacy && !c.probe && c.expect !== 'refuse' && (c.gauntlet || /^(slot|oval|rect-origin|tangent-line-circle$|triangle-length|hexagon)/.test(c.id)))) {
  const rules = plainRules(cs.rules);
  const u = lib.scSketch(cs.geoms, rules); const b = lib.brepSolve(cs.geoms, rules);
  const row = { id: cs.id, sc: u.report && { status: u.report.status, dof: u.report.dof, redundant: u.report.redundant?.length ?? null, failing: u.report.failing?.length ?? null }, brep: b.open ? { open: b.open } : { dof: b.diag?.dof ?? null, bucket: b.diag?.bucket ?? null }, freecad: cs.fc ? { dof: cs.fc.dof, conflicting: cs.fc.conflicting?.length, redundant: cs.fc.redundant?.length } : null };
  out.dof.push(row);
  console.log('dof', cs.id.padEnd(60), JSON.stringify(row));
}
writeFileSync(OUTF, JSON.stringify(out, null, 1));
