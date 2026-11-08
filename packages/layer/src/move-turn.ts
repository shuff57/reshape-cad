// The move-turn group's guards, in every planner set. Source: docs/spikes/solidcraft-referee/contract/move-turn-harness/translate-guard.mjs (the group's
// guarded copy of phase0/translate.mjs, rounds 3 to 5; there is no contract/move-turn.guard.mjs: the guards live in that translator). The original is untouched.
//
// Why (~/.cache/solidcraft-0.30.1-rig/HALT-4-host-route.md, class B): the layer folded seven groups but not this one, so the host route built what the move-turn
// contract rows promise to refuse: 212 wrong solids on 0.30.1 (and on the 0.21.0 pin) among cone move / turn chains and moves after a pocket, for example a cone
// moved and turned eight times built -63.02 mm3 where OCCT and brep-rs give 157.08, and move(a) after pocket(a) moved the CUT part (5748.71) where the doc's move is
// of the uncut original (6000).
//
// What is ported, each with the original's sentence verbatim (feature names as the original gives them: ctx.mt.nameMap(doc) when the host passes it, the id otherwise):
//   1. MT-CUT-HEAD (round 3, "cut-then-move fork"): a move or turn whose target already has a newer cut on it (a pocket, groove or hole advanced its handle) is
//      refused: the doc's move is of the part before the cut, the command list's body is the part after it.        Row: "move() or turn() of a shape that pocket()
//      or groove() already cut ... | refused".
//   2. MT-CONE-CHAIN (round 5): a move or turn of a part that has a conical face and has already been through CONE_CHAIN_MAX = 3 move / turn steps is refused.
//      Row: "move() or turn() of a part with a conical face ... already been moved or turned more than 3 times ... | refused".
//   3. MT-INVARIANT (round 4, the rigid-motion invariant): every built move and turn is checked against the part it started from: volume, surface area, the
//      count of every kind of face but cylinders, and the centre of mass (a move shifts it by the offset; a turn keeps its distance to the pivot). The supported
//      rows say "the translator guard must ship"; on the current kernel a cone is wrong after ONE move (HALT-4: 461.78 -> 151.15 mm3), so the chain limit alone
//      does not cover them.
//   4. MT-PRIMITIVE (round 4, with the invariant): a primitive without a whole-shape round is checked against its closed-form volume.
// Not ported, and why (docs/spikes/solidcraft-referee/GUARD-MOVE-TURN.md): the pick guard (the layer follows a name through moves itself, ctx.followMoves), the
// copy mapping (the layer refuses a copying move), the multi-lump bookkeeping, the 3000 mm magnitude limit (it contradicts the primitives contract's far-placement
// rules and the cases it guards are not wrong on the pin), the time limit (G-BUDGET), the folded half of the invariant's chain repair (see motionRepair below;
// its padded half IS ported, GUARD-OVERREFUSAL.md), and the invariant on a copying move (never built).
//
// Bookkeeping that the original keeps per run is taken from the doc here, so it does not depend on which set's step built a feature: the move / turn count of
// every feature (the original's st.steps: the most of its sources, plus one for a move or turn) and the display names. Both are computed once per translation
// (motionInfo, called by translateDoc). The checks read the set's own state (st.head, st.measure) and the reply of the run that built the part before the move
// (pocket-cut.ts lastRunOf), so a reference measure is the same bodies, measured the same way, as the result.
//
// No kernel is named. Off with ctx.skipMoveTurn (measuring only; the differential tests' originals have none of these checks). The two checks after the build
// (MT-INVARIANT, MT-PRIMITIVE) are also off with ctx.skipSketchVolume, the switch of the other post-build checks, as pocket-cut.ts is: the fake engines of the
// layer's tests report bounding-box volumes, not closed forms, and unified.test.mjs keeps them off unless UNIFIED_SKETCH_VOLUME=on. Never set in production.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { Cmd, RunResult, TranslateCtx } from './types.js';
import type { TranslateState } from './translate.js';
import { lastRunOf } from './pocket-cut.js';

export const MT_CUT_GUARD = 'MT-CUT-HEAD';
export const MT_CONE_GUARD = 'MT-CONE-CHAIN';
export const MT_INVARIANT_GUARD = 'MT-INVARIANT';
export const MT_PRIMITIVE_GUARD = 'MT-PRIMITIVE';
/** the original's CONE_CHAIN_MAX (MT_CONE_CHAIN_MAX overrode it for the group's negative controls only) */
export const CONE_CHAIN_MAX = 3;
/** the original's INV_TOL: [planar, curved], relative (com: of the bounding-box diagonal) */
export const INV_TOL = { vol: [1e-8, 3e-4], com: [1e-7, 3e-4] } as const;

/** What translateDoc keeps for these guards: the original's st.steps (the move / turn steps a feature has been through) and st.names. */
export interface MotionInfo { steps: Record<string, number>; names: Record<string, string> }

interface FView { id: string; kind: string; target?: string; into?: string; targets?: string[]; offset?: number[]; angles?: number[]; copy?: boolean; round?: number; size?: number[]; radius?: number; height?: number; ringRadius?: number; tubeRadius?: number; sides?: number; width?: number; depth?: number }
const FV = (f: Feature): FView => f as unknown as FView;
const isStep = (k: string) => k === 'move' || k === 'rotate';

/** Steps and names for one document. The names are the original's: ctx.mt.nameMap(doc) when there is one, else none (the id is used). */
export function motionInfo(doc: { features: Feature[] }, ctx: Pick<TranslateCtx, 'mt'>): MotionInfo {
  const steps: Record<string, number> = {};
  for (const f of doc.features) {
    const v = FV(f);
    const srcs = [v.target, v.into, ...(v.targets ?? [])].filter(Boolean) as string[];
    const prior = Math.max(0, ...srcs.map((t) => steps[t] ?? 0));
    steps[f.id] = prior + (isStep(f.kind) ? 1 : 0);
  }
  let names: Record<string, string> = {};
  try { const nm = ctx.mt?.nameMap; if (nm) names = nm(doc as never) ?? {}; } catch { names = {}; }
  return { steps, names };
}
const nameOf = (st: TranslateState, id: string) => st.motion?.names[id] ?? id;

/** MT-CUT-HEAD: the original's cutGuard, for a move or turn whose dependency check passed. `headOf` is the planner's. */
export function cutHeadRefusal(f: Feature, st: TranslateState, ctx: Pick<TranslateCtx, 'skipMoveTurn'>, headOf: (id: string) => string): string | null {
  if (ctx.skipMoveTurn || !st.motion || !isStep(f.kind)) return null;
  const id = FV(f).target!;
  const h = headOf(id);
  if (h === id) return null;
  const N = (x: string) => nameOf(st, x);
  return `${N(f.id)} is not built: it ${f.kind === 'rotate' ? 'turns' : 'moves'} ${N(id)}, but ${N(h)} had already cut into ${N(id)}, and this build cannot tell whether you mean the part before or after the cut -- ${f.kind === 'rotate' ? 'turn' : 'move'} ${N(id)} before the cut, or ${f.kind === 'rotate' ? 'turn' : 'move'} the result of ${N(h)} instead.`;
}

/** MT-CONE-CHAIN: the original's cone chain limit, for a move or turn whose plan was made. The target's measure says whether it has a conical face. */
export function coneChainRefusal(f: Feature, st: TranslateState, ctx: Pick<TranslateCtx, 'skipMoveTurn'>): string | null {
  if (ctx.skipMoveTurn || !st.motion || !isStep(f.kind)) return null;
  const v = FV(f);
  const prior = Math.max(0, ...([v.target, v.into, ...(v.targets ?? [])].filter(Boolean) as string[]).map((t) => st.motion!.steps[t] ?? 0));
  const coneTarget = (st.measure[v.target!]?.faceTypes?.cone ?? 0) > 0;
  if (!coneTarget || prior + 1 <= CONE_CHAIN_MAX) return null;
  return `${nameOf(st, f.id)} is not built: ${nameOf(st, v.target!)} has a cone-shaped face and has already been moved or turned ${prior} times, and a cone moved or turned more than ${CONE_CHAIN_MAX} times in a row cannot be placed accurately, so it is shown without it -- build the part where you want it, or use fewer moves and turns.`;
}

// ---- the round 4 checks after the build -----------------------------------------------------------------------------------------------------------------------
interface MMeasure { volume: number; area: number | null; faceTypes: Record<string, number>; com: number[]; bbox: number[]; curved: boolean }
/** the original's aggregate, the fields the checks read (area is null when the reply carries none) */
function measureOf(res: RunResult | undefined, names: string[]): MMeasure | null {
  const bs = res?.measure?.bodies?.filter((b) => names.includes(b.name)) ?? [];
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  const vol = bs.reduce((s, b) => s + b.volume_mm3, 0);
  const areas = bs.map((b) => (b as { area_mm2?: number }).area_mm2);
  return {
    volume: vol,
    area: areas.every((a) => typeof a === 'number' && Number.isFinite(a)) ? (areas as number[]).reduce((s, a) => s + a, 0) : null,
    faceTypes: bs.reduce((a: Record<string, number>, b) => { for (const [k, n] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + n; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * (b.center_of_mass?.[i] ?? NaN), 0) / vol),
    bbox: [...lo, ...hi],
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
  };
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toPrecision(2));
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const diagOf = (bb: number[]) => Math.max(Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]), 1);
const dist3 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The original's invariantProblem: null, or its sentence. `x` is the result, `r` the part it started from (the copy branch is not ported: a copying move is never built). */
export function invariantSentence(f: Feature, st: TranslateState, x: MMeasure, r: MMeasure): string | null {
  const v = FV(f);
  const nm = nameOf(st, f.id); const tn = nameOf(st, v.target!);
  const k = x.curved || r.curved ? 1 : 0;
  const move = f.kind === 'move';
  const bad = (what: string, got: string, want: string, unit: string) => `${nm} is not built: ${move ? 'moving' : 'turning'} ${tn} would change its ${what} (${got}${unit} instead of ${want}${unit}), which a ${move ? 'move' : 'turn'} must never do, so it is shown without it -- try fewer separate ${move ? 'moves' : 'turns'}, or build the part where you want it.`;
  if (rel(x.volume, r.volume) > INV_TOL.vol[k]) return bad('volume', fmt(x.volume), fmt(r.volume), ' mm3');
  if (x.area !== null && r.area !== null && rel(x.area, r.area) > INV_TOL.vol[k]) return bad('surface area', fmt(x.area), fmt(r.area), ' mm2');
  // surfaces: a rigid motion keeps every planar / conical / spherical / toroidal face and never creates a surface of unknown kind (cylinders may re-split at the seam)
  for (const t of new Set([...Object.keys(r.faceTypes), ...Object.keys(x.faceTypes)])) {
    if (t === 'cylinder') continue;
    const a = r.faceTypes[t] ?? 0; const b = x.faceTypes[t] ?? 0;
    if (a !== b) return `${nm} is not built: ${move ? 'moving' : 'turning'} ${tn} would change its faces (${b} ${t === 'other' ? 'of unknown kind' : t} ${b === 1 ? 'face' : 'faces'} instead of ${a}), which a ${move ? 'move' : 'turn'} must never do, so it is shown without it -- try fewer separate ${move ? 'moves' : 'turns'}, or build the part where you want it.`;
  }
  if (!x.com.every(Number.isFinite) || !r.com.every(Number.isFinite)) return null; // a reply with no centre of mass: the original has no such reply, nothing to compare
  const dg = diagOf(r.bbox);
  if (move) {
    const want = r.com.map((c, i) => c + (v.offset?.[i] ?? 0));
    if (dist3(x.com, want) / dg > INV_TOL.com[k]) return bad('centre of mass', `[${x.com.map(fmt)}]`, `[${want.map(fmt)}]`, '');
  } else {
    const c = [0, 1, 2].map((i) => (r.bbox[i] + r.bbox[i + 3]) / 2);
    const dr = dist3(r.com, c); const dx = dist3(x.com, c);
    if (Math.abs(dr - dx) / dg > INV_TOL.com[k]) return bad('centre of mass', `${fmt(dx)} from the pivot`, `${fmt(dr)} from the pivot`, ' mm');
  }
  return null;
}

/** The original's primitiveVolume: closed-form volume of a primitive, null when it has a whole-shape round (no closed form there). */
export function primitiveVolume(f: Feature): number | null {
  const v = FV(f);
  if (v.round) return null;
  const P = Math.PI;
  switch (f.kind) {
    case 'box': return v.size![0] * v.size![1] * v.size![2];
    case 'cylinder': return P * v.radius! ** 2 * v.height!;
    case 'cone': return P * v.radius! ** 2 * v.height! / 3;
    case 'sphere': return 4 / 3 * P * v.radius! ** 3;
    case 'torus': return 2 * P * P * v.ringRadius! * v.tubeRadius! ** 2;
    case 'prism': { const n = Math.max(3, Math.min(12, Math.round(v.sides!))); return 0.5 * n * v.radius! ** 2 * Math.sin(2 * P / n) * v.height!; }
    case 'wedge': return 0.5 * v.width! * v.depth! * v.height!;
    default: return null;
  }
}
/** The original's primitiveProblem: null, or its sentence. */
export function primitiveSentence(f: Feature, st: TranslateState, m: MMeasure): string | null {
  const want = primitiveVolume(f);
  if (!want) return null;
  const curved = ['cylinder', 'cone', 'sphere', 'torus'].includes(f.kind);
  if (rel(m.volume, want) <= INV_TOL.vol[curved ? 1 : 0]) return null;
  return `${nameOf(st, f.id)} is not built: the engine built it with the wrong size (volume ${fmt(m.volume)} mm3 instead of ${fmt(want)} mm3), so it is shown without it -- try it with fewer turns and moves, or build it at the origin and move it once.`;
}

const PRIMITIVE_KINDS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge'];

/**
 * The round 4 checks, as a step calls them after a feature's engine run succeeded, before it is accepted (next to the sketch-volume check). `res` is that run's reply,
 * `produces` the bodies the feature leaves, `accepted` the commands accepted before it. null = accepted; otherwise the original's sentence and the guard code.
 * A move / turn whose part before it cannot be measured (no reply of the run before, no measure of the target with these same bodies) is not checked.
 */
export function motionRefusal(f: Feature, st: TranslateState, ctx: Pick<TranslateCtx, 'skipMoveTurn' | 'skipSketchVolume'>, res: RunResult, produces: string[], accepted: Cmd[]): { sentence: string; guard: string } | null {
  if (ctx.skipMoveTurn || ctx.skipSketchVolume || !st.motion || !res.measure) return null;
  if (PRIMITIVE_KINDS.includes(f.kind)) {
    const m = measureOf(res, produces);
    const s = m ? primitiveSentence(f, st, m) : null;
    return s ? { sentence: s, guard: MT_PRIMITIVE_GUARD } : null;
  }
  if (!isStep(f.kind) || FV(f).copy) return null;
  const x = measureOf(res, produces);
  if (!x) return null;
  let r = measureOf(lastRunOf(accepted), produces);
  if (!r) { // no record of the run before: the target's own measure, when it is of these same bodies (it has no surface area)
    const t = st.measure[FV(f).target!];
    if (!t || t.bodies.length !== produces.length || !t.bodies.every((b) => produces.includes(b))) return null;
    r = { volume: t.volume, area: null, faceTypes: t.faceTypes ?? {}, com: t.com, bbox: t.bbox, curved: t.curved };
  }
  const s = invariantSentence(f, st, x, r);
  return s ? { sentence: s, guard: MT_INVARIANT_GUARD } : null;
}

// ---- the round 4 chain repair, its padding half --------------------------------------------------------------------------------------------------------------
// The original (translate-guard.mjs, "(round 4) repair") answers a failed invariant by re-running the part with other command lists, each re-checked by the SAME
// invariant, and builds the first one that passes; the invariant's sentence stands when none does. Its reason, measured by the group: the engine's fault depends
// on how many moves a body has been through (a revolve-built cone is wrong at 6, 8, 15, 17 ... moves and right at every other count), so one or two moves by
// [0, 0, 0] after the move or turn bring the count back to a right one. The move-turn rows' "the translator guard must ship" is that translator, repair included.
// Ported: the padded candidates, in the original's order (padded1, padded2): the feature's own commands, then n no-op translations of each body it leaves, as one
// variant, so the commands already accepted for earlier features are never rewritten. Not ported: the folded candidates (simplifyChain), because a fold rewrites
// commands that earlier features own, and this layer keeps each feature's prefix of the accepted list (st.accLen, lastRunOf, resolveAfter) fixed once accepted.
// Only an MT-INVARIANT refusal is repaired (the original repairs MT-PRIMITIVE too; no primitive was over-refused by it, so it stays a refusal as before).
// Off with ctx.skipMoveTurnRepair (measuring only: the before/after runs of GUARD-OVERREFUSAL.md); never set in production.
/** the original's padList(base, n) without base: n no-op translations of every body in `names` */
export function padCommands(names: string[], n: number): Cmd[] {
  return Array.from({ length: n }, () => names.map((nm): Cmd => ({ command: 'solid.move', params: { bodies: [nm], translate: [0, 0, 0] } }))).flat();
}
/**
 * A step calls this when motionRefusal refused a variant. `first` is that refusal. Returns the repaired variant (the feature's commands plus the padding) and the reply
 * of the run that built it, when that run passes motionRefusal against the same part before; null when there is no repair (the step refuses with `first`).
 */
export async function motionRepair(
  f: Feature, st: TranslateState, ctx: Pick<TranslateCtx, 'skipMoveTurn' | 'skipSketchVolume' | 'skipMoveTurnRepair'>, first: { guard: string },
  produces: string[], accepted: Cmd[], variant: Cmd[], run: (cmds: Cmd[]) => RunResult | Promise<RunResult>,
): Promise<{ variant: Cmd[]; res: RunResult; pads: number } | null> {
  if (ctx.skipMoveTurnRepair || first.guard !== MT_INVARIANT_GUARD || !isStep(f.kind) || FV(f).copy || !produces.length) return null;
  for (const n of [1, 2]) {
    const v2 = [...variant, ...padCommands(produces, n)];
    let res: RunResult;
    try { res = await run([...accepted, ...v2]); } catch { continue; }
    if (!res?.ok || !res.measure) continue;
    if (!measureOf(res, produces)) continue;
    if (motionRefusal(f, st, ctx, res, produces, accepted) === null) return { variant: v2, res, pads: n };
  }
  return null;
}
