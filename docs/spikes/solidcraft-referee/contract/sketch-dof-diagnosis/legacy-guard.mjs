// CONTRACT PIECE (round 4, proposed code, lives only in the contract dir). The guard for the LEGACY script route
//   reSHape Script  ->  runScript (rules settle one by one, addConstraintSettling may DROP older ones)  ->  solveDoc (keeps the OLD points when a solve "collapses")  ->  extrude.
// Measured failure (r4b.mjs, reproduced from the repo's own dist): rect(40,30); length(1,20); length(2,15) builds 40x15 = area 600 (want 300) with warnings undefined,
// because the second length call silently dropped the first (the 25% area gate called 300/1200 a collapse), and length(1,8) leaves the 40x30 rect with a false "cannot hold".
//
// What the guard does, per sketch, with no help from the kernel:
//   1. reads what the student WROTE: the ruleLog of reshape-script.logged.mjs (the 3-line patch of packages/script, see make-logged-script.mjs): every rule call, in order, with the replace/idempotent
//      semantics applyConstraint has (across vs up on one edge, one pair rule per pair of edges), but WITHOUT the silent drops;
//   2. takes the TS pipeline's answer if it satisfies every written rule (independent signed check, legacy-rules.mjs) and is a proper shape, else re-solves the written rules itself
//      (TS solver from the fewest-movers seed, then from deterministic jitters, each polished) and keeps the nearest answer that satisfies EVERY rule, keeps the drawn orientation and is a simple polygon;
//   3. polishes (signed Gauss-Newton) so the planar bar 1e-9 is met;
//   4. if nothing satisfies the written rules: REFUSES, in one plain sentence naming the newest rule that cannot hold. The sketch is then not built.
import { runScript as loggedRunScript } from './reshape-script.logged.mjs';
import * as L from './lib.mjs';
import { signedResiduals, checkAll, polish, diagOf } from './legacy-rules.mjs';

const S = L.solve;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const signedArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };

/** simple (non self-intersecting) polygon test, O(n^2): proper crossings, collinear overlaps, and a reversal (spike) at any corner */
export function isSimple(p) {
  const n = p.length; if (n < 3) return false;
  const d = diagOf(p); const eps = 1e-9 * d * d;
  const o = (x, y, z) => cross(sub(y, x), sub(z, x));
  const onSeg = (a, b, c) => Math.min(a[0], b[0]) - 1e-9 * d <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 * d && Math.min(a[1], b[1]) - 1e-9 * d <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9 * d;
  const segInt = (a, b, c, e) => {
    const d1 = o(a, b, c), d2 = o(a, b, e), d3 = o(c, e, a), d4 = o(c, e, b);
    if (d1 * d2 < -eps * eps && d3 * d4 < -eps * eps) return true;
    if (Math.abs(d1) <= eps && Math.abs(d2) <= eps) return onSeg(a, b, c) || onSeg(a, b, e) || onSeg(c, e, a) || onSeg(c, e, b); // collinear: overlap
    return false;
  };
  for (let i = 0; i < n; i++) {                       // spike: the next edge doubles back along the previous one
    const u = sub(p[(i + 1) % n], p[i]), v = sub(p[(i + 2) % n], p[(i + 1) % n]);
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu > 0 && lv > 0 && Math.abs(cross(u, v)) / (lu * lv) < 1e-9 && (u[0] * v[0] + u[1] * v[1]) < 0) return false;
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segInt(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return false;
  }
  return true;
}
/** why a point list is not a proper shape: 'blown-up' | 'squeezed' | 'inside-out' | 'folded' | null (= proper). Same orientation as drawn, simple, no edge or area collapsed below 1e-3 / 1e-4 of the drawn size */
export function shapeProblem(p, drawn) {
  if (!p.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) return 'blown-up';
  const d = diagOf(drawn); const c = drawn.reduce((s, q) => [s[0] + q[0] / drawn.length, s[1] + q[1] / drawn.length], [0, 0]);
  if (!p.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) <= 50 * d)) return 'blown-up';
  for (let i = 0; i < p.length; i++) { const e = sub(p[(i + 1) % p.length], p[i]); if (Math.hypot(e[0], e[1]) < 1e-3 * d) return 'squeezed'; }
  const a = signedArea(p), a0 = signedArea(drawn);
  if (Math.abs(a) < 1e-4 * Math.abs(a0)) return 'squeezed';
  if (!isSimple(p)) return 'folded';
  if (Math.sign(a) !== Math.sign(a0)) return 'inside-out';
  return null;
}
export const properShape = (p, drawn) => shapeProblem(p, drawn) === null;

// ---------- plain sentences (acceptance test: plainProblems from refusal-sentence.mjs) ----------
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const n1 = (v) => String(Math.round(v * 1000) / 1000);
export function plainRule(c) {
  switch (c.kind) {
    case 'horizontal': return `edge ${c.edge + 1} going straight across`;
    case 'vertical': return `edge ${c.edge + 1} going straight up`;
    case 'length': return `edge ${c.edge + 1} being ${n1(c.value)} long`;
    case 'equal': return `edges ${c.edge + 1} and ${c.other + 1} being the same length`;
    case 'parallel': return `edges ${c.edge + 1} and ${c.other + 1} being parallel`;
    case 'perpendicular': return `edges ${c.edge + 1} and ${c.other + 1} meeting at a right angle`;
    case 'distanceX': return `corner ${c.b + 1} being ${n1(c.value)} across from corner ${c.a + 1}`;
    case 'distanceY': return `corner ${c.b + 1} being ${n1(c.value)} up from corner ${c.a + 1}`;
    case 'symmetric': return `corner ${c.center + 1} sitting midway between corners ${c.a + 1} and ${c.b + 1}`;
    case 'angle': return `the ${n1(c.degrees)} degree turn from edge ${c.edge + 1} to edge ${c.other + 1}`;
    case 'lock': return `corner ${c.corner + 1} staying pinned`;
    default: return `a ${c.kind} rule`;
  }
}
/** which OTHER rules, taken away one at a time, would let the rest hold: the ones worth naming in the sentence */
export function blame(drawn, rules, idx) {
  const out = [];
  for (let j = 0; j < rules.length; j++) {
    if (j === idx) continue;
    const rest = rules.filter((_, k) => k !== j);
    const sol = solveIntended(drawn, rest, { jitters: 6, phases: ['touched-only'] });
    if (sol.points) out.push(j);
  }
  return out;
}
const listOf = (a, total = a.length) => (total > a.length ? `${a.join(', ')} and ${total - a.length} more` : a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
export const refuseSentenceWith = (c, others) => (others.length === 0 ? refuseSentence(c)
  : `The rule for ${plainRule(c)} cannot hold together with the rule${others.length > 1 ? 's' : ''} for ${listOf(others.slice(0, 3).map(plainRule), others.length)}, so the part is not built; remove or change one of them.`);
export const refuseSentence = (c) => `The rule for ${plainRule(c)} cannot hold together with the other rules on this sketch, so the part is not built; remove or change one of the rules.`;
export const refuseShapeSentence = (c, problem = 'folded') => `The rules, with ${plainRule(c)}, would ${problem === 'inside-out' ? 'turn the sketch inside out' : problem === 'squeezed' ? 'squeeze the sketch flat' : 'fold the sketch over itself'}, so the part is not built; remove or change one of the rules.`;

// ---------- replay of what the student wrote ----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function intendedRules(logForSketch, initial) {
  let cur = initial.map((c) => ({ ...c }));
  for (const e of logForSketch) {
    const added = e.added; let base = cur;
    if (cur.some((c) => same(c, added))) continue;
    if (added.kind === 'horizontal' || added.kind === 'vertical') { const opp = added.kind === 'horizontal' ? 'vertical' : 'horizontal'; base = base.filter((c) => !(c.kind === opp && 'edge' in c && c.edge === added.edge)); }
    else if (added.kind === 'equal' || added.kind === 'parallel' || added.kind === 'perpendicular') base = base.filter((c) => !((c.kind === 'equal' || c.kind === 'parallel' || c.kind === 'perpendicular') && c.edge === added.edge && c.other === added.other));
    cur = [...base, { ...added }];
  }
  return cur;
}

const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TOL = 1e-9; // mm; polish() reaches ~1e-13, so this is the planar bar, not the TS solver's 1e-6
const moved = (p, q) => p.reduce((s, a, i) => s + (a[0] - q[i][0]) ** 2 + (a[1] - q[i][1]) ** 2, 0);

/** find points that satisfy EVERY rule in `rules`, nearest to `drawn`. Returns {points} or {fail:{rule, residual}} (rule = the newest rule that is still off in the best effort) */
export function solveIntended(drawn, rules, { jitters = 40, phases = ['touched-only', 'all-free'] } = {}) {
  const tryFrom = (start) => {
    const r = S.solveSketch(start, rules);
    const q = polish(r.points, rules);
    const chk = checkAll(q.points, rules, drawn, TOL);
    return { points: q.points, chk };
  };
  const d = diagOf(drawn); const n = drawn.length; const wrap = (i) => ((i % n) + n) % n;
  const locked = new Set(rules.filter((c) => c.kind === 'lock').map((c) => wrap(c.corner)));
  // corners no rule mentions stay exactly where the student drew them in the first phase (only the corners a rule touches may be jittered into another basin);
  // if no proper shape exists that way, a second phase may also move the untouched corners (an L whose free corners must give way to a shorter edge)
  const touched = new Set();
  for (const c of rules) { for (const e of [c.edge, c.other]) if (e !== undefined) { touched.add(wrap(e)); touched.add(wrap(e + 1)); } for (const k of [c.a, c.b, c.center, c.corner]) if (k !== undefined) touched.add(wrap(k)); }
  let best = null; let freePhase = false;
  for (const phase of phases) {
    const rnd = mulberry(0x5eed);
    const seeds = phase === 'touched-only' ? [S.seedForNewRule(drawn, rules), drawn] : [];
    for (let k = 0; k < jitters * (phase === 'touched-only' ? 1 : 2); k++) {
      const amp = (k % 3 === 0 ? 0.1 : k % 3 === 1 ? 0.3 : 0.5) * d;
      seeds.push(drawn.map((p, i) => (locked.has(i) || (phase === 'touched-only' && !touched.has(i)) ? [p[0], p[1]] : [p[0] + (rnd() - 0.5) * amp, p[1] + (rnd() - 0.5) * amp])));
    }
    const cands = [];
    for (const s of seeds) {
      let res; try { res = tryFrom(s); } catch { continue; }
      if (res.chk.ok && properShape(res.points, drawn)) { cands.push(res); if (cands.length >= 3 || (cands.length === 1 && s === seeds[0])) break; }
      if (!best || Math.abs(res.chk.worst.residual) < Math.abs(best.chk.worst.residual)) best = res;
    }
    if (cands.length) { cands.sort((a, b) => moved(a.points, drawn) - moved(b.points, drawn)); return { points: cands[0].points, phase }; }
    freePhase = true;
  }
  // none: name the newest rule that is off in the best effort
  const r = best ? best.chk.residuals : [];
  const mx = Math.max(0, ...r.map(Math.abs));
  let idx = -1; r.forEach((v, i) => { if (Math.abs(v) >= 0.5 * mx && Math.abs(v) > TOL) idx = i; });
  const problem = best ? shapeProblem(best.points, drawn) : null;
  return { fail: { ruleIndex: idx < 0 ? rules.length - 1 : idx, rule: rules[idx < 0 ? rules.length - 1 : idx], residual: mx, folded: best ? problem !== null && mx <= TOL : false, problem } };
}

/**
 * src -> { outcome: 'built-ready' | 'refused' | 'script-error', sentence?, doc?, last?, sketches:[...], pipeline:{...} }
 * `doc` is the doc to extrude/build: the TS-solved doc with every legacy sketch's points replaced by the verified points.
 */
export function guardedLegacy(src) {
  const run = loggedRunScript(src);
  if (run.errors?.length) return { outcome: 'script-error', errors: run.errors.map((e) => e.message ?? String(e)) };
  const shipped = L.runScript(src);                          // the interpreter exactly as the repo ships it
  const rawDoc = L.modelCodegen.solveDoc(shipped.doc);       // what the repo builds today
  const doc = L.clone(L.modelCodegen.solveDoc(run.doc));     // the logged copy's doc (identical except the distX/distY/angle sign fix)
  const report = [];
  for (const f of doc.features) {
    if (f.kind !== 'sketch' || !f.points || !(f.constraints?.length)) continue;
    const f0 = run.doc.features.find((x) => x.id === f.id);
    const log = (run.ruleLog ?? []).filter((e) => e.sketchId === f.id);
    const initial = log.length ? log[0].existing : f0.constraints;
    const intended = log.length ? intendedRules(log, initial) : f0.constraints;
    const drawn = f0.points;
    const dropped = log.filter((e) => e.removed || e.removedAlso).flatMap((e) => [e.removed, e.removedAlso].filter(Boolean));
    const droppedInFinal = dropped.filter((c) => intended.some((i) => same(i, c)));   // rules the student wrote that the TS pipeline threw away
    const entry = { sketch: f.id, written: intended.length, droppedByPipeline: droppedInFinal.map(plainRule), tsPipelineHolds: false, route: null };
    // 2a: the TS answer
    const ts = f.points;
    let chosen = null;
    { const q = polish(ts, intended); const c2 = checkAll(q.points, intended, drawn, TOL); if (c2.ok && properShape(q.points, drawn)) { chosen = q.points; entry.tsPipelineHolds = checkAll(ts, intended, drawn, 1e-6).ok; entry.route = entry.tsPipelineHolds ? 'ts-answer-polished' : 'repaired-by-polish'; } }
    if (chosen) { /* accepted */ }
    else {
      const sol = solveIntended(drawn, intended);
      if (sol.points) { chosen = sol.points; entry.route = 'resolved-by-guard:' + sol.phase; }
      else { entry.route = 'refused'; entry.failRule = sol.fail.rule; const bl = sol.fail.folded ? [] : blame(drawn, intended, sol.fail.ruleIndex); entry.blamed = bl.map((j) => plainRule(intended[j])); entry.sentence = sol.fail.folded ? refuseShapeSentence(sol.fail.rule, sol.fail.problem) : refuseSentenceWith(sol.fail.rule, bl.map((j) => intended[j])); entry.residual = sol.fail.residual; report.push(entry); return { outcome: 'refused', sentence: entry.sentence, sketches: report, rawDoc, run, shipped }; }
    }
    f.points = chosen; f.constraints = intended;
    report.push(entry);
  }
  return { outcome: 'built-ready', doc, last: doc.features.at(-1).id, sketches: report, rawDoc, run, shipped };
}
