// TypeScript port of the sketch-dof-diagnosis group's guard for the LEGACY script route (outline points + panel rules):
//   docs/spikes/solidcraft-referee/contract/sketch-dof-diagnosis/legacy-guard.mjs (guardedLegacy) and legacy-rules.mjs (the signed rule check and polish).
// Behaviour-preserving: same replay, same tolerances, same seeds and jitters, same sentences. The differences from the original, and only these:
//  - it takes what the original computes itself: the run's raw doc, the solved doc (solveDoc of it) and the run's ruleLog (RunResult.ruleLog, the interpreter's
//    record of every rule call, which the original read from its patched copy reshape-script.logged.mjs); the interpreter itself is never imported here;
//  - the sketch solver comes in as an argument (`solve`: packages/sketch's solveSketch and seedForNewRule), as every kernel and solver does in this layer;
//  - a sketch whose rules were all written before any rule call (no ruleLog entry) is read from its constraints, as the original does.
//
// WHAT IT GUARDS (contract rows sketch-dof-diagnosis#8, #10, #13, #14, #15). runScript settles each rule call by addConstraintSettling, which may DROP an older rule
// to make the new one fit (the 25%-of-area gate), and solveDoc keeps the OLD points when a solve "collapses". So rect(40,30); length(1,20); length(2,15) built
// 40 x 15 (the 20 dropped, no warning), and length(1,8) left the 40 x 30 rect with a false "cannot hold" warning. The guard replays what the student WROTE
// (the log, with applyConstraint's replace semantics but without the drops), takes the solved answer if it satisfies every written rule (signed check,
// polished to the planar bar 1e-9) and is a proper shape, else re-solves the written rules itself, and if nothing satisfies them REFUSES in one sentence
// naming the newest rule that cannot hold. The sketch is then not built.
import type { Feature } from '@shuff57/reshape-script/model-types';

export type P2 = [number, number];
/** a legacy (outline) rule, packages/sketch Constraint */
export interface LRule { kind: string; edge?: number; other?: number; value?: number; a?: number; b?: number; center?: number; degrees?: number; corner?: number }
/** RunResult.ruleLog entry: one per rule call that changed the sketch's rule list (an identical repeat is not logged) */
export interface RuleLogEntry { sketchId: string; existing: LRule[]; added: LRule; removed: LRule | null; removedAlso: LRule | null; warning?: string | null }
/** packages/sketch's solver, passed in */
export interface LegacySolver {
  solveSketch(points: P2[], constraints: LRule[], pinned?: Iterable<number>): { points: P2[]; residual: number; iterations: number; overConstrained: boolean };
  seedForNewRule(points: P2[], constraints: LRule[]): P2[];
}

// ---------- legacy-rules.mjs: independent signed evaluator for the outline rule kinds (shares no code with packages/sketch) ----------
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: P2, b: P2): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: P2, b: P2): number => a[0] * b[0] + a[1] * b[1];
const len = (a: P2): number => Math.hypot(a[0], a[1]);

export function diagOf(pts: P2[]): number {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Number.isFinite(d) && d > 1e-9 ? d : 1;
}
const E = (pts: P2[], e: number): [P2, P2] => { const n = pts.length; return [pts[((e % n) + n) % n], pts[(((e + 1) % n) + n) % n]]; };
const edgeVec = (pts: P2[], e: number): P2 => { const [a, b] = E(pts, e); return sub(b, a); };

/** signed residual list, parallel to `constraints` (mm; angles turned into mm with the sketch diagonal). `start` = the points before the solve (lock). */
export function signedResiduals(pts: P2[], constraints: LRule[], start: P2[] = pts, scale = diagOf(start)): number[] {
  return constraints.map((c) => {
    switch (c.kind) {
      case 'horizontal': { const [a, b] = E(pts, c.edge!); return b[1] - a[1]; }
      case 'vertical': { const [a, b] = E(pts, c.edge!); return b[0] - a[0]; }
      case 'length': return len(edgeVec(pts, c.edge!)) - c.value!;
      case 'equal': return len(edgeVec(pts, c.edge!)) - len(edgeVec(pts, c.other!));
      case 'parallel': case 'perpendicular': {
        const u = edgeVec(pts, c.edge!), v = edgeVec(pts, c.other!);
        const lu = len(u), lv = len(v);
        if (lu < 1e-12 || lv < 1e-12) return scale; // no direction: maximally wrong
        const s = c.kind === 'parallel' ? cross(u, v) / (lu * lv) : dot(u, v) / (lu * lv);
        return Math.asin(Math.max(-1, Math.min(1, s))) * scale;
      }
      case 'distanceX': return pts[c.b!][0] - pts[c.a!][0] - c.value!;
      case 'distanceY': return pts[c.b!][1] - pts[c.a!][1] - c.value!;
      case 'symmetric': {
        const mx = (pts[c.a!][0] + pts[c.b!][0]) / 2 - pts[c.center!][0], my = (pts[c.a!][1] + pts[c.b!][1]) / 2 - pts[c.center!][1];
        return Math.abs(mx) >= Math.abs(my) ? mx : my;
      }
      case 'angle': {
        const u = edgeVec(pts, c.edge!), v = edgeVec(pts, c.other!);
        if (len(u) < 1e-12 || len(v) < 1e-12) return scale;
        const turn = Math.atan2(cross(u, v), dot(u, v));
        let want = ((c.degrees! * Math.PI) / 180) % (2 * Math.PI);
        if (want > Math.PI) want -= 2 * Math.PI; if (want <= -Math.PI) want += 2 * Math.PI;
        let d = turn - want; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        return (d / (2 * Math.PI)) * scale;
      }
      case 'lock': return Math.hypot(pts[c.corner!][0] - start[c.corner!][0], pts[c.corner!][1] - start[c.corner!][1]);
      default: return NaN;
    }
  });
}
/** one entry per EQUATION (symmetric has two: x and y), lock rules omitted */
function rowsOf(pts: P2[], constraints: LRule[], start: P2[] = pts, scale = diagOf(start)): number[] {
  const out: number[] = [];
  constraints.forEach((c) => {
    if (c.kind === 'lock') return;
    if (c.kind === 'symmetric') { out.push((pts[c.a!][0] + pts[c.b!][0]) / 2 - pts[c.center!][0], (pts[c.a!][1] + pts[c.b!][1]) / 2 - pts[c.center!][1]); return; }
    out.push(signedResiduals(pts, [c], start, scale)[0]);
  });
  return out;
}
/** every rule holds to tol (mm), NaN counts as failing */
export function checkAll(pts: P2[], constraints: LRule[], start: P2[] = pts, tolMm = 1e-6): { ok: boolean; worst: { index: number; kind?: string; residual: number }; residuals: number[] } {
  const r = signedResiduals(pts, constraints, start);
  let worst: { index: number; kind?: string; residual: number } = { index: -1, residual: 0 };
  r.forEach((v, i) => { if (!(Math.abs(v) <= Math.abs(worst.residual))) worst = { index: i, kind: constraints[i].kind, residual: v }; });
  const ok = r.every((v) => Math.abs(v) <= tolMm);
  return { ok, worst, residuals: r };
}
function solveLin(A: number[][], b: number[]): number[] | null {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let i = c + 1; i < n; i++) { const f = M[i][c] / M[c][c]; for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
/** Minimum-norm Gauss-Newton on the free coordinates, signed residuals, backtracking line search; never changes the basin the start is in. */
export function polish(pts0: P2[], constraints: LRule[], pinned: number[] = [], { maxIter = 80, tol = 1e-13 } = {}): { points: P2[]; worst: number; iterations: number } {
  const n = pts0.length; const start: P2[] = pts0.map((p) => [p[0], p[1]]);
  const fixed = new Set(pinned.map((p) => ((p % n) + n) % n)); for (const c of constraints) if (c.kind === 'lock') fixed.add(((c.corner! % n) + n) % n);
  const free: number[] = []; for (let i = 0; i < n; i++) if (!fixed.has(i)) free.push(2 * i, 2 * i + 1);
  const scale = diagOf(start);
  const flat0: number[] = []; for (const p of start) flat0.push(p[0], p[1]);
  const expand = (x: number[]): P2[] => { const all = flat0.slice(); free.forEach((k, j) => { all[k] = x[j]; }); return Array.from({ length: n }, (_, i) => [all[2 * i], all[2 * i + 1]] as P2); };
  const res = (x: number[]): number[] => rowsOf(expand(x), constraints, start, scale);
  const sumsq = (f: number[]): number => f.reduce((a, v) => a + v * v, 0);
  let x = free.map((k) => flat0[k]); let f = res(x); let cost = sumsq(f); let it = 0;
  for (; it < maxIter && Math.sqrt(cost) > tol; it++) {
    const m = f.length, nn = x.length; const J = Array.from({ length: m }, () => new Array(nn).fill(0));
    for (let j = 0; j < nn; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[j])); const xp = x.slice(), xm = x.slice(); xp[j] += h; xm[j] -= h;
      const fp = res(xp), fm = res(xm); for (let i = 0; i < m; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
    }
    const A = Array.from({ length: m }, () => new Array(m).fill(0)); let tr = 0;
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) { let v = 0; for (let k = 0; k < nn; k++) v += J[a][k] * J[b][k]; A[a][b] = v; if (a === b) tr += v; }
    const rho = 1e-12 * Math.max(tr / Math.max(m, 1), 1e-30);
    for (let a = 0; a < m; a++) A[a][a] += rho;
    const y = solveLin(A, f.map((v) => -v)); if (!y) break;
    const d = new Array(nn).fill(0); for (let k = 0; k < nn; k++) for (let a = 0; a < m; a++) d[k] += J[a][k] * y[a];
    let accepted = false;
    for (let alpha = 1; alpha > 1e-4; alpha /= 2) {
      const xn = x.map((v, i) => v + alpha * d[i]); const fn = res(xn); const cn = sumsq(fn);
      if (cn < cost) { x = xn; f = fn; cost = cn; accepted = true; break; }
    }
    if (!accepted) break;
  }
  return { points: expand(x), worst: Math.max(0, ...f.map(Math.abs)), iterations: it };
}

// ---------- legacy-guard.mjs ----------
const signedArea = (p: P2[]): number => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };

/** simple (non self-intersecting) polygon test, O(n^2): proper crossings, collinear overlaps, and a reversal (spike) at any corner */
export function isSimple(p: P2[]): boolean {
  const n = p.length; if (n < 3) return false;
  const d = diagOf(p); const eps = 1e-9 * d * d;
  const o = (x: P2, y: P2, z: P2): number => cross(sub(y, x), sub(z, x));
  const onSeg = (a: P2, b: P2, c: P2): boolean => Math.min(a[0], b[0]) - 1e-9 * d <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 * d && Math.min(a[1], b[1]) - 1e-9 * d <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9 * d;
  const segInt = (a: P2, b: P2, c: P2, e: P2): boolean => {
    const d1 = o(a, b, c), d2 = o(a, b, e), d3 = o(c, e, a), d4 = o(c, e, b);
    if (d1 * d2 < -eps * eps && d3 * d4 < -eps * eps) return true;
    if (Math.abs(d1) <= eps && Math.abs(d2) <= eps) return onSeg(a, b, c) || onSeg(a, b, e) || onSeg(c, e, a) || onSeg(c, e, b); // collinear: overlap
    return false;
  };
  for (let i = 0; i < n; i++) { // spike: the next edge doubles back along the previous one
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
export type ShapeProblem = 'blown-up' | 'squeezed' | 'inside-out' | 'folded' | null;
/** why a point list is not a proper shape (same orientation as drawn, simple, no edge or area collapsed below 1e-3 / 1e-4 of the drawn size), null = proper */
export function shapeProblem(p: P2[], drawn: P2[]): ShapeProblem {
  if (!p.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) return 'blown-up';
  const d = diagOf(drawn); const c = drawn.reduce((s, q) => [s[0] + q[0] / drawn.length, s[1] + q[1] / drawn.length] as P2, [0, 0] as P2);
  if (!p.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) <= 50 * d)) return 'blown-up';
  for (let i = 0; i < p.length; i++) { const e = sub(p[(i + 1) % p.length], p[i]); if (Math.hypot(e[0], e[1]) < 1e-3 * d) return 'squeezed'; }
  const a = signedArea(p), a0 = signedArea(drawn);
  if (Math.abs(a) < 1e-4 * Math.abs(a0)) return 'squeezed';
  if (!isSimple(p)) return 'folded';
  if (Math.sign(a) !== Math.sign(a0)) return 'inside-out';
  return null;
}
export const properShape = (p: P2[], drawn: P2[]): boolean => shapeProblem(p, drawn) === null;

// ---------- the sentences (the contract's, verbatim: sketch-dof-diagnosis#10, #13) ----------
const n1 = (v: number): string => String(Math.round(v * 1000) / 1000);
export function plainRule(c: LRule): string {
  switch (c.kind) {
    case 'horizontal': return `edge ${c.edge! + 1} going straight across`;
    case 'vertical': return `edge ${c.edge! + 1} going straight up`;
    case 'length': return `edge ${c.edge! + 1} being ${n1(c.value!)} long`;
    case 'equal': return `edges ${c.edge! + 1} and ${c.other! + 1} being the same length`;
    case 'parallel': return `edges ${c.edge! + 1} and ${c.other! + 1} being parallel`;
    case 'perpendicular': return `edges ${c.edge! + 1} and ${c.other! + 1} meeting at a right angle`;
    case 'distanceX': return `corner ${c.b! + 1} being ${n1(c.value!)} across from corner ${c.a! + 1}`;
    case 'distanceY': return `corner ${c.b! + 1} being ${n1(c.value!)} up from corner ${c.a! + 1}`;
    case 'symmetric': return `corner ${c.center! + 1} sitting midway between corners ${c.a! + 1} and ${c.b! + 1}`;
    case 'angle': return `the ${n1(c.degrees!)} degree turn from edge ${c.edge! + 1} to edge ${c.other! + 1}`;
    case 'lock': return `corner ${c.corner! + 1} staying pinned`;
    default: return `a ${c.kind} rule`;
  }
}
const listOf = (a: string[], total = a.length): string => (total > a.length ? `${a.join(', ')} and ${total - a.length} more` : a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
export const refuseSentence = (c: LRule): string => `The rule for ${plainRule(c)} cannot hold together with the other rules on this sketch, so the part is not built; remove or change one of the rules.`;
export const refuseSentenceWith = (c: LRule, others: LRule[]): string => (others.length === 0 ? refuseSentence(c)
  : `The rule for ${plainRule(c)} cannot hold together with the rule${others.length > 1 ? 's' : ''} for ${listOf(others.slice(0, 3).map(plainRule), others.length)}, so the part is not built; remove or change one of them.`);
export const refuseShapeSentence = (c: LRule, problem: ShapeProblem = 'folded'): string => `The rules, with ${plainRule(c)}, would ${problem === 'inside-out' ? 'turn the sketch inside out' : problem === 'squeezed' ? 'squeeze the sketch flat' : 'fold the sketch over itself'}, so the part is not built; remove or change one of the rules.`;

// ---------- replay of what the student wrote ----------
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isPair = (c: LRule): boolean => c.kind === 'equal' || c.kind === 'parallel' || c.kind === 'perpendicular';
/** the rules the student wrote, in order, with applyConstraint's replace semantics (across vs up on one edge; one pair rule per pair of edges) and no silent drop */
export function intendedRules(logForSketch: RuleLogEntry[], initial: LRule[]): LRule[] {
  let cur = initial.map((c) => ({ ...c }));
  for (const e of logForSketch) {
    const added = e.added; let base = cur;
    if (cur.some((c) => same(c, added))) continue;
    if (added.kind === 'horizontal' || added.kind === 'vertical') { const opp = added.kind === 'horizontal' ? 'vertical' : 'horizontal'; base = base.filter((c) => !(c.kind === opp && 'edge' in c && c.edge === added.edge)); }
    else if (isPair(added)) base = base.filter((c) => !(isPair(c) && c.edge === added.edge && c.other === added.other));
    cur = [...base, { ...added }];
  }
  return cur;
}

const mulberry = (a: number) => (): number => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TOL = 1e-9; // mm; polish() reaches ~1e-13, so this is the planar bar, not the TS solver's 1e-6
const moved = (p: P2[], q: P2[]): number => p.reduce((s, a, i) => s + (a[0] - q[i][0]) ** 2 + (a[1] - q[i][1]) ** 2, 0);

type Fail = { ruleIndex: number; rule: LRule; residual: number; folded: boolean; problem: ShapeProblem };
/** points that satisfy EVERY rule, nearest to `drawn`, or the newest rule still off in the best effort */
export function solveIntended(S: LegacySolver, drawn: P2[], rules: LRule[], { jitters = 40, phases = ['touched-only', 'all-free'] } = {}): { points: P2[]; phase: string } | { fail: Fail } {
  type Try = { points: P2[]; chk: ReturnType<typeof checkAll> };
  const tryFrom = (start: P2[]): Try => {
    const r = S.solveSketch(start, rules);
    const q = polish(r.points, rules);
    const chk = checkAll(q.points, rules, drawn, TOL);
    return { points: q.points, chk };
  };
  const d = diagOf(drawn); const n = drawn.length; const wrap = (i: number): number => ((i % n) + n) % n;
  const locked = new Set(rules.filter((c) => c.kind === 'lock').map((c) => wrap(c.corner!)));
  // corners no rule mentions stay where the student drew them in the first phase; a second phase may move them too
  const touched = new Set<number>();
  for (const c of rules) { for (const e of [c.edge, c.other]) if (e !== undefined) { touched.add(wrap(e)); touched.add(wrap(e + 1)); } for (const k of [c.a, c.b, c.center, c.corner]) if (k !== undefined) touched.add(wrap(k)); }
  let best: Try | null = null;
  for (const phase of phases) {
    const rnd = mulberry(0x5eed);
    const seeds: P2[][] = phase === 'touched-only' ? [S.seedForNewRule(drawn, rules), drawn] : [];
    for (let k = 0; k < jitters * (phase === 'touched-only' ? 1 : 2); k++) {
      const amp = (k % 3 === 0 ? 0.1 : k % 3 === 1 ? 0.3 : 0.5) * d;
      seeds.push(drawn.map((p, i) => (locked.has(i) || (phase === 'touched-only' && !touched.has(i)) ? [p[0], p[1]] : [p[0] + (rnd() - 0.5) * amp, p[1] + (rnd() - 0.5) * amp]) as P2));
    }
    const cands: Try[] = [];
    for (const s of seeds) {
      let res: Try; try { res = tryFrom(s); } catch { continue; }
      if (res.chk.ok && properShape(res.points, drawn)) { cands.push(res); if (cands.length >= 3 || (cands.length === 1 && s === seeds[0])) break; }
      if (!best || Math.abs(res.chk.worst.residual) < Math.abs(best.chk.worst.residual)) best = res;
    }
    if (cands.length) { cands.sort((a, b) => moved(a.points, drawn) - moved(b.points, drawn)); return { points: cands[0].points, phase }; }
  }
  // none: name the newest rule that is off in the best effort
  const r = best ? best.chk.residuals : [];
  const mx = Math.max(0, ...r.map(Math.abs));
  let idx = -1; r.forEach((v, i) => { if (Math.abs(v) >= 0.5 * mx && Math.abs(v) > TOL) idx = i; });
  const problem = best ? shapeProblem(best.points, drawn) : null;
  const ri = idx < 0 ? rules.length - 1 : idx;
  return { fail: { ruleIndex: ri, rule: rules[ri], residual: mx, folded: best ? problem !== null && mx <= TOL : false, problem } };
}
/** which OTHER rules, taken away one at a time, would let the rest hold: the ones worth naming in the sentence */
export function blame(S: LegacySolver, drawn: P2[], rules: LRule[], idx: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < rules.length; j++) {
    if (j === idx) continue;
    const rest = rules.filter((_, k) => k !== j);
    const sol = solveIntended(S, drawn, rest, { jitters: 6, phases: ['touched-only'] });
    if ('points' in sol) out.push(j);
  }
  return out;
}

export interface LegacySketchReport { sketch: string; written: number; droppedByPipeline: string[]; tsPipelineHolds: boolean; route: string | null; failRule?: LRule; blamed?: string[]; sentence?: string; residual?: number }
export type LegacyGuardResult =
  | { outcome: 'built-ready'; doc: { version: number; features: Feature[] }; sketches: LegacySketchReport[] }
  | { outcome: 'refused'; sentence: string; sketches: LegacySketchReport[] };
interface SK { id: string; kind: string; points?: P2[]; constraints?: LRule[] }

/**
 * The guard, per legacy sketch. `rawDoc` is the doc the interpreter returned (its sketch points are what the student drew), `solvedDoc` is solveDoc(rawDoc) (what
 * the pipeline would build), `ruleLog` is RunResult.ruleLog (empty for a doc no script produced: the sketch's own constraints are then what was written).
 * Returns the doc to build (solvedDoc with every legacy sketch's points replaced by verified points and its rules by the written ones), or the refusal.
 */
export function guardLegacySketches(rawDoc: { version?: number; features: Feature[] }, solvedDoc: { version?: number; features: Feature[] }, ruleLog: RuleLogEntry[], S: LegacySolver): LegacyGuardResult {
  const doc = JSON.parse(JSON.stringify(solvedDoc)) as { version: number; features: Feature[] };
  const report: LegacySketchReport[] = [];
  for (const f of doc.features as unknown as SK[]) {
    if (f.kind !== 'sketch' || !f.points) continue;
    const log = (ruleLog ?? []).filter((e) => e && e.sketchId === f.id);
    if (!(f.constraints?.length) && !log.length) continue;
    const f0 = (rawDoc.features as unknown as SK[]).find((x) => x.id === f.id)!;
    const initial = log.length ? log[0].existing : f0.constraints ?? [];
    const intended = log.length ? intendedRules(log, initial) : (f0.constraints ?? []);
    const drawn = f0.points!.map((p) => [p[0], p[1]] as P2);
    const dropped = log.filter((e) => e.removed || e.removedAlso).flatMap((e) => [e.removed, e.removedAlso].filter(Boolean) as LRule[]);
    const droppedInFinal = dropped.filter((c) => intended.some((i) => same(i, c))); // rules the student wrote that the pipeline threw away
    const entry: LegacySketchReport = { sketch: f.id, written: intended.length, droppedByPipeline: droppedInFinal.map(plainRule), tsPipelineHolds: false, route: null };
    // the pipeline's answer, polished
    const ts = f.points.map((p) => [p[0], p[1]] as P2);
    let chosen: P2[] | null = null;
    { const q = polish(ts, intended); const c2 = checkAll(q.points, intended, drawn, TOL); if (c2.ok && properShape(q.points, drawn)) { chosen = q.points; entry.tsPipelineHolds = checkAll(ts, intended, drawn, 1e-6).ok; entry.route = entry.tsPipelineHolds ? 'ts-answer-polished' : 'repaired-by-polish'; } }
    if (!chosen) {
      const sol = solveIntended(S, drawn, intended);
      if ('points' in sol) { chosen = sol.points; entry.route = 'resolved-by-guard:' + sol.phase; }
      else {
        entry.route = 'refused'; entry.failRule = sol.fail.rule;
        const bl = sol.fail.folded ? [] : blame(S, drawn, intended, sol.fail.ruleIndex);
        entry.blamed = bl.map((j) => plainRule(intended[j]));
        entry.sentence = sol.fail.folded ? refuseShapeSentence(sol.fail.rule, sol.fail.problem) : refuseSentenceWith(sol.fail.rule, bl.map((j) => intended[j]));
        entry.residual = sol.fail.residual; report.push(entry);
        return { outcome: 'refused', sentence: entry.sentence, sketches: report };
      }
    }
    f.points = chosen; f.constraints = intended;
    report.push(entry);
  }
  return { outcome: 'built-ready', doc, sketches: report };
}
