// ROUND 4 section C2: random soup rule sets (rect / triangle / two circles / the exactly-tangent slot with jittered starts and extra dimensions), raw vs guard, on the STOCK pkg.
// The pools are round 3's (r3b.mjs) plus a TANGENT pool, because round 3's fuzz had no tangent rules and so said nothing about rule-satisfying wrong-branch builds.
//   SEEDS=1,2 N=250 SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/sketch-dof-diagnosis/r4c2.mjs   (writes r4c2.json)
//
// Truth per case (three independent opinions, none of them SolidCraft):
//   feasible    : brep-rs diagnose says consistent|redundant, OR indep.mjs (its own LM, 1 start) converged, OR the guard's witness search found a witness verified by two evaluators
//   infeasible  : brep-rs says conflicting|globallyInfeasible AND neither indep nor the guard found a witness
// Expected volume of a built part: shoelace of the witness (polygons), pi r^2 (separate circles), the slot closed form; null where no closed form is available.
import { writeFileSync } from 'node:fs';
import * as R from './r4-lib.mjs';
import { guardedSoup, rawBuild, plainProblems } from './soup-guard2.mjs';
import { analyse } from './indep.mjs';

const { clone, e2, mulberry, H } = R;
const SEEDS = (process.env.SEEDS ?? '1,2').split(',').map(Number); const N = +(process.env.N ?? 250);
const T = R.TRI(); const RC = R.rect(3, 2, 33, 22);
const CC = [{ k: 'circle', id: 1, c: [5, 5], r: 4 }, { k: 'circle', id: 2, c: [20, 6], r: 3 }, { k: 'line', id: 3, a: [0, 0], b: [30, 2], construction: true }];   // the free line is a construction line: a loose drawn edge is an outline problem (refused by the outline rule), not a solver problem
const SLOT = R.fixtures.gauntletFixtures().find((x) => x.id === 'sk-circle-arc-tangent__slot-arc-first-order');
const SLOT_CLOSED = (30 * 12 + Math.PI * 36) * H;
const centres = (v) => ({ k: 'distance', a: 2, aEnd: 'c', b: 4, bEnd: 'c', value: v });
const topLen = (v) => ({ k: 'distance', a: 3, aEnd: 'a', b: 3, bEnd: 'b', value: v });
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
  // tangent pool: the saved slot (fully constrained: 4 coincident + 4 tangent joins, h, radius, equal radii, origin, centre dx) plus 1 to 3 extras; starts jittered 0 to 3.5% of the diagonal
  slot: { geoms: SLOT.geoms, base: SLOT.rules, pool: [centres(30), centres(31), topLen(30), topLen(33), { k: 'distanceY', a: 1, aEnd: 'a', b: 3, bEnd: 'a', value: 12 }, { k: 'distanceY', a: 1, aEnd: 'a', b: 3, bEnd: 'a', value: 14 },
    { k: 'radius', a: 2, value: 6 }, { k: 'radius', a: 4, value: 7 }, { k: 'diameter', a: 2, value: 12 }, { k: 'horizontal', a: 3 }, { k: 'parallel', a: 1, b: 3 }, { k: 'distance', a: 1, aEnd: 'a', b: 3, bEnd: 'a', value: 35 }], jitter: true },
};
const diagOfG = (gs) => { const p = []; for (const g of gs) for (const k of ['a', 'b']) if (g[k]) p.push(g[k]); const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); };
function jitterSlot(geoms, rules, amp, rnd) {
  const locked = new Set(rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const mv = (p) => [p[0] + (rnd() * 2 - 1) * amp, p[1] + (rnd() * 2 - 1) * amp];
  return geoms.map((g) => { const o = clone(g); const lk = (e) => locked.has(`${g.id}:${e}`);
    if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); }
    if (g.k === 'arc') { if (!lk('c')) o.c = mv(g.c); if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    return o; });
}
/** closed-form expected volume of the part the WITNESS describes, or null */
function expectedVolume(name, witness) {
  if (name === 'rect' || name === 'tri') { const pts = witness.filter((g) => g.k === 'line').map((g) => g.a); return R.polyArea(pts) * H; }
  if (name === 'slot') return SLOT_CLOSED;
  if (name === 'cc') { const [a, b] = witness; if (Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) > a.r + b.r + 1e-6) return Math.PI * (a.r * a.r + b.r * b.r) * H; return null; }
  return null;
}
const rows = [];
for (const seed of SEEDS) {
  const rnd = mulberry(seed * 7919);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let n = 0; n < N; n++) {
    const name = pick(['rect', 'rect', 'tri', 'cc', 'slot', 'slot']); const P = pools[name];
    const k = name === 'slot' ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 6);
    let rules = shuffle(P.pool).slice(0, k).map((r) => ({ ...r }));
    if (name !== 'slot' && rnd() < 0.2) { const d = rules.filter((r) => typeof r.value === 'number'); if (d.length) { const r = pick(d); r.value = r.value * 1.1 + 1; } }
    rules = [...P.base, ...rules];
    const geoms = P.jitter ? jitterSlot(P.geoms, rules, pick([0, 0.005, 0.01, 0.02, 0.035]) * diagOfG(P.geoms), rnd) : P.geoms;
    const b = R.brepSketch(geoms, rules);
    let ind; try { ind = analyse(geoms, rules); } catch { ind = {}; }
    const raw = rawBuild(geoms, rules);
    const g = guardedSoup(geoms, rules, { skipRaw: true });
    const row = { seed, n, name, rules, brep: b.open ? { open: b.open } : { bucket: b.diag?.bucket, dof: b.diag?.dof }, indep: { consistent: ind.consistent ?? null, dof: ind.dof ?? null } };
    row.raw = raw.status === 'built' ? { status: 'built', volume: raw.volume, bodies: raw.bodies, faces: raw.faces } : { status: raw.status, error: (raw.error ?? raw.sentence)?.slice(0, 120) };
    row.guard = { outcome: g.outcome, stage: g.stage, sentence: g.sentence ?? null, dof: g.dof, accepted: g.accepted };
    if (g.outcome === 'built') {
      row.guard.volume = g.measure.volume;
      const ev = expectedVolume(name, g.witness); row.expected = ev;
      if (name === 'rect' || name === 'tri') { // second kernel on the same witness + rules (brep-rs builds polygon sketches; OCCT has no soup sketch builder, and brep-rs refuses the tangent slot)
        const bd = R.brepBuild({ version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, geoms: clone(g.witness), rules: clone(rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }] });
        row.brepVolume = bd.outcome === 'built' ? bd.volume : null; row.brepOutcome = bd.outcome;
      }
      if (ev) row.guard.relErr = Math.abs(g.measure.volume - ev) / ev;
    }
    rows.push(row);
  }
}
const truth = (r) => {
  const bk = r.brep.bucket; const brepInfeasible = bk === 'conflicting' || bk === 'globallyInfeasible';
  const witnessed = r.guard.outcome === 'built';
  if (!brepInfeasible || r.indep.consistent || witnessed) return 'feasible';
  return 'infeasible';
};
const curved = (r) => r.name === 'cc' || r.name === 'slot';
const bar = (r) => (curved(r) ? 3e-4 : 1e-9);
const C = (f) => rows.filter(f).length;
const rawBuilt = (r) => r.raw.status === 'built';
const S = {
  cases: rows.length, byPool: Object.fromEntries(['rect', 'tri', 'cc', 'slot'].map((p) => [p, C((r) => r.name === p)])),
  truthInfeasible: C((r) => truth(r) === 'infeasible'), truthFeasible: C((r) => truth(r) === 'feasible'),
  // RAW (unguarded) wrongness. A raw build is WRONG when (a) the rules are infeasible but SolidCraft built something, or (b) the rules are feasible, the raw volume differs from the closed form by more than the bar
  rawBuiltOnInfeasible: C((r) => truth(r) === 'infeasible' && rawBuilt(r)),
  rawRefusedAtCommandOrMapper: C((r) => !rawBuilt(r)),
  // a raw volume can only be called WRONG when the rules fix the part (witness dof 0); with free dof a different valid part is a different answer, not an error
  rawComparableUnique: C((r) => rawBuilt(r) && r.expected && r.guard.outcome === 'built' && r.guard.dof === 0),
  rawBuiltWrongVolume_dof0: C((r) => rawBuilt(r) && r.expected && r.guard.outcome === 'built' && r.guard.dof === 0 && Math.abs(r.raw.volume - r.expected) / r.expected > bar(r)),
  rawBuiltDifferentVolume_dofPositive: C((r) => rawBuilt(r) && r.expected && r.guard.outcome === 'built' && r.guard.dof > 0 && Math.abs(r.raw.volume - r.expected) / r.expected > bar(r)),
  rawBuiltSameVolume_dofPositive: C((r) => rawBuilt(r) && r.expected && r.guard.outcome === 'built' && r.guard.dof > 0 && Math.abs(r.raw.volume - r.expected) / r.expected <= bar(r)),
  // GUARD
  guardBuilt: C((r) => r.guard.outcome === 'built'), guardRefused: C((r) => r.guard.outcome === 'refused'), guardRefusedStages: rows.filter((r) => r.guard.outcome === 'refused').reduce((o, r) => { o[r.guard.stage] = (o[r.guard.stage] ?? 0) + 1; return o; }, {}),
  guardBuiltWrongVolume: C((r) => r.guard.outcome === 'built' && r.expected && r.guard.relErr > bar(r)),
  guardBuiltNoClosedForm: C((r) => r.guard.outcome === 'built' && !r.expected),
  guardBuiltOnInfeasible: C((r) => r.guard.outcome === 'built' && truth(r) === 'infeasible'),
  guardRefusedOnFeasible_falseRefusals: C((r) => r.guard.outcome === 'refused' && (r.brep.bucket === 'consistent' || r.brep.bucket === 'redundant') && r.indep.consistent),
  guardRefusedOnFeasible_byStageAndPool: rows.filter((r) => r.guard.outcome === 'refused' && (r.brep.bucket === 'consistent' || r.brep.bucket === 'redundant') && r.indep.consistent).reduce((o, r) => { const k = r.guard.stage + '/' + r.name; o[k] = (o[k] ?? 0) + 1; return o; }, {}),
  guardRefusedOnFeasible_byStage: rows.filter((r) => r.guard.outcome === 'refused' && (r.brep.bucket === 'consistent' || r.brep.bucket === 'redundant') && r.indep.consistent).reduce((o, r) => { o[r.guard.stage] = (o[r.guard.stage] ?? 0) + 1; return o; }, {}),
  guardWorstRelErr_planar: e2(Math.max(0, ...rows.filter((r) => !curved(r) && r.guard.relErr !== undefined).map((r) => r.guard.relErr))),
  guardWorstRelErr_curved: e2(Math.max(0, ...rows.filter((r) => curved(r) && r.guard.relErr !== undefined).map((r) => r.guard.relErr))),
  brepRsSecondKernel: { built: C((r) => r.brepVolume != null), refusedOrError: C((r) => r.brepOutcome && r.brepVolume == null), maxRelDiffVsSolidCraftGuardBuild: e2(Math.max(0, ...rows.filter((r) => r.brepVolume != null).map((r) => Math.abs(r.brepVolume - r.guard.volume) / r.guard.volume))) },
  refusalSentencesNotPlain: rows.filter((r) => r.guard.sentence && plainProblems(r.guard.sentence).length).length, sentenceExamples: Object.fromEntries(['preflight:infeasible', 'preflight:collapsed', 'outline', 'kernel'].map((st) => [st, (rows.find((r) => r.guard.stage === st) ?? { guard: {} }).guard.sentence ?? null])),
  tangentPool: { cases: C((r) => r.name === 'slot'), rawBuilt: C((r) => r.name === 'slot' && rawBuilt(r)), rawWrongVolume: C((r) => r.name === 'slot' && rawBuilt(r) && r.expected && Math.abs(r.raw.volume - r.expected) / r.expected > 3e-4), guardWrongVolume: C((r) => r.name === 'slot' && r.guard.outcome === 'built' && r.guard.relErr > 3e-4), guardBuilt: C((r) => r.name === 'slot' && r.guard.outcome === 'built'), guardRefused: C((r) => r.name === 'slot' && r.guard.outcome === 'refused') },
};
console.log(JSON.stringify(S, null, 1));
writeFileSync(new URL('./r4c2.json', import.meta.url), JSON.stringify({ seeds: SEEDS, perSeed: N, summary: S, examples: { guardWrong: rows.filter((r) => r.guard.relErr > bar(r)).slice(0, 5), falseRefusals: rows.filter((r) => r.guard.outcome === 'refused' && (r.brep.bucket === 'consistent' || r.brep.bucket === 'redundant') && r.indep.consistent).slice(0, 8).map((r) => ({ name: r.name, rules: r.rules, sentence: r.guard.sentence, stage: r.guard.stage })), rawWrongSlot: rows.filter((r) => r.name === 'slot' && rawBuilt(r) && r.expected && Math.abs(r.raw.volume - r.expected) / r.expected > 3e-4).slice(0, 4), rawWrongUnique: rows.filter((r) => rawBuilt(r) && r.expected && r.guard.outcome === 'built' && r.guard.dof === 0 && Math.abs(r.raw.volume - r.expected) / r.expected > bar(r)).slice(0, 6).map((r) => ({ name: r.name, rules: r.rules.filter((x) => x.k !== 'coincident'), raw: r.raw.volume, expected: r.expected })), rawBuiltOnInfeasible: rows.filter((r) => truth(r) === 'infeasible' && rawBuilt(r)).map((r) => ({ name: r.name, rules: r.rules.filter((x) => x.k !== 'coincident'), raw: r.raw })) }, rows }, null, 0));
