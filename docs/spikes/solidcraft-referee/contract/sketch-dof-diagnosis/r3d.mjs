// ROUND 3 section D: the named silent-acceptance repros on the SOUP route (SolidCraft solves the rules), with the guard's verdict.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> SOLIDCRAFT_REFEREE_PKG2=<pkg2> bun contract/sketch-dof-diagnosis/r3d.mjs   (writes r3d.json)
import { writeFileSync, readFileSync } from 'node:fs';
import * as R from './r3-lib.mjs';
import * as G from './legacy.mjs';
import { analyse } from './indep.mjs';
import { guardSolved, metrics } from './soup-guard.mjs';
import { labelSoup, plainProblems } from './refusal-sentence.mjs';
const OUT = { cases: [] };
const r6 = (x) => (typeof x === 'number' ? +x.toPrecision(6) : x);
function one(id, geoms, rules, note) {
  const s = R.scSketch(geoms, rules);
  const b = R.brepDiag(geoms, rules);
  let ind; try { ind = analyse(geoms, rules); } catch (e) { ind = { unsupported: String(e) }; }
  const row = { id, note, brep: b.open ? { open: b.open } : { bucket: b.bucket, dof: b.dof }, indepConsistent: ind.consistent ?? null };
  if (s.mapperRefused) row.sc = { mapperRefused: s.mapperRefused };
  else {
    row.sc = { refusalAtCommand: s.firstRefusal && { command: s.firstRefusal.command, error: s.firstRefusal.error }, status: s.report?.status, dof: s.report?.dof, failing: s.report?.failing, profiles: s.profiles.map(r6), extrudeError: s.extrudeError, volume: s.volume?.map(r6) };
    if (s.solved) {
      const m = metrics(geoms, s.solved, rules);
      const g = guardSolved(geoms, s.solved, rules, (i) => labelSoup(rules[i], geoms));
      row.metrics = { shortestOverDrawnDiag: +m.minVsDiag.toExponential(3), shortestOverDrawnEdge: +m.minVsDrawn.toExponential(3), worstRule: m.worst && { kind: m.worst.kind, residual: r6(m.worst.residual), unit: m.worst.unit } };
      row.guard = g.ok ? { ok: true } : { ok: false, kind: g.kind, sentence: g.sentence, plainProblems: plainProblems(g.sentence) };
      if (id.startsWith('SIGN')) { const c1 = s.solved[0].c, c2 = s.solved[1].c; row.solvedDy = r6(c2[1] - c1[1]); row.solvedDx = r6(c2[0] - c1[0]); }
    }
  }
  OUT.cases.push(row); console.log(id, JSON.stringify({ ...row, note: undefined }));
}
const T = R.TRI(); const RC = R.rect(0, 0, 30, 20);
one('N1 triangle, two right angles', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }], 'critic (a): two right angles in a triangle');
one('N2 triangle, perpendicular(1,3)+equal(1,2)', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 3 }, { k: 'equal', a: 1, b: 2 }], 'critic (b)');
one('N3 rectangle h/v + angle 45', RC, [...R.shape(), { k: 'angle', a: 1, b: 2, value: 45 }], 'critic (c)');
one('N4 triangle, three perpendiculars (control: SolidCraft refuses at the command)', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'perpendicular', a: 1, b: 3 }], 'control');
const C2 = [{ k: 'circle', id: 1, c: [5, 5], r: 4 }, { k: 'circle', id: 2, c: [20, 6], r: 3 }];
const sgnRules = (dy) => [{ k: 'coincident', a: 1, aEnd: 'c', b: -1, bEnd: 'a' }, { k: 'distance', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 15.033296378372908 }, { k: 'distanceY', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: dy }];
one('SIGN-1 signed distanceY +2.1, start dy=+1', C2, sgnRules(2.1), 'critic sign flip: solved dy comes out -2.1');
one('SIGN-2 signed distanceY +1, start dy=+1', C2, sgnRules(1), 'same start, smaller value');
one('SIGN-3 signed distanceY +2.1, start dy=+0.5 (c2 starts at (20,5.5))', [C2[0], { ...C2[1], c: [20, 5.5] }], sgnRules(2.1), 'start closer: sign kept');
// M3 family on the soup route
const HV = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
for (const [id, pts, cons] of [
  ['M3 rect + up on a horizontal edge', [[0, 0], [40, 0], [40, 25], [0, 25]], [...HV, { kind: 'vertical', edge: 0 }]],
  ['M3b skew quad, across+up on one edge', [[0, 0], [40, 3], [41, 25], [1, 24]], [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }]],
  ['M3c hexagon, across+up on one edge', [[0, 0], [20, -3], [40, 0], [40, 20], [20, 25], [0, 20]], [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }]],
]) { const { geoms, rules } = G.toSoup(pts, cons); one(id, geoms, rules, 'round-2 collapse family'); }
// the angle flip found by the fuzz (feasible rule set, angle 45 held as 135)
{
  const { rows } = JSON.parse(readFileSync(new URL('./r3b.json', import.meta.url), 'utf8'));
  const f = rows.find((r) => r.seed === 2 && r.n === 94);
  one('ANGLE-FLIP rect: equal(1,2), distance, length(3)=30, angle(1,2)=45 (fuzz seed 2 case 94)', R.rect(3, 2, 33, 22), f.rules, 'angle dimension is undirected: SolidCraft solves to the other orientation');
}
writeFileSync(new URL('./r3d.json', import.meta.url), JSON.stringify(OUT, null, 1));
