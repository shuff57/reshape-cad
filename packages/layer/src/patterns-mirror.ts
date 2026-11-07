// TypeScript port of the patterns-mirror group's translator: docs/spikes/solidcraft-referee/contract/pm-translate.mjs (the file as it is now, round 6, the one
// pm-results.json and patterns-mirror.json were built with). Behaviour-preserving: same guards, same thresholds, same sentences, same command lists, same engine calls.
//
// THE ORIGINAL IS NOT A COPY OF THE PHASE 4 TRANSLATOR. It is phase0/translate.mjs with 17 named patches and its own SYNCHRONOUS loop. The layer's base is the phase 4
// translator (translate.ts). The 'patterns-mirror' set is therefore
//     base (phase 4) planners for every kind except pattern and mirror  +  the group's guarded pattern and mirror planners  +  the group's own loop,
// with two small adapters on kinds it does not own (the group's patches 'reversed' and 'taper': a reversed pocket pushes WITH the sweep; a tapered pull is mapped, with the
// extrude-pocket group's fold guard) and the group's cut guards ('snap' and 'web': a cut whose tool lies almost on an earlier cut, or leaves a wall thinner than 1% of the
// part's diagonal, is lost by the kernel without an error). It equals the original on a doc only where phase0 and phase 4 plan every other feature identically;
// NOTES.md ("Fold 4") lists, kind by kind, where they do not.
//
// WORDING. The original notes a refusal twice: `refusal` (the engine / translator reason, for diagnostics) and `student` (one plain sentence about the student's own call).
// Every other set of the layer puts the sentence a student reads in `refusal`; this one does too. `refusal` here is the original's `student`; the original's `refusal` is `raw`.
//
// WHAT IS NOT PORTED. (1) The original asks brep-rs for the point a shell / fillet / draft name stands for (ctx.resolveAt); here those kinds are planned by the base
// (engine topology), as in the other folds, and a shell with no open face is refused by the base before it reaches the engine (the original sends it to the engine, which
// refuses it). (2) `mapPartialAngle` (a measuring switch of the group's harness): a circular pattern over less than 360 degrees is always refused. (3) The patch switches
// (ctx.patches / PM_OFF, the negative controls): every patch is ON. (4) The child process the original runs each engine call in to be able to kill it: the host's runSC takes
// { budgetS } and must kill the run and return { ok: false, timedOut: true }; a host that ignores it leaves the run unbounded.
//
// No kernel is named: everything that touches an engine comes in through the context object (ctx.runSC, ctx.topologyOf, ctx.arc, ctx.mt).
// Non-null assertions (!) stand for fields the feature's kind guarantees on a well-formed doc; the original reads them unguarded, so a malformed doc throws the same
// TypeError, which the step turns into the same translator-error refusal.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { Cmd, RunResult, TranslateCtx, V3 } from './types.js';
import { BASE_PROFILE, planFeature, frameWithMt, resolveNamesFor } from './translate.js';
import { SKETCH_VOLUME_GUARD, sketchVolumeRefusal } from './sketch-volume.js';
import { POCKET_CUT_GUARD, pocketCutRefusal, rememberRun } from './pocket-cut.js';
import { hollowRefusal } from './hollow-check.js';
import { motionRefusal } from './move-turn.js';
import { beforeOf, blendOf, blendRefusal } from './fillet-chain.js';
import { ERRORED_BODY_GUARD, erroredBodySentence } from './errored-body.js';
import { isVerbatimGuard } from './translate.js';
import type { Aggregate, FeatureResult, LoopEnv, Plan, PlanCtx, Planner, Profile, TranslateState } from './translate.js';
import { outlineSize, taperFold } from './outline-guard.js';
import type { GuardOutline } from './outline-guard.js';

const AX: Record<string, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXN: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' };
const len = (a: V3): number => Math.hypot(...a);
const isZero3 = (v: V3 | undefined | null): boolean => !v || (v[0] === 0 && v[1] === 0 && v[2] === 0);

/** The kinds this set owns. */
export const PM_KINDS = ['pattern', 'mirror'];
/** The guards of this set that look at kinds it does not own (the cut guards on a pocket / hole) or at the run itself (the time limits). */
export const PM_CROSS_KIND_GUARDS = ['PM-SNAPCUT', 'PM-WEB', 'G-BUDGET'];

/** The fields of a feature this module reads (loose on purpose: a malformed doc fails the same way as in the original). */
export interface PF {
  id: string;
  kind: string;
  target?: string;
  targets?: string[];
  into?: string;
  op?: string;
  plane?: string;
  mode?: string;
  count: number;
  step?: V3;
  axis?: string;
  totalAngle?: number;
  center?: V3;
  rotate?: V3;
  size?: V3;
  radius?: number;
  height?: number;
  ringRadius?: number;
  tubeRadius?: number;
  sides?: number;
  width?: number;
  depth?: number;
  offset?: V3;
  angles?: V3;
  copy?: boolean;
  angle?: number;
  reversed?: boolean;
  midplane?: boolean;
  length2?: number;
  direction?: unknown;
  alongNormal?: boolean;
  taper?: number;
  style?: string;
  thickness?: number;
  diameter?: number;
  corners?: { dx: number; dy: number };
  counterbore?: unknown;
  countersink?: unknown;
}
const PFV = (f: Feature): PF => f as unknown as PF;

// ---- state -----------------------------------------------------------------------------------------------------------------------------
export interface Box3 { lo: V3; hi: V3 }
/** The world box of the tool a pocket or hole sweeps (for the near-coincident cut check and the thin-wall check). */
export interface ToolBox { lo: V3; hi: V3; circle: boolean; poly: V3[] | null; ai: number }
export interface MirrorAt { axis: number; at: number; how: string }
/** The group's bookkeeping beside the generic state. */
export interface PMState {
  /** analytic box of each accepted feature (patch 'plane'); undefined = unknown */
  abox: Record<string, Box3 | null | undefined>;
  /** the feature's solid contains a torus (truck reports a torus face as type 'other', so the lineage comes from the ModelDoc) */
  torus: Record<string, boolean>;
  /** the cuts made so far into each body (by body name) */
  tools: Record<string, ToolBox[]>;
  /** the names of every body the engine held after the last accepted feature */
  known: Set<string> | null;
  /** wall milliseconds of the last accepted run */
  accMs: number;
  /** the engine / translator text of each refusal of this set, and the sentence a student reads */
  raw: Record<string, string>;
  student: Record<string, string>;
  rootOf: Record<string, { call: string; reason: string }>;
  mirrorAt: Record<string, MirrorAt>;
  /** the names the step's plan produced, for the accepted-feature hook to reset the cut history of (the step sets it just before it calls the hooks) */
  produced?: string[];
  docT0: number;
}
export function initPM(st: TranslateState): void {
  st.pm = { abox: {}, torus: {}, tools: {}, known: null, accMs: 0, raw: {}, student: {}, rootOf: {}, mirrorAt: {}, docT0: Date.now() };
}

// ---- the sentence a student reads --------------------------------------------------------------------------------------------------------
const CALL: Record<string, string> = { shell: 'hollow', extrude: 'pull', revolve: 'spin', blend: 'loft' };
const fname = (f: PF): string => (f.kind === 'pattern' ? (f.mode === 'circular' ? 'repeatAround' : 'repeat') : f.kind === 'combine' ? (f.op === 'union' ? 'join' : f.op === 'subtract' ? 'subtract' : 'common') : f.kind === 'fillet' ? (f.style === 'chamfer' ? 'bevel' : 'round') : (CALL[f.kind] ?? f.kind));
const fmtMm = (v: number): string => String(+Number(v).toPrecision(2));
/** For curved copies the 'touching' verdict is a join test, which cannot tell touching from a hair apart; the tag carries the box gap so the sentence stays true. */
const nearTag = (gap: number[]): string => { const g = Math.max(...gap); return g > 1e-8 ? ` gap=${g.toExponential(1)}` : ''; };

/**
 * The sentence a student sees for a refused feature: plain, one sentence, about THEIR call, no feature ids, no engine names, no kernel text. `raw` is the
 * translator / engine reason. Unknown engine text falls to the last entry, which is still one plain sentence but says less. (Exported for the tests.)
 */
export function studentSentence(fIn: Feature | PF, raw: string): string {
  const f = fIn as PF;
  const n = fname(f);
  let m: RegExpExecArray | null;
  if (/TIME BUDGET: whole model/.test(raw)) { m = /exceeded (\d+) ms/.exec(raw); return `${n}(): checking the whole model was stopped after ${m ? Math.round(+m[1] / 60000) : 60} minutes without finishing, so this step and every step after it were left out -- use fewer steps or fewer copies.`; }
  if (/TIME BUDGET/.test(raw)) { m = /exceeded (\d+) ms/.exec(raw); return `${n}(): building this was stopped after ${m ? Math.round(+m[1] / 1000) : 600} seconds without finishing, so it was left out -- use fewer copies, space them apart, or use flat-sided shapes.`; }
  if (/pattern count must be/.test(raw)) return `${n}(): a pattern can have at most 1000 copies, and this one asks for ${f.count} -- use a count of 1000 or fewer.`;
  if (/near-coincident copies/.test(raw)) { m = /shifted by only ([\d.e+-]+) mm \(([\d.e+-]+) mm is the smallest safe shift/.exec(raw); return `${n}(): the copies are shifted by only ${m ? m[1] : 'a hair'} mm, so each one lies almost exactly on the one before and the thin layer between them would be lost -- shift them by more than ${m ? m[2] : 'a few hundredths of'} mm, or by a whole part size.`; }
  if (/thin wall/.test(raw)) { m = /wall of only ([\d.e+-]+) mm .* ([\d.e+-]+) mm is the smallest safe wall (between two cuts|between a cut and the side of the part)/.exec(raw); const side = m && /side of the part/.test(m[3]); return `${n}(): this cut leaves a wall of only ${m ? m[1] : 'a hair'} mm ${side ? 'between it and the side of the part' : 'between it and an earlier cut'}, and a wall that thin is lost without any error -- leave more than ${m ? m[2] : 'a few tenths of'} mm of material there, or make it one wider cut.`; }
  if (/near-coincident cut/.test(raw)) { m = /by only ([\d.e+-]+) mm from an earlier cut of the same size \(([\d.e+-]+) mm is the smallest safe shift/.exec(raw); return `${n}(): this cut lies only ${m ? m[1] : 'a hair'} mm from an earlier cut of the same size, so the thin sliver between the two would be lost -- move it by more than ${m ? m[2] : 'a few hundredths of'} mm, or leave it out.`; }
  if (/\[curved-near/.test(raw)) { m = /gap=([\d.e+-]+)/.exec(raw); return `${n}(): two of the curved copies lie so close together${m ? ` (the boxes around them are only about ${m[1].replace(/e([+-])0*(\d)/, 'e$1$2')} mm apart)` : ''} that it cannot be told whether they touch, and curved copies that close cannot be fused or kept apart reliably -- leave a clear gap between them, or overlap them clearly.`; }
  if (/mirror copy not fused/.test(raw) || (f.kind === 'mirror' && /boolean Union: the operation failed/.test(raw))) return 'mirror(): the mirrored copy touches the original but the two could not be fused into one solid -- mirror in another direction, or build the part with pull() instead of spin().';
  if (/sub-resolution gap/.test(raw)) { m = /apart by ([\d.e+-]+) mm/.exec(raw); return `${n}(): the copies would be only ${m ? m[1] : 'a hair'} mm apart, a gap too small to keep apart reliably -- make the gap larger than 0.001 mm, or let the copies touch exactly.`; }
  if (/sub-resolution overlap/.test(raw)) { m = /by only ([\d.e+-]+) mm/.exec(raw); return `${n}(): the copies overlap by only ${m ? m[1] : 'a hair'} mm, too little to fuse them reliably -- overlap them by more than 0.0005 mm (a visible overlap is better), or leave a clear gap.`; }
  if (/copies overlap or touch.*curved/.test(raw)) return `${n}(): these copies overlap or touch, and their curved faces cannot be fused into one solid yet -- space the copies so they clear each other, or build the shape from flat faces.`;
  if (/copies overlap or touch/.test(raw)) return `${n}(): these copies overlap or touch and could not be fused into one solid -- space the copies so they clear each other by a visible gap, or overlap them clearly.`;
  if (/mirror contact is not a face/.test(raw)) return 'mirror(): on that side the part meets the mirror plane only along a line or at a point (its nearest side is curved, pointed or edge-on), so the copy cannot be fused to it -- mirror in a direction where the part has a flat face, or turn the part so a flat face points that way (a sphere has no flat face to turn).';
  if (/lumps: shell boundaries intersect or touch/.test(raw)) {
    if (f.kind === 'mirror') return 'mirror(): on that side the part meets the mirror plane only along a line or at a point (its nearest side is curved, pointed or edge-on), so the copy cannot be fused to it -- mirror in a direction where the part has a flat face, or turn the part so a flat face points that way (a sphere has no flat face to turn).';
    return `${n}(): two of the copies would meet only along an edge or at a point, so the result would not be one solid -- overlap them along a face or leave a gap.`;
  }
  if (/join cannot preserve the original faces|boolean Union: the operation failed|exact fallback for where the bodies meet/.test(raw)) return `${n}(): these two shapes touch only along a line or at a point (or are exactly tangent), so they cannot be fused into one solid -- overlap them a little or leave a gap.`;
  if (/angle semantics|less than 360 degrees is not mapped/.test(raw)) return `${n}(): a turn other than one full 360 degrees is not available for a whole shape yet -- leave the angle out for a full turn, or repeat a pocket or hole, which does accept an angle.`;
  if (/zero step/.test(raw)) return `${n}(): the step is [0, 0, 0], so every copy would land exactly on the original -- give a step such as [30, 0, 0].`;
  if (/counterbore and countersink are not mapped/.test(raw)) return 'hole(): a hole with a counterbore or countersink cannot be drilled yet, so it cannot be repeated either -- drill a plain hole instead.';
  if (f.kind === 'shell' && /faces. must be a list of points|solid\.shell/.test(raw)) return 'hollow(): a hollow with no open side cannot be built here, so it cannot be repeated or mirrored either -- give the hollow an open side, for example hollow(shape, { wall: 3, open: \'top\' }).';
  if (/torus/.test(raw) && /clear of/.test(raw)) return `${n}(): copies of a ring that touch or overlap cannot be fused reliably yet -- space the copies so the rings do not meet.`;
  if (/only along an edge or at a point/.test(raw)) return `${n}(): two of the copies would meet only along an edge or at a point, so the result would not be one solid -- overlap them along a face or leave a gap.`;
  if (/analytic|cannot tell exactly where the part ends/.test(raw)) return `${n}(): it cannot be told exactly where this curved part ends in that direction, so the mirror plane cannot be placed -- mirror a part made of flat faces, or build the other half yourself.`;
  if ((m = /the (\w+) option is not mapped/.exec(raw))) return `${n}(): the ${m[1]} option is not built yet -- leave ${m[1]} out.`;
  if (/taper closes the profile|fold over itself/.test(raw)) return `${n}(): the taper makes the outline fold over itself before the end of the pull, so nothing is built -- use a smaller taper or a shorter pull.`;
  if (/not a single body|needs a single/.test(raw)) return `${n}(): this works on one shape at a time, and what it was given is several separate shapes -- join them first.`;
  if (f.kind === 'draft' && /solid\.draft|drafting faces/.test(raw)) return 'draft(): a draft can only be put on a face that is parallel to the pull direction (the top face of a box is not) -- leave the draft out, or draft a side face.';
  if (/sum check/.test(raw)) return `${n}(): the copies are apart, but the volume of the result does not add up to the volume of the copies, so it cannot be trusted -- move the copies clearly apart or clearly together, or line their faces up exactly.`;
  if (/no measured bounding box/.test(raw)) return `${n}(): there is no built shape to ${n} -- an earlier step did not produce one.`;
  return `${n}(): this could not be built reliably, so it was left out -- change the shape or its numbers a little and try again.`;
}

// ---- patch 'snap' (round 4): copies and cuts shifted by almost nothing -----------------------------------------------------------------
export const SNAP_REL = 0.015;
export const SLIVER_MM = 5e-4;
const minExtent = (lo: V3, hi: V3): number => { const e = [0, 1, 2].map((i) => hi[i] - lo[i]).filter((v) => v > 1e-9); return e.length ? Math.min(...e) : 0; };

/** World box of the tool a pocket or hole sweeps. null when it cannot be told. */
export function toolBoxOf(f: Feature, st: TranslateState, ctx: Pick<TranslateCtx, 'arc' | 'mt'>): ToolBox | null {
  const g = PFV(f);
  if (g.kind === 'pocket') {
    const sk = st.sketches[g.target!]; if (!sk) return null;
    const fr = frameWithMt(sk, ctx.mt); const o = ctx.arc.outlineOf(sk); if (!o.ok) return null;
    const W = (p: number[]): V3 => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1]);
    let pts: V3[];
    if (sk.shape === 'circle') { const [a, b] = o.points; const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2; pts = [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] - r, c[1] + r], [c[0] + r, c[1] + r]].map(W); }
    else pts = o.points.map(W);
    const circle = sk.shape === 'circle'; const poly = circle ? null : pts;
    const nl = Math.hypot(...fr.n) || 1; const sgn = g.reversed ? 1 : -1;
    const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const q of pts) for (const t of [0, sgn * g.depth!]) for (let i = 0; i < 3; i++) { const v = q[i] + (fr.n[i] / nl) * t; lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); }
    const ai = [0, 1, 2].find((i) => Math.abs(Math.abs(fr.n[i]) / nl - 1) < 1e-9) ?? -1;
    return { lo, hi, circle, poly, ai };
  }
  if (g.kind === 'hole') {
    const m = st.measure[g.target!]; if (!m) return null;
    const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const centers = g.corners ? [[-g.corners.dx, -g.corners.dy], [g.corners.dx, -g.corners.dy], [-g.corners.dx, g.corners.dy], [g.corners.dx, g.corners.dy]] : [[0, 0]];
    const ai = ({ x: 0, y: 1, z: 2 } as Record<string, number>)[g.axis ?? 'z'];
    const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const [ox, oy] of centers) {
      const c = [bc[0] + g.center![0] + (g.corners ? ox : 0), bc[1] + g.center![1] + (g.corners ? oy : 0), bc[2] + g.center![2]];
      for (let i = 0; i < 3; i++) { const h = i === ai ? g.depth! / 2 : g.diameter! / 2; lo[i] = Math.min(lo[i], c[i] - h); hi[i] = Math.max(hi[i], c[i] + h); }
    }
    return { lo, hi, circle: true, poly: null, ai };
  }
  return null;
}
/** Near-coincident cut: a tool box of the same size as an earlier one on the same body, sitting 0 < d <= SNAP_REL x smallest extent from it. */
export function snapCut(tb: ToolBox, prior: ToolBox[] | undefined): { d: number; tau: number } | null {
  const ext = [0, 1, 2].map((i) => tb.hi[i] - tb.lo[i]); const mn = minExtent(tb.lo, tb.hi); if (!(mn > 0)) return null;
  const tau = SNAP_REL * mn;
  for (const pb of prior ?? []) {
    if (!ext.every((e, i) => Math.abs(e - (pb.hi[i] - pb.lo[i])) <= tau)) continue;
    const d = Math.hypot(...[0, 1, 2].map((i) => (tb.lo[i] + tb.hi[i]) / 2 - (pb.lo[i] + pb.hi[i]) / 2));
    if (d > 1e-9 && d <= tau) return { d, tau };
  }
  return null;
}

// ---- patch 'web' (round 6): a thin wall of material left between flat-sided cuts is lost by the cut with no error ---------------------------------
export const WEB_REL = 0.01; // of the part's bounding-box diagonal; truck loses a flat wall <= ~0.0026 x diagonal
type P2 = number[];
const segDist = (p: P2, q: P2, r: P2, s: P2): number => { // min distance between 2D segments pq and rs (0 if they cross)
  const cr = (a: P2, b: P2, c: P2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = cr(r, s, p), d2 = cr(r, s, q), d3 = cr(p, q, r), d4 = cr(p, q, s);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const pt = (a: P2, b: P2, c: P2): number => { const dx = c[0] - b[0], dy = c[1] - b[1]; const L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((a[0] - b[0]) * dx + (a[1] - b[1]) * dy) / L2)) : 0; return Math.hypot(a[0] - b[0] - t * dx, a[1] - b[1] - t * dy); };
  return Math.min(pt(p, r, s), pt(q, r, s), pt(r, p, q), pt(s, p, q));
};
const inPoly = (pt: P2, poly: P2[]): boolean => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
/** Distance between two 2D polygons (0 when they overlap or touch). */
export function polyDist(A: P2[], B: P2[]): number {
  if (inPoly(A[0], B) || inPoly(B[0], A)) return 0;
  let d = Infinity;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) d = Math.min(d, segDist(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]));
  return d;
}
/** Thin-wall check for a new cut tool `tb` against the earlier cuts `prior` on the same body and the part's own box `bb` ([lo3, hi3] flattened). */
export function webCut(tb: ToolBox | null, prior: ToolBox[] | undefined, bb: number[] | undefined): { d: number; tau: number; kind: string } | null {
  if (!tb || tb.circle || !tb.poly || !bb) return null; // circles / hole walls are not lost (measured)
  const diag = Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]); const tau = WEB_REL * diag;
  if (!(tau > 0)) return null;
  const proj = (pts: V3[], ai: number): P2[] => pts.map((p) => [0, 1, 2].filter((i) => i !== ai).map((i) => p[i]));
  let best: { d: number; tau: number; kind: string } | null = null;
  const upd = (d: number, kind: string): void => { if (d > 1e-9 && d <= tau && (!best || d < best.d)) best = { d, tau, kind }; };
  for (const pb of prior ?? []) {
    if (pb.circle || !pb.poly) continue;
    if (tb.ai >= 0 && tb.ai === pb.ai) {
      const ov = Math.min(tb.hi[tb.ai], pb.hi[tb.ai]) - Math.max(tb.lo[tb.ai], pb.lo[tb.ai]);
      if (!(ov > 1e-9)) continue;
      upd(polyDist(proj(tb.poly, tb.ai), proj(pb.poly, tb.ai)), 'cut');
    } else { // other directions: the gap between the two boxes, along one axis, while they overlap on the other two
      const g = [0, 1, 2].map((i) => Math.max(tb.lo[i] - pb.hi[i], pb.lo[i] - tb.hi[i]));
      const apart = g.filter((v) => v > 0);
      if (apart.length === 1) upd(apart[0], 'cut');
    }
  }
  for (let i = 0; i < 3; i++) {
    if (i === tb.ai) continue;
    upd(tb.lo[i] - bb[i], 'side'); upd(bb[i + 3] - tb.hi[i], 'side');
  }
  return best;
}

/** The cut guards ('snap' and 'web') on a pocket or a hole: does this cut get refused, and why? null = it passes (or is not a cut this guard can judge). */
export interface CutHit { guard: 'PM-SNAPCUT' | 'PM-WEB'; raw: string }
export function cutGuard(f: Feature, st: TranslateState, ctx: Pick<TranslateCtx, 'arc' | 'mt'>): CutHit | null {
  const g = PFV(f);
  if (g.kind !== 'pocket' && g.kind !== 'hole') return null;
  const pm = st.pm!;
  const into = g.kind === 'pocket' ? g.into! : g.target!;
  const hid = headOf(st, into);
  // a target that was refused or already used up is the planner's to refuse (its dependency sentence comes before any guard)
  const blocked = (id: string): boolean => { const h = headOf(st, id); return !!(st.refused[h] || st.stale[h]); };
  if (blocked(into) || (g.kind === 'pocket' && blocked(g.target!))) return null;
  const bs = st.bodies[hid];
  if (!bs || bs.length !== 1) return null; // the planner refuses these before any guard looks
  const tb = toolBoxOf(f, st, ctx);
  if (!tb) return null;
  const snap = snapCut(tb, pm.tools[bs[0]]);
  if (snap) return { guard: 'PM-SNAPCUT', raw: `${g.id} (${g.kind}): near-coincident cut: this cut lies by only ${fmtMm(snap.d)} mm from an earlier cut of the same size (${fmtMm(snap.tau)} mm is the smallest safe shift: ${SNAP_REL * 100}% of the tool's smallest size), so the thin sliver between the two would be dropped` };
  const wm = st.measure[into];
  const hit = webCut(tb, pm.tools[bs[0]], wm?.bbox);
  if (hit) return { guard: 'PM-WEB', raw: `${g.id} (${g.kind}): thin wall: this cut leaves a wall of only ${fmtMm(hit.d)} mm ${hit.kind === 'side' ? 'between it and the side of the part' : 'between it and an earlier cut'}; ${fmtMm(hit.tau)} mm is the smallest safe wall ${hit.kind === 'side' ? 'between a cut and the side of the part' : 'between two cuts'} (${WEB_REL * 100}% of the part's diagonal), because a flat wall thinner than that is dropped by the cut` };
  return null;
}
function headOf(st: TranslateState, id: string): string { let h = id; const seen = new Set<string>(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; }

// ---- analytic bounding boxes (patch 'plane') ---------------------------------------------------------------------------------------------
// Built from the ModelDoc only, never from the engine's tessellated measure. null = unknown (the caller falls back to the measured box).
const rot90Half = (h: V3, angles: V3 | undefined): V3 | null => {
  const v: V3 = [...h];
  for (let a = 0; a < 3; a++) {
    const ang = angles?.[a] ?? 0;
    if (!ang) continue;
    const k = ang / 90;
    if (!Number.isInteger(k)) return null;
    if (((k % 2) + 2) % 2 === 1) { const i = (a + 1) % 3; const j = (a + 2) % 3; [v[i], v[j]] = [v[j], v[i]]; }
  }
  return v;
};
const unionBox = (bs: Array<Box3 | null | undefined>): Box3 | null => (bs.some((b) => !b) ? null : { lo: [0, 1, 2].map((i) => Math.min(...bs.map((b) => b!.lo[i]))), hi: [0, 1, 2].map((i) => Math.max(...bs.map((b) => b!.hi[i]))) });
const shiftBox = (b: Box3 | null | undefined, t: V3): Box3 | null => (b ? { lo: b.lo.map((v, i) => v + t[i]), hi: b.hi.map((v, i) => v + t[i]) } : null);
export function analyticBox(f: Feature, st: TranslateState, ctx: Pick<TranslateCtx, 'arc' | 'mt'>, mirrorAt: MirrorAt | undefined): Box3 | null {
  const g = PFV(f);
  const pm = st.pm!;
  const c = g.center ?? [0, 0, 0];
  switch (g.kind) {
    case 'box': case 'cylinder': case 'sphere': case 'cone': case 'torus': {
      const h: V3 = g.kind === 'box' ? g.size!.map((v) => v / 2)
        : g.kind === 'cylinder' || g.kind === 'cone' ? [g.radius!, g.radius!, g.height! / 2]
          : g.kind === 'sphere' ? [g.radius!, g.radius!, g.radius!]
            : [g.ringRadius! + g.tubeRadius!, g.ringRadius! + g.tubeRadius!, g.tubeRadius!];
      const r = isZero3(g.rotate) ? h : rot90Half(h, g.rotate);
      return r ? { lo: c.map((v, i) => v - r[i]), hi: c.map((v, i) => v + r[i]) } : null;
    }
    case 'prism': case 'wedge': {
      if (!isZero3(g.rotate)) return null;
      const poly = g.kind === 'prism'
        ? (() => { const n = Math.max(3, Math.min(12, Math.round(g.sides!))); return Array.from({ length: n }, (_, i) => [g.radius! * Math.cos(2 * Math.PI * i / n), g.radius! * Math.sin(2 * Math.PI * i / n)]); })()
        : [[-g.width! / 2, -g.depth! / 2], [g.width! / 2, -g.depth! / 2], [-g.width! / 2, g.depth! / 2]];
      const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
      return { lo: [c[0] + Math.min(...xs), c[1] + Math.min(...ys), c[2] - g.height! / 2], hi: [c[0] + Math.max(...xs), c[1] + Math.max(...ys), c[2] + g.height! / 2] };
    }
    case 'extrude': {
      if (g.taper) return null; // a taper leans the walls: the base outline's box is not the part's box
      const sk = st.sketches[g.target!];
      if (!sk) return null;
      const fr = frameWithMt(sk, ctx.mt);
      const o = ctx.arc.outlineOf(sk);
      if (!o.ok) return null;
      const W = (p: number[]): V3 => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1]);
      const sweep = (pts3: V3[], half: V3): Box3 => {
        const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
        for (const q of pts3) for (const t of [0, g.height!]) for (let i = 0; i < 3; i++) { const v = q[i] + fr.n[i] * t; lo[i] = Math.min(lo[i], v - half[i]); hi[i] = Math.max(hi[i], v + half[i]); }
        return { lo, hi };
      };
      if (sk.shape === 'circle') {
        const [a, b] = o.points; const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
        const nl = Math.hypot(...fr.n);
        return sweep([W([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])], fr.n.map((v) => r * Math.sqrt(Math.max(0, 1 - (v / nl) ** 2))));
      }
      if (Object.values(o.bulges ?? {}).some((x) => x)) return null; // arcs: bbox of the chords is not the bbox of the arcs
      return sweep(o.points.map(W), [0, 0, 0]);
    }
    case 'revolve': {
      // patch 'spinbox': a full turn of a straight-edged outline about the frame's normal through the frame origin. Axis-aligned frames only.
      if (g.angle !== 360) return null;
      const sk = st.sketches[g.target!];
      if (!sk) return null;
      const fr = frameWithMt(sk, ctx.mt);
      const ai = fr.n.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-12);
      if (ai < 0 || fr.n.filter((x) => Math.abs(x) > 1e-12).length !== 1) return null;
      const o = ctx.arc.outlineOf(sk);
      if (!o.ok || sk.shape === 'circle' || Object.values(o.bulges ?? {}).some((x) => x)) return null;
      const us = o.points.map((p) => p[0]); const vs = o.points.map((p) => p[1]);
      const R = Math.max(...us.map(Math.abs));
      const ax = [fr.origin[ai] + fr.n[ai] * Math.min(...vs), fr.origin[ai] + fr.n[ai] * Math.max(...vs)].sort((a, b) => a - b);
      const lo = [0, 1, 2].map((i) => (i === ai ? ax[0] : fr.origin[i] - R)); const hi = [0, 1, 2].map((i) => (i === ai ? ax[1] : fr.origin[i] + R));
      return { lo, hi };
    }
    case 'combine': {
      const bx = g.targets!.map((t) => pm.abox[t] ?? null);
      return g.op === 'union' ? unionBox(bx) : g.op === 'subtract' ? bx[0] : null;
    }
    case 'hole': return pm.abox[g.target!] ?? null;
    case 'pocket': case 'groove': return pm.abox[g.into!] ?? null;
    case 'move': return g.copy ? null : shiftBox(pm.abox[g.target!] ?? null, g.offset!);
    case 'rotate': {
      const b = pm.abox[g.target!];
      if (!b) return null;
      const r = rot90Half([0, 1, 2].map((i) => (b.hi[i] - b.lo[i]) / 2), g.angles);
      if (!r) return null;
      const m = [0, 1, 2].map((i) => (b.hi[i] + b.lo[i]) / 2);
      return { lo: m.map((v, i) => v - r[i]), hi: m.map((v, i) => v + r[i]) };
    }
    case 'mirror': {
      const b = pm.abox[g.target!]; const at = mirrorAt;
      if (!b || !at) return null;
      const lo = [...b.lo]; const hi = [...b.hi];
      lo[at.axis] = 2 * at.at - b.hi[at.axis]; hi[at.axis] = 2 * at.at - b.lo[at.axis];
      return unionBox([b, { lo, hi }]);
    }
    case 'pattern': {
      const b = pm.abox[g.target!];
      if (!b) return null;
      if (g.count < 2) return b;
      if (g.mode === 'circular') return null;
      const s = g.step ?? [0, 0, 0];
      return unionBox(Array.from({ length: g.count }, (_, i) => shiftBox(b, s.map((v) => v * i))));
    }
    default: return null;
  }
}

/** Do two boxes touch or overlap (gap <= tol on every axis)? Returns the per-axis gaps. */
const boxGap = (a: { bbox: number[] }, b: { bbox: number[] }): number[] => [0, 1, 2].map((i) => Math.max(a.bbox[i] - b.bbox[i + 3], b.bbox[i] - a.bbox[i + 3]));

/** Aggregate the named bodies of a successful run into one measure (sum volume / faces / shells, union bbox). The shell count is the sum the engine reports (NaN when it reports none). */
export function aggregatePM(res: RunResult, names: string[]): Aggregate | null {
  const bs = res.measure!.bodies.filter((b) => names.includes(b.name));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  return {
    volume: bs.reduce((s, b) => s + b.volume_mm3, 0),
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    shells: bs.reduce((s, b) => s + (b.kernel.shells as number), 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a: Record<string, number>, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / bs.reduce((a, b) => a + b.volume_mm3, 0)),
    bodies: bs.map((b) => b.name),
  };
}

// ---- the planners ------------------------------------------------------------------------------------------------------------------------
interface PMRefusal { refusal: string; guard?: string }
const refuse = (sentence: string, guard?: string): PMRefusal => (guard ? { refusal: sentence, guard } : { refusal: sentence });
/** A plan of this set: the base plan's fields plus the few the loop reads. */
interface PMPlan {
  variants: Cmd[][];
  produces: string[];
  consumes: string[];
  pickedFrom?: string;
  identity?: true;
  copiesOf?: string;
  mirrorAt?: MirrorAt;
}

/** The dependency sentence of the group: the raw text of an earlier refusal of this set, not the sentence the student reads. */
function pmDep(f: Feature, role: string, id: string, st: TranslateState): string | null {
  const r = st.refused[id];
  if (r) return `${f.id} (${f.kind}): its ${role} ${id} was refused (${st.pm?.raw[id] ?? r})`;
  if (st.stale[id]) return `${f.id} (${f.kind}): its ${role} ${id} was already changed in place by ${st.stale[id]}, and a solidcraft command list has no second copy of it`;
  return null;
}

const pmPattern: Planner = (f, st, _ctx, h) => {
  const g = PFV(f);
  const d = h.dep(g.target!);
  if (d) return refuse(d) as unknown as Plan;
  const bs = h.needBody(g.target!);
  if (!bs || bs.length !== 1) return refuse(`${g.id} (pattern): needs a single target body`) as unknown as Plan;
  if (g.count < 2) return { variants: [[]], produces: bs, consumes: [g.target!], identity: true } as unknown as Plan;
  const tm = st.measure[g.target!];
  if (tm) {
    const mn = minExtent(tm.bbox.slice(0, 3), tm.bbox.slice(3)); const tau = SNAP_REL * mn;
    let disp = 0;
    if (g.mode === 'circular') {
      const ai = ({ x: 0, y: 1, z: 2 } as Record<string, number>)[g.axis ?? 'z']; const th = (2 * Math.PI) / g.count;
      for (const cx of [0, 3]) for (const cy of [1, 4]) for (const cz of [2, 5]) {
        const c = [tm.bbox[cx], tm.bbox[cy], tm.bbox[cz]]; const rho = Math.hypot(...c.filter((_x, i) => i !== ai));
        disp = Math.max(disp, 2 * rho * Math.sin(th / 2));
      }
    } else disp = len(g.step ?? [0, 0, 0]);
    if (mn > 0 && disp > 0 && disp <= tau) return refuse(`${g.id} (pattern): near-coincident copies: consecutive copies are shifted by only ${fmtMm(disp)} mm (${fmtMm(tau)} mm is the smallest safe shift: ${SNAP_REL * 100}% of the part's smallest size ${fmtMm(mn)} mm), so solid.combine join would drop the thin layer between them and report the original's volume`, 'PM-SNAP') as unknown as Plan;
  }
  const copies = [bs[0], ...Array.from({ length: g.count - 1 }, (_x, i) => `${bs[0]} (${i + 2})`)];
  let pat: Cmd;
  if (g.mode === 'circular') {
    const tot = g.totalAngle ?? 360;
    if (tot !== 360) return refuse(`${g.id} (pattern): a circular pattern over less than 360 degrees is not mapped (solidcraft's angle semantics were not verified)`) as unknown as Plan;
    pat = { command: 'solid.pattern.circular', params: { bodies: bs, axis: AXN[g.axis ?? 'z'], count: g.count } };
  } else {
    const s: V3 = g.step ?? [0, 0, 0];
    if (isZero3(s)) return refuse(`${g.id} (pattern): a zero step puts every copy on the original`) as unknown as Plan;
    const L = len(s);
    pat = { command: 'solid.pattern.rectangular', params: { bodies: bs, dir1: s.map((v) => v / L), count1: g.count, spacing1: L } };
  }
  // OCCT fuses the instances. Try to join them; if solidcraft cannot (disjoint copies), keep them as separate bodies.
  const join: Cmd = { command: 'solid.combine', params: { target: copies[0], tools: copies.slice(1), operation: 'join' } };
  return { variants: [[pat, join], [pat]], produces: copies, consumes: [g.target!], copiesOf: bs[0] } as unknown as Plan;
};

const pmMirror: Planner = (f, st, _ctx, h) => {
  const g = PFV(f);
  const d = h.dep(g.target!);
  if (d) return refuse(d) as unknown as Plan;
  const bs = h.needBody(g.target!);
  const m = st.measure[g.target!];
  if (!m) return refuse(`${g.id} (mirror): no measured bounding box for ${g.target}`) as unknown as Plan;
  const axis = g.plane === 'yz' ? 0 : g.plane === 'xz' ? 1 : 2;
  let lo = m.bbox[axis]; let hi = m.bbox[axis + 3];
  let how = 'measured';
  // analytic box from the ModelDoc, accepted only if the engine's measured box agrees (guards a wrong algebra)
  const a = st.pm!.abox[g.target!];
  const ext = Math.max(...[0, 1, 2].map((i) => m.bbox[i + 3] - m.bbox[i]), 1);
  const tol = 1e-3 + 1e-4 * ext;
  if (a && [0, 1, 2].every((i) => Math.abs(a.lo[i] - m.bbox[i]) <= tol && Math.abs(a.hi[i] - m.bbox[i + 3]) <= tol)) { lo = a.lo[axis]; hi = a.hi[axis]; how = 'analytic'; }
  else if (m.curved) return refuse(`${g.id} (mirror): cannot tell exactly where the part ends along the mirror direction (no analytic box, curved faces) -- truck's box is tessellation-derived`) as unknown as Plan;
  else if (Math.abs(Math.abs(lo) - Math.abs(hi)) <= 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))) { hi = -lo; how = 'measured-planar-tie'; }
  const at = Math.abs(lo) <= Math.abs(hi) ? lo : hi; // occt-build: through the part's nearer face on this axis
  const origin = [0, 0, 0]; origin[axis] = at;
  const normal = [0, 0, 0]; normal[axis] = 1;
  return { variants: [[{ command: 'solid.mirror', params: { bodies: bs, plane: { origin, normal }, combine: true } }]], produces: bs, consumes: [g.target!], mirrorAt: { axis, at, how } } as unknown as Plan;
};

/** The base (phase 4) planner with this group's dependency sentence: what a kind this set does not own is planned with. */
const PM_PLAIN: Profile = { ...BASE_PROFILE, name: 'patterns-mirror(plain)', depSentence: pmDep };

/** patch 'reversed': a pocket with reversed:true pushes WITH the sweep (the base ignores the flag: a silent wrong solid). */
const pmPocket: Planner = (f, st, ctx) => {
  const p = planFeature(f, st, ctx, PM_PLAIN);
  if ('refusal' in p || 'noop' in p) return p;
  if (!PFV(f).reversed) return p;
  const variants = p.variants.map((v) => v.map((c, i) => (i === v.length - 1 && c.command === 'solid.extrude' ? { ...c, params: { ...c.params, direction: 'positive' } } : c)));
  return { ...p, variants };
};
/** patch 'taper': pull(..., {taper}) is mapped (solid.extrude {taper}) with the extrude-pocket group's fold guard. */
const pmExtrude: Planner = (f, st, ctx) => {
  const g = PFV(f);
  const canTaper = !!g.taper && !(g.midplane || g.length2 || g.reversed || g.direction || g.alongNormal) && g.height! > 0 && Math.abs(g.taper) <= 89.9;
  const p = planFeature(canTaper ? ({ ...f, taper: undefined } as unknown as Feature) : f, st, ctx, PM_PLAIN);
  if (!canTaper || 'refusal' in p || 'noop' in p) return p;
  const sk = st.sketches[g.target!];
  const o = ctx.arc.outlineOf(sk);
  if (!o.ok) return refuse(`${g.id} (extrude): sketch ${sk.id} has no usable outline`) as unknown as Plan;
  const oo: GuardOutline = { ...o, shape: sk.shape };
  const size = outlineSize(oo, ctx.arc);
  const fold = taperFold(oo, ctx.arc, g.height! * Math.tan((g.taper! * Math.PI) / 180), sk.shape === 'circle' ? size.minRadius : null);
  if (fold) return refuse(`${g.id} (extrude): a taper of ${g.taper} degrees over ${g.height} mm makes the outline fold over itself (the taper closes the profile)`) as unknown as Plan;
  const variants = p.variants.map((v) => v.map((c, i) => (i === v.length - 1 && c.command === 'solid.extrude' ? { ...c, params: { ...c.params, taper: g.taper } } : c)));
  return { ...p, variants };
};

/** What the step plans with: this group's four planners (pattern, mirror, and the two adapters), the base for the rest. */
const PM_PLAN: Profile = { ...PM_PLAIN, name: 'patterns-mirror(plan)', planners: { pattern: pmPattern, mirror: pmMirror, pocket: pmPocket, extrude: pmExtrude } };

// ---- the loop ----------------------------------------------------------------------------------------------------------------------------
const TOLC = 1e-3;
export async function pmStep(f: Feature, idx: number, env: LoopEnv): Promise<void> {
  const { doc, ctx, st, accepted, out } = env;
  const pm = st.pm!;
  const g = PFV(f);
  const prefix = doc.features.slice(0, idx);
  const note = (o: Omit<FeatureResult, 'id' | 'kind'>): void => { out.push({ id: f.id, kind: f.kind, ...o }); };
  const headRoot = (id: string): string => { const seen = new Set<string>(); let h = id; while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
  const rootStudent = (raw: string): string => {
    const m = /its (?:target|sketch|solid) (\S+) was refused/.exec(raw);
    const sx = m ? (pm.student[m[1]] ?? st.refused[m[1]]) : undefined;
    if (m && sx) {
      // a dependent names the call it needs and the ROOT cause, instead of repeating the root's sentence under the wrong call
      const dep = pm.rootOf[headRoot(m[1])] ?? pm.rootOf[m[1]];
      if (dep) { pm.rootOf[f.id] = dep; return `${fname(g)}(): it needs ${dep.call}() to be built first, and that was refused: ${dep.reason}`; }
      if (!pm.student[m[1]]) {
        // the refusal belongs to another step of the unified set: name its call and say why, in a sentence of this group's shape
        const x = doc.features.find((y) => y.id === m[1]);
        const why = sx.replace(/^\S+( \([^)]*\))?:\s*/, '').replace(/\.?$/, '.');
        if (x) return `${fname(g)}(): it needs ${fname(PFV(x))}() to be built first, and that was refused: ${why}`;
      }
      return sx;
    }
    if (/was already changed in place/.test(raw)) return `${fname(g)}(): the shape it works on was already used up by an earlier step, so it cannot be used a second time.`;
    return studentSentence(g, raw);
  };
  const refusedNote = (raw: string, student: string | undefined, commands: Cmd[], guard?: string): void => {
    const sentence = student ?? rootStudent(raw);
    st.refused[f.id] = sentence; pm.raw[f.id] = raw; pm.student[f.id] = sentence;
    if (!pm.rootOf[f.id]) pm.rootOf[f.id] = { call: fname(g), reason: sentence.replace(/^[\w]+\(\): /, '') };
    note({ status: 'refused', refusal: sentence, raw, ...(guard ? { guard } : {}), commands });
  };
  // the whole-model time limit
  const DOC_BUDGET = ctx.pmDocBudgetMs ?? 3600000;
  if (Date.now() - pm.docT0 > DOC_BUDGET && f.kind !== 'sketch' && f.kind !== 'datum') {
    refusedNote(`${f.id} (${f.kind}): TIME BUDGET: whole model exceeded ${DOC_BUDGET} ms before this step`, undefined, [], 'G-BUDGET');
    return;
  }
  if (f.kind === 'sketch') st.sketches[f.id] = f;
  const resolved = await resolveNamesFor(f, prefix, env);
  const fctx: PlanCtx = { ...ctx, resolve: (name) => resolved.get(name) ?? null };
  let planned: Plan;
  try { planned = planFeature(f, st, fctx, PM_PLAN); } catch (e) { planned = refuse(`${f.id} (${f.kind}): translator error: ${(e as Error).message}`) as unknown as Plan; }
  if ('refusal' in planned) { const pg = (planned as unknown as PMRefusal).guard; refusedNote(planned.refusal, isVerbatimGuard(pg) ? planned.refusal : undefined, [], pg); return; } // the open-outline and move-turn sentences are kept as they are, as the sketch-volume one is
  if ('noop' in planned) { note({ status: 'noop', commands: [] }); return; }
  const plan = planned as unknown as PMPlan; // named `plan` so that a malformed plan throws the same TypeError text as the original ('plan.produces is not iterable')
  // ---- patches 'snap' and 'web' for a cut: a tool almost on an earlier cut, a wall thinner than 1% of the part's diagonal
  let cut: CutHit | null;
  try { cut = cutGuard(f, st, ctx); } catch (e) { refusedNote(`${f.id} (${f.kind}): translator error: ${(e as Error).message}`, undefined, []); return; } // the original computes the tool box inside the planner's try
  if (cut) { refusedNote(cut.raw, undefined, [], cut.guard); return; }
  // ---- torus guard (patch 'torus'): the engine did not return from a pattern of touching tori in 150 s (measured), and a mirror always lands the copy ON the original
  if ((f.kind === 'pattern' || f.kind === 'mirror') && !plan.identity) {
    const tm = st.measure[g.target!];
    if (tm && pm.torus[g.target!]) { // a torus face is type 'other' in the engine's reply, so the lineage from the ModelDoc is used, not face_types
      let clear = false;
      const bb = tm.bbox;
      if (f.kind === 'pattern' && g.mode !== 'circular') {
        const s0 = g.step ?? [0, 0, 0];
        // every pair of copies separated by more than 1e-3 along some axis (copy i vs i+1 is the closest pair for a straight step)
        clear = [0, 1, 2].some((a) => Math.abs(s0[a]) > (bb[a + 3] - bb[a]) + 1e-3);
      } else if (f.kind === 'pattern') {
        const ax = ({ x: 0, y: 1, z: 2 } as Record<string, number>)[g.axis ?? 'z'];
        const mid = [0, 1, 2].map((i) => (bb[i] + bb[i + 3]) / 2);
        const rad = Math.hypot(...mid.filter((_x, i) => i !== ax));
        const bsr = Math.hypot(...[0, 1, 2].map((i) => (bb[i + 3] - bb[i]) / 2));
        const spacing = (2 * Math.PI) / g.count; // full turn; partial turns are not mapped
        clear = (g.totalAngle ?? 360) === 360 && 2 * rad * Math.sin(spacing / 2) > 2 * bsr + 1e-3;
      }
      if (!clear) {
        refusedNote(`${f.id} (${f.kind}): a torus is in the shape and its copies are not provably clear of each other (truck does not return on touching tori)`, f.kind === 'mirror' ? 'mirror(): a mirrored ring always meets its original along a circle, so the two would not become one solid -- build the second ring yourself with move() and leave a clear gap.' : `${fname(g)}(): rings that touch or overlap cannot be fused reliably yet -- space the copies so the rings do not meet.`, [], 'PM-TORUS');
        return;
      }
    }
  }
  let lastErr: string | null = null;
  let firstJoinErr: string | null = null;
  // ---- time limit: NEW work gets ctx.pmBudgetMs (default 600 s); replaying what is already accepted gets 2x the time it took when it was accepted (plus 1 s)
  const B = ctx.pmBudgetMs ?? 600000;
  const callSC = async (cmds: Cmd[]): Promise<RunResult> => {
    const t0 = Date.now();
    const budgetMs = B + 2 * pm.accMs + 1000;
    let r: RunResult;
    try { r = await ctx.runSC(cmds, { budgetS: budgetMs / 1000 }); } catch (e) { r = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${(e as Error).message}` } }; }
    r.wallMs = Date.now() - t0;
    if (r.timedOut) r = { ...r, ok: false, failed: { command: '(budget)', error: `TIME BUDGET: exceeded ${B} ms` } };
    return r;
  };
  let errored = false; // an engine reply with an errored body (errored-body.ts)
  for (const [vi, variant] of plan.variants.entries()) {
    const res = await callSC([...accepted, ...variant]);
    if (!res.ok) {
      if (res.erroredBody) errored = true;
      lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown');
      if (res.timedOut) { refusedNote(`${f.id} (${f.kind}): ${lastErr}`, undefined, variant, 'G-BUDGET'); return; } // no other variant: the fallback would be as slow or worse
      if (vi === 0 && plan.copiesOf) firstJoinErr = lastErr;
      continue;
    }
    // patch 'fresh': bodies the command created that the plan did not name (a mirror or pattern of several bodies leaves the copies as 'b (2)', 'b (3)' ...) are measured too
    const known = pm.known ?? new Set<string>();
    const fresh = res.measure!.bodies.map((b) => b.name).filter((n) => !known.has(n) && !plan.produces.includes(n));
    const m = aggregatePM(res, [...plan.produces, ...fresh]);
    if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }
    // every set: the built pull against its sketch (sketch-volume.ts)
    const sv = f.kind === 'extrude' ? sketchVolumeRefusal(f, st.sketches[f.target], ctx, res, plan.produces) : null;
    if (sv) { refusedNote(sv, sv, variant, SKETCH_VOLUME_GUARD); return; }
    // every set: a move or turn against the part it started from, a primitive against its closed-form volume (move-turn.ts)
    const mv = motionRefusal(f, st, ctx, res, plan.produces, accepted);
    if (mv) { refusedNote(mv.sentence, mv.sentence, variant, mv.guard); return; }
    // a blend of one straight edge between two planar faces adds exactly one face (fillet-chain.ts)
    const bl = blendRefusal(f, blendOf(plan), beforeOf(st, g.target), m, ctx);
    if (bl) { refusedNote(bl.sentence, bl.sentence, variant, bl.guard); return; }
    // ---- fused guard: a mirror is defined as copy + fuse. When ONE body goes in and several come out, solid.mirror combine:true reported success but left the copy
    // as a separate body touching the original (measured: a spun washer mirrored across a flat end). Volume and bbox still agree with the oracles there.
    if (f.kind === 'mirror' && st.measure[g.target!]?.shells === 1 && (m.shells as number) > 1) {
      refusedNote(`${f.id} (mirror): mirror copy not fused: solid.mirror combine:true returned ${m.bodies.length} body(ies) with ${m.shells} shells for one input body of 1 shell (${m.bodies.join(', ')})`, undefined, variant, 'PM-FUSED');
      return;
    }
    // ---- mirror contact guard: is the contact between the part and its reflection a FACE? For PLANAR parts (exact volumes) the plane is shifted towards the part by
    // d/2, so the copy overlaps the part by d, for d = 1e-2 and 1e-3: the overlap volume (2V - fused volume) grows like d when the contact is a face, like d^2 for an
    // edge, d^3 for a point. Exponent k = log10(ov1/ov2) > 1.5 refuses.
    if (f.kind === 'mirror' && plan.mirrorAt && !m.curved && st.measure[g.target!]?.shells === 1 && st.measure[g.target!]?.volume > 0) {
      const V0 = st.measure[g.target!].volume; const bb = st.measure[g.target!].bbox; const ax = plan.mirrorAt.axis;
      const side = (bb[ax] + bb[ax + 3]) / 2 > plan.mirrorAt.at ? 1 : -1;
      let probeFailed: string | null = null;
      const ovAt = async (d: number): Promise<{ timedOut: RunResult } | number | null> => {
        const cmd = variant[0]; const plane = cmd.params.plane as { origin: number[]; normal: number[] }; const o = [...plane.origin]; o[ax] += side * d / 2;
        const r = await callSC([...accepted, { ...cmd, params: { ...cmd.params, plane: { ...plane, origin: o } } }]);
        if (r.timedOut) return { timedOut: r };
        if (!r.ok) { probeFailed = `${r.failed ? `${r.failed.command}: ${r.failed.error}` : String(r.error ?? 'unknown')}`; return null; }
        const mm = aggregatePM(r, [...plan.produces, ...r.measure!.bodies.map((b) => b.name).filter((n) => !known.has(n))]);
        if (!mm) probeFailed = 'no body came back';
        return mm ? 2 * V0 - mm.volume : null;
      };
      const o1 = await ovAt(1e-2);
      if (o1 !== null && typeof o1 === 'object') { refusedNote(`${f.id} (${f.kind}): ${o1.timedOut.failed!.error}`, undefined, variant, 'G-BUDGET'); return; }
      const o2 = await ovAt(1e-3);
      if (o2 !== null && typeof o2 === 'object') { refusedNote(`${f.id} (${f.kind}): ${o2.timedOut.failed!.error}`, undefined, variant, 'G-BUDGET'); return; }
      // DELIBERATE DEVIATION from pm-translate.mjs (owner decision (b), 2026-10-26): the original SKIPS this check when a probe run fails (o1 or o2 is null), so a part whose mirror contact
      // is an edge or a point is built whenever the engine fails on a probe: the guard fails open. A check that could not run is a refusal here, with the same guard name.
      if (probeFailed !== null) { refusedNote(`${f.id} (mirror): mirror contact check could not run: a probe run failed (${probeFailed})`, 'mirror(): the check that the mirrored copy meets the part along a face could not be completed, so this mirror is left out -- try again, or mirror in a direction where the part has a flat face.', variant, 'PM-MIRCONTACT'); return; }
      if (o1 != null && o2 != null) {
        const k = o2 > 0 && o1 > 0 ? Math.log10(o1 / o2) : Infinity;
        if (!(o1 > 1e-9 * V0) || k > 1.5) { refusedNote(`${f.id} (mirror): mirror contact is not a face: the overlap of the copy pushed in by 1e-2 and 1e-3 mm is ${o1.toExponential(2)} and ${o2.toExponential(2)} mm3 (growth exponent ${Number.isFinite(k) ? k.toFixed(2) : 'inf'}; a face contact grows like 1, an edge like 2, a point like 3)`, undefined, variant, 'PM-MIRCONTACT'); return; }
      }
    }
    // ---- fallback guard: the unjoined variant is only an answer when the copies are PROVABLY apart.
    if (plan.copiesOf && vi > 0) {
      const cps = res.measure!.bodies.filter((b) => plan.produces.includes(b.name));
      const bbx = (b: { bbox: { min: number[]; max: number[] } }): { bbox: number[] } => ({ bbox: [...b.bbox.min, ...b.bbox.max] });
      let wa = 0; let wb = 0;
      // the closest pair is the one with the SMALLEST max-axis gap
      let closest = Infinity;
      for (let a = 0; a < cps.length; a++) for (let b = a + 1; b < cps.length; b++) {
        const gp = Math.max(...boxGap(bbx(cps[a]), bbx(cps[b])));
        if (gp < closest) { closest = gp; wa = a; wb = b; }
      }
      if (cps.length > 1 && !(closest > 1e-3)) {
        const curved = m.curved;
        const depth = -closest;
        const sub = !curved && depth > 0 && depth <= 1e-5;
        const why = sub
          ? `sub-resolution overlap: copies ${wa + 1} and ${wb + 1} overlap by only ${depth.toExponential(1)} mm and solid.combine could not join them (${firstJoinErr})`
          : `copies overlap or touch${curved ? ' (curved faces)' : ''}: copies ${wa + 1} and ${wb + 1} have bbox gap ${closest.toExponential(1)} and solid.combine could not join them (${firstJoinErr}); leaving them as ${cps.length} separate bodies would add their volumes`;
        refusedNote(`${f.id} (pattern): ${why}`, undefined, variant, 'PM-DISJOINT');
        return;
      }
    }
    // ---- contact guard: copies of a repeat/repeatAround that meet only along an edge or at a point. Only looked at when the result has MORE shells than the bounding-box
    // graph of the copies has connected components; then each exactly-touching pair is joined on its own and flagged when the join keeps 2 shells with volume = sum, or the
    // engine refuses the join outright.
    if (f.kind === 'pattern' && !plan.identity) {
      const sep = await callSC([...accepted, variant[0]]);
      if (sep.timedOut) { refusedNote(`${f.id} (${f.kind}): ${sep.failed!.error}`, undefined, variant, 'G-BUDGET'); return; }
      const cps = sep.ok ? sep.measure!.bodies.filter((b) => plan.produces.includes(b.name)) : [];
      const bb = (b: { bbox: { min: number[]; max: number[] } }): { bbox: number[] } => ({ bbox: [...b.bbox.min, ...b.bbox.max] });
      const isCurved = (b: { face_types?: Record<string, number> }): boolean => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane');
      const par = cps.map((_x, i2) => i2);
      const fnd = (i2: number): number => (par[i2] === i2 ? i2 : (par[i2] = fnd(par[i2])));
      const cand: Array<[number, number, number[], boolean]> = [];
      const nudge: Array<[number, number, number[]]> = [];
      for (let a = 0; a < cps.length; a++) for (let b = a + 1; b < cps.length; b++) {
        const gap = boxGap(bb(cps[a]), bb(cps[b]));
        // ---- sliver guard: two PLANAR copies whose bounding boxes overlap or touch (every gap <= 1e-8 mm) and that overlap by a sliver along some axis: 1e-8 < depth <= SLIVER_MM.
        if (!isCurved(cps[a]) && !isCurved(cps[b]) && gap.every((x) => x <= 1e-8)) {
          const depth = Math.min(...gap.filter((x) => x < -1e-8).map((x) => -x));
          if (depth <= SLIVER_MM) {
            refusedNote(`${f.id} (pattern): sub-resolution overlap: copies ${a + 1} and ${b + 1} overlap by only ${depth.toExponential(1)} mm along one direction (bbox overlap), below the ${SLIVER_MM} mm solid.combine join fuses exactly`, undefined, variant, 'PM-SLIVER');
            return;
          }
        }
        if (!gap.every((x) => x <= TOLC)) continue;
        par[fnd(a)] = fnd(b);
        // ---- gap guard: planar copies almost touching. The engine closes a gap <= 1e-5 into one fused bar (OCCT keeps it), so the result silently differs from the oracle.
        const gmax = Math.max(...gap);
        if (!isCurved(cps[a]) && !isCurved(cps[b]) && gmax > 1e-8) {
          refusedNote(`${f.id} (pattern): sub-resolution gap: copies ${a + 1} and ${b + 1} are apart by ${gmax.toExponential(1)} mm (bbox gap), below the 1e-3 mm the kernel can keep apart`, undefined, variant, 'PM-SUBGAP');
          return;
        }
        if (gap.some((x) => Math.abs(x) <= TOLC)) cand.push([a, b, gap, isCurved(cps[a]) || isCurved(cps[b])]);
        else if (isCurved(cps[a]) || isCurved(cps[b])) nudge.push([a, b, gap]); // boxes overlap deeply: only a nudge test can tell tangent from apart
      }
      const K = new Set(cps.map((_x, i2) => fnd(i2))).size;
      const S = res.measure!.bodies.filter((b) => [...plan.produces, ...fresh].includes(b.name)).reduce((t, b) => t + (b.kernel.shells as number), 0);
      if (S > K) {
        for (const [a, b, gap, curvedPair] of cand) {
          const two = await callSC([...accepted, variant[0], { command: 'solid.combine', params: { target: cps[a].name, tools: [cps[b].name], operation: 'join' } }]);
          if (two.timedOut) { refusedNote(`${f.id} (${f.kind}): ${two.failed!.error}`, undefined, variant, 'G-BUDGET'); return; }
          const tb = two.ok ? two.measure!.bodies.find((x) => x.name === cps[a].name) : null;
          const gs = gap.map((x) => x.toExponential(1)).join(',');
          if (!two.ok && /join cannot preserve the original faces/.test(two.failed?.error ?? '')) {
            refusedNote(`${f.id} (pattern): copies ${a + 1} and ${b + 1} meet only along an edge or at a point${curvedPair ? ` [curved-near${nearTag(gap)}]` : ''} (bbox gap ${gs}; solid.combine: ${two.failed!.error})`, undefined, variant, 'PM-CONTACT');
            return;
          }
          // curved copies get the curved volume tolerance (3e-4): a joined pair of tangent cylinders is 5e-5 off the sum of its parts
          const volTol = (curvedPair ? 3e-4 : 1e-6) * tb?.volume_mm3!;
          if (tb && tb.kernel.shells! >= 2 && Math.abs(tb.volume_mm3 - cps[a].volume_mm3 - cps[b].volume_mm3) <= volTol) {
            refusedNote(`${f.id} (pattern): copies ${a + 1} and ${b + 1} meet only along an edge or at a point${curvedPair ? ` [curved-near${nearTag(gap)}]` : ''} (bbox gap ${gs}; joined pair keeps ${tb.kernel.shells} shells, volume = sum${curvedPair ? ' within the curved tolerance' : ''}; whole result ${S} shells vs ${K} bbox-connected groups)`, undefined, variant, 'PM-CONTACT');
            return;
          }
        }
        // NUDGE TEST (curved pairs with deeply overlapping boxes, e.g. cylinders tangent along a line and stepped diagonally): push copy b 2e-3 mm towards copy a along the
        // line of their centres of mass and join. Tangent copies now overlap and fuse into ONE shell; copies that are really apart stay two shells.
        for (const [a, b, gap] of nudge) {
          const ca = cps[a].center_of_mass; const cb = cps[b].center_of_mass;
          const d = [0, 1, 2].map((i) => ca[i] - cb[i]); const L = Math.hypot(...d);
          if (!(L > 1e-9)) continue;
          const t = d.map((v) => (v / L) * 2e-3);
          const nu = await callSC([...accepted, variant[0], { command: 'solid.move', params: { bodies: [cps[b].name], translate: t } }, { command: 'solid.combine', params: { target: cps[a].name, tools: [cps[b].name], operation: 'join' } }]);
          if (nu.timedOut) { refusedNote(`${f.id} (${f.kind}): ${nu.failed!.error}`, undefined, variant, 'G-BUDGET'); return; }
          const nb = nu.ok ? nu.measure!.bodies.find((x) => x.name === cps[a].name) : null;
          if (nb && nb.kernel.shells === 1) {
            refusedNote(`${f.id} (pattern): copies ${a + 1} and ${b + 1} meet only along an edge or at a point [curved-near${nearTag(gap)}] (curved copies with overlapping boxes, bbox gap ${gap.map((x) => x.toExponential(1)).join(',')}; pushed 2e-3 mm together they fuse into one shell, so they were touching; whole result ${S} shells vs ${K} bbox-connected groups)`, undefined, variant, 'PM-CONTACT');
            return;
          }
        }
      }
      // ---- sum check: when EVERY pair of planar copies is provably apart (bbox gap > 1e-3 mm) the union volume is exactly the sum of the copies' own volumes (measured
      // separately, before any join: `sep`), so the result must equal that sum.
      if (cps.length > 1 && cps.every((b) => !isCurved(b))) {
        let allApart = true;
        for (let a2 = 0; a2 < cps.length && allApart; a2++) for (let b2 = a2 + 1; b2 < cps.length; b2++) { if (!(Math.max(...boxGap(bb(cps[a2]), bb(cps[b2]))) > TOLC)) { allApart = false; break; } }
        const sumV = cps.reduce((t2, b3) => t2 + b3.volume_mm3, 0);
        if (allApart && Math.abs(m.volume - sumV) > 1e-9 * sumV) {
          refusedNote(`${f.id} (pattern): sum check: the ${cps.length} copies are all apart (bbox gap above 1e-3 mm) so the result must be the sum of their volumes ${sumV.toPrecision(12)}, but solid.combine join returned ${m.volume.toPrecision(12)} (relative difference ${(Math.abs(m.volume - sumV) / sumV).toExponential(1)})`, undefined, variant, 'PM-SUMCHECK');
          return;
        }
      }
    }
    // the sets with no after-the-build check of a pocket: the cut against the tool that made it (pocket-cut.ts, the extrude-pocket group's check and sentence)
    const pc = f.kind === 'pocket' ? await pocketCutRefusal(f, ctx, res, accepted, variant, plan.produces, callSC) : null;
    if (pc) { refusedNote(pc, pc, variant, POCKET_CUT_GUARD); return; }
    // every set: the hollow of a part with rounded or bevelled edges against its closed form (hollow-check.ts)
    const hc = f.kind === 'shell' ? hollowRefusal(f, doc.features, st, ctx, res, plan.produces, accepted) : null;
    if (hc) { refusedNote(hc.sentence, hc.sentence, variant, hc.guard); return; }
    accepted.push(...variant);
    rememberRun(accepted, res);
    if (plan.mirrorAt) pm.mirrorAt[f.id] = plan.mirrorAt;
    pm.produced = plan.produces;
    for (const mp of membersOf0(env.profile)) mp.onAccepted?.(st, res, m, null, { f, ctx });
    st.accLen[f.id] = accepted.length;
    st.bodies[f.id] = m.bodies;
    st.measure[f.id] = m;
    for (const c of plan.consumes) {
      if (c === f.id) continue;
      if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? g.target : g.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
    }
    note({ status: 'built', commands: variant, measure: m, pickedFrom: plan.pickedFrom, variantsTried: plan.variants.indexOf(variant) + 1, pick: (variant.find((c) => c.params.edges || c.params.faces)?.params) ?? null, ...(plan.mirrorAt ? { mirrorAt: plan.mirrorAt } : {}), wallMs: res.wallMs });
    return;
  }
  if (errored) { refusedNote(`${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`, erroredBodySentence(f), plan.variants[0], ERRORED_BODY_GUARD); return; }
  refusedNote(`${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`, undefined, plan.variants[0]);
}
const membersOf0 = (p: Profile): Profile[] => p.members ?? [p];

// ---- the bookkeeping every accepted feature triggers, whichever step built it ----------------------------------------------------------------
/**
 * Runs for EVERY accepted feature (this set's step, and, in the unified set, the other groups' steps): what the guards of this group read about the scene.
 * It runs before the generic state moves on (st.bodies / st.head of the feature are not yet updated), as in the other sets' steps.
 */
function pmAccepted(st: TranslateState, res: RunResult, m: Aggregate, _plan: Plan | null, acc?: { f: Feature; ctx: TranslateCtx }): void {
  const pm = st.pm!;
  pm.known = new Set(res.measure!.bodies.map((b) => b.name));
  if (!acc) return;
  const { f, ctx } = acc;
  const g = PFV(f);
  pm.accMs = res.wallMs ?? 0;
  // the cut history: a pocket or hole with a tool box is added to its body's list; every other feature resets the lists of the bodies it produced
  const tb = (g.kind === 'pocket' || g.kind === 'hole') ? toolBoxOf(f, st, ctx) : null;
  const into = g.kind === 'pocket' ? g.into! : g.kind === 'hole' ? g.target! : null;
  const p0 = into !== null ? st.bodies[headOf(st, into)]?.[0] : undefined;
  if (tb && p0) (pm.tools[p0] ??= []).push(tb);
  else for (const b of pm.produced ?? m.bodies) delete pm.tools[b];
  pm.produced = undefined;
  pm.abox[f.id] = analyticBox(f, st, ctx, pm.mirrorAt[f.id]);
  pm.torus[f.id] = f.kind === 'torus' || [g.target, g.into, ...(g.targets ?? [])].some((t) => !!t && !!pm.torus[t]);
}

// ---- the planner set -----------------------------------------------------------------------------------------------------------------------
export const PM_PROFILE: Profile = {
  name: 'patterns-mirror',
  // the owner of 'pattern' and 'mirror' in a composition; both planners are synchronous, the step calls them through PM_PLAN with the two adapters
  planners: { pattern: pmPattern, mirror: pmMirror },
  verifies: false,
  initState(st) { initPM(st); },
  depSentence: pmDep,
  noOutline: BASE_PROFILE.noOutline,
  plannerError: BASE_PROFILE.plannerError,
  kernelRefusal: BASE_PROFILE.kernelRefusal,
  onAccepted: pmAccepted,
  step: pmStep,
};
