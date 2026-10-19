// ROUND 4 section D: dof, redundancy, conflicts and the start-state dependence, all on the STOCK pkg.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/sketch-dof-diagnosis/r4d.mjs   (writes r4d.json)
import { writeFileSync, readFileSync } from 'node:fs';
import * as R from './r4-lib.mjs';
import { guardedSoup, rawBuild, findWitness, redundantRules, diagnose, plainProblems } from './soup-guard2.mjs';
import { analyse } from './indep.mjs';
import * as G from './legacy.mjs';

const { clone, e2, mulberry, H } = R;
const OUT = {};
const jitter = (geoms, amp, rnd) => geoms.map((q) => { const o = clone(q); for (const k of ['a', 'b', 'c', 'p']) if (o[k]) o[k] = [o[k][0] + (rnd() * 2 - 1) * amp, o[k][1] + (rnd() * 2 - 1) * amp]; return o; });
const all = [...R.fixtures.OWN, ...R.fixtures.gauntletFixtures()];
const slot = (Lx, Rr) => (Lx * 2 * Rr + Math.PI * Rr * Rr);

// ---------------- D1: dof per sketch. truth = FreeCAD ref (gauntlet) or the hand count (own); SolidCraft = rank by refusal probing; guard = independent Jacobian nullity ----------------
{
  const rows = [];
  for (const fx of all) {
    const fc = fx.gauntlet ? R.fcRef(fx.id) : null;
    const truth = fc ? fc.dof : fx.expectDof ?? null;
    for (const [mode, amp] of [['stored', 0], ['jitter0.2mm', 0.2]]) {
      const rnd = mulberry(1000 + fx.id.length);
      const geoms = amp ? jitter(fx.geoms, amp, rnd) : clone(fx.geoms);
      const sc = R.rankByProbe(geoms, fx.rules, { plane: fx.plane });
      const b = R.brepSketch(geoms, fx.rules);
      let ind; try { ind = analyse(geoms, fx.rules); } catch { ind = {}; }
      const dg = diagnose(geoms, fx.rules); const normB = (k) => (k === 'globallyInfeasible' ? 'conflicting' : k);
      rows.push({ id: fx.id, mode, truth, truthBucket: fc ? fc.bucket : null, guardBucket: dg.bucket, guardDof: dg.dof, guardRedundant: dg.redundant.length, fcRedundant: fc ? fc.redundant.length : null, brepBucket: b.open ? 'open-failed' : normB(b.diag?.bucket) ?? null, scProbeDof: sc.dof ?? (sc.mapperRefused ? 'mapper-refused' : sc.baseRefused ? 'base-refused' : null), brepDof: b.open ? 'open-failed' : b.diag?.dof ?? null, indepDof: ind.dof ?? null, indepConsistent: ind.consistent ?? null });
    }
  }
  const have = rows.filter((r) => r.truth !== null);
  const agree = (k) => have.filter((r) => r[k] === r.truth).length;
  const byMode = (mode) => have.filter((r) => r.mode === mode);
  const agreeM = (mode, k) => byMode(mode).filter((r) => r[k] === r.truth).length;
  const hb = rows.filter((r) => r.truthBucket);
  const bucketAgree = (k) => hb.filter((r) => r[k] === r.truthBucket).length;
  OUT.d1b = { withFreecadBucket: hb.length, guardAgrees: bucketAgree('guardBucket'), brepAgrees: bucketAgree('brepBucket'),
    guardDisagrees: hb.filter((r) => r.guardBucket !== r.truthBucket).map((r) => [r.id, r.mode, r.truthBucket, r.guardBucket]),
    redundantCountMatchesFreecad: hb.filter((r) => r.truthBucket === 'redundant').map((r) => [r.id, r.mode, r.fcRedundant, r.guardRedundant]) };
  console.log('D1b', JSON.stringify(OUT.d1b));
  OUT.d1 = { rows, withTruth: have.length, agree: { sc: agree('scProbeDof'), brep: agree('brepDof'), indep: agree('indepDof') },
    byMode: { stored: { n: byMode('stored').length, sc: agreeM('stored', 'scProbeDof'), brep: agreeM('stored', 'brepDof'), indep: agreeM('stored', 'indepDof') }, 'jitter0.2mm': { n: byMode('jitter0.2mm').length, sc: agreeM('jitter0.2mm', 'scProbeDof'), brep: agreeM('jitter0.2mm', 'brepDof'), indep: agreeM('jitter0.2mm', 'indepDof') } },
    scWrong: have.filter((r) => r.scProbeDof !== r.truth).map((r) => [r.id, r.mode, r.truth, r.scProbeDof]) };
  console.log('D1', JSON.stringify({ ...OUT.d1, rows: undefined }));
}

// ---------------- D2/D3: the exactly-tangent slot: redundant dimensions through a tangent chain, accept/refuse flips with the start state ----------------
{
  const fx = R.fixtures.gauntletFixtures().find((x) => x.id === 'sk-circle-arc-tangent__slot-r6-L30-anchored');
  const centres = (v) => ({ k: 'distance', a: 2, aEnd: 'c', b: 4, bEnd: 'c', value: v });
  const topLen = (v) => ({ k: 'distance', a: 3, aEnd: 'a', b: 3, bEnd: 'b', value: v });
  const outcome = (b) => (b.built ? 'built' : b.mapperRefused ? 'mapper' : /already determined/.test(b.refusal.error) ? 'refused:already-determined' : /different value/.test(b.refusal.error) ? 'refused:DIFFERENT-VALUE' : 'refused:other');
  OUT.d2 = { fixture: fx.id, trialsPerCell: 25, cells: [] };
  for (const [name, extra] of [['centres=30 (implied by the tangent chain)', centres(30)], ['top line length=30 (implied)', topLen(30)]]) {
    for (const amp of [0, 0.02, 0.2, 1]) {
      const tally = {}; const gtally = {}; const rnd = mulberry(100 + Math.round(amp * 1000));
      const N = amp === 0 ? 1 : 25;
      for (let t = 0; t < N; t++) {
        const g = amp === 0 ? clone(fx.geoms) : jitter(fx.geoms, amp, rnd);
        for (const flag of [false, true]) { const k = (flag ? 'flag:' : 'noflag:') + outcome(R.scBuild(g, [...fx.rules, extra], { patch: flag ? R.drivenAll : undefined })); tally[k] = (tally[k] ?? 0) + 1; }
        const gs = guardedSoup(g, [...fx.rules, extra], { skipRaw: true });
        const gk = gs.outcome === 'built' ? (Math.abs(gs.measure.volume - slot(30, 6) * H) / (slot(30, 6) * H) < 3e-4 ? 'built-correct' : 'BUILT-WRONG') : 'refused:' + gs.stage;
        gtally[gk] = (gtally[gk] ?? 0) + 1;
      }
      OUT.d2.cells.push({ extra: name, jitterMm: amp, trials: N, raw: tally, guard: gtally });
      console.log('D2', name.padEnd(46), 'jitter', String(amp).padEnd(5), 'raw', JSON.stringify(tally), 'guard', JSON.stringify(gtally));
    }
  }
  // D3: a redundant dimension accepted on the stored start becomes a hidden driver; the next edit conflicts with it
  OUT.d3 = [];
  for (const [mode, amp] of [['stored', 0], ['jitter0.2mm', 0.2]]) {
    const g = amp ? jitter(fx.geoms, amp, mulberry(5)) : clone(fx.geoms);
    const edit = (L40) => { const r = clone(fx.rules); r[11].value = L40; return r; };
    const row = { start: mode, base: outcome(R.scBuild(g, fx.rules)), plusCentres30: outcome(R.scBuild(g, [...fx.rules, centres(30)])), lengthTo40_withoutExtra: outcome(R.scBuild(g, edit(40))),
      lengthTo40_withCentres30Kept: outcome(R.scBuild(g, [...edit(40), centres(30)])), lengthTo40_withCentres30Kept_flag: outcome(R.scBuild(g, [...edit(40), centres(30)], { patch: R.drivenAll })) };
    const gs = guardedSoup(g, [...edit(40), centres(30)], { skipRaw: true });
    row.guard_lengthTo40_withCentres30 = { outcome: gs.outcome, stage: gs.stage, sentence: gs.sentence ?? null, problems: gs.sentence ? plainProblems(gs.sentence) : null };
    const g2 = guardedSoup(g, [...edit(40)], { skipRaw: true });
    row.guard_lengthTo40_alone = { outcome: g2.outcome, volume: g2.measure && e2(g2.measure.volume), closed: e2(slot(40, 6) * H), rel: g2.measure && e2(Math.abs(g2.measure.volume - slot(40, 6) * H) / (slot(40, 6) * H)) };
    OUT.d3.push(row); console.log('D3', JSON.stringify(row));
  }
}

// ---------------- D4: redundant NON-dimension rules and dimensions on a rectangle: SolidCraft (if_redundant:"refuse" proxy) vs the guard's rank listing ----------------
{
  const base = [...R.shape(), { k: 'lock', a: 1, aEnd: 'a' }, R.len(1, 30), R.len(2, 20)];
  const geoms = R.rect(0, 0, 30, 20);
  const cases = [
    ['horizontal written twice', { k: 'horizontal', a: 1 }, true], ['perpendicular(1,2) implied by h/v', { k: 'perpendicular', a: 1, b: 2 }, true], ['parallel(1,3) implied', { k: 'parallel', a: 1, b: 3 }, true],
    ['duplicate join coincident(1b,2a)', R.join(1, 2), true], ['origin coincident on a locked corner', { k: 'coincident', a: 1, aEnd: 'a', b: -1, bEnd: 'a' }, true], ['lock written twice', { k: 'lock', a: 1, aEnd: 'a' }, true],
    ['equal(1,3) implied (30=30 through h/v + lengths)', { k: 'equal', a: 1, b: 3 }, true], ['length(3)=30 implied dimension', R.len(3, 30), true], ['distanceX(1a,1b)=30 implied dimension', { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }, true],
    ['control: length(3)=31 (a conflict, not a redundancy)', R.len(3, 31), false], ['control: perpendicular(1,3) is NOT implied (parallel edges)', { k: 'perpendicular', a: 1, b: 3 }, false],
  ];
  OUT.d4 = { rows: [] };
  for (const [name, extra, isRedundant] of cases) {
    const rules = [...base, extra];
    const refuse = R.scBuild(geoms, rules, { patch: R.refuseAll });
    const plain = R.scBuild(geoms, rules);
    const driven = R.scBuild(geoms, rules, { patch: R.drivenAll });
    const w = findWitness(geoms, rules);
    const red = w.witness ? redundantRules(w.witness, rules) : { note: 'no witness' };
    const idx = rules.length - 1;
    const row = { case: name, trulyRedundant: isRedundant,
      scAsWritten: plain.built ? 'accepted+built' : plain.refusal ? 'REFUSED: ' + plain.refusal.error.slice(0, 110) : 'mapper', scRefuseFlag: refuse.built ? 'accepted (not detected as redundant)' : refuse.refusal ? 'refused: ' + refuse.refusal.error.slice(0, 80) : 'mapper', scDrivenFlag: driven.built ? 'built' : driven.refusal ? 'refused: ' + driven.refusal.error.slice(0, 80) : 'mapper',
      guardWitness: w.witness ? 'feasible' : w.fail.kind, guardRedundantListIncludesNewRule: red.redundant ? red.redundant.includes(idx) : null, guardRedundantCount: red.redundant?.length ?? null };
    OUT.d4.rows.push(row); console.log('D4', JSON.stringify(row));
  }
  const rr = OUT.d4.rows;
  OUT.d4.summary = { truthRedundant: rr.filter((r) => r.trulyRedundant).length, guardFlagsRedundant: rr.filter((r) => r.trulyRedundant && r.guardRedundantListIncludesNewRule).length, guardFalseFlags: rr.filter((r) => !r.trulyRedundant && r.guardRedundantListIncludesNewRule).length,
    scRefuseDetects: rr.filter((r) => r.trulyRedundant && r.scRefuseFlag.startsWith('refused')).length, scAcceptsSilently: rr.filter((r) => r.trulyRedundant && r.scRefuseFlag.startsWith('accepted')).length };
  console.log('D4 summary', JSON.stringify(OUT.d4.summary));
}

// ---------------- D5: the named conflict / collapse / sign cases, raw vs guard ----------------
{
  const cases = [];
  const T = R.TRI(); const RC = R.rect(0, 0, 30, 20);
  const add = (id, geoms, rules, note, extra = {}) => cases.push({ id, geoms, rules, note, ...extra });
  add('N1 triangle, two right angles', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }], 'round 3 sliver');
  add('N2 triangle, perpendicular(1,3)+equal(1,2)', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 3 }, { k: 'equal', a: 1, b: 2 }], 'feasible, under-determined');
  add('N3 rectangle h/v + angle 45', RC, [...R.shape(), { k: 'angle', a: 1, b: 2, value: 45 }], 'impossible');
  add('N4 triangle, three perpendiculars', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'perpendicular', a: 1, b: 3 }], 'control');
  const C2 = [{ k: 'circle', id: 1, c: [5, 5], r: 4 }, { k: 'circle', id: 2, c: [20, 6], r: 3 }];
  const sg = (dy) => [{ k: 'coincident', a: 1, aEnd: 'c', b: -1, bEnd: 'a' }, { k: 'distance', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 15.033296378372908 }, { k: 'distanceY', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: dy }];
  add('SIGN-1 distanceY +2.1, start dy=+1', C2, sg(2.1), 'signed flip'); add('SIGN-2 distanceY +1, start dy=+1', C2, sg(1), 'smaller value'); add('SIGN-3 distanceY +2.1, start dy=+0.5', [C2[0], { ...C2[1], c: [20, 5.5] }], sg(2.1), 'closer start');
  const HVr = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
  for (const [id, pts, cons] of [['M3 rect + up on a horizontal edge', [[0, 0], [40, 0], [40, 25], [0, 25]], [...HVr, { kind: 'vertical', edge: 0 }]], ['M3b skew quad, across+up on one edge', [[0, 0], [40, 3], [41, 25], [1, 24]], [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }]], ['M3c hexagon, across+up on one edge', [[0, 0], [20, -3], [40, 0], [40, 20], [20, 25], [0, 20]], [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }]]]) { const { geoms, rules } = G.toSoup(pts, cons); add(id, geoms, rules, 'horizontal AND vertical on one edge'); }
  try { const j = JSON.parse(readFileSync(new URL('./r3b.json', import.meta.url), 'utf8')); const f = j.rows.find((r) => r.seed === 2 && r.n === 94); add('ANGLE-FLIP rect: equal(1,2), diagonal, length(3)=30, angle(1,2)=45 (fuzz seed 2 case 94)', R.rect(3, 2, 33, 22), f.rules, 'undirected angle'); } catch { /* r3b.json is committed; skip if absent */ }
  for (const c of G.CONFLICT) { const { geoms, rules } = G.toSoup(c.pts, [...c.cons, c.add]); add('legacy ' + c.id, geoms, rules, 'two rules that fight'); }
  for (const id of ['sk-conflict__width-30-vs-35', 'sk-conflict__radius-vs-diameter', 'sk-conflict__equal-vs-two-radii']) { const f = all.find((x) => x.id === id); if (f) add(id, f.geoms, f.rules, 'gauntlet conflict', { plane: f.plane }); }
  OUT.d5 = { rows: [] };
  for (const c of cases) {
    const raw = R.scBuild(c.geoms, c.rules, { plane: c.plane });
    const g = guardedSoup(c.geoms, c.rules, { plane: c.plane, skipRaw: true });
    const b = R.brepSketch(c.geoms, c.rules);
    const row = { id: c.id, note: c.note, brepBucket: b.open ? 'open-failed' : b.diag?.bucket,
      raw: raw.built ? { status: 'built', volume: e2(raw.volume), bodies: raw.bodies } : raw.mapperRefused ? { status: 'mapper-refused', sentence: raw.mapperRefused[0]?.slice(0, 160) } : { status: 'refused-at-command', command: raw.refusal.command, error: raw.refusal.error.slice(0, 140) },
      guard: { outcome: g.outcome, stage: g.stage, sentence: g.sentence ?? null, problems: g.sentence ? plainProblems(g.sentence) : null, volume: g.measure && e2(g.measure.volume), dof: g.dof } };
    OUT.d5.rows.push(row); console.log('D5', row.id.padEnd(60), 'brep', row.brepBucket, '| RAW', row.raw.status, row.raw.volume ?? '', '| GUARD', g.outcome, g.measure ? e2(g.measure.volume) : g.sentence?.slice(0, 100));
  }
}
writeFileSync(new URL('./r4d.json', import.meta.url), JSON.stringify(OUT, null, 1));
