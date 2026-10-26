// TypeScript port of docs/spikes/solidcraft-referee/contract/booleans.guard.mjs (the booleans group's pure guard and sentence layer, round 6; the text booleans.json was built with).
// Behaviour-preserving: same guards in the same order, same thresholds, same sentences. Pure functions: no kernel, no engine.
//
// What it decides, in order, BEFORE any engine call for the combine (G1..G14, G16..G18, G20), and AFTER a successful call (afterCombine: G4b, G19, G21), and the sentence for
// every raw message (plainSentence, G9). The group is NOT accepted in Phase 1 (docs/spikes/solidcraft-referee/LAYER-CONTRACT.md, "booleans: unresolved"): the holes listed in
// NOTES.md (Fold 5) are in this port too, on purpose.
//
//   G1  same shape twice            -> refuse            (join(a, a), cut(a, a), keep(a, a))
//   G10 tube tool                   -> refuse            (cut with a spin() of a ring-shaped outline unless the tube lies wholly inside the part)
//   G2  time budget, hang class     -> refuse            (two cylinders with non-parallel axes; a cylinder whose axis misses a sphere's centre; a cone meeting a round shape other than a coaxial
//                                                         cylinder / cone / centred ball; a torus meeting anything but a plain box around it or a coaxial cylinder)
//   G16 a cylinder or cone meeting a flat face at a slant -> refuse     G18 a cylinder or ball reaching the fillet band of a rounded box -> refuse
//   G17 keep of two cylinders on one axis, same radius, partly overlapping -> refuse       G20 keep of two parallel cylinders that cross (a lens) -> refuse
//   G13 round shapes tangent along a circle -> refuse       G14 hollow ball -> refuse       G3b keep of a shallow ball cap wider than the other shape -> refuse
//   G3  sliver overlap              -> refuse            (cut / keep whose overlap is thinner than SLIVER[class] mm)
//   G4 / G5 a cut that removes nothing / a keep that leaves nothing -> refuse     G6 pinch on join     G7 pinch on cut
//   G19 (after the build) the result sticks out of the box of an operand it must lie in -> refuse     G21 (after the build) a cut that leaves a curved remainder under 3e-2 of the target -> refuse
//   G8  a tool reused later is not a refusal: the translator passes keep_tools so the tool survives (reusedTools)
//   G9  plainSentence(raw)          -> every raw engine / translator message becomes one student sentence (no ids, no engine words)
//   G12 a handle that is several pieces used by a feature that needs ONE piece -> refuse (plainPieces)
// Rule for the PAGE: every engine run for a combine runs with a time budget (BUDGET_S seconds); on a timeout the run is terminated and nothing is changed. The layer asks the host for it
// through ctx.runSC(cmds, { budgetS }); a host that ignores the option leaves the run unbounded (see booleans.ts).
import * as SL from './booleans-slow.js';
import type { Orient, SlowFeat } from './booleans-slow.js';
import type { V3 } from './types.js';

export const BUDGET_S = 45;
// Thin-overlap thresholds, by what the thin overlap is made of (measured: booleans-r2/sliver-sweep.json for planar tools, booleans-r3/sliver-sweep-round.json for round ones):
//   flat    both faces that meet are flat and square to the axes: cut and keep exact from 2e-3 mm, silent no-op / no body at <= 1.5e-3  -> 4e-3 (2x)
//   rotated planar tools turned off the axes, or an operand the guard cannot classify  -> 0.1 (2x)
//   curved  a curved surface is the one that enters: cut is silently ignored at <= 0.1 (ball) / <= 0.05 (cylinder)  -> 0.2;  keep gives no body, a refusal or a volume 6e-4 off down to 1 mm / 2 mm  -> 2
export const SLIVER = { flat: 4e-3, rotated: 0.1, curvedCut: 0.2, curvedKeep: 2 };
const EPS = 1e-6;

type Op = string;
/** The combine feature as the guard reads it. */
export interface CombineView { id: string; op: Op; targets: string[] }
/** One operand: its feature id and its descriptor. */
export interface GuardOp { id: string; d: Desc }
/** A measured body, as the aggregate of the translator gives it. */
export interface MeasureView { bbox: number[]; faceTypes?: Record<string, number>; curved?: boolean }
/** What the guard sees of one operand (describe()). */
export interface Desc {
  lo: number[];
  hi: number[];
  prim: SlowFeat | null;
  aligned: boolean;
  kind: string | null;
  axis: string | null;
  round: boolean;
  faceTypes: Record<string, number>;
  curved: boolean;
  ring: { angle?: number } | null;
  pieces: number;
  info: Orient | null;
}
export interface GuardHit { code: string; sentence: string; detail?: unknown }

// measured bboxes of CURVED bodies come from tessellation (a cylinder of radius 10 reports x max 39.99985 instead of 40; a torus 17.99995 instead of 18),
// so 'touching' / 'apart' / 'inside' comparisons use a per-operand tolerance of 1e-3 mm + 2e-4 x the operand's largest extent for curved bodies
const tolOf = (d: Desc): number => (hasCurved(d) ? 1e-3 + 2e-4 * Math.max(d.hi[0] - d.lo[0], d.hi[1] - d.lo[1], d.hi[2] - d.lo[2]) : EPS);
const tolPair = (a: Desc, b: Desc): number => Math.max(tolOf(a), tolOf(b));

const FN: Record<string, string> = { union: 'join', subtract: 'cut', intersect: 'keep' };
const mm = (v: number): string => String(+v.toPrecision(3));
export const SENTENCES = {
  sameShape: (op: Op): string => `${FN[op]}() was given the same shape twice; give it two different shapes.`,
  budget: (op: Op): string => `This ${FN[op]}() took longer than ${BUDGET_S} seconds to calculate, so it was stopped and nothing was changed; use simpler shapes or cut with a box-shaped tool.`,
  trap: (op: Op): string => `The solid calculation for this ${FN[op]}() failed part-way, so nothing was changed; if two faces of the shapes are almost, but not exactly, on top of each other, move one shape so they are clearly apart or exactly together.`,
  hangCross: (op: Op): string => `Round shapes that cross at an angle or off-centre (two cylinders at right angles, a cylinder that misses the centre of a ball) take minutes to calculate here, so this ${FN[op]}() is not built; line them up on one axis or use a box-shaped tool.`,
  hangCone: (op: Op): string => `A cone combined with a cylinder, cone or ball that is not on the cone's own axis either fails or takes minutes here, so this ${FN[op]}() is not built; put the other shape on the cone's axis, or use a box-shaped tool.`,
  hangTorus: (op: Op): string => `A ring (torus) that meets another shape in anything but a box around it or a cylinder through its hole takes minutes or fails here, so this ${FN[op]}() is not built; keep the ring clear of the other shape or enclose it in a box.`,
  sliver: (op: Op, depth: number = SLIVER.rotated): string => `The two shapes overlap by less than ${mm(depth)} mm, which is too thin to ${op === 'intersect' ? 'keep' : 'cut'} reliably here, so nothing was changed; make the overlap at least ${mm(depth)} mm deep or move the shapes clear of each other.`,
  cutNothingThin: (): string => 'The cut removed nothing because the cutting shape only grazes the part or misses it; move it so the two overlap clearly.',
  cutNothing: (): string => 'The cutting shape does not overlap the shape being cut, so nothing would be removed; move it (give it an at: position) so the two overlap.',
  keepNothing: (): string => 'The two shapes do not overlap, so keeping their overlap leaves nothing.',
  keepNothingKernel: (): string => 'Keeping the overlap of these shapes leaves nothing here: they do not overlap, or only by a sliver too thin to keep.',
  cutEverything: (): string => 'The cutting shapes would remove the whole shape, so nothing would be left.',
  pinchJoin: (): string => 'The two shapes only touch along a line or at a point, so they would not be one solid; overlap them a little.',
  thinCap: (): string => 'The part this keep() would leave is a shallow cap of a ball that runs out past the edges of the other shape, which cannot be built reliably here, so nothing was changed; push the ball deeper into the shape or keep the cap inside the shape\'s edges.',
  pinchCut: (): string => "The cutting shape touches the part's surface along a line or at a point, which leaves a pinched solid that cannot be built correctly here, so nothing was changed; change its size or position a little so it clearly crosses that surface or stays clear of it.",
  tangentCircle: (op: Op): string => `The two round shapes only touch along a circle, which cannot be built as one clean solid here, so this ${FN[op]}() was not done; change one size a little so they clearly overlap or clearly miss each other.`,
  hollowBall: (op: Op): string => `A ball with a smaller ball taken out of its inside (a hollow ball) cannot be built here, so this ${FN[op]}() was not done.`,
  tubeTool: (op: Op): string => `A tube-shaped tool (a spin() of a ring-shaped outline) that is not wholly inside the part cannot be built correctly here, so this ${FN[op]}() was not done; cut with a solid shape instead, or keep the tube wholly inside the part.`,
  slant: (op: Op): string => `A cylinder or cone that meets a flat face at a slant (neither square to it nor parallel to it) takes minutes to calculate here, so this ${FN[op]}() is not built; turn the shapes together, or keep the round shape square to the flat faces.`,
  roundBand: (op: Op): string => `A cylinder or ball that reaches the rounded edges or corners of a rounded box takes minutes to calculate here, so this ${FN[op]}() is not built; keep the round shape clear of the rounded edges, or use a box-shaped tool.`,
  lens: (op: Op): string => `The overlap of two cylinders with parallel axes that cross each other (a lens shape) cannot be built reliably here, so this ${FN[op]}() was not done; put the two cylinders on one axis, let one contain the other, or cut with a box-shaped tool.`,
  outsideShapes: (op: Op): string => `The part this ${FN[op]}() would leave came out bigger than the shapes it was made from, so its size cannot be trusted here and nothing was changed; use a smaller round shape, or make the overlap deeper.`,
  tinyRemainder: (): string => 'This cut() would leave only a very thin sliver of the part (under 3 percent of its volume), which cannot be calculated reliably here, so nothing was changed; cut less away, or remove the sliver on purpose with a different cut.',
  sameWall: (op: Op): string => `Two cylinders on the same axis with the same radius share their curved wall, and keeping only their overlap cannot be built here, so this ${FN[op]}() was not done; give one of them a clearly different radius, or let one contain the other.`,
  costly: (op: Op): string => `This ${FN[op]}() of round shapes would take longer than ${BUDGET_S} seconds on this computer, so it is not built; use fewer or simpler round shapes, or cut with a box-shaped tool.`,
  coincident: (op: Op): string => `This ${FN[op]}() could not be calculated here because faces of the two shapes lie exactly on top of each other, so nothing was changed; move one shape a little so they clearly cross, or build the part in simpler steps.`,
  shallow: (op: Op): string => `This ${FN[op]}() could not be calculated here because curved faces of the two shapes meet at a shallow angle or only just touch, so nothing was changed; change a size or a position a little so they clearly cross, or build the part in simpler steps.`,
  curvedKernel: (op: Op): string => `This ${FN[op]}() could not be calculated here, so nothing was changed; try building the part in simpler steps, one join, cut or keep at a time.`, // only for kernel text with no recorded cause
  generic: (op: Op): string => `This ${FN[op]}() could not be built, so nothing was changed; move the shapes so they overlap more clearly.`,
  needTwo: (): string => 'A join, cut or keep needs two or more shapes.',
  consumed: (): string => 'This shape was already used up by an earlier join, cut or keep, so it cannot be used again; make a second copy of it.',
  skipped: (): string => 'This step was skipped because an earlier step it depends on was not done; fix that earlier step first.',
  pieces: (): string => 'This step needs the part to be one connected piece, but an earlier cut left it in several pieces; join the pieces together first or cut so that one piece is left.',
};

// ---- operand descriptors ------------------------------------------------------------------------------------------------------
const rotAxis = (rotate: V3 | undefined): string => { // world direction of the primitive's own Z axis after the translator's x, y, z rotations (about the origin); 'x'|'y'|'z'|'oblique'
  let v: V3 = [0, 0, 1];
  const rx = (a: number, [x, y, z]: V3): V3 => { const c = Math.cos(a), s = Math.sin(a); return [x, y * c - z * s, y * s + z * c]; };
  const ry = (a: number, [x, y, z]: V3): V3 => { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c]; };
  const rz = (a: number, [x, y, z]: V3): V3 => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c, z]; };
  const d = Math.PI / 180;
  if (rotate?.[0]) v = rx(rotate[0] * d, v);
  if (rotate?.[1]) v = ry(rotate[1] * d, v);
  if (rotate?.[2]) v = rz(rotate[2] * d, v);
  const a = v.map(Math.abs);
  for (const [i, n] of [[0, 'x'], [1, 'y'], [2, 'z']] as Array<[number, string]>) if (a[i] > 1 - 1e-9) return n;
  return 'oblique';
};
/** descriptor of one operand: bbox from the measured body, kind/axis from the ModelDoc feature when it is an untouched primitive. extra: {ring: {angle}|null, pieces: n, info} */
export function describe(measure: MeasureView, feat: SlowFeat | null | undefined, extra: { ring?: { angle?: number } | null; pieces?: number; info?: Orient | null } = {}): Desc {
  const lo = measure.bbox.slice(0, 3); const hi = measure.bbox.slice(3);
  const prim = feat && ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge'].includes(feat.kind) ? feat : null;
  const aligned = !!prim && (prim.rotate ?? [0, 0, 0]).every((v) => Math.abs(v / 90 - Math.round(v / 90)) < 1e-9); // a primitive turned by multiples of 90 degrees fills its bounding box the way an unturned one does
  return { lo, hi, prim, aligned, kind: prim?.kind ?? null, axis: prim && ['cylinder', 'cone', 'torus'].includes(prim.kind) ? rotAxis(prim.rotate) : null, round: !!(prim && prim.round), faceTypes: measure.faceTypes ?? {}, curved: !!measure.curved, ring: extra.ring ?? null, pieces: extra.pieces ?? 1, info: extra.info ?? null };
}
const overlapOf = (a: Desc, b: Desc): number[] => [0, 1, 2].map((i) => Math.min(a.hi[i], b.hi[i]) - Math.max(a.lo[i], b.lo[i]));
const hasCurved = (d: Desc): boolean => d.curved || d.kind === 'cylinder' || d.kind === 'sphere' || d.kind === 'cone' || d.kind === 'torus' || d.round;
const AXI: Record<string, number> = { x: 0, y: 1, z: 2 };
const centre = (d: Desc): number[] => [0, 1, 2].map((i) => (d.lo[i] + d.hi[i]) / 2);
/** is the operand's face on the +/-axis side of its bbox a plane (area contact possible)? null = cannot tell (not a plain primitive) */
const flatOnAxis = (d: Desc, ax: string): boolean | null => {
  if (!d.prim || d.round) return null;
  if (d.kind === 'box') return d.aligned; // a box turned by 45 degrees touches with an edge or a corner, not a face
  if (d.kind === 'cylinder') return d.axis === ax;
  if (d.kind === 'prism' || d.kind === 'wedge') return d.aligned ? null : false;
  return false; // sphere, cone tip, torus: the bbox face is a curved surface
};
const isPlainBox = (d: Desc): boolean => d.kind === 'box' && d.aligned && !d.round;

// ---- the checks ---------------------------------------------------------------------------------------------------------------
/** are two axes the same line? (both world axes of the same name, centres on that line) */
const coaxial = (a: Desc, b: Desc, tol: number): boolean => {
  if (!a.axis || !b.axis || a.axis === 'oblique' || a.axis !== b.axis) return false;
  const k = AXI[a.axis]; const ca = centre(a); const cb = centre(b);
  return [0, 1, 2].every((i) => i === k || Math.abs(ca[i] - cb[i]) <= tol);
};
interface CylFacts { a: number[]; c: number[]; r: number; h: number }
/** facts of a plain cylinder operand: a primitive, or a round pull / spin whose lineage says one cylinder axis along a world axis. null = cannot tell */
function cylFacts(d: Desc): CylFacts | null {
  if (d.prim?.kind === 'cylinder' && !d.prim.round) {
    const R = SL.rotMat(d.prim.rotate); const a = [R[0][2], R[1][2], R[2][2]];
    const c = d.prim.center ?? [0, 0, 0];
    return { a, c, r: d.prim.radius!, h: d.prim.height! };
  }
  const ft = d.faceTypes ?? {};
  if (!d.prim && d.info && d.info.cyl.length === 1 && d.info.cone.length === 0 && !d.info.sphere && d.info.torus.length === 0 && ft.cylinder === 1 && ft.plane === 2 && Object.keys(ft).length === 2) {
    const a = d.info.cyl[0]; const k = a.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
    if (k < 0) return null;
    const ext = [0, 1, 2].map((i) => d.hi[i] - d.lo[i]); const rest = [0, 1, 2].filter((i) => i !== k);
    if (Math.abs(ext[rest[0]] - ext[rest[1]]) > 1e-3 * Math.max(1, ext[rest[0]])) return null;
    const c = centre(d); return { a: [0, 0, 0].map((_, i) => (i === k ? 1 : 0)), c, r: ext[rest[0]] / 2, h: ext[k] };
  }
  return null;
}
/** two cylinders on ONE line with the same radius whose lengths overlap in part (neither contains the other, and they are not merely touching) */
function sharedWall(A: Desc, B: Desc): boolean {
  const a = cylFacts(A); const b = cylFacts(B); if (!a || !b) return false;
  const tol = 1e-6 * Math.max(1, a.r, b.r, a.h, b.h);
  const par = Math.abs(Math.abs(a.a[0] * b.a[0] + a.a[1] * b.a[1] + a.a[2] * b.a[2]) - 1) < 1e-9;
  if (!par || Math.abs(a.r - b.r) > tol) return false;
  const dc = [0, 1, 2].map((i) => b.c[i] - a.c[i]); const along = dc[0] * a.a[0] + dc[1] * a.a[1] + dc[2] * a.a[2];
  const off = Math.hypot(dc[0] - along * a.a[0], dc[1] - along * a.a[1], dc[2] - along * a.a[2]);
  if (off > tol) return false; // not the same line
  const lo = Math.max(-a.h / 2, along - b.h / 2); const hi = Math.min(a.h / 2, along + b.h / 2);
  if (hi - lo <= tol) return false; // only touching or apart: the other guards
  const aInB = along - b.h / 2 <= -a.h / 2 + tol && along + b.h / 2 >= a.h / 2 - tol; const bInA = -a.h / 2 <= along - b.h / 2 + tol && a.h / 2 >= along + b.h / 2 - tol;
  return !aInB && !bInA; // containment builds (measured: coax-probe.txt)
}
/** two parallel cylinders whose walls cross (a lens) and whose heights overlap in volume */
function crossLens(A: Desc, B: Desc): boolean {
  const a = cylFacts(A); const b = cylFacts(B); if (!a || !b) return false;
  const tol = 1e-6 * Math.max(1, a.r, b.r, a.h, b.h);
  const par = Math.abs(Math.abs(a.a[0] * b.a[0] + a.a[1] * b.a[1] + a.a[2] * b.a[2]) - 1) < 1e-9;
  if (!par) return false;
  const dc = [0, 1, 2].map((i) => b.c[i] - a.c[i]); const along = dc[0] * a.a[0] + dc[1] * a.a[1] + dc[2] * a.a[2];
  const off = Math.hypot(dc[0] - along * a.a[0], dc[1] - along * a.a[1], dc[2] - along * a.a[2]);
  if (off <= tol) return false; // one axis: coaxial (sharedWall / containment)
  if (off >= a.r + b.r - tol || off <= Math.abs(a.r - b.r) + tol) return false; // apart, tangent, or one inside the other: the walls do not cross
  return Math.min(a.h / 2, along + b.h / 2) - Math.max(-a.h / 2, along - b.h / 2) > tol;
}
/** hang class: returns 'cross' | 'cone' | 'torus' | null for one pair of operands whose bboxes are not apart */
function hangOf(A: Desc, B: Desc): 'cross' | 'cone' | 'torus' | null {
  const ov = overlapOf(A, B); const tol = tolPair(A, B);
  if (ov.some((v) => v < -tol)) return null; // apart: no surface meets
  for (const [t, o] of [[A, B], [B, A]]) {
    if (!(t.kind === 'torus' || (!t.prim && t.faceTypes.torus))) continue;
    // W1: the torus sits strictly inside a plain box: the surfaces never meet (measured, x-box-minus-tor-void: 12 s)
    const inside = isPlainBox(o) && [0, 1, 2].every((i) => t.lo[i] > o.lo[i] + tol && t.hi[i] < o.hi[i] - tol);
    // W2: a cylinder coaxial with the torus: every meeting is a circle (measured, x-tor-union-cyl-axis / -touch: 16 s)
    const coax = o.kind === 'cylinder' && t.kind === 'torus' && coaxial(o, t, tol);
    if (!(inside || coax)) return 'torus';
  }
  if (A.kind === 'cylinder' && B.kind === 'cylinder') {
    // W3 (round 4): a cylinder with another direction that lies WHOLLY inside the other never meets its surface: measured fast and exact (hg-cyl-inside-perp 1.9 s). Not 'crossing'.
    const nested = A.prim && B.prim && !A.round && !B.round && (SL.cylInsideCyl(A.prim, B.prim) || SL.cylInsideCyl(B.prim, A.prim));
    if (!nested && (A.axis === 'oblique' || B.axis === 'oblique' || A.axis !== B.axis)) return 'cross'; // parallel axes: fast (x-cyl-minus-cyl-parallel 0.9 s)
  }
  // sphere x cylinder: circles only when the cylinder axis passes through the sphere centre (x-sph-cut-cyl 9 s); an axis that misses the centre makes a quartic curve (fuzz: no result in 60 s)
  const sc = A.kind === 'sphere' && B.kind === 'cylinder' ? [A, B] : A.kind === 'cylinder' && B.kind === 'sphere' ? [B, A] : null;
  if (sc) {
    const [s, c] = sc;
    if (c.axis === 'oblique') return 'cross';
    const k = AXI[c.axis!];
    const off = [0, 1, 2].filter((i) => i !== k).map((i) => (s.lo[i] + s.hi[i]) / 2 - (c.lo[i] + c.hi[i]) / 2);
    if (Math.hypot(...off) > tol) return 'cross';
  }
  // a cone meeting another round shape: only the measured-safe combinations (CONE_OK) are built, everything else is refused rather than guessed
  const cn = A.kind === 'cone' ? [A, B] : B.kind === 'cone' ? [B, A] : null;
  if (cn && hasCurved(cn[1]) && !coneOk(cn[0], cn[1], tol)) return 'cone';
  return null;
}
/** the cone combinations that were MEASURED to build in a few seconds and to match OCCT (booleans-r3/cone-*): a cylinder or cone on the cone's own axis, a ball centred on that axis */
export const CONE_OK = { cylinderCoaxial: true, coneCoaxial: true, ballCentred: true };
function coneOk(cone: Desc, other: Desc, tol: number): boolean {
  if (cone.axis === 'oblique') return false;
  if (other.kind === 'cylinder' || other.kind === 'cone') return CONE_OK[other.kind === 'cylinder' ? 'cylinderCoaxial' : 'coneCoaxial'] && coaxial(cone, other, tol);
  if (other.kind === 'sphere') {
    const k = AXI[cone.axis!]; const cc = centre(cone); const cs = centre(other);
    return CONE_OK.ballCentred && [0, 1, 2].every((i) => i === k || Math.abs(cc[i] - cs[i]) <= tol);
  }
  return false;
}

/** does a curved surface of this operand face the thin axis? (ball, cone, ring, cylinder on its side, rounded box, or a body the guard cannot read that has curved faces) */
const curvedOnAxis = (d: Desc, ax: string): boolean => {
  if (d.round) return true;
  if (d.kind === 'sphere' || d.kind === 'cone' || d.kind === 'torus') return true;
  if (d.kind === 'cylinder') return d.axis !== ax;
  if (d.prim) return false;
  return !!d.curved;
};
/** the class of a thin overlap along axis `ax` between two operands: 'flat' | 'curved' | 'rotated' */
function sliverClass(a: Desc, b: Desc, ax: number): 'flat' | 'curved' | 'rotated' {
  const k = 'xyz'[ax];
  if (flatOnAxis(a, k) === true && flatOnAxis(b, k) === true) return 'flat';
  if (curvedOnAxis(a, k) || curvedOnAxis(b, k)) return 'curved';
  return 'rotated';
}
// round 5 (critic round 3): a thin KEEP of a BALL needs a depth that scales with the ball, not a flat 2 mm. THE 0.1 WAS CHOSEN AFTER SEEING THAT DATA (the smallest round fraction that has no failing case at or above it).
export const BALL_KEEP_FRAC = 0.1;
// round 6 (critic round 4): the same for a keep where a CYLINDER enters on its curved side. THE 0.035 R WAS CHOSEN AFTER SEEING THAT DATA. A keep that dips less than max(2 mm, 0.035 R, 0.1 R_ball) is refused.
export const CYL_KEEP_FRAC = 0.035;
export const TINY_FRAC = 3e-2;
const sliverMm = (cls: string, op: Op, a: Desc, b: Desc, ax = -1): number => {
  if (cls === 'flat') return SLIVER.flat;
  if (cls === 'rotated') return SLIVER.rotated;
  if (op !== 'intersect') return SLIVER.curvedCut;
  const R = Math.max(...[a, b].map((x) => (x?.kind === 'sphere' && x.prim ? x.prim.radius! : 0)));
  // a cylinder that enters on its curved side (its axis is NOT the thin axis); a plain primitive, or a round pull / spin that reads as one cylinder (cylFacts)
  const Rc = Math.max(...[a, b].map((x) => { const c = cylFacts(x); return c && Math.abs(c.a[ax]) < 0.999 ? c.r : 0; }));
  return Math.max(SLIVER.curvedKeep, BALL_KEEP_FRAC * R, CYL_KEEP_FRAC * Rc);
};

// ---- oriented-box penetration depth (separating-axis test): the thickness of the overlap of two boxes turned by the SAME translator rotation (x, then y, then z about the origin), centres as given.
const dot = (u: number[], v: number[]): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u: number[], v: number[]): number[] => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
/** penetration depth of two oriented boxes (the smallest overlap over the 15 separating axes); <= 0 when they do not overlap. Returns null when either is not a plain box primitive. */
export function obbDepth(A: Desc, B: Desc): number | null {
  if (!A.prim || !B.prim || A.kind !== 'box' || B.kind !== 'box' || A.round || B.round) return null;
  const mk = (p: SlowFeat): { c: number[]; h: number[]; ax: number[][] } => { const R = SL.rotMat(p.rotate); return { c: p.center ?? [0, 0, 0], h: p.size!.map((v) => v / 2), ax: [0, 1, 2].map((j) => [R[0][j], R[1][j], R[2][j]]) }; };
  const a = mk(A.prim); const b = mk(B.prim);
  const t = [0, 1, 2].map((i) => b.c[i] - a.c[i]);
  const axes = [...a.ax, ...b.ax];
  for (const u of a.ax) for (const v of b.ax) { const w = cross(u, v); const n = Math.hypot(...w); if (n > 1e-9) axes.push(w.map((x) => x / n)); }
  let best = Infinity;
  for (const L of axes) {
    const ra = a.h.reduce((s, h, i) => s + h * Math.abs(dot(a.ax[i], L)), 0); const rb = b.h.reduce((s, h, i) => s + h * Math.abs(dot(b.ax[i], L)), 0);
    best = Math.min(best, ra + rb - Math.abs(dot(t, L)));
  }
  return best;
}

/**
 * f: the combine feature {id, op, targets}. ops: array of {id, d: descriptor} in targets order (target first).
 * Returns null or {code, sentence}.
 */
export function guardCombine(f: CombineView, ops: GuardOp[]): GuardHit | null { const r = guardCombine0(f, ops); if (r) PLAIN.add(r.sentence); return r; }
function guardCombine0(f: CombineView, ops: GuardOp[]): GuardHit | null {
  const op = f.op;
  if (new Set(f.targets).size !== f.targets.length) return { code: 'G1', sentence: SENTENCES.sameShape(op) };
  const pairs: Array<[GuardOp, GuardOp]> = op === 'union' ? ops.flatMap((a, i) => ops.slice(i + 1).map((b): [GuardOp, GuardOp] => [a, b])) : ops.slice(1).map((t): [GuardOp, GuardOp] => [ops[0], t]);
  // G10 tube tool: a spin() of a ring-shaped outline used as the TOOL of a cut, unless it lies wholly inside the part (a void)
  if (op === 'subtract') {
    for (const [a, b] of pairs) {
      if (!b.d.ring) continue;
      const tol = tolPair(a.d, b.d);
      const inside = [0, 1, 2].every((i) => b.d.lo[i] > a.d.lo[i] + tol && b.d.hi[i] < a.d.hi[i] - tol);
      if (!inside) return { code: 'G10', sentence: SENTENCES.tubeTool(op) };
    }
  }
  // G2 hang class (any pair)
  for (const [a, b] of pairs) { const h = hangOf(a.d, b.d); if (h) return { code: 'G2', sentence: h === 'cross' ? SENTENCES.hangCross(op) : h === 'cone' ? SENTENCES.hangCone(op) : SENTENCES.hangTorus(op), detail: h }; }
  // G16 (round 4): a cylinder or cone whose curved side meets a flat face at a slant. MEASURED (booleans-r4/cost-grid1.jsonl): >30 s cpu for every turned-box / vertical-cylinder pair except a turn about the cylinder's own axis,
  // and for a tilted cylinder against an axis-aligned box; a few seconds when the two are square to each other. The pair is read from the lineage of both operands (booleans-slow).
  {
    const all = ops.flatMap((a, i) => ops.slice(i + 1).map((b): [GuardOp, GuardOp] => [a, b]));
    for (const [a, b] of all) {
      if (a.d.kind === 'cylinder' && b.d.kind === 'cylinder') continue; // two cylinders are G2's (cross / nested)
      if (!a.d.info || !b.d.info) continue;
      const ov = overlapOf(a.d, b.d); const tol = tolPair(a.d, b.d);
      if (!ov.every((v) => v > tol)) continue; // the boxes do not overlap in volume: no surface of one reaches the other
      const v = SL.slantedMeeting({ info: a.d.info, prim: a.d.prim }, { info: b.d.info, prim: b.d.prim });
      if (v === 'slant') return { code: 'G16', sentence: SENTENCES.slant(op), detail: 'slant' };
    }
  }
  // G18 (round 4): a rounded box (whole-shape round) whose fillet band is reached by a cylinder or a ball
  {
    const all = ops.flatMap((a, i) => ops.slice(i + 1).map((b): [GuardOp, GuardOp] => [a, b]));
    for (const [a, b] of all) for (const [r, o] of [[a, b], [b, a]]) {
      if (r.d.prim?.kind === 'box' && r.d.prim.round && o.d.prim && (o.d.prim.kind === 'cylinder' || o.d.prim.kind === 'sphere')) {
        const ov = overlapOf(r.d, o.d); if (!ov.every((v) => v > tolPair(r.d, o.d))) continue;
        if (SL.roundBandHit(r.d.prim, o.d.prim) === true) return { code: 'G18', sentence: SENTENCES.roundBand(op) };
      }
    }
  }
  // G17 (round 4): keep() of two cylinders on one axis with the same radius whose lengths overlap only in part: the kernel returns no result (cut and join of the same pair build)
  if (op === 'intersect') {
    for (const [a, b] of ops.flatMap((x, i) => ops.slice(i + 1).map((y): [GuardOp, GuardOp] => [x, y]))) {
      if (sharedWall(a.d, b.d)) return { code: 'G17', sentence: SENTENCES.sameWall(op) };
    }
  }
  // G20 (round 6): keep() of two PARALLEL cylinders that cross each other (a lens: neither contains the other, axes apart by less than the radii sum and more than their difference, heights overlap in volume).
  if (op === 'intersect') {
    for (const [a, b] of ops.flatMap((x, i) => ops.slice(i + 1).map((y): [GuardOp, GuardOp] => [x, y]))) {
      if (crossLens(a.d, b.d)) return { code: 'G20', sentence: SENTENCES.lens(op) };
    }
  }
  // G13 torus and a coaxial cylinder that meet only along a circle at the INNER equator (cylinder radius = ring radius - tube radius): join gives one body with two shells, cut removes nothing, keep leaves nothing.
  // The OUTER equator (cylinder radius = ring radius + tube radius, the ring inside the cylinder) was measured fine for join and keep and is refused for cut only
  for (const [a, b] of pairs) {
    for (const [t, c] of [[a.d, b.d], [b.d, a.d]]) {
      if (t.kind !== 'torus' || c.kind !== 'cylinder' || !coaxial(t, c, tolPair(t, c))) continue;
      const R = t.prim!.ringRadius!; const r = t.prim!.tubeRadius!; const tol = tolPair(t, c);
      const rc = c.prim!.radius!;
      if (Math.abs(rc - (R - r)) <= tol) return { code: 'G13', sentence: SENTENCES.tangentCircle(op) };
      if (op === 'subtract' && Math.abs(rc - (R + r)) <= tol) return { code: 'G13', sentence: SENTENCES.tangentCircle(op) }; // cylinder minus the ring it encloses: the kernel needs more than 150 s and then refuses it
    }
  }
  // G14 hollow ball: a smaller ball wholly inside a ball, as the tool of a cut (concentric, off centre or touching from inside)
  if (op === 'subtract') {
    for (const [a, b] of pairs) {
      if (a.d.kind === 'sphere' && b.d.kind === 'sphere') {
        const tol = tolPair(a.d, b.d);
        if ([0, 1, 2].every((i) => b.d.lo[i] >= a.d.lo[i] - tol && b.d.hi[i] <= a.d.hi[i] + tol)) return { code: 'G14', sentence: SENTENCES.hollowBall(op) };
      }
    }
  }
  if (op === 'subtract' || op === 'intersect') {
    const ovs = pairs.map(([a, b]) => overlapOf(a.d, b.d));
    const tols = pairs.map(([a, b]) => tolPair(a.d, b.d));
    // G3 sliver: bbox overlap positive but thinner than the class threshold on some axis (the true overlap is no thicker than its bbox)
    for (const [k, ov] of ovs.entries()) {
      if (!ov.every((v) => v > tols[k])) continue;
      const ax = ov.indexOf(Math.min(...ov));
      const cls = sliverClass(pairs[k][0].d, pairs[k][1].d, ax);
      const depth = sliverMm(cls, op, pairs[k][0].d, pairs[k][1].d, ax);
      // two turned boxes: the bounding boxes are loose, so the real thickness of the overlap comes from the oriented-box test
      const obb = cls === 'rotated' ? obbDepth(pairs[k][0].d, pairs[k][1].d) : null;
      const thin = obb !== null ? obb : Math.min(...ov);
      if (thin < depth && thin > -tols[k]) return { code: 'G3', sentence: SENTENCES.sliver(op, depth), detail: { depth, thin, class: cls, obb: obb !== null } };
    }
    // G3b (round 5): a keep of a BALL that leaves a cap whose base is wider than the other shape, so the ball's face is trimmed by that shape's sides. THE RULE WAS FITTED TO THE DATA; it over-refuses.
    if (op === 'intersect') {
      for (const [k, ov] of ovs.entries()) {
        if (!ov.every((v) => v > tols[k])) continue;
        const [a, b] = pairs[k];
        for (const [sph, oth] of [[a.d, b.d], [b.d, a.d]]) {
          if (sph.kind !== 'sphere' || !sph.prim || oth.kind === 'sphere') continue;
          const R = sph.prim.radius!; const ax = ov.indexOf(Math.min(...ov)); const depth = ov[ax];
          if (!(depth < R)) continue;
          const base = Math.sqrt(Math.max(0, 2 * R * depth - depth * depth));
          const narrow = Math.min(...[0, 1, 2].filter((i) => i !== ax).map((i) => oth.hi[i] - oth.lo[i]));
          if (2 * base > narrow - tols[k]) return { code: 'G3b', sentence: SENTENCES.thinCap(), detail: { depth, base, narrow } };
        }
      }
    }
    const touching = ovs.map((ov, k) => ov.every((v) => v > tols[k]));
    if (op === 'subtract' && !touching.some(Boolean)) return { code: 'G4', sentence: SENTENCES.cutNothing() };
    if (op === 'intersect' && touching.some((t) => !t)) return { code: 'G5', sentence: SENTENCES.keepNothing() };
    if (op === 'subtract') {
      // G7: a round primitive tool that touches a plain box target's SIDE along a line or at a point. Wholly inside the box (inscribed ball / cylinder), or passing THROUGH it along
      // the one axis where it is flat (a vertical cylinder tangent to the four sides). KNOWN HOLE (LAYER-CONTRACT.md, booleans row 126): it only reads a box() target with a primitive tool.
      for (const [a, b] of pairs) {
        if (!isPlainBox(a.d) || !b.d.prim || b.d.kind === 'box' || b.d.round) continue;
        const tol = tolPair(a.d, b.d);
        const ax = ['x', 'y', 'z'];
        const curvedAxes = [0, 1, 2].filter((i) => flatOnAxis(b.d, ax[i]) !== true);
        if (curvedAxes.length === 3 && b.d.kind === 'cylinder') continue; // an oblique cylinder: not a case this rule can read
        // tangent sides: (axis, side) pairs where the tool's bounding face lies on the part's face.
        const tangent = curvedAxes.reduce((n, i) => n + (Math.abs(b.d.lo[i] - a.d.lo[i]) <= tol ? 1 : 0) + (Math.abs(b.d.hi[i] - a.d.hi[i]) <= tol ? 1 : 0), 0);
        const within = [0, 1, 2].every((i) => b.d.lo[i] >= a.d.lo[i] - tol && b.d.hi[i] <= a.d.hi[i] + tol);
        const flatTouches = [0, 1, 2].filter((i) => flatOnAxis(b.d, ax[i]) === true).some((i) => Math.abs(b.d.lo[i] - a.d.lo[i]) <= tol || Math.abs(b.d.hi[i] - a.d.hi[i]) <= tol); // a flat cap lying ON a face opens the void onto that face
        const sealed = within && !flatTouches;
        const hasFlat = [0, 1, 2].some((i) => flatOnAxis(b.d, ax[i]) === true);
        // round 5: THREE tangent sides refuses; round 6: TWO tangent sides refuse too
        const pinch = (hasFlat && tangent >= 2) || (tangent >= 1 && sealed);
        if (pinch) return { code: 'G7', sentence: SENTENCES.pinchCut() };
      }
    }
  }
  if (op === 'union') {
    for (const [a, b] of pairs) {
      const ov = overlapOf(a.d, b.d); const tol = tolPair(a.d, b.d);
      if (ov.some((v) => v < -tol)) continue; // apart: two separate pieces, measured fine
      if (ov.every((v) => v > tol)) continue; // real volume overlap
      const zero = ov.map((v, i) => (Math.abs(v) <= tol ? i : -1)).filter((i) => i >= 0);
      if (zero.length >= 2) return { code: 'G6', sentence: SENTENCES.pinchJoin() }; // bbox touch along an edge or at a vertex
      const ax = ['x', 'y', 'z'][zero[0]];
      const fa = flatOnAxis(a.d, ax); const fb = flatOnAxis(b.d, ax);
      if (fa === false || fb === false) return { code: 'G6', sentence: SENTENCES.pinchJoin() }; // a curved surface meets the other shape along a line or at a point
    }
  }
  return null;
}

/** What the after-the-build check reads of what was built. */
export interface AfterMeasure { volume: number; bbox: number[]; curved: boolean }
/** G4b, after a successful run: a cut that left the target's volume exactly as it was removed nothing (a sliver the kernel ignored, or a near miss the bounding boxes could not rule out) */
export function afterCombine(f: CombineView, m: AfterMeasure | null | undefined, before: { volume: number } | null | undefined, boxes: Array<number[] | undefined> | null | undefined): GuardHit | null { const r = afterCombine0(f, m, before, boxes); if (r) PLAIN.add(r.sentence); return r; }
function afterCombine0(f: CombineView, m: AfterMeasure | null | undefined, before: { volume: number } | null | undefined, boxes: Array<number[] | undefined> | null | undefined): GuardHit | null {
  if (!m) return null;
  if (f.op === 'subtract' && before && Math.abs(m.volume - before.volume) <= 1e-12 * Math.max(before.volume, 1)) return { code: 'G4b', sentence: SENTENCES.cutNothingThin() };
  // G19 (round 6): the result of a keep lies inside EVERY operand's box, of a cut inside the target's box, of a join inside the hull of all. A kernel bounding box that sticks out of that box by more than the bar (curved 3e-4,
  // planar 1e-9, relative to max(|bound|, 1)) is a wrong body: the operand boxes are the independent measure (an axis-aligned box operand is exact). KNOWN HOLE: a curved operand's box is the tessellated one (LAYER-CONTRACT.md).
  if (Array.isArray(boxes) && boxes.every((b) => Array.isArray(b) && b.length === 6) && Array.isArray(m.bbox)) {
    const bs = boxes as number[][];
    const bar = m.curved ? 3e-4 : 1e-9;
    const lo = [0, 1, 2].map((i) => (f.op === 'union' ? Math.min(...bs.map((b) => b[i])) : f.op === 'subtract' ? bs[0][i] : Math.max(...bs.map((b) => b[i]))));
    const hi = [0, 1, 2].map((i) => (f.op === 'union' ? Math.max(...bs.map((b) => b[i + 3])) : f.op === 'subtract' ? bs[0][i + 3] : Math.min(...bs.map((b) => b[i + 3]))));
    const out = [0, 1, 2].some((i) => (lo[i] - m.bbox[i]) / Math.max(Math.abs(lo[i]), 1) > bar || (m.bbox[i + 3] - hi[i]) / Math.max(Math.abs(hi[i]), 1) > bar);
    if (out) return { code: 'G19', sentence: SENTENCES.outsideShapes(f.op) };
  }
  // G21 (round 6): a cut that leaves a curved remainder under TINY_FRAC of the target's volume. THE 3e-2 WAS CHOSEN AFTER SEEING THAT DATA; it also refuses 8 of the 10 that were inside the bar (over-refusal, on purpose).
  if (f.op === 'subtract' && before && m.curved && m.volume > 0 && m.volume < TINY_FRAC * before.volume) return { code: 'G21', sentence: SENTENCES.tinyRemainder() };
  return null;
}

/** operands that a LATER feature still uses: the translator keeps those tools alive (keep_tools) instead of consuming them */
export function reusedTools(f: CombineView, feats: Array<{ id: string; targets?: string[]; target?: string; into?: string }>): string[] {
  const later = feats.slice(feats.findIndex((x) => x.id === f.id) + 1);
  const uses = (id: string): boolean => later.some((g) => (g.targets ?? []).includes(id) || g.target === id || g.into === id);
  return f.targets.slice(1).filter(uses);
}

// ---- G9: one student sentence for every raw message -------------------------------------------------------------------------------
const BAD_WORDS = /solidcraft|truck|kernel|occt|brep|wasm|tessell|op\d+|\bb_[a-z]|\bcommand\b|fallback|body named|ModelDoc|translator|panic|unreachable/i;
export const lintSentence = (s: unknown): string[] => {
  const problems: string[] = [];
  if (typeof s !== 'string' || !s.trim()) return ['empty'];
  if (BAD_WORDS.test(s)) problems.push(`engine/internal word: ${s.match(BAD_WORDS)![0]}`);
  const body = s.trim().replace(/[.]$/, '');
  if (/[.!?]\s+[A-Z]/.test(body)) problems.push('more than one sentence');
  if (!/[.]$/.test(s.trim())) problems.push('no final period');
  if (s.length > 330) problems.push('longer than 330 characters');
  return problems;
};

/** Every sentence this module has made. A raw text that is already one of them passes through plainSentence unchanged. (Module state, as in the original.) */
const PLAIN = new Set<string>();
const mark = (r: GuardHit): GuardHit => { PLAIN.add(r.sentence); return r; };
export const isPlain = (t: string): boolean => PLAIN.has(t);

/** raw: the text the engine or the translator produced; f: the combine feature (or null); returns {code, sentence} */
export function plainSentence(raw: unknown, f: { op?: string } | null | undefined): GuardHit { return mark(plainSentence0(raw, f)); }
function plainSentence0(raw: unknown, f: { op?: string } | null | undefined): GuardHit {
  const op = f?.op ?? 'union';
  const t = String(raw ?? '');
  if (PLAIN.has(t)) return { code: 'PLAIN', sentence: t };
  if (/no body named/.test(t)) return op === 'intersect' ? { code: 'K1', sentence: SENTENCES.keepNothingKernel() } : op === 'subtract' ? { code: 'K2', sentence: SENTENCES.cutEverything() } : { code: 'K3', sentence: SENTENCES.generic(op) };
  if (/cannot be combined with itself/.test(t)) return { code: 'K4', sentence: SENTENCES.sameShape(op) };
  if (/needs two or more targets/.test(t)) return { code: 'K5', sentence: SENTENCES.needTwo() };
  if (/already changed in place/.test(t)) return { code: 'K6', sentence: SENTENCES.consumed() };
  if (/was refused \((.*)\)$/.test(t)) {
    // round 4: the dependency sentence no longer glues the earlier step's reason on after a colon: the page shows that earlier step's own sentence beside it
    return { code: 'K7', sentence: SENTENCES.skipped() };
  }
  if (/unreachable|WASM TRAP|RuntimeError|trap/i.test(t)) return { code: 'K8', sentence: SENTENCES.trap(op) };
  if (/coincident faces/i.test(t)) return { code: 'K9a', sentence: SENTENCES.coincident(op) };
  if (/exact fallback|planar faces only|curved faces|shallow angle|tangent/i.test(t)) return { code: 'K9b', sentence: SENTENCES.shallow(op) };
  if (/implausible result volume|not a manifold|tolerance|degenerate|failed to (intersect|boolean|combine)|could not|cannot/i.test(t)) return { code: 'K9', sentence: SENTENCES.curvedKernel(op) };
  return { code: 'K0', sentence: SENTENCES.generic(op) };
}

/** G12: a feature that is not a combine, refused because its target is several pieces ("needs a single ... body") */
export function plainPieces(raw: unknown): GuardHit | null { return /single (measured target )?body|not a single body/.test(String(raw ?? '')) ? { code: 'G12', sentence: mark({ code: 'G12', sentence: SENTENCES.pieces() }).sentence } : null; }

// ---- interpreter-level sentence: join / cut / keep given the wrong KIND of argument ---------------------------------------------------------------
// runScript says "cut() needs two or more shapes: cut(a, b)." for cut(a) AND for cut(a, 5), the second case with two arguments given. This reads the failing call from the script text and says which
// argument is the problem. Returns a sentence or null (null = keep the interpreter's own message, which is right for fewer than two arguments). HOST-SIDE, like preflightScript: it reads the script, not the ModelDoc.
const SHAPE_CALLS = /^(box|cylinder|sphere|cone|ring|prism|wedge|pull|spin|hole|join|cut|keep|turn|move|copy|mirror|repeat|repeatAround|round|bevel|hollow|draft|groove|pocket|loft|blend)\s*\(/;
function splitArgs(text: string, open: number): string[] | null {
  const args: string[] = []; let depth = 0; let cur = ''; let quote: string | null = null;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) { cur += ch; if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) { if (depth === 0) { args.push(cur.trim()); return args; } depth--; }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return null;
}
/** round 5: the interpreter's own two-sentence refusal for round() / bevel() of a combine handle becomes ONE sentence */
export function explainFront(message: unknown): string | null {
  return /^Rounding works on a shape, not a combination\./.test(String(message ?? '')) ? 'Rounding works on a shape, not on a combination, so round the shapes before you join them.' : null;
}
export function explainCombineArgs(message: unknown, source: unknown, line: number | undefined): string | null {
  const m = /^(join|cut|keep)\(\) needs two or more shapes/.exec(String(message ?? ''));
  if (!m) return null;
  const fn = m[1];
  const lines = String(source ?? '').split('\n');
  const text = lines[(line ?? 1) - 1] ?? '';
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
  let hit: RegExpExecArray | null; let args: string[] | null = null;
  while ((hit = re.exec(text))) { args = splitArgs(text, hit.index + hit[0].length - 1); if (args && args.length >= 2) break; }
  if (!args || args.length < 1) return null;
  const declared = (name: string): string | null => { const d = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([^;]*)`).exec(String(source)); return d ? d[1].trim() : null; };
  // ONE argument that is a list ([a, b], or a name declared as a list): the interpreter's "needs two or more shapes" is true but does not say that a list is not accepted
  if (args.length === 1) {
    const a = args[0];
    const isList = /^\[.*\]$/.test(a) || (/^[A-Za-z_]\w*$/.test(a) && /^\[/.test(declared(a) ?? ''));
    return isList ? `${fn}() takes the shapes one after another, not in a list; write ${fn}(a, b) instead of ${fn}([a, b]).` : null;
  }
  const kindOf = (a: string): string | null => {
    if (/^-?\d+(\.\d+)?$/.test(a)) return 'a number';
    if (/^(['"`]).*\1$/.test(a)) return 'text';
    if (/^\[.*\]$/.test(a)) return 'a list';
    if (/^[A-Za-z_]\w*$/.test(a)) {
      const d = declared(a);
      if (d === null) return 'a name that has not been defined';
      if (/^sketch\s*\(/.test(d)) return 'a sketch, which has no volume';
      if (SHAPE_CALLS.test(d)) return null;
      if (/^-?\d/.test(d)) return 'a number';
      return null;
    }
    if (SHAPE_CALLS.test(a)) return null;
    return null;
  };
  for (let i = 0; i < args.length; i++) {
    const k = kindOf(args[i]);
    if (k) return `${fn}() works on shapes, but argument ${i + 1} is ${k}; give it a solid such as a box(), a cylinder() or the result of pull().`;
  }
  return null;
}
