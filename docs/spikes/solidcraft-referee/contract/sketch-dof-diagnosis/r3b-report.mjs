// ROUND 3 section B report: reads r3b.json (the fuzz rows) and prints the numbers the rows quote. Deterministic, no engine needed.
//   bun contract/sketch-dof-diagnosis/r3b-report.mjs   (writes r3b-report.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { DEG_REL } from './soup-guard.mjs';
const { rows } = JSON.parse(readFileSync(new URL('./r3b.json', import.meta.url), 'utf8'));
const out = { totals: {}, classes: {}, dof: {}, examples: {} };
const isInfeasibleOracle = (r) => !r.brep.open && (r.brep.bucket === 'conflicting' || r.brep.bucket === 'globallyInfeasible') && r.indep.consistent === false;
out.totals.cases = rows.length;
out.totals.mapperRefused = rows.filter((r) => r.sc.mapperRefused).length;
const run = rows.filter((r) => !r.sc.mapperRefused);
out.totals.scRefusedAtACommand = run.filter((r) => r.sc.refusal).length;
const acc = run.filter((r) => !r.sc.refusal && r.metrics);
out.totals.scAcceptedEverything = acc.length;
const held = (r) => (r.metrics.worstOver ?? 0) <= 1;
const collapsed = (r) => r.metrics.minVsDiag < DEG_REL;
const oracleOK = (r) => r.indep.consistent === true && (r.metrics.oracleMinVsDiag ?? 0) >= DEG_REL;
const cls = { A_ruleHeld_notCollapsed: [], B_collapsed_properPartExists: [], B_collapsed_onlyDegenerateOrInfeasible: [], C_ruleNotHeld: [] };
for (const r of acc) {
  if (!held(r)) cls.C_ruleNotHeld.push(r);
  else if (collapsed(r)) (oracleOK(r) ? cls.B_collapsed_properPartExists : cls.B_collapsed_onlyDegenerateOrInfeasible).push(r);
  else cls.A_ruleHeld_notCollapsed.push(r);
}
for (const [k, v] of Object.entries(cls)) out.classes[k] = v.length;
out.totals.infeasibleByOracle = rows.filter(isInfeasibleOracle).length;
out.totals.infeasibleMapperRefused = rows.filter((r) => isInfeasibleOracle(r) && r.sc.mapperRefused).length;
out.totals.infeasibleRefusedAtCommand = rows.filter((r) => isInfeasibleOracle(r) && !r.sc.mapperRefused && r.sc.refusal).length;
const infeasAcc = acc.filter(isInfeasibleOracle);
out.totals.infeasibleAcceptedNoRefusal = infeasAcc.length;
out.totals.infeasibleAcceptedGuardFires = infeasAcc.filter((r) => !r.guard.ok).length;
out.totals.infeasibleAcceptedGuardPasses = infeasAcc.filter((r) => r.guard.ok).length;
out.examples.infeasibleAcceptedGuardPasses = infeasAcc.filter((r) => r.guard.ok).map((r) => ({ seed: r.seed, n: r.n, rules: r.rules.slice(r.name === 'cc' ? 0 : r.name === 'rect' ? 4 : 3), allRulesHeld: held(r), minVsDiag: r.metrics.minVsDiag, note: 'every driving rule is held by the SolidCraft geometry (independent rule-check), so the oracle label "infeasible" was a local-solver miss: this is a real solution, not a silent accept' }));
const guardFires = acc.filter((r) => !r.guard.ok);
out.totals.guardFires = guardFires.length; out.totals.guardFiresRuleNotHeld = guardFires.filter((r) => r.guard.kind === 'rule-not-held').length; out.totals.guardFiresCollapsed = guardFires.filter((r) => r.guard.kind === 'collapsed').length;
out.totals.guardPasses = acc.length - guardFires.length;
// a guard "false positive" would be: it fires, yet the rule set legitimately asks for a part this small. The collapse test exempts a length/radius the student typed, so measure the remaining case: oracle consistent AND oracle also < DEG_REL
out.totals.guardFiresButOracleAlsoTiny = guardFires.filter((r) => r.guard.kind === 'collapsed' && r.indep.consistent === true && (r.metrics.oracleMinVsDiag ?? 1) < DEG_REL).length;
const hist = (arr) => { const b = {}; for (const v of arr) { const e = v <= 0 ? 'zero' : Math.floor(Math.log10(v)); b[e] = (b[e] ?? 0) + 1; } return b; };
out.totals.minVsDiagDecades_ruleHeld_notGuarded = hist(cls.A_ruleHeld_notCollapsed.map((r) => r.metrics.minVsDiag));
out.totals.minVsDiagDecades_collapsed = hist([...cls.B_collapsed_properPartExists, ...cls.B_collapsed_onlyDegenerateOrInfeasible].map((r) => r.metrics.minVsDiag));
out.totals.smallestEdgeRatioKeptByGuard = Math.min(...cls.A_ruleHeld_notCollapsed.map((r) => r.metrics.minVsDiag));
out.totals.largestCollapsedRatio = Math.max(...[...cls.B_collapsed_properPartExists, ...cls.B_collapsed_onlyDegenerateOrInfeasible].map((r) => r.metrics.minVsDiag));
// dof: SolidCraft's own dof vs brep-rs diagnose dof, per guard class (consistent|redundant buckets, no tangent in this pool)
const dofCmp = (set) => { const c = set.filter((r) => !r.brep.open && (r.brep.bucket === 'consistent' || r.brep.bucket === 'redundant')); const eq = c.filter((r) => r.sc.dof === r.brep.dof); return { n: c.length, equal: eq.length }; };
out.dof.guardPasses = dofCmp(acc.filter((r) => r.guard.ok));
out.dof.guardFires = dofCmp(guardFires);
out.dof.guardFiresStillStatusSolved = guardFires.filter((r) => r.sc.status === 'solved' && (r.sc.failing ?? []).length === 0).length;
out.dof.guardFiresDofPositive = guardFires.filter((r) => r.sc.dof > 0).length;
out.examples.ruleNotHeld = cls.C_ruleNotHeld.map((r) => ({ seed: r.seed, n: r.n, name: r.name, kind: r.metrics.worstKind, residual: +r.metrics.worstResidual.toFixed(3), status: r.sc.status, dof: r.sc.dof, failing: r.sc.failing, volume: r.sc.volume, rules: r.rules.filter((x) => !(x.k === 'coincident' && x.aEnd === 'b')) }));
out.examples.collapsedProperPartExists = cls.B_collapsed_properPartExists.slice(0, 8).map((r) => ({ seed: r.seed, n: r.n, name: r.name, minVsDiag: r.metrics.minVsDiag, oracleMin: r.metrics.oracleMinVsDiag, volume: r.sc.volume, rules: r.rules.filter((x) => !(x.k === 'coincident' && x.aEnd === 'b')) }));
out.examples.collapsedOnlyDegenerate = cls.B_collapsed_onlyDegenerateOrInfeasible.slice(0, 8).map((r) => ({ seed: r.seed, n: r.n, name: r.name, minVsDiag: r.metrics.minVsDiag, brep: r.brep.bucket, indepConsistent: r.indep.consistent, status: r.sc.status, dof: r.sc.dof, failing: r.sc.failing, profiles: r.sc.profiles, extrudeError: r.sc.extrudeError, volume: r.sc.volume, rules: r.rules.filter((x) => !(x.k === 'coincident' && x.aEnd === 'b')) }));
console.log(JSON.stringify({ totals: out.totals, classes: out.classes, dof: out.dof }, null, 1));
console.log('ruleNotHeld', JSON.stringify(out.examples.ruleNotHeld.map((e) => [e.name, e.kind, e.residual, e.status, e.dof, e.volume])));
console.log('collapsed, proper part exists', JSON.stringify(out.examples.collapsedProperPartExists.map((e) => [e.name, e.minVsDiag, e.oracleMin, e.volume, JSON.stringify(e.rules)])));
console.log('collapsed only degenerate', JSON.stringify(out.examples.collapsedOnlyDegenerate.map((e) => [e.name, e.minVsDiag, e.brep, e.status, e.dof, e.profiles, e.extrudeError, e.volume])));
writeFileSync(new URL('./r3b-report.json', import.meta.url), JSON.stringify(out, null, 1));
