// ROUND 4 section C: the SOUP route on the STOCK pkg only (no wrapper2): the silent wrong solids of round 3 reproduced, then the same inputs through soup-guard2.mjs.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/sketch-dof-diagnosis/r4c.mjs   (writes r4c.json)
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
import { guardedSoup, rawBuild, plainProblems, HEIGHT as H } from './soup-guard2.mjs';

const clone = L.clone;
const e2 = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? +x.toExponential(3) : String(x)) : x);
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const OUT = {};
const LN = (id, a, b) => ({ k: 'line', id, a, b });
const join = (i, j) => ({ k: 'coincident', a: i, aEnd: 'b', b: j, bEnd: 'a' });
const centre = (b) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2];

// ---------------- C1: two right angles on a triangle ----------------
{
  const TRI = [LN(1, [0, 0], [40, 0]), LN(2, [40, 0], [10, 25]), LN(3, [10, 25], [0, 0])];
  const tj = [join(1, 2), join(2, 3), join(3, 1)];
  const cases = {
    twoRightAngles: [...tj, { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }],
    threeRightAngles: [...tj, { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'perpendicular', a: 1, b: 3 }],
    perp13_equal12: [...tj, { k: 'perpendicular', a: 1, b: 3 }, { k: 'equal', a: 1, b: 2 }],
    oneRightAngleControl: [...tj, { k: 'perpendicular', a: 1, b: 3 }, { k: 'lock', a: 1, aEnd: 'a' }, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }, { k: 'distance', a: 3, aEnd: 'a', b: 3, bEnd: 'b', value: 25 }],
  };
  OUT.c1 = {};
  for (const [name, rules] of Object.entries(cases)) {
    const raw = rawBuild(TRI, rules); const g = guardedSoup(TRI, rules);
    OUT.c1[name] = { raw: raw.status === 'built' ? { status: 'built', volume: e2(raw.volume), faces: raw.faces } : { status: raw.status, error: (raw.error ?? raw.sentence)?.slice(0, 160) },
      guard: { outcome: g.outcome, stage: g.stage, sentence: g.sentence ?? null, problems: g.sentence ? plainProblems(g.sentence) : null, volume: g.measure && e2(g.measure.volume), dof: g.dof, rawAgrees: g.rawAgrees } };
    console.log('C1', name, JSON.stringify(OUT.c1[name]));
  }
}

// ---------------- C2: signed dimension flip ----------------
{
  const rules = (variant, v) => variant === 'dist' ? [{ k: 'coincident', a: 1, aEnd: 'c', b: -1, bEnd: 'a' }, { k: 'distance', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 15.0333 }, { k: 'distanceY', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: v }]
    : [{ k: 'lock', a: 1, aEnd: 'c' }, { k: 'distanceY', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: v }];
  const rows = [];
  for (const variant of ['dist', 'lock']) for (const dy0 of [0.2, 0.5, 1, 2, 2.5, 3, 5, 10]) {
    const geoms = [{ k: 'circle', id: 1, c: variant === 'dist' ? [5, 5] : [0, 0], r: 4 }, { k: 'circle', id: 2, c: [20, (variant === 'dist' ? 5 : 0) + dy0], r: 3 }];
    const R = rules(variant, 2.1);
    const raw = rawBuild(geoms, R);
    const g = guardedSoup(geoms, R);
    const readDy = (st) => { // st.bbox: per body; identify by bbox width (2r)
      if (!st.bbox || st.bbox.length !== 2) return null; const w = (b) => b[3] - b[0]; const big = st.bbox.find((b) => Math.abs(w(b) - 8) < 1e-3), small = st.bbox.find((b) => Math.abs(w(b) - 6) < 1e-3);
      if (!big || !small) return null; return +(centre(small)[1] - centre(big)[1]).toFixed(4);
    };
    rows.push({ variant, startDy: dy0, askedDy: 2.1, rawDy: raw.status === 'built' ? readDy(raw) : raw.status, guardOutcome: g.outcome, guardDy: g.measure ? readDy(g.measure) : null, guardSentence: g.sentence ?? null });
  }
  OUT.c2 = { rows, rawFlips: rows.filter((r) => typeof r.rawDy === 'number' && Math.abs(r.rawDy - 2.1) > 1e-3).length, rawCorrect: rows.filter((r) => typeof r.rawDy === 'number' && Math.abs(r.rawDy - 2.1) <= 1e-3).length, guardWrong: rows.filter((r) => r.guardOutcome === 'built' && Math.abs(r.guardDy - 2.1) > 1e-3).length, guardBuiltCorrect: rows.filter((r) => r.guardOutcome === 'built' && Math.abs(r.guardDy - 2.1) <= 1e-3).length, guardRefused: rows.filter((r) => r.guardOutcome === 'refused').length };
  console.log('C2', JSON.stringify({ ...OUT.c2, rows: undefined }));
  console.log(rows.map((r) => `${r.variant} start ${r.startDy} raw ${r.rawDy} guard ${r.guardDy ?? r.guardSentence}`).join('\n'));
}

// ---------------- C3: arc-first-order slot, jittered starts (tangent docs): the guard-completeness test ----------------
{
  const fx = L.fixtures.gauntletFixtures().find((x) => x.id === 'sk-circle-arc-tangent__slot-arc-first-order');
  const closed = fx.closed * H;
  const diag = (() => { const p = []; for (const g of fx.geoms) for (const k of ['a', 'b']) if (g[k]) p.push(g[k]); const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); })();
  const jitter = (amp, rnd) => {
    const locked = new Set(fx.rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
    const mv = (p) => [p[0] + (rnd() * 2 - 1) * amp, p[1] + (rnd() * 2 - 1) * amp];
    return fx.geoms.map((g) => { const o = clone(g); const lk = (e) => locked.has(`${g.id}:${e}`);
      if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); }
      if (g.k === 'arc') { if (!lk('c')) o.c = mv(g.c); if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
      return o; });
  };
  OUT.c3 = { fixture: fx.id, closedVolume: closed, diag: +diag.toFixed(3), levels: [] };
  const N = +(process.env.C3_N ?? 60);
  for (const frac of [0.005, 0.01, 0.02, 0.035]) {
    const rnd = mulberry(Math.floor(frac * 1e4) + fx.id.length); const lv = { jitterFracOfDiag: frac, n: N, rawWrong: 0, rawRefused: 0, rawOk: 0, guardBuiltOk: 0, guardBuiltWrong: 0, guardRefused: 0, guardRefusedStages: {}, rawWrongWorstRel: 0, guardWorstRel: 0, rawWrongButGuardOk: 0 };
    for (let t = 0; t < N; t++) {
      const geoms = jitter(frac * diag, rnd);
      const raw = rawBuild(fx.geoms.length ? geoms : geoms, fx.rules);
      const rawRel = raw.status === 'built' ? Math.abs(raw.volume - closed) / closed : null;
      if (raw.status !== 'built') lv.rawRefused++; else if (rawRel > 3e-4) { lv.rawWrong++; lv.rawWrongWorstRel = Math.max(lv.rawWrongWorstRel, rawRel); } else lv.rawOk++;
      const g = guardedSoup(geoms, fx.rules, { skipRaw: true });
      if (g.outcome === 'built') { const rel = Math.abs(g.measure.volume - closed) / closed; lv.guardWorstRel = Math.max(lv.guardWorstRel, rel); if (rel > 3e-4) lv.guardBuiltWrong++; else { lv.guardBuiltOk++; if (rawRel !== null && rawRel > 3e-4) lv.rawWrongButGuardOk++; } }
      else { lv.guardRefused++; lv.guardRefusedStages[g.stage] = (lv.guardRefusedStages[g.stage] ?? 0) + 1; }
    }
    lv.rawWrongWorstRel = e2(lv.rawWrongWorstRel); lv.guardWorstRel = e2(lv.guardWorstRel);
    OUT.c3.levels.push(lv); console.log('C3', JSON.stringify(lv));
  }
}

// ---------------- C5: every phase-2 fixture (34), stored start and a rough start, raw vs guard vs closed form ----------------
{
  const all = [...L.fixtures.OWN, ...L.fixtures.gauntletFixtures()];
  const rows = [];
  for (const fx of all) {
    for (const mode of ['stored', 'rough']) {
      const rnd = mulberry(7 + fx.id.length);
      const geoms = mode === 'stored' ? clone(fx.geoms) : (() => { const locked = new Set(fx.rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`)); const mv = (p) => [p[0] + (rnd() * 2 - 1) * 0.6, p[1] + (rnd() * 2 - 1) * 0.6];
        return fx.geoms.map((g) => { const o = clone(g); const lk = (e) => locked.has(`${g.id}:${e}`); if (g.k === 'point' && !lk('a')) o.p = mv(g.p); if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); } if (g.k === 'circle') { if (!lk('c')) o.c = mv(g.c); o.r = g.r * (1 + 0.05 * (rnd() * 2 - 1)); } if (g.k === 'arc') { if (!lk('c')) o.c = mv(g.c); if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); o.r = g.r * (1 + 0.05 * (rnd() * 2 - 1)); } return o; }); })();
      const closed = fx.closed != null ? fx.closed * H : null;
      const raw = rawBuild(geoms, fx.rules); const g = guardedSoup(geoms, fx.rules, { skipRaw: true });
      const rr = raw.status === 'built' && closed ? Math.abs(raw.volume - closed) / closed : null;
      const gr = g.outcome === 'built' && closed ? Math.abs(g.measure.volume - closed) / closed : null;
      rows.push({ id: fx.id, mode, closed, raw: raw.status === 'built' ? 'built' : raw.status, rawRel: rr === null ? null : e2(rr), guard: g.outcome, guardStage: g.stage, guardRel: gr === null ? null : e2(gr), guardDof: g.dof, expectDof: fx.expectDof ?? null, sentence: g.sentence ?? null });
    }
  }
  const curved = (id) => /slot|circle|arc|washer|hexagon/.test(id);
  OUT.c5 = { rows, n: rows.length,
    guardBuilt: rows.filter((r) => r.guard === 'built').length, guardRefused: rows.filter((r) => r.guard === 'refused').length,
    guardBuiltWrong: rows.filter((r) => r.guard === 'built' && r.guardRel !== null && +r.guardRel > (curved(r.id) ? 3e-4 : 1e-9)).length,
    guardBuiltNoClosedForm: rows.filter((r) => r.guard === 'built' && r.guardRel === null).length,
    rawWrong: rows.filter((r) => r.raw === 'built' && r.rawRel !== null && +r.rawRel > (curved(r.id) ? 3e-4 : 1e-9)).length,
    refusedSentences: rows.filter((r) => r.sentence).map((r) => [r.id, r.mode, r.stage, r.sentence]) };
  console.log('C5', JSON.stringify({ ...OUT.c5, rows: undefined }));
}
writeFileSync(new URL('./r4c.json', import.meta.url), JSON.stringify(OUT, null, 1));
