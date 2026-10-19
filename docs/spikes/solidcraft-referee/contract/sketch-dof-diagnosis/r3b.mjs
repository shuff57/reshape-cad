// ROUND 3 section B: silent acceptance of impossible / conflicting soup rule sets, and the guard that catches them.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> SOLIDCRAFT_REFEREE_PKG2=<wrapper2 pkg> bun contract/sketch-dof-diagnosis/r3b.mjs   (writes r3b.json)
import { writeFileSync } from 'node:fs';
import * as R from './r3-lib.mjs';
import { analyse } from './indep.mjs';
import { guardSolved, metrics } from './soup-guard.mjs';
const SEEDS = (process.env.SEEDS ?? '1,2').split(',').map(Number); const N = +(process.env.N ?? 400);
const T = R.TRI(); const RC = R.rect(3, 2, 33, 22);
const CC = [{ k: 'circle', id: 1, c: [5, 5], r: 4 }, { k: 'circle', id: 2, c: [20, 6], r: 3 }, { k: 'line', id: 3, a: [0, 0], b: [30, 2] }];
const pools = {
  rect: { geoms: RC, base: R.loopJoins(4), pool: [
    { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }, { k: 'vertical', a: 1 }, { k: 'horizontal', a: 2 },
    { k: 'parallel', a: 1, b: 3 }, { k: 'parallel', a: 2, b: 4 }, { k: 'parallel', a: 1, b: 2 }, { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'perpendicular', a: 3, b: 4 }, { k: 'perpendicular', a: 4, b: 1 }, { k: 'perpendicular', a: 1, b: 3 },
    { k: 'equal', a: 1, b: 3 }, { k: 'equal', a: 2, b: 4 }, { k: 'equal', a: 1, b: 2 },
    R.len(1, 30), R.len(2, 20), R.len(3, 30), R.len(4, 20), R.len(1, 12), R.len(2, 7),
    { k: 'lock', a: 1, aEnd: 'a' }, { k: 'lock', a: 3, aEnd: 'a' }, { k: 'coincident', a: 1, aEnd: 'a', b: -1, bEnd: 'a' },
    { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }, { k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 20 },
    { k: 'distance', a: 1, aEnd: 'a', b: 3, bEnd: 'a', value: Math.hypot(30, 20) },
    { k: 'angle', a: 1, b: 2, value: 90 }, { k: 'angle', a: 1, b: 4, value: 90 }, { k: 'angle', a: 1, b: 2, value: 45 },
  ] },
  tri: { geoms: T, base: R.loopJoins(3), pool: [
    { k: 'horizontal', a: 1 }, { k: 'equal', a: 2, b: 3 }, { k: 'equal', a: 1, b: 2 }, R.len(1, 40), R.len(2, Math.hypot(30, 25)), R.len(3, Math.hypot(10, 25)),
    { k: 'coincident', a: 1, aEnd: 'a', b: -1, bEnd: 'a' }, { k: 'lock', a: 1, aEnd: 'a' },
    { k: 'angle', a: 1, b: 2, value: 180 - Math.atan2(25, -30) * 180 / Math.PI },
    { k: 'perpendicular', a: 1, b: 3 }, { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'parallel', a: 1, b: 2 }, { k: 'vertical', a: 3 },
    { k: 'distanceY', a: 1, aEnd: 'a', b: 3, bEnd: 'a', value: 25 },
  ] },
  cc: { geoms: CC, base: [], pool: [
    { k: 'radius', a: 1, value: 4 }, { k: 'radius', a: 2, value: 3 }, { k: 'diameter', a: 1, value: 8 }, { k: 'diameter', a: 2, value: 6 }, { k: 'equal', a: 1, b: 2 },
    { k: 'lock', a: 1, aEnd: 'c' }, { k: 'coincident', a: 1, aEnd: 'c', b: -1, bEnd: 'a' },
    { k: 'distanceX', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 15 }, { k: 'distanceY', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 1 }, { k: 'distanceY', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 2.1 },
    { k: 'distance', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: Math.hypot(15, 1) }, { k: 'distance', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 15.033296378372908 },
    { k: 'horizontal', a: 3 }, { k: 'pointOnObject', a: 3, aEnd: 'a', b: -1 }, { k: 'pointOnObject', a: 1, aEnd: 'c', b: 3 }, { k: 'pointOnObject', a: 3, aEnd: 'b', b: 2 },
    R.len(3, Math.hypot(30, 2)), { k: 'coincident', a: 3, aEnd: 'a', b: -1, bEnd: 'a' },
  ] },
};
const rows = [];
for (const seed of SEEDS) {
  const rnd = R.mulberry(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let n = 0; n < N; n++) {
    const name = pick(['rect', 'rect', 'tri', 'cc']); const P = pools[name];
    const k = 1 + Math.floor(rnd() * 6);
    let rules = shuffle(P.pool).slice(0, k).map((r) => ({ ...r }));
    if (rnd() < 0.2) { const d = rules.filter((r) => typeof r.value === 'number'); if (d.length) { const r = pick(d); r.value = r.value * 1.1 + 1; } }
    rules = [...P.base, ...rules];
    const b = R.brepDiag(P.geoms, rules);
    let ind; try { ind = analyse(P.geoms, rules); } catch (e) { ind = { unsupported: String(e) }; }
    const s = R.scSketch(P.geoms, rules);
    const row = { seed, n, name, rules, brep: b.open ? { open: b.open } : { bucket: b.bucket, dof: b.dof }, indep: ind.unsupported ? { unsupported: ind.unsupported } : { consistent: ind.consistent, dof: ind.dof } };
    if (s.mapperRefused) row.sc = { mapperRefused: s.mapperRefused };
    else {
      row.sc = { refusal: s.firstRefusal && { command: s.firstRefusal.command, error: s.firstRefusal.error }, status: s.report?.status, dof: s.report?.dof, failing: s.report?.failing, redundant: s.report?.redundant?.length ?? 0, profiles: s.profiles, extrudeError: s.extrudeError, volume: s.volume };
      if (!s.firstRefusal && s.solved) {
        const m = metrics(P.geoms, s.solved, rules);
        row.metrics = { minVsDiag: m.minVsDiag, minVsDrawn: m.minVsDrawn, worstOver: m.worst?.over, worstKind: m.worst?.kind, worstResidual: m.worst?.residual };
        if (ind.solved && ind.consistent) { const om = metrics(P.geoms, ind.solved, rules); row.metrics.oracleMinVsDiag = om.minVsDiag; }
        const g = guardSolved(P.geoms, s.solved, rules);
        row.guard = g.ok ? { ok: true } : { ok: false, kind: g.kind, sentence: g.sentence };
      }
    }
    rows.push(row);
  }
}
// ---- classification. truth: infeasible = (brep conflicting|globallyInfeasible) AND independent LM did not converge; feasible = brep consistent|redundant OR independent converged
const truth = (r) => {
  if (r.brep.open) return 'open-fail';
  const bk = r.brep.bucket; const infe = (bk === 'conflicting' || bk === 'globallyInfeasible');
  if (!infe) return 'feasible';
  return r.indep.consistent === false ? 'infeasible' : r.indep.consistent === true ? 'feasible(brep-missed)' : 'infeasible?';
};
const C = {};
const add = (k, r) => { (C[k] ??= []).push(r); };
for (const r of rows) {
  const t = truth(r);
  if (r.sc.mapperRefused) { add(`${t}|mapper-refused`, r); continue; }
  const refused = !!r.sc.refusal;
  add(`${t}|${refused ? 'sc-refused' : 'sc-accepted'}|${r.guard ? (r.guard.ok ? 'guard-pass' : 'guard-' + r.guard.kind) : '-'}`, r);
}
const summary = Object.fromEntries(Object.entries(C).sort().map(([k, v]) => [k, v.length]));
console.log(JSON.stringify(summary, null, 1));
const silentAccepts = rows.filter((r) => truth(r) === 'infeasible' && !r.sc.mapperRefused && !r.sc.refusal);
const slivers = silentAccepts.filter((r) => r.metrics && r.metrics.minVsDiag < 1e-2);
console.log('infeasible total', rows.filter((r) => truth(r) === 'infeasible').length, 'silent accepts (no refusal at any rule command)', silentAccepts.length, 'of which solved geometry has a line/radius < 1e-2 of diag', slivers.length);
const hist = (arr) => { const b = {}; for (const v of arr) { const e = v <= 0 ? 'neg/0' : Math.floor(Math.log10(v)); b[e] = (b[e] ?? 0) + 1; } return b; };
console.log('minVsDiag decade histogram, silent accepts of infeasible:', JSON.stringify(hist(silentAccepts.filter((r) => r.metrics).map((r) => r.metrics.minVsDiag))));
const feas = rows.filter((r) => truth(r).startsWith('feasible') && r.metrics);
console.log('minVsDiag decade histogram, feasible accepted:', JSON.stringify(hist(feas.map((r) => r.metrics.minVsDiag))), 'n', feas.length);
console.log('feasible accepted: min of minVsDiag', Math.min(...feas.map((r) => r.metrics.minVsDiag)), ' max worstOver (residual / tol)', Math.max(...feas.map((r) => r.metrics.worstOver ?? 0)));
const fired = rows.filter((r) => truth(r).startsWith('feasible') && r.guard && !r.guard.ok);
const spurious = fired.filter((r) => (r.metrics.oracleMinVsDiag ?? 0) >= 1e-2);
console.log('feasible rule sets where SC collapsed the part although the independent solver keeps every edge >= 1e-2 of the diagonal (SC WRONG, correct part exists):', spurious.length, JSON.stringify(spurious.slice(0, 6).map((r) => [r.seed, r.n, r.name, r.metrics.minVsDiag, r.metrics.oracleMinVsDiag, r.sc.volume])));
const fp = fired.filter((r) => (r.metrics.oracleMinVsDiag ?? 0) >= 1e-2 && r.metrics.minVsDiag >= 1e-2);
console.log('GUARD false positives (guard fires although SC and the oracle both keep every edge >= 1e-2 of diag):', fp.length, JSON.stringify(fp.slice(0, 5).map((r) => [r.seed, r.n, r.guard.kind, r.guard.sentence, JSON.stringify(r.rules.slice(R.loopJoins(1).length))])));
const fn = silentAccepts.filter((r) => r.guard?.ok);
console.log('GUARD false negatives (infeasible, sc accepted, guard passes):', fn.length, JSON.stringify(fn.slice(0, 5).map((r) => [r.seed, r.n, r.name, r.metrics, JSON.stringify(r.rules)])));
const flips = rows.filter((r) => r.sc && !r.sc.refusal && r.metrics && r.metrics.worstOver > 1 && truth(r).startsWith('feasible'));
console.log('feasible, sc accepted, a driving rule NOT held by the solved geometry (rule-check):', flips.length, JSON.stringify(flips.slice(0, 6).map((r) => [r.seed, r.n, r.name, r.metrics.worstKind, +r.metrics.worstResidual.toFixed(3), r.guard?.kind])));
writeFileSync(new URL('./r3b.json', import.meta.url), JSON.stringify({ summary, rows }, null, 0));
