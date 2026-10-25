// TypeScript port of the extrude-pocket group's translator fork: docs/spikes/solidcraft-referee/contract/translate-ep.mjs.
// Behaviour-preserving. The fork is NOT only the 'extrude' and 'pocket' cases of planFeature (its own header says so, the diff against
// phase7 translate-p4.mjs says more): it also changes the dependency sentences of every kind, the 'no usable outline' sentence, the
// 'combine' planner, the measure of a feature (split-off pieces, shells), the translator-error and kernel-refusal wording, and it adds
// the after-the-build checks. All of that is what the 'extrude-pocket' Profile below carries; the base profile (translate.ts) is untouched.
//
// What the group's mapping guarantees is in contract/extrude-pocket.json; this file only reproduces the mapping and its guards.
// No kernel is named: everything that touches an engine comes in through the context object, exactly as in the base.
import type { ExtrudeFeature, Feature, PocketFeature, CombineFeature, SketchFeature } from '@shuff57/reshape-script/model-types';
import type { Cmd, Frame, TranslateCtx, V3 } from './types.js';
import { frameWithMt, isSoup, refuse } from './translate.js';
import type { Aggregate, InSketch, PlanCtx, PlanHelpers, Plan, Profile, SceneEntry, TranslateState, VerifyEnv } from './translate.js';
import { evenOddPicks, soupLoops } from './soup-regions.js';
import { selfTouch, taperFold, taperFoldLoops, outlineSize, sampleOutline, MIN_LEN, MIN_ROUND } from './outline-guard.js';
import type { GuardOutline } from './outline-guard.js';

/** The option fields of an extrude / pocket as the original reads them (loose on purpose: a malformed doc fails the same way). */
interface OptView {
  id: string;
  kind: string;
  height?: number;
  depth?: number;
  through?: boolean;
  midplane?: boolean;
  length2?: number;
  reversed?: boolean;
  taper?: number;
  direction?: number[] | null;
  alongNormal?: boolean;
}

// ---- cleaning a sketch ----------------------------------------------------------------------------------------------------------
/**
 * A polygon that repeats a point (the same corner twice in a row, or the first point again at the end) is the same outline without
 * the repeat. Repeats are dropped when the sketch is a plain polygon (no rules, no legacy bulges); `rounds` and `chamfers` follow
 * their corner. Anything else is left to the refusal sentence.
 */
function cleanSketch(sk: SketchFeature | undefined): SketchFeature | undefined {
  if (!sk || isSoup(sk) || sk.shape === 'circle' || !Array.isArray(sk.points) || sk.points.length < 3) return sk;
  if ((sk.constraints && sk.constraints.length) || (sk.bulges && Object.keys(sk.bulges).length)) return sk;
  const P = sk.points as number[][];
  const same = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-9;
  const keep: number[] = []; const map: number[] = [];
  for (let i = 0; i < P.length; i++) {
    if (keep.length && same(P[i], P[keep[keep.length - 1]])) { map.push(keep.length - 1); continue; }
    keep.push(i); map.push(keep.length - 1);
  }
  while (keep.length > 1 && same(P[keep[keep.length - 1]], P[keep[0]])) { keep.pop(); for (let i = 0; i < map.length; i++) if (map[i] === keep.length) map[i] = 0; }
  if (keep.length === P.length) return sk;
  const remap = (rec: Record<number, number> | undefined) => {
    if (!rec || !Object.keys(rec).length) return rec;
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(rec)) { const j = map[Number(k)]; if (j !== undefined && !(j in out)) out[j] = v; }
    return out;
  };
  // the cast: the original builds a plain copy of the sketch with the points replaced
  const c = { ...sk, points: keep.map((i) => P[i]) } as SketchFeature;
  if (sk.rounds) c.rounds = remap(sk.rounds);
  if (sk.chamfers) c.chamfers = remap(sk.chamfers);
  return c;
}

/** Why outlineOf() gave nothing, in a sentence a student can act on (never the library's own text, which is about an edit). */
export function noOutlineSentence(sk: SketchFeature, o: { points?: number[][] } | null | undefined): string {
  const pts = (o && o.points) || sk.points || [];
  if (pts.length) {
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const h = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    if (w <= 1e-9 || h <= 1e-9) return `the outline of sketch ${sk.id} is flat: it is 0 mm ${w <= 1e-9 ? 'wide' : 'tall'}, so it has no area to pull; give it a size in both directions`;
  }
  return `sketch ${sk.id} has two corners on the very same spot, so one of its sides has no length and the outline is not a shape; move the corners apart or delete the extra one`;
}

// ---- pull / pocket option mapping -----------------------------------------------------------------------------------------------
// Semantics are the ModelDoc ones (see contract/extrude-pocket.json). Along the sketch normal n = u x v:
//   pull:   sgn = (reversed ? -1 : 1) * sign(height); the solid spans sgn*[-back, span-back]   (span = |h| + length2, back = length2;
//           midplane: span = |h|, back = |h|/2)
//   pocket: the tool spans sgn*[back-span, back]; through = down to the far end of the part, no second length
//   slant (direction, not parallel to n): sweep S = dhat * mag * sgn, mag = span/|dhat.n| (alongNormal) or span; the profile starts at -S*back/span.
// solidcraft has no oblique direction, so a slanted pull is a ruled loft of two copies of the outline.
const SIGN = (x: number) => (x < 0 ? -1 : 1);
const fmtMm = (x: number) => String(+Number(x).toPrecision(3));
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const TAPER_LIMIT = 89.9;
const MAX_SHAPES = 24; // most shapes (loops) in one pull/pocket sketch; above that nothing was measured, so it is refused

interface Slant { dh: V3; c: number; alongNormal: boolean }
interface Reach { maxN: number; minN: number }
interface OptionPlan {
  kind: 'pull' | 'pocket';
  noun: string;
  L: number;
  span: number;
  back: number;
  taper: number;
  slant: Slant | null;
  through: boolean;
  mid: boolean;
  sgn: number;
  up: number;
  down: number;
  nn: V3;
  fr: Frame;
  reach: Reach | null;
}
type OptionResult = { refusal: string } | OptionPlan;

/** Validate and normalise the options of one pull/pocket into {up, down, through, taper, slant}. Refusal = a plain sentence. */
function optionPlan(kind: 'pull' | 'pocket', f: OptView, sk: SketchFeature, ctx: TranslateCtx, bboxOfTarget: number[] | null = null): OptionResult {
  const len0 = (kind === 'pull' ? f.height : f.depth) as number;
  const L = Math.abs(len0);
  const noun = kind === 'pull' ? 'pull' : 'pocket';
  if (!(L > 0) && !f.through) return { refusal: kind === 'pull' ? 'the pull height is 0, so there is nothing to pull' : 'the pocket depth is 0, so there is nothing to cut' };
  if (L < MIN_LEN && !f.through) return { refusal: `the ${kind === 'pull' ? 'pull height' : 'pocket depth'} ${fmtMm(L)} mm is under ${MIN_LEN} mm, which is too small to build; make it at least ${MIN_LEN} mm` };
  const mid = !!f.midplane;
  const l2 = mid || !((f.length2 as number) > 0) ? 0 : (f.length2 as number);
  if (l2 > 0 && l2 < MIN_LEN) return { refusal: `length2 ${fmtMm(l2)} mm is under ${MIN_LEN} mm, which is too small to build; make it at least ${MIN_LEN} mm` };
  const taper = f.taper ?? 0;
  if (Math.abs(taper) > TAPER_LIMIT) return { refusal: `a taper of ${taper} degrees cannot be built: a taper leans the walls by at most ${TAPER_LIMIT} degrees either way` };
  const fr = frameWithMt(sk, ctx.mt);
  const n = cross3(fr.u, fr.v);
  const nl = Math.hypot(...n);
  const nn = n.map((c) => c / nl);
  let dir: number[] | null = f.direction ?? null;
  let flip = false;
  let slant: Slant | null = null;
  if (dir) {
    const dl = Math.hypot(...dir);
    const dh = dir.map((c) => c / dl);
    const c = dot3(dh, nn);
    const parallel = Math.hypot(...cross3(dh, nn)) <= 1e-9;
    const eff = kind === 'pull' ? c : -c; // a pocket's tool is the pull swept the other way
    if (parallel) { flip = eff < 0; dir = null; } else {
      if (Math.abs(c) < 1e-6) return { refusal: 'the direction lies in the sketch plane, so it never leaves the profile; pick a direction that points out of the plane' };
      slant = { dh, c, alongNormal: f.alongNormal !== false };
    }
  }
  const sgn0 = (f.reversed ? -1 : 1) * (flip ? -1 : 1) * SIGN(len0);
  const through = kind === 'pocket' && !!f.through;
  // through-all together with midplane cuts the whole part both ways. Together with length2 the second length has no meaning: refuse.
  if (through && l2 > 0) return { refusal: 'through together with length2 is not built, because it could mean two different cuts (the cut ignoring length2, or the cut also reaching length2 on the other side of the sketch); use through alone, or length2 without through' };
  if (taper !== 0 && slant) return { refusal: 'a taper and a direction together are not built yet: use one or the other' };
  if (taper !== 0 && (mid || l2 > 0)) return { refusal: `a taper together with ${mid ? 'midplane' : 'length2'} is not built yet: use one of them, or set the taper to 0` };
  const span = mid ? L : L + l2;
  const back = mid ? L / 2 : l2;
  // extents along +n (up) and -n (down) for the straight case. pull: sgn*[-back, span-back]; pocket: sgn*[back-span, back]
  let up: number; let down: number;
  if (kind === 'pull') { if (sgn0 > 0) { up = span - back; down = back; } else { up = back; down = span - back; } }
  else if (sgn0 > 0) { up = back; down = span - back; } else { up = span - back; down = back; }
  // how far a through-all cut has to reach: from the sketch plane to the farthest corner of the target's box, along the travel direction
  let reach: Reach | null = null;
  if (through) {
    if (!bboxOfTarget) return { refusal: 'a through-all pocket needs the part it cuts, and it was not measured' };
    const o = fr.origin;
    const lo = bboxOfTarget.slice(0, 3); const hi = bboxOfTarget.slice(3);
    let mx = -Infinity; let mn = Infinity;
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) { const t = dot3([x - o[0], y - o[1], z - o[2]], nn); mx = Math.max(mx, t); mn = Math.min(mn, t); }
    reach = { maxN: mx, minN: mn };
  }
  return { kind, noun, L, span, back, taper, slant, through, mid, sgn: sgn0, up, down, nn, fr, reach };
}

/** Guards on the outline itself (bow-tie, tiny outline, folded taper). Returns a plain sentence or null. */
function outlineGuards(o: OptionPlan, s: { soup?: true }, sk: SketchFeature, ctx: TranslateCtx): string | null {
  if (s.soup) return null; // the soup path has its own checks (soup-regions.ts)
  const out = ctx.arc.outlineOf(sk);
  if (!out.ok) return null;
  const oo: GuardOutline = { ...out, shape: sk.shape };
  const size = outlineSize(oo, ctx.arc);
  if (size.w <= 1e-9 || size.h <= 1e-9) return sk.shape === 'circle' ? 'the circle has a diameter of 0 mm, so it has no area to pull; give it a diameter' : `the outline is flat: it is 0 mm ${size.w <= 1e-9 ? 'wide' : 'tall'}, so it has no area to pull; give it a size in both directions`;
  if (size.w < MIN_LEN || size.h < MIN_LEN) return `the outline is ${fmtMm(Math.min(size.w, size.h))} mm across, under ${MIN_LEN} mm, which is too small to build; draw it larger`;
  if (hasCurve(sk, ctx) && Math.min(size.w, size.h) < MIN_ROUND) return `the round outline is ${fmtMm(Math.min(size.w, size.h))} mm across, under ${MIN_ROUND} mm, which is too small to build; draw it larger`;
  const bad = selfTouch(oo, ctx.arc);
  if (bad === 'cross') return 'two edges of the outline cross each other, so it does not enclose one area; redraw it without crossing';
  if (bad === 'touch') return 'two parts of the outline touch each other, so it does not enclose one clean area; pull them apart';
  if (o.taper) {
    // wall travel at the far end of the sweep: positive taper = the walls lean outward
    const reach = o.through ? Math.max(0, o.reach ? (o.sgn > 0 ? -o.reach.minN : o.reach.maxN) : 0) : o.span;
    const d = reach * Math.tan((o.taper * Math.PI) / 180);
    const circleR = sk.shape === 'circle' ? size.minRadius : null;
    const fold = taperFold(oo, ctx.arc, d, circleR);
    if (fold) return `a taper of ${o.taper} degrees over ${+reach.toFixed(3)} mm makes the outline fold over itself (its walls would cross before the end), so nothing is built; use a smaller taper or a shorter length`;
  }
  return null;
}

/** The same cut as a finite tool: a through-all cut becomes a tool long enough to cover the whole part (only used to measure what the cut removes). */
function finiteTool(o: OptionPlan): OptionPlan {
  if (!o.through) return o;
  const trav = o.sgn > 0 ? -o.reach!.minN : o.reach!.maxN; // how far the tool has to travel along its direction to clear the part
  if (o.mid) {
    const a = Math.max(o.reach!.maxN, 0) + 1; const b = Math.max(-o.reach!.minN, 0) + 1;
    const m = Math.max(a, b);
    return { ...o, through: false, up: m, down: m, span: 2 * m, back: m, slant: o.slant && { ...o.slant, alongNormal: true } };
  }
  const ext = Math.max(trav, 0) + 1;
  return { ...o, through: false, up: o.sgn > 0 ? 0 : ext, down: o.sgn > 0 ? ext : 0, span: ext, back: 0, slant: o.slant && { ...o.slant, alongNormal: true } };
}

type Sweep = { refusal: string } | { cmds: Cmd[]; ntool?: number };
type Body = Record<string, unknown>;
type SketchPart = Exclude<InSketch, { refusal: string }>;

/** The solidcraft commands for one planned pull/pocket. body = {operation, body_name|targets}. */
function emitSweep(o: OptionPlan, s: SketchPart, sk: SketchFeature, ctx: TranslateCtx, st: TranslateState, body: Body, only?: number): Sweep {
  const g = outlineGuards(o, s, sk, ctx);
  if (g) return { refusal: g };
  if (o.slant) {
    // A slanted sweep: loft two copies of the outline, `S` apart (solidcraft has no oblique extrude). One classic outline; rows and rules are refused.
    if (s.soup) return { refusal: 'a direction is only built for one plain outline; this sketch has holes or several shapes, so draw one outline or drop the direction' };
    const { dh, c, alongNormal } = o.slant;
    let span = o.span; let back = o.back;
    const section = (origin: number[], name: string): Cmd[] => s.cmds.map((cmd) => (cmd.command === 'sketch.create' ? { ...cmd, params: { ...cmd.params, name, plane: { ...(cmd.params.plane as object), origin } } } : cmd));
    if (o.through) {
      // cut to the far end of the part along the slanted travel; the tool's n-extent has to cover the whole box on that side
      const tn = (o.sgn > 0 ? 1 : -1) * SIGN(c); // travel along +n when positive
      const need = tn > 0 ? o.reach!.maxN : -o.reach!.minN;
      const needBack = tn > 0 ? -o.reach!.minN : o.reach!.maxN;
      if (!o.mid && !(need > 0)) return { refusal: 'it does not touch the part, so it cuts nothing; move the sketch onto the part or change the direction' };
      const m = Math.max(need, o.mid ? needBack : 0, 0) + 1;
      span = o.mid ? 2 * m : m; back = o.mid ? m : 0;
      const mag = span / Math.abs(c);
      const S = dh.map((x) => x * mag * o.sgn);
      const k = back / span;
      const p0 = o.fr.origin.map((x, i) => x - S[i] * k);
      const p1 = p0.map((x, i) => x + S[i]);
      const a = `sk_${sk.id}_${st.counter++}a`; const b = `sk_${sk.id}_${st.counter++}b`;
      return { cmds: [...section(p0, a), ...section(p1, b), { command: 'solid.loft', params: { sections: [{ sketch: a }, { sketch: b }], ...body } }] };
    }
    const mag = span / (alongNormal ? Math.abs(c) : 1);
    const S = dh.map((x) => x * mag * o.sgn);
    const k = back / span;
    const p0 = o.fr.origin.map((x, i) => x - S[i] * k);
    const p1 = p0.map((x, i) => x + S[i]);
    const a = `sk_${sk.id}_${st.counter++}a`; const b = `sk_${sk.id}_${st.counter++}b`;
    return { cmds: [...section(p0, a), ...section(p1, b), { command: 'solid.loft', params: { sections: [{ sketch: a }, { sketch: b }], ...body } }] };
  }
  const ex: Record<string, unknown> = { sketch: s.name, ...body };
  let ntool = 1;
  if (s.soup) {
    // solidcraft's default is ALL profiles, so a loop standing inside another fills its hole again. Even-odd: pick the material regions.
    const eo = evenOddPicks(sk);
    if ('sentence' in eo) return { refusal: eo.sentence };
    if (eo.loops > MAX_SHAPES) return { refusal: `this sketch has ${eo.loops} separate shapes, more than the ${MAX_SHAPES} that one ${o.noun ?? 'pull'} is built with (SolidCraft needs about a second for each and cannot be interrupted); split them over two ${o.noun ?? 'pull'}s` };
    if (o.taper) {
      // a taper on holes / several shapes is built as long as no wall folds, no hole closes and no two shapes grow into each other before the end of the sweep
      const reachT = o.through ? Math.max(0, o.reach ? (o.sgn > 0 ? -o.reach.minN : o.reach.maxN) : 0) : o.span;
      const dT = reachT * Math.tan((o.taper * Math.PI) / 180);
      const foldT = taperFoldLoops(eo.polys.map((poly, i) => ({ poly, depth: eo.depths[i] })), dT);
      if (foldT) return { refusal: `a taper of ${o.taper} degrees over ${+reachT.toFixed(3)} mm ${foldT.why === 'loops' ? 'makes two shapes of the sketch (or a hole and its outline) run into each other' : 'makes an outline fold over itself or a hole close up'} before the end, so nothing is built; use a smaller taper or a shorter length` };
    }
    if (eo.loops > 1) { ex.profiles = (only === undefined ? eo.picks : [eo.picks[only]]).map((p) => ({ point: p })); ntool = eo.picks.length; } // `only` = build just that region (the consistency check runs one scratch session per region)
  }
  if (o.taper) ex.taper = o.taper;
  if (o.through) {
    ex.through_all = true;
    ex.direction = o.mid ? 'symmetric' : (o.sgn > 0 ? 'negative' : 'positive');
    return { cmds: [...s.cmds, { command: 'solid.extrude', params: ex }], ntool };
  }
  if (o.up > 0 && o.down > 0) { ex.distance = o.up; ex.distance2 = o.down; }
  else if (o.down > 0) { ex.distance = o.down; ex.direction = 'negative'; }
  else ex.distance = o.up;
  return { cmds: [...s.cmds, { command: 'solid.extrude', params: ex }], ntool };
}

// ---- extents in the sketch frame (u, v, n), for the guards that look at where a tool sits against the part ---------------------------
const NEAR_FLUSH = 1e-4; // mm: a tool face this close to a part face, but not on it, is a wall/sliver below what the kernel keeps apart
const FLUSH_NOISE = 1e-9;
// The bounding box the kernel reports for a part with a curved cut is not exact; on a curved part a gap under this floor is bounding-box noise.
const CURVED_BBOX_SLOP = 3e-5;
/** bbox of the sketch profile in (u, v): [u0, v0, u1, v1], or null */
function profileBox(sk: SketchFeature, ctx: TranslateCtx): number[] | null {
  if (isSoup(sk)) {
    const got = soupLoops(sk);
    if (!('loops' in got)) return null;
    const pts = got.loops.flatMap((l) => l.poly);
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }
  const out = ctx.arc.outlineOf(sk);
  if (!out.ok) return null;
  if (sk.shape === 'circle') { const [a, b] = out.points; const cx = (a[0] + b[0]) / 2; const cy = (a[1] + b[1]) / 2; const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2; return [cx - r, cy - r, cx + r, cy + r]; }
  const { pts } = sampleOutline({ ...out, shape: sk.shape }, ctx.arc);
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
const hasCurve = (sk: SketchFeature, ctx: TranslateCtx): boolean => {
  if (isSoup(sk)) return ((sk.geoms ?? []) as unknown as Array<{ construction?: boolean; k: string }>).some((g) => !g.construction && (g.k === 'circle' || g.k === 'arc'));
  if (sk.shape === 'circle') return true;
  const out = ctx.arc.outlineOf(sk);
  return !!out.ok && Object.values(out.bulges ?? {}).some((g) => g);
};
interface Extents { u: number[]; v: number[]; n: number[]; mouthSide: number }
interface Box3 { u: number[]; v: number[]; n: number[] }
/** extent of the tool [lo, hi] along u, v and n of the frame */
function frameExtents(o: OptionPlan, sk: SketchFeature, ctx: TranslateCtx): Extents | null {
  const box = profileBox(sk, ctx);
  if (!box) return null;
  const fr = o.fr; const nn = o.nn;
  const along = (a: V3, p: V3) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
  const n0 = along(nn, fr.origin);
  const span = o.span; const back = o.back;
  if (o.slant) {
    const mag = span / (o.slant.alongNormal ? Math.abs(o.slant.c) : 1);
    const S = o.slant.dh.map((x) => x * mag * o.sgn);
    const sU = along(fr.u, S); const sV = along(fr.v, S); const sN = along(nn, S);
    const k = back / span;
    const q0 = -sN * k; const q1 = q0 + sN;
    const nLo = n0 + Math.min(q0, q1); const nHi = n0 + Math.max(q0, q1);
    const shift = -k;
    return { u: [box[0] + Math.min(sU * shift, sU * (shift + 1)), box[2] + Math.max(sU * shift, sU * (shift + 1))], v: [box[1] + Math.min(sV * shift, sV * (shift + 1)), box[3] + Math.max(sV * shift, sV * (shift + 1))], n: [nLo, nHi], mouthSide: o.sgn * SIGN(o.slant.c) };
  }
  // straight: pull spans sgn*[-back, span-back]; pocket spans sgn*[back-span, back] along n
  if (o.taper) return null; // the wall travels with the taper; the consistency check covers it
  const pad = 0;
  const lo = o.kind === 'pull' ? (o.sgn > 0 ? -back : -(span - back)) : (o.sgn > 0 ? back - span : -back);
  const hi = o.kind === 'pull' ? (o.sgn > 0 ? span - back : back) : (o.sgn > 0 ? back : span - back);
  return { u: [box[0] - pad, box[2] + pad], v: [box[1] - pad, box[3] + pad], n: o.through ? [-1e300, 1e300] : [n0 + lo, n0 + hi], mouthSide: 0 };
}
function bboxInFrame(bb: number[], o: OptionPlan): Box3 {
  const fr = o.fr; const nn = o.nn;
  const ext = (a: V3): number[] => { const v: number[] = []; for (const x of [bb[0], bb[3]]) for (const y of [bb[1], bb[4]]) for (const z of [bb[2], bb[5]]) v.push(a[0] * x + a[1] * y + a[2] * z); return [Math.min(...v), Math.max(...v)]; };
  return { u: ext(fr.u), v: ext(fr.v), n: ext(nn) };
}
/** 0 < gap <= NEAR_FLUSH between a tool face and a part face on the same axis (tool face inside the part), else null */
function nearFlush(tool: Box3, part: Box3, floor = FLUSH_NOISE): { axis: 'u' | 'v' | 'n'; gap: number } | null {
  for (const ax of ['u', 'v', 'n'] as const) {
    for (const [t, p, sideIn] of [[tool[ax][0], part[ax][0], (t: number, p: number) => t - p], [tool[ax][1], part[ax][1], (t: number, p: number) => p - t]] as const) {
      const gap = sideIn(t, p);
      if (gap > floor && gap <= NEAR_FLUSH * (1 + 1e-9)) return { axis: ax, gap };
    }
  }
  return null;
}

// ---- after-the-build checks (the kernel built something; is it the solid the student asked for?) -------------------------------------
// Each plan may carry `verify(m, env)` (async): a string back = a refusal sentence, the variant is not accepted. Checks: touches nothing /
// seals a void; cut consistency (the kernel can silently DROP a wall or sliver thinner than ~0.3% of the part's size); curved accuracy.
const CURVE_ERR: Array<[number, number]> = [[35, 2.0e-4], [40, 2.5e-4], [45, 3.1e-4], [75, 5e-4], [100, 6e-4], [150, 9e-4], [300, 2e-3], [1000, 5e-2], [Infinity, 0.6]]; // measured
const curveErr = (x: number) => CURVE_ERR.find(([lim]) => x <= lim)![1];
const ABS_ERR: Array<[number, number]> = [[0.005, 3e-2], [0.01, 1.4e-2], [0.02, 7.3e-3], [0.05, 2.4e-3], [0.1, 1.9e-3], [0.2, 6e-4], [0.3, 4.6e-4], [0.5, 2.6e-4], [Infinity, 0]];
const absErr = (D: number) => ABS_ERR.find(([lim]) => D <= lim)![1];
const CURVED_BAR = 3e-4;

/** Smallest radius drawn in a sketch (circle, arc, rounded corner), or Infinity. */
function minRadiusOf(sk: SketchFeature, ctx: TranslateCtx): number {
  if (isSoup(sk)) return ((sk.geoms ?? []) as unknown as Array<{ construction?: boolean; k: string; r?: number; a: number[]; c: number[] }>).filter((g) => !g.construction && (g.k === 'circle' || g.k === 'arc')).reduce((r, g) => Math.min(r, g.r ?? Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1])), Infinity);
  const out = ctx.arc.outlineOf(sk);
  if (!out.ok) return Infinity;
  return outlineSize({ ...out, shape: sk.shape }, ctx.arc).minRadius ?? Infinity;
}
/** The relative volume error the kernel can make on the curved part of this feature; null when it stays under the curved bar. */
function curvedAccuracy(f: Feature, m: Aggregate, sk: SketchFeature, ctx: TranslateCtx, curvedVolume: number): string | null {
  const r = minRadiusOf(sk, ctx);
  if (!Number.isFinite(r) || !(r > 0)) return null;
  const diag = Math.hypot(m.bbox[3] - m.bbox[0], m.bbox[4] - m.bbox[1], m.bbox[5] - m.bbox[2]);
  const x = diag / (2 * r);
  const bound = (Math.max(curveErr(x), absErr(2 * r)) * curvedVolume) / Math.max(m.volume, 1e-300);
  if (!(bound > CURVED_BAR)) return null;
  const what = f.kind === 'extrude' ? 'pull' : 'pocket';
  const tiny = absErr(2 * r) >= curveErr(x);
  const why = tiny ? `the smallest round shape in this ${what} is only ${fmtMm(2 * r)} mm across` : `the part is about ${Math.round(x)} times wider than the smallest round shape in this ${what}`;
  return `${f.id}: ${why}, and SolidCraft would report its volume and mass up to ${(bound * 100).toPrecision(2)}% wrong, so it is refused instead of showing a wrong part; make the round shape larger or the part smaller`;
}

/** A pull: only the curved-accuracy check. */
async function verifyPull(f: Feature, m: Aggregate, sk: SketchFeature, ctx: TranslateCtx): Promise<string | null> { return curvedAccuracy(f, m, sk, ctx, m.volume); }

const total = (res: { measure?: { bodies: Array<{ volume_mm3: number }> } }) => res.measure!.bodies.reduce((a, b) => a + b.volume_mm3, 0);

interface Tool {
  pieces: string[];
  build(body: Body, only?: number): Sweep;
  extents?: Extents | null;
  opt?: OptionPlan;
}

/** A pocket: it must change the part, must not seal a void, and the volume that went must be the volume the tool removes. */
async function verifyPocket(f: Feature, m: Aggregate, before: Aggregate | undefined, sk: SketchFeature, ctx: TranslateCtx, env: VerifyEnv, tool: Tool): Promise<string | null> {
  if (!before) return null;
  const sameVol = Math.abs(m.volume - before.volume) <= 1e-9 * Math.max(before.volume, 1);
  if (sameVol && m.faces === before.faces) return `${f.id} does not touch the part, so it cuts nothing; move the sketch onto the part, or change the depth or direction`;
  // one more shell than one more body = a void: a cavity closed off inside the part
  if (m.shells! - before.shells! > m.bodies.length - before.bodies.length) return `${f.id} would leave a sealed cavity inside the part instead of opening onto a face; start the sketch on a face of the part, or cut deeper`;
  // a tool face a hair short of a part face leaves a wall the kernel may snap away: refuse it outright
  if (tool.extents && before.bbox) {
    const nf = nearFlush(tool.extents, bboxInFrame(before.bbox, tool.opt!), before.curved ? CURVED_BBOX_SLOP : FLUSH_NOISE);
    if (nf) return `${f.id}: the cut stops ${+nf.gap.toPrecision(2)} mm short of a face of the part, closer than the ${NEAR_FLUSH} mm this app can check reliably (SolidCraft can silently lose a sliver that thin), so it is refused; make the cut reach the face, or leave at least 0.001 mm`;
  }
  // consistency: V_before - V_after must equal what the tool removes, measured separately as (tool INTERSECT piece), one scratch session per piece.
  const sceneTotal = env.scene.reduce((a, b) => a + b.vol, 0);
  const sceneExact = (n: string) => env.scene.find((b) => b.name === n)?.vol ?? 0;
  let removed = 0; let inconclusive = false;
  for (const piece of tool.pieces) {
    const t = `tmp_tool_${f.id}`;
    const made = tool.build({ operation: 'new', body_name: t });
    if ('refusal' in made) { inconclusive = true; continue; }
    const nTool = made.ntool ?? 1;
    // one scratch session per (piece, tool region): the kernel's intersect with SEVERAL tools is not "each one", so each session builds ONLY its own region
    for (let rg = 0; rg < nTool; rg++) {
      const one = nTool > 1 ? tool.build({ operation: 'new', body_name: t }, rg) : made;
      if ('refusal' in one) { inconclusive = true; continue; }
      const r2 = await env.runSC([...env.accepted, ...one.cmds, { command: 'solid.combine', params: { target: piece, tools: [t], operation: 'intersect' } }]);
      if (!r2.ok) { inconclusive = true; continue; }
      const leftover = r2.measure!.bodies.filter((b) => b.name === t).reduce((a, b) => a + b.volume_mm3, 0);
      removed += total(r2) - leftover - (sceneTotal - sceneExact(piece));
    }
  }
  const curvedPart = m.curved || before.curved;
  const tol = curvedPart ? CURVED_BAR * Math.max(before.volume, 1) : 1e-9 * Math.max(before.volume, 1);
  const dev = m.volume - (before.volume - removed);
  env.checks.push({ check: 'cut-consistency', removedByTool: removed, devMm3: dev, tolMm3: tol, inconclusive });
  if (!inconclusive && Math.abs(dev) > tol) return `${f.id}: the cut and the volume the sketch should remove do not add up (${Math.abs(dev) < 0.01 ? dev.toExponential(1) : +dev.toFixed(3)} mm3 apart); a wall or sliver thinner than about 0.3% of the part's size is the usual cause, so it is refused rather than losing it silently; leave a thicker wall or cut in one go`;
  return curvedAccuracy(f, m, sk, ctx, Math.max(removed, 0));
}

// ---- a join whose parts only touch along a line or at a point -------------------------------------------------------------------------
// The kernel either refuses ("join cannot preserve the original faces ...") or builds ONE body with TWO shells, so neither its answer nor its
// shell count tells touching from apart. The decision is geometric and exact for blocks (volume == box volume); for other parts the boxes only
// bound the contact, so the rule is conservative.
const TOUCH_EPS = 1e-6; // mm: a gap this small counts as touching
export const JOIN_TOUCH_SENTENCE = (id: string) => `${id}: the parts of this join only touch along a line or at a point (or stop just short of each other), so they would not be one solid; overlap them a little, share a whole face, or keep them clearly apart`;
const isBlock = (b: SceneEntry) => { const v = (b.bbox[3] - b.bbox[0]) * (b.bbox[4] - b.bbox[1]) * (b.bbox[5] - b.bbox[2]); return Math.abs(v - b.vol) <= 1e-9 * Math.max(v, 1); };
/** 'apart' | 'overlap' | 'face' | 'line-point' by the gaps between two boxes on x, y, z (a gap <= TOUCH_EPS is touching, a negative one overlap) */
export function boxContact(a: number[], b: number[]): 'apart' | 'overlap' | 'face' | 'line-point' {
  let touch = 0;
  for (let k = 0; k < 3; k++) {
    const gap = Math.max(a[k], b[k]) - Math.min(a[k + 3], b[k + 3]);
    if (gap > TOUCH_EPS) return 'apart';
    if (gap >= -TOUCH_EPS) touch++;
  }
  return touch === 0 ? 'overlap' : touch === 1 ? 'face' : 'line-point';
}
/** pairs of join operands that only touch at an edge or a point: blocks decided exactly before the kernel runs */
function blockTouches(names: string[], scene: SceneEntry[]): Array<{ a: string; b: string; how: string }> {
  const out: Array<{ a: string; b: string; how: string }> = [];
  const ent = names.map((n) => scene.find((x) => x.name === n)).filter((x): x is SceneEntry => !!x);
  for (let i = 0; i < ent.length; i++) for (let j = i + 1; j < ent.length; j++) {
    const c = boxContact(ent[i].bbox, ent[j].bbox);
    if (c === 'line-point' && isBlock(ent[i]) && isBlock(ent[j])) out.push({ a: ent[i].name, b: ent[j].name, how: 'blocks touching on 2+ axes' });
  }
  return out;
}
/** after the build: parts that are not blocks, boxes touching/overlapping, and the join merged no shell */
function curvedTouches(names: string[], scene: SceneEntry[], m: Aggregate): Array<{ a: string; b: string; how: string }> {
  const ent = names.map((n) => scene.find((x) => x.name === n)).filter((x): x is SceneEntry => !!x);
  const sum = ent.reduce((a, e) => a + e.shells, 0);
  if (m.shells! < sum) return []; // a shell merged: some pair shares a surface
  const out: Array<{ a: string; b: string; how: string }> = [];
  for (let i = 0; i < ent.length; i++) for (let j = i + 1; j < ent.length; j++) {
    if (isBlock(ent[i]) && isBlock(ent[j])) continue;
    const c = boxContact(ent[i].bbox, ent[j].bbox);
    if (c === 'face' || c === 'line-point') out.push({ a: ent[i].name, b: ent[j].name, how: `boxes ${c}, no shell merged (${m.shells} of ${sum})` });
  }
  return out;
}

/**
 * A join: V(A union B ...) must equal what inclusion-exclusion gives: union = op0 + (op1 minus op0) + (op2 minus (op0 + op1)) + ...,
 * each "minus" measured in its own scratch session. Catches a thin protrusion or sliver the union drops.
 */
async function verifyUnion(f: Feature, m: Aggregate, ops: string[], env: VerifyEnv): Promise<string | null> {
  const ct = curvedTouches(ops, env.scene, m);
  env.checks.push({ check: 'join-contact', blockPairsTouching: 0, otherPairsSuspect: ct.length });
  if (ct.length) return JOIN_TOUCH_SENTENCE(f.id);
  const sceneTotal = env.scene.reduce((a, b) => a + b.vol, 0);
  const sceneExact = (n: string) => env.scene.find((b) => b.name === n)?.vol ?? 0;
  const bb = (n: string) => env.scene.find((b) => b.name === n)?.bbox;
  for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) {
    const a = bb(ops[i]); const b = bb(ops[j]);
    if (!a || !b) continue;
    // the steps a join drops scale with the part: everything up to 2.5e-5 of the union's diagonal is refused outright.
    const diag = Math.hypot(Math.max(a[3], b[3]) - Math.min(a[0], b[0]), Math.max(a[4], b[4]) - Math.min(a[1], b[1]), Math.max(a[5], b[5]) - Math.min(a[2], b[2]));
    const near = Math.max(NEAR_FLUSH, 2.5e-5 * diag);
    // two faces a hair apart on the same side, between boxes that overlap along the other axes: a step the kernel may snap flat
    for (let ax = 0; ax < 3; ax++) for (const k of [0, 3]) {
      const gap = Math.abs(a[ax + k] - b[ax + k]);
      const overlapOthers = [0, 1, 2].filter((q) => q !== ax).every((q) => Math.min(a[q + 3], b[q + 3]) - Math.max(a[q], b[q]) > 1e-6);
      if (overlapOthers && gap > FLUSH_NOISE && gap <= near * (1 + 1e-9)) return `${f.id}: two faces of the joined parts are ${+gap.toPrecision(2)} mm apart, closer than the ${+near.toPrecision(2)} mm this app can check reliably on a part this size (SolidCraft can silently lose a step that thin), so it is refused; make them flush or at least ${+(near * 1.5).toPrecision(2)} mm apart`;
    }
  }
  let expected = sceneExact(ops[0]);
  let inconclusive = false;
  for (let i = 1; i < ops.length; i++) {
    const r = await env.runSC([...env.accepted, { command: 'solid.combine', params: { target: ops[i], tools: ops.slice(0, i), operation: 'cut' } }]);
    if (!r.ok) { inconclusive = true; continue; }
    const consumed = ops.slice(0, i + 1).reduce((a, n) => a + sceneExact(n), 0);
    expected += total(r) - (sceneTotal - consumed);
  }
  const tol = (m.curved ? CURVED_BAR : 1e-9) * Math.max(m.volume, 1);
  const dev = m.volume - expected;
  env.checks.push({ check: 'join-consistency', expectedMm3: expected, devMm3: dev, tolMm3: tol, inconclusive });
  if (!inconclusive && Math.abs(dev) > tol) return `${f.id}: the joined part and the sum of its pieces do not add up (${Math.abs(dev) < 0.01 ? dev.toExponential(1) : +dev.toFixed(3)} mm3 apart); a sliver or thin step of about 0.1 mm or less is the usual cause, so it is refused rather than losing it silently; make the overlap or the step thicker`;
  return null;
}

// ---- the planners ---------------------------------------------------------------------------------------------------------------
function planExtrude(fe: Feature, st: TranslateState, ctx: PlanCtx, h: PlanHelpers): Plan {
  const f = fe as ExtrudeFeature;
  const d = h.dep(f.target, 'sketch');
  if (d) return refuse(d);
  const sk = cleanSketch(st.sketches[f.target]);
  if (!sk) return refuse(`${f.id}: ${f.target} is not a sketch`);
  const opt = optionPlan('pull', f as unknown as OptView, sk, ctx);
  if ('refusal' in opt) return refuse(`${f.id}: ${opt.refusal}`);
  const s = h.inSketch(sk);
  if ('refusal' in s) return refuse(`${f.id}: ${s.refusal}`);
  const body = { operation: 'new', body_name: h.name };
  const built = emitSweep(opt, s, sk, ctx, st, body);
  if ('refusal' in built) return refuse(`${f.id}: ${built.refusal}`);
  return { variants: [[...built.cmds]], produces: [h.name], consumes: [], flagCurvedSlant: !!(opt.slant && hasCurve(sk, ctx)), verify: (m) => verifyPull(f, m, sk, ctx) };
}

function planPocket(fe: Feature, st: TranslateState, ctx: PlanCtx, h: PlanHelpers): Plan {
  const f = fe as PocketFeature;
  const d = h.dep(f.target, 'sketch') || h.dep(f.into, 'solid');
  if (d) return refuse(d);
  const sk = cleanSketch(st.sketches[f.target]);
  const bs = h.needBody(f.into);
  if (!sk || !bs) return refuse(`${f.id}: needs a sketch and a part to cut`);
  const before = st.measure[h.headOf(f.into)];
  const opt = optionPlan('pocket', f as unknown as OptView, sk, ctx, before?.bbox ?? null);
  if ('refusal' in opt) return refuse(`${f.id}: ${opt.refusal}`);
  const s = h.inSketch(sk);
  if ('refusal' in s) return refuse(`${f.id}: ${s.refusal}`);
  // A slanted tool with a round shape that crosses a face of the part is slower, did not finish in 25 s in one join, or TRAPS the pinned kernel
  // (measured). It builds quickly when it ends inside the part. So: no round slanted tool that leaves the part's box, no cut into a body made from one.
  if (bs.some((b) => st.curvedSlant!.has(b))) return refuse(`${f.id}: the part it cuts was made from a slanted round pull, and cutting into one can freeze or crash SolidCraft, so it is not built yet; cut before slanting, or draw the slanted pull with straight sides`);
  // the bounding-box test below does not see an earlier hole, pocket or step INSIDE the box, so a slanted round cut is only built into a plain block
  if (opt.slant && hasCurve(sk, ctx) && !ctx.unguardedSlant) { // ctx.unguardedSlant: measuring only
    const piece = bs.map((b) => st.scene!.find((x) => x.name === b));
    if (piece.some((x) => !x || !isBlock(x))) return refuse(`${f.id}: a slanted cut with a round shape is only built into a plain block (no holes, pockets or steps in it), because SolidCraft can take minutes or freeze when it has to cut around them; this part is not one, so cut the slanted hole first, or cut straight down`);
  }
  if (opt.slant && hasCurve(sk, ctx) && before?.bbox) {
    const te = frameExtents(opt, sk, ctx); const pe = bboxInFrame(before.bbox, opt);
    if (!te) return refuse(`${f.id}: the outline of this slanted cut could not be measured`);
    const eps = 1e-6; const out: string[] = [];
    for (const ax of ['u', 'v'] as const) if (te[ax][0] < pe[ax][0] - eps || te[ax][1] > pe[ax][1] + eps) out.push(ax);
    if (opt.through) out.push('n');
    else { const far = te.n; const travelPos = opt.sgn * SIGN(opt.slant.c) > 0; if (travelPos ? far[1] > pe.n[1] + eps : far[0] < pe.n[0] - eps) out.push('n'); }
    if (out.length) return refuse(`${f.id}: a slanted cut with a round shape is only built when it ends inside the part; this one runs out through the ${opt.through ? 'far side' : 'side or far end'} of the part, which can freeze or crash SolidCraft; shorten the depth, cut straight down, or draw it with straight sides`);
  }
  const built = emitSweep(opt, s, sk, ctx, st, { operation: 'cut', targets: bs });
  if ('refusal' in built) return refuse(`${f.id}: ${built.refusal}`);
  // the tool as a separate finite body (for the consistency check): a through-all cut becomes a tool long enough to cover the whole part
  const toolOf = finiteTool(opt);
  const tool: Tool = { pieces: bs, build: (body, only) => emitSweep(toolOf, s, sk, ctx, st, body, only) };
  tool.extents = frameExtents(opt, sk, ctx); tool.opt = opt;
  return { variants: [[...built.cmds]], produces: bs, consumes: [f.into], verify: (m, env) => verifyPocket(f, m, before, sk, ctx, env, tool) };
}

function planCombine(fe: Feature, st: TranslateState, _ctx: PlanCtx, h: PlanHelpers): Plan {
  const f = fe as CombineFeature;
  const ds = f.targets.map((t) => h.dep(t)).find(Boolean);
  if (ds) return refuse(ds);
  if (f.targets.length < 2) return refuse(`${f.id}: a join, subtract or intersect needs two or more parts`);
  const all = f.targets.map((t) => h.needBody(t));
  if (all.some((b) => !b || b.length === 0)) return refuse(`${f.id}: one of its parts has nothing built, so there is nothing to combine`);
  const parts = all as string[][];
  const op = f.op === 'union' ? 'join' : f.op === 'subtract' ? 'cut' : 'intersect';
  // a target can be several pieces. A join takes every piece of every target; a subtract or intersect of pieces is not mapped.
  if (op !== 'join' && parts.some((b) => b.length !== 1)) return refuse(`${f.id}: a ${f.op === 'subtract' ? 'subtract' : 'intersect'} is not built yet when one of its parts is ${parts.find((b) => b.length !== 1)!.length} separate pieces; make every part one piece`);
  const flat = parts.flat();
  if (op === 'join' && flat.some((n) => st.curvedSlant!.has(n))) {
    // a slanted round pull that overlaps another operand's box would have to be cut against its faces: hangs or traps (see the pocket case)
    const sc = new Map(st.scene!.map((b) => [b.name, b.bbox] as const));
    const vol = (a: number[], b: number[]) => [0, 1, 2].reduce((v, i) => v * Math.max(0, Math.min(a[i + 3], b[i + 3]) - Math.max(a[i], b[i]) - 1e-6), 1);
    for (const n of flat.filter((x) => st.curvedSlant!.has(x))) for (const m2 of flat) if (m2 !== n && sc.get(n) && sc.get(m2) && vol(sc.get(n)!, sc.get(m2)!) > 0) return refuse(`${f.id} a slanted round pull that runs into the other part cannot be joined yet (it can freeze or crash SolidCraft); join it where it only touches, or pull it with straight sides`);
  }
  if (op === 'join') {
    const bt = blockTouches(flat, st.scene!);
    if (bt.length) return refuse(JOIN_TOUCH_SENTENCE(f.id));
  }
  return {
    variants: [[{ command: 'solid.combine', params: { target: flat[0], tools: flat.slice(1), operation: op } }]],
    produces: flat, consumes: f.targets,
    verify: op === 'join' ? (m, env) => verifyUnion(f, m, flat, env) : undefined,
  };
}

/**
 * What a student reads when solidcraft itself refuses a feature the mapping let through. Raw kernel text is never shown; it stays in the
 * note's `failed` field for the evidence.
 */
export function plainKernelSentence(f: Feature, raw: unknown): string {
  const what = f.kind === 'extrude' ? 'pull' : f.kind === 'pocket' ? 'pocket' : f.kind === 'combine' ? (f.op === 'union' ? 'join' : f.op === 'subtract' ? 'subtract' : 'intersect') : f.kind === 'fillet' ? 'round' : f.kind;
  const r = String(raw ?? '');
  if (f.kind === 'combine' && /join cannot preserve the original faces|zero-thickness edge contact/.test(r)) return JOIN_TOUCH_SENTENCE(f.id);
  if (/profile loop is not closed/.test(r)) return `${f.id}: the outline does not close: two ends that should meet are a hair apart (less than 0.00001 mm); add a coincident rule between them or make them meet exactly`;
  // DELIBERATE DEVIATION from translate-ep.mjs (owner chose option A, 2026-10-25): the group's translator hides the sketch solver's diagnosis behind
  // the generic sentence below. These two diagnoses were measured on SolidCraft 0.21.0 (diag-conflict, diag-redundant) and are told in plain words,
  // without the kernel's command ids, constraint ids or option names.
  if (f.kind === 'extrude' || f.kind === 'pocket') {
    if (/over-constrain/.test(r)) return `${f.id}: a rule or dimension in this sketch conflicts with the others (it would over-constrain the sketch), so nothing is ${what === 'pull' ? 'added' : 'cut'}; remove or change one of the conflicting rules`;
    if (/already determined/.test(r)) return `${f.id}: a dimension in this sketch is already determined by the other rules, so adding it again would be redundant and nothing is ${what === 'pull' ? 'added' : 'cut'}; remove it, or make it a reference dimension`;
  }
  if (f.kind === 'combine') return `${f.id}: this ${what} cannot be built from these parts (the solid it makes does not close up cleanly), so nothing is combined; change the sizes or positions so the parts overlap by a clear amount`;
  if (/taper closes the profile/.test(r)) return `${f.id}: the taper makes the outline fold over itself or close up before the end of the ${what}, so nothing is built; use a smaller taper or a shorter length`;
  if (/extrude distance is zero/.test(r)) return `${f.id}: the length is too small to build; make it at least ${MIN_LEN} mm`;
  if (/attach a plane to a wire/.test(r)) return `${f.id}: the outline is too small or too thin to build; draw it larger`;
  if (/through all needs a body/.test(r)) return `${f.id}: there is no part to cut through`;
  if (f.kind === 'extrude' || f.kind === 'pocket') return `${f.id}: this ${what} cannot be built from the sketch as drawn (the solid it makes does not close up cleanly), so nothing is ${what === 'pull' ? 'added' : 'cut'}; change the sketch, the length or the options`;
  // every other kind: a plain sentence, never the kernel's text
  return `${f.id}: this ${what} cannot be built as drawn (the solid it makes does not close up cleanly); change its sizes, positions or options`;
}

/** The extrude-pocket group's translator: base planners for every kind except extrude, pocket and combine, plus the group's wording and checks. */
export const EXTRUDE_POCKET_PROFILE: Profile = {
  name: 'extrude-pocket',
  planners: { extrude: planExtrude, pocket: planPocket, combine: planCombine },
  verifies: true,
  initState(st) { st.scene = []; st.curvedSlant = new Set(); },
  // the bookkeeping the generic loop used to do inline after an accepted feature: the scene after the last accepted feature, and the bodies made by a slanted round pull
  onAccepted(st, res, m, plan) {
    if (plan && 'flagCurvedSlant' in plan && plan.flagCurvedSlant) for (const b of m.bodies) st.curvedSlant!.add(b);
    st.scene = res.measure!.bodies.map((b) => ({ name: b.name, vol: b.volume_mm3, bbox: [...b.bbox.min, ...b.bbox.max], shells: b.kernel?.shells ?? 1 }));
  },
  depSentence(f, role, id, st) {
    const lbl = f.kind === 'extrude' || f.kind === 'pocket' || f.kind === 'combine' ? f.id : `${f.id} (${f.kind})`;
    if (st.refused[id]) return `${lbl}: its ${role} ${id} was refused, so there is nothing to build on (${String(st.refused[id]).replace(/^[^:]*: /, '')})`;
    if (st.stale[id]) return `${lbl}: its ${role} ${id} was already used up by ${st.stale[id]}, so it cannot be used again; use the result of ${st.stale[id]} instead`;
    return null;
  },
  noOutline: noOutlineSentence,
  plannerError: (f, e) => ({
    refusal: `${f.id}: this ${f.kind === 'extrude' ? 'pull' : f.kind} could not be mapped for the solid kernel as written; simplify it or change its options`,
    internal: String(e && (e as { message?: unknown }).message),
  }),
  kernelRefusal: (f, raw) => plainKernelSentence(f, raw),
};
