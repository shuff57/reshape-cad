// Opt-in (ctx.followMoves): carry a resolved FACE name through the moves and quarter turns of the part between the feature the name was
// resolved on and the target it is used on, by applying the SAME rigid transform the translator's commands apply (planFeature 'move' /
// 'rotate') to the named plane. The base resolver (resolve-names.ts) reads a name on the own shape of the feature it names; without this the
// target's plane is looked up where the primitive was BUILT, so a part that was moved or turned afterwards is refused ("no face of b lies on
// that plane any more"). With this, confirmOnTarget (translate.ts) looks for the moved plane on the target's own topology, and still picks
// the point from that topology with the engine's own pick-hit test, still requires exactly one face, and still refuses otherwise.
//
// What is followed: a non-copy `move` (a translation by `offset`), a `rotate` whose angles are all multiples of 90 degrees (the translator
// moves the part's bounding-box centre to the origin, turns about x then y then z, moves it back: p' = R (p - c) + c, R right-handed,
// verified on the kernel), and the features that change a body without placing it (shell, draft, hole, fillet, pocket, groove).
// What is refused, in one sentence, never approximated: a copying move, a rotate by any other angle, and any other feature (join or cut,
// mirror, pattern, extrude...) standing between a moved or turned part and the target. A chain with no move and no turn is returned
// UNCHANGED, so switching the flag on changes nothing for a part that was never placed.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { FaceRes, Resolved } from './resolve-names.js';
import type { V3 } from './types.js';

type Mat = number[][];
type Step = { kind: 'move'; t: V3 } | { kind: 'turn'; R: Mat; c: V3; id: string };

interface FView { id: string; kind: string; target?: string; targets?: string[]; into?: string; offset?: V3; copy?: boolean; angles?: V3 }

const I3: Mat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mul = (A: Mat, B: Mat): Mat => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const app = (R: Mat, v: V3): V3 => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SIN = [0, 1, 0, -1]; const COS = [1, 0, -1, 0];

/** Right-handed rotation about axis 0 (x), 1 (y) or 2 (z) by k quarter turns, exact entries. */
function quarter(axis: 0 | 1 | 2, k: number): Mat {
  const q = ((k % 4) + 4) % 4; const c = COS[q]; const s = SIN[q];
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

/** The rotation of a `rotate` feature: x, then y, then z, each about the global axis (as the translator's three solid.move calls). null if an angle is not a whole quarter turn. */
export function quarterTurns(angles: V3): Mat | null {
  let R = I3;
  for (let i = 0; i < 3; i++) {
    const a = angles[i] ?? 0;
    if (typeof a !== 'number' || !Number.isFinite(a) || Math.abs(a / 90 - Math.round(a / 90)) > 1e-9) return null;
    R = mul(quarter(i as 0 | 1 | 2, Math.round(a / 90)), R);
  }
  return R;
}

export interface FollowEnv {
  /** the features before the one that uses the name */
  features: Feature[];
  /** the bounding box [minx, miny, minz, maxx, maxy, maxz] the translator measured for a feature (what planFeature 'rotate' reads) */
  bboxOf(featureId: string): number[] | undefined;
  targetId: string;
}

const PASS_TARGET = ['shell', 'draft', 'hole', 'fillet'];
const PASS_INTO = ['pocket', 'groove'];

export function followMoves(rr: Resolved, env: FollowEnv): Resolved {
  if (!rr.ok || rr.kind !== 'face' || !rr.plane) return rr;
  const nm = rr.evidence.name;
  const byId = new Map<string, FView>(env.features.map((f) => [f.id, f as unknown as FView]));
  const root = rr.shape.featureId;
  const back: Step[] = [];
  let cur = env.targetId;
  let blocker: FView | null = null;
  for (const seen = new Set<string>(); cur !== root; ) {
    if (seen.has(cur)) { blocker = null; break; }
    seen.add(cur);
    const g = byId.get(cur);
    if (!g) { blocker = null; break; }
    if (g.kind === 'move') {
      if (g.copy) return fail(`${nm} names a face of ${root}, but ${g.id} is a copying move, so which copy the name means is not known; nothing is picked`);
      back.push({ kind: 'move', t: g.offset ?? [0, 0, 0] }); cur = g.target ?? ''; continue;
    }
    if (g.kind === 'rotate') {
      const R = quarterTurns(g.angles ?? [0, 0, 0]);
      if (!R) return fail(`${nm} names a face of ${root}, but ${g.id} turns the part by ${(g.angles ?? []).join(', ')} degrees, and a name is carried only through a turn of whole quarter turns (90, 180 or 270 degrees) about x, y or z; nothing is picked`);
      const bb = env.bboxOf(g.target ?? '');
      if (!bb) return fail(`${nm} names a face of ${root}, but there is no measured bounding box for ${g.target} to turn ${g.id} about; nothing is picked`);
      back.push({ kind: 'turn', R, c: [0, 1, 2].map((i) => (bb[i] + bb[i + 3]) / 2), id: g.id }); cur = g.target ?? ''; continue;
    }
    if (PASS_TARGET.includes(g.kind)) { cur = g.target ?? ''; continue; }
    if (PASS_INTO.includes(g.kind)) { cur = g.into ?? ''; continue; }
    blocker ??= g; // joins, mirrors, patterns and the rest: not followed; keep walking to see whether a move or a turn lies behind it
    cur = (g.kind === 'combine' ? g.targets?.[0] : g.target) ?? g.into ?? '';
  }
  if (!back.length) return rr; // never placed, or a history this does not read: the base behaviour, unchanged
  if (cur !== root || blocker) {
    const why = blocker ? `${blocker.id} is a ${blocker.kind}` : 'the history between them cannot be read';
    return fail(`${nm} names a face of ${root}, but the part was moved or turned and then ${why}; a name is carried through a move or a quarter turn only, so nothing is picked`);
  }
  // apply in build order: the first transform applied is the one nearest the named feature = the last pushed
  let n = rr.plane.n; let d = rr.plane.d; let pt: V3 | null | undefined = rr.point;
  const trail: string[] = [];
  for (const s of back.slice().reverse()) {
    if (s.kind === 'move') {
      d += dot(n, s.t);
      if (pt) pt = pt.map((v, i) => v + s.t[i]);
      trail.push(`move ${s.t.join(',')}`);
    } else {
      const n2 = app(s.R, n);
      d += dot(n2, s.c) - dot(n, s.c); // x' = R (x - c) + c
      if (pt) { const q = app(s.R, pt.map((v, i) => v - s.c[i])); pt = q.map((v, i) => v + s.c[i]); }
      n = n2; trail.push(`turn ${s.id}`);
    }
  }
  const out: FaceRes = { ...rr, plane: { n, d }, point: pt, evidence: { ...rr.evidence, followed: { from: root, to: env.targetId, steps: trail, plane: { n, d } } } };
  return out;
}

const fail = (sentence: string): Resolved => ({ ok: false, sentence });
