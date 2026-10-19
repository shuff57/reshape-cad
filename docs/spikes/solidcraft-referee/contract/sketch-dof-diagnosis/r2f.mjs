// ROUND 2, section F: (row 20) edges named by SolidCraft's refusal vs TS losingEdges vs brep-rs blame; (row 24) SolidCraft 'measured' dimension values vs the TS edge labels.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/r2f.mjs   (writes r2f.json)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as L from './lib.mjs';
import * as G from './legacy.mjs';
import { kTables } from './refusal-sentence.mjs';
const sc2 = createRequire(import.meta.url)((process.env.SOLIDCRAFT_REFEREE_PKG2 ?? '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/cdof/pkg2') + '/solidcraft_referee_dofcrit.js');
const OUT = { f1: [], f2: [] };
const edgesOfRule = (rule, n) => { const E = (e) => ((e % n) + n) % n; if (rule.k === 'horizontal' || rule.k === 'vertical') return [E(rule.a - 1)]; if (rule.k === 'distance' && rule.a === rule.b) return [E(rule.a - 1)]; if (['equal', 'parallel', 'perpendicular', 'angle'].includes(rule.k)) return [E(rule.a - 1), E(rule.b - 1)]; return []; };
// ---- F1
for (const c of G.CONFLICT) {
  const cons = [...c.cons, c.add]; const n = c.pts.length; const { geoms, rules } = G.toSoup(c.pts, cons);
  const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
  const r = L.scRun(L.mapper.extrudeCommands(m, { height: 10 }).filter((x) => x.command !== '@sketch'));
  const { kToRule } = kTables(m);
  const ids = [...(r.error ?? '').matchAll(/\bk(\d+)\b/g)].map((x) => Number(x[1]));
  const failedRule = m.ruleMap.findIndex((ix) => ix && ix.includes(r.index));
  const named = [...new Set([failedRule, ...ids.map((k) => kToRule[k])])].filter((i) => i >= 0);
  const scEdges = [...new Set(named.flatMap((i) => edgesOfRule(rules[i], n)))].sort();
  const ts = L.solve.solveSketch(c.pts, cons); const los = L.solve.losingEdges(ts.points, cons);
  const bd = L.brepSketch(geoms, rules).diag; const bEdges = [...new Set((bd?.blame ?? []).flatMap((i) => edgesOfRule(rules[i] ?? {}, n)))].sort();
  OUT.f1.push({ id: c.id, scRefusalEdges: scEdges, tsLosingEdges: los, brepBlameEdges: bEdges, scCoversBrep: bEdges.every((e) => scEdges.includes(e)), tsCoversBrep: bEdges.every((e) => los.includes(e)) });
  console.log('F1', JSON.stringify(OUT.f1.at(-1)));
}
// ---- F2: measured values
const fmt = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(+x.toFixed(2)));
for (const c of G.DETERMINED) {
  const { geoms, rules } = G.toSoup(c.pts, c.cons); const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
  const r = JSON.parse(sc2.run(JSON.stringify({ commands: L.mapper.extrudeCommands(m, { height: 10 }) })));
  const dims = r.results.filter((x) => x.command === 'sketch.dimension' && x.ok).map((x) => ({ asked: Number(x.out.expression), measured: x.out.measured, type: x.out.type, dofAfter: x.out.sketch?.dof }));
  const ts = L.solve.solveSketch(c.pts, c.cons); const lab = L.outline.sketchLabels(ts.points, c.cons);
  const lengthRules = c.cons.filter((k) => k.kind === 'length');
  const labelsFor = lengthRules.map((k) => ({ edge: k.edge + 1, asked: k.value, tsLabel: lab.edges.find((e) => e.edge === k.edge)?.text, tsKind: lab.edges.find((e) => e.edge === k.edge)?.kind }));
  OUT.f2.push({ id: c.id, scDims: dims, maxMeasuredVsAsked: Math.max(0, ...dims.filter((d) => d.type === 'LinearDimension').map((d) => Math.abs(d.measured - d.asked))), tsLengthLabels: labelsFor, labelsEqualAsked: labelsFor.every((l) => l.tsLabel === fmt(l.asked)) });
  console.log('F2', JSON.stringify(OUT.f2.at(-1)));
}
// reference dimension: measured is the real value, not the asked one
{
  const c = G.DETERMINED[0]; const { geoms, rules } = G.toSoup(c.pts, c.cons);
  rules.push({ k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 55, driving: false });
  const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
  const r = JSON.parse(sc2.run(JSON.stringify({ commands: L.mapper.extrudeCommands(m, { height: 10 }) })));
  const last = r.results.filter((x) => x.command === 'sketch.dimension').at(-1);
  OUT.f2ref = { askedReferenceValue: 55, scMeasured: last.out.measured, driven: last.out.driven, dofAfter: last.out.sketch.dof, edge2TrueLength: 25 };
  console.log('F2ref', JSON.stringify(OUT.f2ref));
}
// ---- F3: SolidCraft's own residual / report fields (hidden by the given pkg; read through pkg2), D1..D7 from the DRAWN (rough) start and from the solved start
OUT.f3 = [];
for (const c of G.DETERMINED) {
  const { geoms, rules } = G.toSoup(c.pts, c.cons); const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
  const r = JSON.parse(sc2.run(JSON.stringify({ commands: L.mapper.extrudeCommands(m, { height: 10 }) })));
  const rep = r.results.find((x) => x.command === '@sketch')?.out?.report;
  OUT.f3.push({ id: c.id, reportKeys: Object.keys(rep ?? {}), status: rep?.status, dof: rep?.dof, max_residual: rep?.max_residual, iterations: rep?.iterations, continuations: rep?.continuations, failing: rep?.failing });
  console.log('F3', JSON.stringify(OUT.f3.at(-1)));
}
writeFileSync(new URL('./r2f.json', import.meta.url), JSON.stringify(OUT, null, 1));
