// Repro for issues 2 and 3 (tangency residual, dof/redundant flag). Only solidcraft command JSON goes in.
//   SOLIDCRAFT_REFEREE_PKG2=<dir> node tangent-probe.mjs
// Geometry: line l (0,0)->(10,0); 3-point arc a, start (10,0) through (15,5) end (10,10) (R=5, centre (10,5));
// sketch.constraint.coincident l.end a.start, then sketch.constraint.tangent l a. Start state is exactly tangent,
// or jittered by +-amp mm (deterministic LCG). Reads solidcraft's own sketch.inspect (and the wrapper's @sketch for
// max_residual, which the CLI does not expose).
import { run } from './run.mjs';
import { writeFileSync } from 'node:fs';
const mk = (j) => [
  { command: 'sketch.create', params: { name: 's', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } },
  { command: 'sketch.line', params: { points: [[0 + j[0], 0 + j[1]], [10 + j[2], 0 + j[3]]], ids: ['l'], connect: false } },
  { command: 'sketch.arc.three_point', params: { start: [10 + j[4], 0 + j[5]], through: [15 + j[6], 5 + j[7]], end: [10 + j[8], 10 + j[9]], id: 'a', connect: false } },
  { command: 'sketch.constraint.coincident', params: { a: 'l.end', b: 'a.start' } },
  { command: 'sketch.constraint.tangent', params: { a: 'l', b: 'a' } },
  { command: 'sketch.inspect', params: {} },
  { command: '@sketch', params: {} },
];
function one(j) {
  const r = run(mk(j));
  const tan = r.results[4], ins = r.results[5].out, rep = r.results[6].out.report;
  const P = Object.fromEntries(ins.points.map((p) => [p.id, p.at]));
  const R = ins.curves.find((c) => c.id === 'a').radius;
  const d = [P['l.end'][0] - P['l.start'][0], P['l.end'][1] - P['l.start'][1]]; const dl = Math.hypot(...d);
  const rv = [P['a.start'][0] - P['a.center'][0], P['a.start'][1] - P['a.center'][1]];
  const perp = (rv[0] * d[0] + rv[1] * d[1]) / dl; // component of the centre->joint radius along the line = tangency error in mm
  return { dof: ins.dof, status: ins.status, failing: ins.failing, redundant: tan.out.redundant ?? false, report_redundant: rep.redundant,
    max_residual: rep.max_residual, gap: Math.hypot(P['l.end'][0] - P['a.start'][0], P['l.end'][1] - P['a.start'][1]), R, perp_mm: perp, perp_rel: perp / R };
}
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
console.log('exact-tangent start:'); console.log(JSON.stringify(one(Array(10).fill(0))));
const j05 = [0.03, -0.04, 0.02, 0.05, -0.05, 0.04, 0.04, -0.03, -0.02, 0.05];
console.log('jitter 0.05 mm start (fixed numbers):'); console.log(JSON.stringify(one(j05)));
writeFileSync(new URL('./scripts/tangent-jitter-0p05.json', import.meta.url), '[\n' + mk(j05).slice(0, 6).map((c) => ' ' + JSON.stringify(c)).join(',\n') + '\n]\n');
console.log('12 jittered starts (amp 0.05..2 mm):');
for (const amp of [0.05, 0.1, 0.25, 0.5, 1, 2, 0.05, 0.1, 0.25, 0.5, 1, 2]) {
  const o = one(Array.from({ length: 10 }, () => rnd() * amp));
  console.log(`amp=${amp} status=${o.status} failing=${JSON.stringify(o.failing)} dof=${o.dof} max_residual=${o.max_residual.toExponential(1)} gap=${o.gap} perp_mm=${o.perp_mm.toExponential(2)} perp_rel=${o.perp_rel.toExponential(2)} R=${o.R}`);
}
