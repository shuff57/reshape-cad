// LIVE random-population check of the blend-loft guard (round 4). Every case: build the doc, ask the guard, and for every case the guard LETS THROUGH
// build it on live truck AND live OCCT and compare. A pass-but-wrong case is a violation. Cases the guard refuses are also built (when cheap) so the
// over/under-refusal counts are measured, not assumed.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.fuzz-live.mjs --seed=5 --n=40 [--modes=a,b] [--out=file.json] [--refused=1]
// Metric: TRUE relative volume error |T-O|/|O| (rounds 1-3 divided by max(|O|,1), which made the 3e-4 curved bar absolute for solids under 1 mm3).
// Bars: 1e-9 and equal face count for straight-sided pairs; 3e-4 when a circle or an arc is involved (truck volumes are tessellation-derived).
import { writeFileSync } from 'node:fs';
import { circ, sk, bl, full, rel, lcg, regPts, rectPts, roundedRectDoc, truckMeasure, occtMeasure, guardOf, frustumVolume, G, arc, solveDoc } from './blend-loft.live-lib.mjs';
const argv = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const STARTSCAN = argv('startscan', '0') === '1'; // guard on every draw, kernels only for the cases the guard calls 'start' (to size that rare class cheaply)
const SEED = +argv('seed', 5); const N = +argv('n', 30); const OUT = argv('out', ''); const REFUSED = argv('refused', '1') === '1';
const R = lcg(SEED); const U = (a, b) => a + (b - a) * R(); const LU = (a, b) => Math.exp(U(Math.log(a), Math.log(b)));
const relT = (a, b) => Math.abs(a - b) / Math.abs(b);

function offsetPoly(P, d) { // P ccw convex; d[i] inward offset of side i (sides stay parallel to the original)
  const n = P.length; const L = [];
  for (let i = 0; i < n; i++) { const a = P[i]; const b = P[(i + 1) % n]; const e = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(...e); const nr = [-e[1] / l, e[0] / l]; L.push({ p: [a[0] + nr[0] * d[i], a[1] + nr[1] * d[i]], e }); }
  return P.map((_, i) => { const A = L[(i + n - 1) % n]; const B = L[i]; const det = A.e[0] * B.e[1] - A.e[1] * B.e[0]; if (Math.abs(det) < 1e-9) return null; const t = ((B.p[0] - A.p[0]) * B.e[1] - (B.p[1] - A.p[1]) * B.e[0]) / det; return [A.p[0] + A.e[0] * t, A.p[1] + A.e[1] * t]; });
}
const PL = ['xy', 'xz', 'yz'];
const gens = { // (order of keys = default mode order)
  // straight-sided pairs whose sides are parallel: random start corner, winding, lateral shift, gap sign
  par() {
    const n = 3 + Math.floor(R() * 6); const sc = LU(2, 80); const P = regPts(n, sc, U(0, 6.28)).map((p) => [p[0] * U(0.8, 1.2), p[1] * U(0.8, 1.2)]);
    const d = P.map(() => U(-0.15, 0.5) * sc * 0.4); const Q = offsetPoly(P, d); if (Q.some((q) => !q)) return null;
    const sh = [U(-0.5, 0.5) * sc, U(-0.5, 0.5) * sc]; const Q2 = Q.map((q) => [q[0] + sh[0], q[1] + sh[1]]);
    const s = Math.floor(R() * n); const rot = Q2.slice(s).concat(Q2.slice(0, s)); const rev = R() < 0.3; const h = LU(0.5, 150) * (R() < 0.3 ? -1 : 1); const pl = R() < 0.5 ? 'xy' : PL[Math.floor(R() * 3)];
    return { a: sk('a', pl, 0, P), b: sk('b', pl, h, rev ? rot.slice().reverse() : rot), tag: `par n${n} sc${sc.toFixed(1)} shift${s}${rev ? ' rev' : ''} h${h.toFixed(1)} ${pl}`, cls: 'par' };
  },
  // the SAME corner order in both sketches (index aligned), sides parallel: the students' natural drawing
  idx() {
    const n = 3 + Math.floor(R() * 5); const sc = LU(2, 60); const P = regPts(n, sc, U(0, 6.28)).map((p) => [p[0] * U(0.7, 1.3), p[1] * U(0.7, 1.3)]);
    const d = P.map(() => U(-0.1, 0.4) * sc * 0.4); const Q = offsetPoly(P, d); if (Q.some((q) => !q)) return null;
    const sh = [U(-0.3, 0.3) * sc, U(-0.3, 0.3) * sc]; const h = LU(1, 100) * (R() < 0.3 ? -1 : 1);
    return { a: sk('a', 'xy', 0, P), b: sk('b', 'xy', h, Q.map((q) => [q[0] + sh[0], q[1] + sh[1]])), tag: `idx n${n} sc${sc.toFixed(1)} h${h.toFixed(1)}`, cls: 'idx' };
  },
  // rectangle to rectangle: any sizes (aspect swaps included), any centre offset, any start corner, either winding, either gap sign, any named plane
  rectrect() {
    const w1 = LU(2, 80); const h1 = LU(2, 80); const w2 = LU(2, 80); const h2 = LU(2, 80);
    const P = rectPts(U(-20, 20), U(-20, 20), w1, h1); let Q = rectPts(U(-20, 20), U(-20, 20), w2, h2);
    const s = Math.floor(R() * 4); Q = Q.slice(s).concat(Q.slice(0, s)); const rev = R() < 0.4; if (rev) Q = Q.slice().reverse();
    const revP = R() < 0.2; const P2 = revP ? P.slice().reverse() : P; const h = LU(1, 120) * (R() < 0.3 ? -1 : 1); const pl = PL[Math.floor(R() * 3)];
    return { a: sk('a', pl, 0, P2), b: sk('b', pl, h, Q), tag: `rectrect ${w1.toFixed(1)}x${h1.toFixed(1)} -> ${w2.toFixed(1)}x${h2.toFixed(1)} start${s}${rev ? ' revQ' : ''}${revP ? ' revP' : ''} h${h.toFixed(1)} ${pl}`, cls: 'rectrect' };
  },
  regcirc() {
    const n = [3, 4, 5, 6, 8][Math.floor(R() * 5)]; const rp = LU(0.3, 60); const rc = LU(0.3, 60); const lat = [U(-1, 1) * rp, U(-1, 1) * rp]; const cl = R() < 0.5; const rev = R() < 0.3;
    let P = regPts(n, rp, 0, 0, 0); if (rev) P = P.slice().reverse(); P = P.map((p) => [p[0] + lat[0], p[1] + lat[1]]);
    const h = LU(1, 100) * (R() < 0.3 ? -1 : 1); const pl = PL[Math.floor(R() * 3)];
    return { a: cl ? circ('a', 0, 0, rc, pl, 0) : sk('a', pl, 0, P), b: cl ? sk('b', pl, h, P) : circ('b', 0, 0, rc, pl, h), tag: `reg${n} ${cl ? 'c->p' : 'p->c'} rp${rp.toFixed(1)} rc${rc.toFixed(1)} h${h.toFixed(1)} ${pl}${rev ? ' rev' : ''}`, cls: 'regcirc', circleR: rc, size: 2 * rp, gapAbs: Math.abs(h) };
  },
  rectcirc() {
    const w = LU(1, 60); const asp = U(1, 2.05); const hh = w / asp; const rc = LU(0.3, 60); const cl = R() < 0.5; const h = LU(1, 100) * (R() < 0.3 ? -1 : 1);
    const sw = R() < 0.5; const Rr = rectPts(U(-20, 20), U(-20, 20), sw ? w : hh, sw ? hh : w); const C = [U(-20, 20), U(-20, 20)]; /* round 4: one coin flip (round-3 draft flipped twice, so the tag could lie about the aspect) */
    return { a: cl ? circ('a', C[0], C[1], rc, 'xy', 0) : sk('a', 'xy', 0, Rr), b: cl ? sk('b', 'xy', h, Rr) : circ('b', C[0], C[1], rc, 'xy', h), tag: `rect${w.toFixed(1)}x${hh.toFixed(1)} ${cl ? 'c->p' : 'p->c'} rc${rc.toFixed(1)} h${h.toFixed(1)}`, cls: 'rectcirc', circleR: rc, size: w, gapAbs: Math.abs(h), aspect: asp };
  },
  cc() {
    const r1 = LU(0.05, 80); const r2 = LU(0.05, 80); const lat = R() < 0.5 ? 0 : U(0, 200); const ang = U(0, 6.28); const h = LU(0.01, 300) * (R() < 0.2 ? -1 : 1);
    return { a: circ('a', 0, 0, r1, 'xy', 0), b: circ('b', lat * Math.cos(ang), lat * Math.sin(ang), r2, 'xy', h), tag: `cc r${r1.toFixed(2)}->r${r2.toFixed(2)} lat${lat.toFixed(1)} h${h.toFixed(2)}`, cls: 'cc', r1, r2, h, lat };
  },
  // ROUND 5. near-parallel pairs: a parallel pair whose second outline is jittered by eps x size, eps log-uniform 1e-6 .. 3e-3, so the guard's parallel limit (sin 2e-3)
  // is crossed on purpose: the cases it passes must still be right (bar 3e-4, equal faces), the ones it refuses are counted.
  near() {
    const n = 3 + Math.floor(R() * 6); const sc = LU(3, 60); const P = regPts(n, sc, U(0, 6.28)).map((p) => [p[0] * U(0.8, 1.2), p[1] * U(0.8, 1.2)]);
    const Q = offsetPoly(P, P.map(() => U(-0.15, 0.5) * sc * 0.4)); if (Q.some((q) => !q)) return null;
    const eps = LU(1e-6, 3e-3); const J = Q.map((q) => [q[0] + U(-1, 1) * eps * sc, q[1] + U(-1, 1) * eps * sc]); const h = LU(2, 100) * (R() < 0.3 ? -1 : 1); const pl = PL[Math.floor(R() * 3)];
    return { a: sk('a', pl, 0, P), b: sk('b', pl, h, J), tag: `near n${n} sc${sc.toFixed(1)} eps${eps.toExponential(1)} h${h.toFixed(1)} ${pl}`, cls: 'near' };
  },
  // HAND-TYPED polygons: every coordinate rounded to 2 (70%) or 1 (30%) decimals, the way a student types polygon([[10,0],[5,8.66],...]); regular and scaled-by-a-typed-factor shapes
  typed() {
    const n = [3, 4, 5, 6, 8][Math.floor(R() * 5)]; const r1 = LU(3, 40); const r2 = r1 * U(0.3, 0.9); const dec = R() < 0.7 ? 2 : 1; const rd = (P) => P.map((p) => p.map((v) => +v.toFixed(dec)));
    const P = rd(regPts(n, r1, 0)); const Q = rd(regPts(n, r2, 0)); const h = LU(3, 80) * (R() < 0.3 ? -1 : 1); const pl = PL[Math.floor(R() * 3)];
    return { a: sk('a', pl, 0, P), b: sk('b', pl, h, Q), tag: `typed reg${n} r${r1.toFixed(1)}->r${r2.toFixed(1)} dec${dec} h${h.toFixed(1)} ${pl}`, cls: 'typed' };
  },
  typedreg() {
    const n = [4, 5, 6, 8][Math.floor(R() * 4)]; const rp = LU(3, 40); const rc = rp * U(0.5, 1.4); const dec = R() < 0.7 ? 2 : 1; const rd = (P) => P.map((p) => p.map((v) => +v.toFixed(dec)));
    const P = rd(regPts(n, rp, 0)); const cl = R() < 0.5; const h = LU(Math.max(1, 0.3 * rp * 2), 100) * (R() < 0.3 ? -1 : 1); const pl = PL[Math.floor(R() * 3)];
    return { a: cl ? circ('a', 0, 0, rc, pl, 0) : sk('a', pl, 0, P), b: cl ? sk('b', pl, h, P) : circ('b', 0, 0, rc, pl, h), tag: `typed reg${n} ${cl ? 'c->p' : 'p->c'} rp${rp.toFixed(1)} rc${rc.toFixed(1)} dec${dec} h${h.toFixed(1)} ${pl}`, cls: 'typedreg', circleR: rc, size: 2 * rp, gapAbs: Math.abs(h) };
  },
  rrcirc() {
    const w = LU(4, 60); const asp = U(1, 1.4); const hh = w / asp; const r = U(0.02, 0.5) * Math.min(w, hh); const cl = R() < 0.5; const rc = LU(1, 60); const h = LU(2, 100) * (R() < 0.3 ? -1 : 1);
    const RR = (id, off) => roundedRectDoc(id, 'xy', off, w, hh, r);
    return { a: cl ? circ('a', 0, 0, rc, 'xy', 0) : RR('a', 0), b: cl ? RR('b', h) : circ('b', 0, 0, rc, 'xy', h), tag: `rr ${w.toFixed(1)}x${hh.toFixed(1)} r${r.toFixed(2)} ${cl ? 'c->rr' : 'rr->c'} rc${rc.toFixed(1)} h${h.toFixed(1)}`, cls: 'rrcirc', circleR: rc, cornerR: r, size: w, gapAbs: Math.abs(h), aspect: asp };
  },
};
// extent of the whole loft in the sketch plane + the gap: the quantity truck's mesh tolerance scales with (bbox diagonal)
const ext = (s) => { if (s.shape === 'circle') { const [p, q] = s.points; const r = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2; const c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; return [c[0] - r, c[0] + r, c[1] - r, c[1] + r]; } const xs = s.points.map((p) => p[0]); const ys = s.points.map((p) => p[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
const loftDiag = (a, b) => { const A = ext(a); const B = ext(b); return Math.hypot(Math.max(A[1], B[1]) - Math.min(A[0], B[0]), Math.max(A[3], B[3]) - Math.min(A[2], B[2]), Math.abs((b.offset ?? 0) - (a.offset ?? 0))); };
const modes = argv('modes', Object.keys(gens).join(',')).split(',');
const rows = []; const summary = {};
for (const m of modes) {
  const S = { cases: 0, guardPassed: 0, passBut: 0, refused: 0, refusedWouldBeWrong: 0, refusedExact: 0, refusedNoSolid: 0, maxPassD: 0, maxPassCurvedD: 0 }; summary[m] = S;
  for (let k = 0; k < N; k++) {
    const c = gens[m](); if (!c) continue; S.cases++;
    const doc = { version: 1, features: [c.a, c.b, bl('a', 'b')] };
    const g = guardOf(doc);
    const curved = [c.a, c.b].some((s) => s.shape === 'circle' || s.rounds); const warp = (() => { try { return G.pairWarp(solveDoc(doc), arc.outlineOf); } catch { return 0; } })(); const bar = (curved || warp > 1e-9) ? 3e-4 : 1e-9; // round 5: a slightly warped (near-parallel) pair is held to the curved bar but must keep equal face counts
    if (g?.code === 'start') { // the sentence names a re-start; apply it and measure that the re-started pair is passed by the guard AND exact on live truck vs live OCCT
      S.start = (S.start ?? 0) + 1;
      if (g.advice) {
        const rot = (L, k) => L.slice(k).concat(L.slice(0, k)); const k = g.advice.corner - 1;
        const fix = g.advice.sketch === 'first' ? { a: { ...c.a, points: rot(c.a.points, k) }, b: c.b } : { a: c.a, b: { ...c.b, points: rot(c.b.points, k) } };
        const d2 = { version: 1, features: [fix.a, fix.b, bl('a', 'b')] }; const g2 = guardOf(d2);
        const o2 = occtMeasure(d2); let t2; try { t2 = truckMeasure(d2); } catch (e) { t2 = { refused: e.message }; }
        const ok = !g2 && o2.volume !== undefined && t2.volume !== undefined && relT(t2.volume, o2.volume) <= ((c.cls === 'near' || c.cls === 'typed') ? 3e-4 : 1e-9) && o2.faces === t2.faces;
        S.adviceTried = (S.adviceTried ?? 0) + 1; if (ok) S.adviceWorked = (S.adviceWorked ?? 0) + 1; else S.adviceFailed = (S.adviceFailed ?? 0) + 1;
        const o0 = occtMeasure(doc); let t0; try { t0 = truckMeasure(doc); } catch (e) { t0 = { refused: e.message }; }
        const rawD = o0.volume !== undefined && t0.volume !== undefined ? relT(t0.volume, o0.volume) : null; if (rawD !== null && rawD > 1e-9) S.startRawWrong = (S.startRawWrong ?? 0) + 1; else if (rawD !== null) S.startRawExact = (S.startRawExact ?? 0) + 1;
        rows.push({ mode: m, tag: c.tag, guard: 'start', sentence: g.sentence, advice: g.advice, adviceWorked: ok, adviceGuard: g2?.code ?? null, rawD });
      } else { S.noAdvice = (S.noAdvice ?? 0) + 1; rows.push({ mode: m, tag: c.tag, guard: 'start', sentence: g.sentence, advice: null }); }
    }
    if (STARTSCAN) { S.scanned = (S.scanned ?? 0) + 1; if (g) S.refused++; else S.guardPassed++; continue; }
    if (g && !REFUSED && !STARTSCAN) { S.refused++; rows.push({ mode: m, tag: c.tag, guard: g.code }); continue; }
    const o = occtMeasure(doc); let t; try { t = truckMeasure(doc); } catch (e) { t = { refused: 'harness threw ' + e.message }; }
    const built = o.volume !== undefined && t.volume !== undefined; const d = built ? relT(t.volume, o.volume) : null;
    const faceMismatch = built && o.faces !== t.faces;
    // POST-BUILD half of the guard: circle<->circle volume must match the closed form. A case it refuses is a refusal, not a violation.
    let post = null; if (!g && built && c.cls === 'cc') { const sd = solveDoc(doc); post = G.postCheckBlend(sd, sd.features.find((x) => x.kind === 'blend'), { kernelVolume: t.volume }); }
    const wrong = !post && (!built || d > bar || (!curved && faceMismatch));
    const row = { mode: m, tag: c.tag, bar, warp, guard: g?.code ?? null, post: post?.code ?? null, postD: post?.d ?? null, d, curved, signed: built ? (t.volume - o.volume) / Math.abs(o.volume) : null, diag: loftDiag(c.a, c.b), circleR: c.circleR ?? (c.r1 !== undefined ? Math.max(c.r1, c.r2) : null), circleRmin: c.r1 !== undefined ? Math.min(c.r1, c.r2) : c.circleR ?? null, cornerR: c.cornerR ?? null, size: c.size ?? null, gapAbs: c.gapAbs ?? null, aspect: c.aspect ?? null, occtFaces: o.faces, truckFaces: t.faces, occt: o.volume, truck: t.volume, truckRefused: t.refused, occtRefused: o.refused };
    if (c.cls === 'cc') { row.closedForm = frustumVolume(c.r1, c.r2, c.h); row.dClosed = t.volume !== undefined ? relT(t.volume, row.closedForm) : null; }
    rows.push(row);
    if (!g && post) { S.postRefused = (S.postRefused ?? 0) + 1; S.guardPassed++; if (built && post.d !== undefined && d <= bar) S.postRefusedButExact = (S.postRefusedButExact ?? 0) + 1; }
    else if (!g) { S.guardPassed++; if (built) { S.maxPassD = Math.max(S.maxPassD, d); if (curved) S.maxPassCurvedD = Math.max(S.maxPassCurvedD, d); } if (wrong) { S.passBut++; console.log(`GUARD-PASS-BUT-WRONG [${m}] ${c.tag}: occt ${o.volume ?? o.refused}/${o.faces}f truck ${t.volume ?? t.refused}/${t.faces}f d=${d?.toExponential(2)} bar ${bar}`); } }
    else { S.refused++; if (!built) S.refusedNoSolid++; else if (wrong) S.refusedWouldBeWrong++; else S.refusedExact++; }
  }
  console.log(`[${m}] seed ${SEED}: ${JSON.stringify(S)}`);
}
const violations = Object.values(summary).reduce((s, x) => s + x.passBut, 0);
console.log(`TOTAL cases ${Object.values(summary).reduce((s, x) => s + x.cases, 0)} guard-passed ${Object.values(summary).reduce((s, x) => s + x.guardPassed, 0)} PASS-BUT-WRONG ${violations}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ seed: SEED, n: N, modes, summary, violations, rows }, null, 1));
process.exit(violations ? 1 : 0);
