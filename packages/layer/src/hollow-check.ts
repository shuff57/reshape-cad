// The hollow of a part with rounded or bevelled edges, checked after the build against a closed form, in every planner set.
//
// Why (docs/spikes/solidcraft-referee/GUARD-FAMILY-C-HOLLOW.md): shell family C. A box whose bottom edges are rounded with R = 1.5t, hollowed with a wall of t, open at
// the top. The filleted part is built right, the hollow of it is not on every kernel: the host route (unified) on one kernel built all eight family-C hollows of
// family-c-run.mjs 1.1e-3 to 5.7e-3 off OCCT and the fuzz oracle P, with the right commands and no refusal. The pre-flight shell guards do not see it (nothing in the
// part is concave). A version test would name a kernel, so the layer checks the result instead: the built hollow against its closed form.
//
// The closed form (no kernel involved). The part is a box (its own frame, any turn of it, any move after it) with straight edges rounded or bevelled between two of its
// own faces, and through holes along the open axis. The hollow is the part minus the cavity, the cavity is the part's inward offset by the wall, open at the open face:
//   * the outer part: the box, less (1 - pi/4) R^2 L per rounded edge and d^2/2 L per bevelled one, plus back the overlap at a corner where two such edges of the same
//     kind and size meet (R^3 (5/3 - pi/2) for two rounds, d^3/3 for two bevels), less pi r^2 per hole times the box along its axis;
//   * the cavity: the box shrunk by t on every face but the open one. An edge between two closed faces is rounded R - t (sharp when R <= t), bevelled d - (2 - sqrt 2) t
//     (sharp at or under zero); an edge of the open face (the rim) leaves the cavity sharp when rounded with R <= t and bevels it d + (sqrt 2 - 1) t (the offset of the
//     bevel face; GUARD-FAMILY-C-HOLLOW.md derives it). Each hole takes pi (r + t)^2 times the cavity along its axis.
// A part the formula does not describe (another root, a combine, a pocket, a draft, a blind or counterbored hole, a hole across the open axis or reaching a blend, three
// blends at a corner, two different blends at a corner, a blend as wide as its face, a whole-shape round, a name carried through another step) is not covered.
//
// What is refused, with the shell group's existing sentence for a hollow the build could not make (shell-draft.ts SENTENCE.openAxisEngine, verbatim; no new wording):
//   * a covered hollow whose built volume is off the closed form by more than HOLLOW_TOL (or whose part before the hollow is off its own closed form: then the part is not
//     the one the formula describes);
//   * a hollow that is NOT covered and has a ROUNDED edge in its history (family C itself: no independent measure, so it is not shown unchecked).
// A hollow of a part with no rounded or bevelled edge is not this check's (the shell group's own guards cover it). A covered hollow of a part with bevels only is
// checked; an uncovered one is left as before (it is not family C). The bar: the right hollows measured 1.9e-5 off OCCT at
// most (the faceted rounds read slightly low), the wrong ones 1.1e-3 at least; HOLLOW_TOL sits between them.
//
// No kernel is named. Off with ctx.skipHollowCheck (measuring only) and with ctx.skipSketchVolume, the switch of the other checks after the build (the fake engines of
// the layer's tests report bounding-box volumes). Never set in production.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { Cmd, RunResult, TranslateCtx } from './types.js';
import type { TranslateState } from './translate.js';
import { lastRunOf } from './pocket-cut.js';

export const HOLLOW_CHECK_GUARD = 'HOLLOW-ROUND';
/** relative to the hollow's own volume: curved (a round or a hole) and planar (bevels only, no hole) */
export const HOLLOW_TOL = { curved: 1.5e-4, planar: 1e-7 } as const;

interface Name { cause?: string; feature?: string; kind?: string; part?: string; of?: Name[] }
interface FView {
  id: string; kind: string; target?: string; size?: number[] | number; center?: number[]; rotate?: number[]; round?: number; roundStyle?: string;
  edge?: Name; style?: string; open?: Name; thickness?: number; copy?: boolean; diameter?: number; depth?: number; axis?: string;
  corners?: { dx: number; dy: number }; counterbore?: unknown; countersink?: unknown; offset?: number[]
}
const FV = (f: Feature): FView => f as unknown as FView;
const PARTS = ['+x', '-x', '+y', '-y', '+z', '-z'];
const AX: Record<string, number> = { x: 0, y: 1, z: 2 };
const axOf = (p: string) => AX[p[1]];
const sgnOf = (p: string) => (p[0] === '+' ? 1 : -1);
const PI = Math.PI;
const ROUND_CORNER = 5 / 3 - PI / 2;

/** One blended edge of the box: the two faces, its kind and size. */
interface Blend { a: string; b: string; style: 'fillet' | 'chamfer'; size: number }
/** What the closed form covers: the box, its blends, its holes (box frame), the open face and the wall. */
export interface HollowModel { size: number[]; blends: Blend[]; holes: Array<{ axis: number; c: number[]; r: number }>; open: string; t: number; rounds: boolean }
export type Covered = { ok: true; model: HollowModel } | { ok: false; why: string; rounds: boolean };

/**
 * Read a shell's history as the closed form needs it. `byId` holds the document's features. Every step from the shell's target back to its root must be a blend of
 * an edge between two faces of the root box, a move (not a copy), a turn, or a through hole; the open face must be a face of that box.
 */
export function hollowModel(f: Feature, byId: Record<string, Feature>): Covered {
  const s = FV(f);
  let rounds = false;
  const chain: FView[] = [];
  const seen = new Set<string>();
  let cur = s.target;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const g = byId[cur]; if (!g) return { ok: false, why: `an unknown feature ${cur}`, rounds };
    const v = FV(g);
    chain.push(v);
    if (v.kind === 'box') break;
    cur = v.target;
  }
  const root = chain.at(-1);
  // a round anywhere in the history makes it family C, covered or not
  for (const v of chain) if ((v.kind === 'fillet' && v.style !== 'chamfer') || (v.round && v.roundStyle !== 'chamfer')) rounds = true;
  const no = (why: string): Covered => ({ ok: false, why, rounds });
  if (!root || root.kind !== 'box') return no('the part is not a box');
  if (root.round) return no('a whole-shape round');
  const size = root.size as number[];
  if (!Array.isArray(size) || size.length !== 3 || !size.every((v) => v > 0)) return no('a box with no size');
  if (!s.open || s.open.feature !== root.id || !PARTS.includes(s.open.part ?? '')) return no('the open face is not a face of the box');
  const t = s.thickness;
  if (!(typeof t === 'number' && t > 0)) return no('no wall');
  const blends: Blend[] = []; const holes: HollowModel['holes'] = [];
  let turned = false;
  for (const v of chain.slice(0, -1).reverse()) { // root first
    if (v.kind === 'move') { if (v.copy) return no('a copy'); continue; }
    if (v.kind === 'rotate') { turned = true; continue; }
    if (v.kind === 'fillet') {
      const e = v.edge;
      const sz = typeof v.size === 'number' ? v.size : NaN;
      if (!(sz > 0)) return no('a blend with no size');
      if (!e || e.cause !== 'between' || e.of?.length !== 2 || !e.of.every((n) => n.cause === 'primitive' && n.feature === root.id && PARTS.includes(n.part ?? ''))) return no('a blend not named by two faces of the box');
      const [a, b] = [e.of[0].part!, e.of[1].part!].sort();
      if (axOf(a) === axOf(b)) return no('a blend between opposite faces');
      if (blends.some((x) => x.a === a && x.b === b)) return no('the same edge blended twice');
      blends.push({ a, b, style: v.style === 'chamfer' ? 'chamfer' : 'fillet', size: sz });
      continue;
    }
    if (v.kind === 'hole') {
      if (turned || !isZero(root.rotate)) return no('a hole in a turned box');
      if (v.counterbore || v.countersink) return no('a counterbored or countersunk hole');
      const ax = AX[v.axis ?? 'z'];
      const c = v.center ?? [0, 0, 0];
      if (!(typeof v.diameter === 'number' && v.diameter > 0 && typeof v.depth === 'number')) return no('a hole with no size');
      if (v.depth / 2 - Math.abs(c[ax]) < size[ax] / 2 - 1e-9) return no('a blind hole');
      const cs = v.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [c[0] + sx * v.corners!.dx, c[1] + sy * v.corners!.dy, c[2]]) : [c];
      for (const cc of cs) holes.push({ axis: ax, c: cc, r: v.diameter / 2 });
      continue;
    }
    return no(`a ${v.kind}`);
  }
  return { ok: true, model: { size, blends, holes, open: s.open.part!, t, rounds } };
}
const isZero = (r: number[] | undefined) => !r || r.every((x) => !x);

// ---- the closed form ------------------------------------------------------------------------------------------------------------------------------------------
/** A box (its extents) with blended edges: the inner or the outer solid. `blends` sizes > 0 only. */
interface Solid { ext: number[]; blends: Blend[] }
/** The eight corners of a box as their three faces. */
const CORNERS = [1, -1].flatMap((x) => [1, -1].flatMap((y) => [1, -1].map((z) => [`${x > 0 ? '+' : '-'}x`, `${y > 0 ? '+' : '-'}y`, `${z > 0 ? '+' : '-'}z`])));
const free = (b: Blend) => [0, 1, 2].find((k) => k !== axOf(b.a) && k !== axOf(b.b))!;
/** Volume of a box with blended edges, or a reason it is not covered. */
function blendedVolume(s: Solid): number | string {
  let v = s.ext[0] * s.ext[1] * s.ext[2];
  for (const b of s.blends) {
    // the blend must fit on both its faces, and two blends on one face must not reach each other
    for (const p of [b.a, b.b]) {
      const other = p === b.a ? b.b : b.a;
      if (b.size >= s.ext[axOf(other)] - 1e-9) return 'a blend as wide as its face';
      const opp = s.blends.find((x) => x !== b && (x.a === p || x.b === p) && axOf(x.a === p ? x.b : x.a) === axOf(other));
      if (opp && b.size + opp.size >= s.ext[axOf(other)] - 1e-9) return 'two blends that reach each other across a face';
    }
    v -= (b.style === 'fillet' ? 1 - PI / 4 : 0.5) * b.size ** 2 * s.ext[free(b)];
  }
  for (const c of CORNERS) {
    const at = s.blends.filter((b) => c.includes(b.a) && c.includes(b.b));
    if (at.length < 2) continue;
    if (at.length > 2) return 'three blends at a corner';
    const [p, q] = at;
    if (p.style !== q.style || Math.abs(p.size - q.size) > 1e-9 * Math.max(1, p.size)) return 'two different blends at a corner';
    v += (p.style === 'fillet' ? ROUND_CORNER : 1 / 3) * p.size ** 3;
  }
  return v;
}

/** The closed-form volume of the part before the hollow and of the hollow, or a reason the model is not covered. */
export function hollowClosedForm(m: HollowModel): { part: number; hollow: number } | { why: string } {
  const { size, t, open } = m;
  const oa = axOf(open); const os = sgnOf(open);
  const outer = blendedVolume({ ext: size, blends: m.blends });
  if (typeof outer === 'string') return { why: outer };
  // the cavity: shrunk by t on every closed face; its centre moves away from the open face by t / 2 along the open axis
  const iext = size.map((e, k) => e - (k === oa ? t : 2 * t));
  if (!iext.every((e) => e > 1e-9)) return { why: 'a wall as thick as the part' };
  const iblends: Blend[] = [];
  for (const b of m.blends) {
    const rim = b.a === open || b.b === open;
    let d: number;
    if (rim) {
      if (b.style === 'fillet') { if (b.size > t + 1e-9) return { why: 'a rim rounded more than the wall' }; continue; }
      d = b.size + (Math.SQRT2 - 1) * t;
    } else d = b.style === 'fillet' ? b.size - t : b.size - (2 - Math.SQRT2) * t;
    if (d > 1e-9) iblends.push({ ...b, size: d });
  }
  const cav = blendedVolume({ ext: iext, blends: iblends });
  if (typeof cav === 'string') return { why: `the cavity has ${cav}` };
  let part = outer; let hollow = outer - cav;
  // through holes along the open axis: the bore leaves the part, its tube of r + t leaves the cavity; both must stay clear of every blend and of each other
  const clear = (c: number[], r: number, ext: number[], bl: Blend[], centre: number[]) => [0, 1, 2].filter((k) => k !== oa).every((k) => [1, -1].every((sg) => {
    const side = `${sg > 0 ? '+' : '-'}${'xyz'[k]}`;
    const reach = Math.max(0, ...bl.filter((b) => b.a === side || b.b === side).map((b) => b.size));
    return sg * (c[k] - centre[k]) + r <= ext[k] / 2 - reach + 1e-9;
  }));
  const ic = [0, 0, 0]; ic[oa] = os * t / 2;
  for (let i = 0; i < m.holes.length; i++) {
    const h = m.holes[i];
    if (h.axis !== oa) return { why: 'a hole across the open axis' };
    if (!clear(h.c, h.r, size, m.blends, [0, 0, 0])) return { why: 'a hole that reaches a blend or a side' };
    if (!clear(h.c, h.r + t, iext, iblends, ic)) return { why: "a hole whose wall reaches a blend or a side of the cavity" };
    for (let j = 0; j < i; j++) {
      const g = m.holes[j];
      if (Math.hypot(...[0, 1, 2].filter((k) => k !== oa).map((k) => h.c[k] - g.c[k])) < h.r + g.r + 2 * t - 1e-9) return { why: 'two holes whose walls meet' };
    }
    part -= PI * h.r ** 2 * size[oa];
    hollow -= PI * h.r ** 2 * size[oa] - PI * (h.r + t) ** 2 * iext[oa];
  }
  return { part, hollow };
}

const volOf = (res: RunResult | undefined, names: string[]): number | null => {
  const bs = res?.measure?.bodies?.filter((b) => names.includes(b.name)) ?? [];
  return bs.length === names.length && bs.length ? bs.reduce((s, b) => s + b.volume_mm3, 0) : null;
};

/**
 * The check, as a step calls it after a shell's engine run succeeded and the set's own checks passed, before the shell is accepted (next to the move-turn checks).
 * `res` is that run's reply, `produces` the bodies the shell leaves, `accepted` the commands accepted before it, `sentence` the set's refusal for a hollow the build could
 * not make (shell-draft.ts openAxisEngine). null = accepted; otherwise the sentence and the guard code, with the numbers in `detail`.
 */
export function hollowRefusal(f: Feature, features: Feature[], st: TranslateState, ctx: Pick<TranslateCtx, 'skipHollowCheck' | 'skipSketchVolume'>, res: RunResult, produces: string[], accepted: Cmd[]):
  { sentence: string; guard: string; detail: Record<string, unknown> } | null {
  if (f.kind !== 'shell' || ctx.skipHollowCheck || ctx.skipSketchVolume || !res.measure || !FV(f).open) return null;
  const byId: Record<string, Feature> = {}; for (const g of features) byId[g.id] = g;
  const cov = hollowModel(f, byId);
  const refuse = (detail: Record<string, unknown>) => ({ sentence: openSentence(f), guard: HOLLOW_CHECK_GUARD, detail });
  if (!cov.ok) return cov.rounds ? refuse({ uncovered: cov.why }) : null;
  if (!cov.model.blends.length) return null; // no rounded or bevelled edge: not this check's part (the shell group's own guards and checks cover it)
  const cf = hollowClosedForm(cov.model);
  if ('why' in cf) return cov.model.rounds ? refuse({ uncovered: cf.why }) : null;
  const after = volOf(res, produces);
  if (after === null) return cov.model.rounds ? refuse({ uncovered: 'the hollow was not measured' }) : null;
  const curved = cov.model.rounds || cov.model.holes.length > 0; // a hole's bore is curved too: its faceted volume reads about 1e-6 off
  const tol = curved ? HOLLOW_TOL.curved : HOLLOW_TOL.planar;
  const before = volOf(lastRunOf(accepted), produces) ?? (() => { const m = st.measure[FV(f).target!]; return m && m.bodies.length === produces.length && m.bodies.every((b) => produces.includes(b)) ? m.volume : null; })();
  if (before !== null && Math.abs(before - cf.part) > tol * cf.part) return refuse({ part: before, partClosed: cf.part, hollow: after, closed: cf.hollow });
  if (Math.abs(after - cf.hollow) > tol * cf.hollow) return refuse({ part: before, partClosed: cf.part, hollow: after, closed: cf.hollow });
  return null;
}

/**
 * The shell group's sentence for a hollow the build could not make with this wall and open side. It is shell-draft.ts SENTENCE.openAxisEngine, moved here unchanged so
 * both read one text (shell-draft.ts imports it; importing shell-draft.ts from here would close an import cycle through translate.ts).
 */
export const openAxisEngineSentence = (f: { id: string; target?: string }): string => `${f.id} (hollow): ${f.target} could not be hollowed with this wall and open side, so ${f.id} is shown without it -- try another wall or another open side.`;
const openSentence = (f: Feature) => openAxisEngineSentence(FV(f));
