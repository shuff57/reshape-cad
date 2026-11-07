// Named fillets on one connected edge chain go to the engine as ONE call, in every planner set (GUARD-FILLET-CHAIN.md, fix 1).
//
// Why: sent one edge per call, a kernel may round more than the named edge. On the SolidCore probe (SOLIDCORE-PROBE-0.40.0-rc.2.md) the four bottom fillets of a box,
// one call each, came out with 18 faces instead of 10: the third call also rounded the vertical edges its edge runs tangent into through the first two rounds. One call
// over the four edges is right there. The fillet-chamfer set already sends such a run as one call per connected component (fillet-chamfer.ts translateGroup); this
// module gives the same grouping to the other sets (base, extrude-pocket, holes, shell-draft, patterns-mirror, booleans, revolve-groove), which sent one call per feature.
//
//   * THE RUN: consecutive fillets with the same style and size, each on the previous one's result, each naming its edge (fillet-chamfer.ts's rule, `runAt`).
//   * THE GROUP: at the run's first fillet every member's edge is resolved on the part BEFORE the run (each set's own way: the engine's topology, or the shell-draft
//     set's primitive-frame pick), then split into connected components (edges that share an end point). The first member of a component sends one call with every
//     edge of the component; the other members are built by that call (planFeature plans them as an empty command list on the lead's body, so every set's own step
//     measures, checks and notes them as usual). When a member cannot be resolved, the same edge is named twice, or a component is one edge, nothing changes: that
//     member is planned exactly as before.
//   * THE POST-BUILD CHECK (`blendRefusal`): a blend of ONE straight edge between two planar faces must add exactly one face, the fillet-chamfer set's net (fc-guard.ts
//     postCheck), with its sentence. It catches a kernel that rounds more than the named edge wherever a set still sends one edge (a lone edge, different sizes, a
//     run broken by another feature).
// Never in the fillet-chamfer and unified sets (st.fc is theirs: their step groups and checks blends itself). `ctx.skipFilletChain` switches both off, for the
// differential tests only, whose originals send one call per feature and whose fake engines do not count faces. No kernel is named.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { TranslateCtx, V3 } from './types.js';
import type { Aggregate, TranslateState } from './translate.js';
import { guardSentence } from './fc-sentences.js';

/** What a member of a grouped run knows: the lead (the member that sends the component's call), and, on the lead, every edge's point in member order. */
export interface ChainInfo { lead: string; ids: string[]; points?: V3[] }
/** One resolved member edge: the point the call sends, and the end points of the edge on the part as it is now (connectivity). */
export interface ChainEdge { point: V3; ends: [V3, V3] }
/** What a blend plan says about what it sends (read by blendRefusal): the number of edges and whether the one edge is straight between two planar faces. */
export interface BlendInfo { edges: number; straightPlanar: boolean }

/** The fields of a fillet this module reads. */
interface FView { id: string; kind: string; target?: string; edge?: unknown; style?: string; size?: number }
const FV = (f: Feature): FView => f as unknown as FView;

/** The sets whose step groups and checks blends itself (fillet-chamfer, unified) keep st.fc; nowhere else is a run grouped here. */
export const chainsOn = (st: TranslateState, ctx: TranslateCtx): boolean => !st.fc && !ctx.skipFilletChain;

/** The run that starts at features[idx]: the fillet itself and the consecutive same-style, same-size fillets each on the previous one (fillet-chamfer.ts's rule). */
export function runAt(features: Feature[], idx: number): Feature[] {
  const f = features[idx]; const fv = FV(f);
  if (!f || f.kind !== 'fillet' || !fv.edge || typeof fv.edge !== 'object') return f ? [f] : [];
  const run: Feature[] = [f];
  for (let j = idx + 1; j < features.length; j++) {
    const g = features[j]; const gv = FV(g);
    if (g.kind !== 'fillet' || gv.style !== fv.style || gv.size !== fv.size || gv.target !== FV(run[run.length - 1]).id || !gv.edge || typeof gv.edge !== 'object') break;
    run.push(g);
  }
  return run;
}

/** Connected components of the member edges (union-find over shared end points, as translateGroup does), each in member order, in order of their first member. */
export function components(edges: ChainEdge[], tol: number): number[][] {
  const parent = edges.map((_, i) => i); const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (p: V3, q: V3): boolean => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tol;
  for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) if (edges[a].ends.some((p) => edges[b].ends.some((q) => near(p, q)))) parent[find(a)] = find(b);
  const comps = new Map<number, number[]>();
  edges.forEach((_, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r)!.push(i); });
  return [...comps.values()];
}

/**
 * Record the grouping of the run that starts at `f` (its first member), once: `resolve(member)` gives each member's edge on the part before the run, or null when it
 * cannot. Members whose edge could not be resolved, or a run with the same edge twice, are left ungrouped (planned as before). Returns nothing; st.chain holds the result.
 */
export async function groupRun(f: Feature, features: Feature[], idx: number, st: TranslateState, resolve: (m: Feature) => Promise<ChainEdge | null>, scale: number): Promise<void> {
  st.chain ??= {};
  if (st.chain[f.id]) return;
  const run = runAt(features, idx);
  const solo = (m: Feature): void => { st.chain![m.id] = { lead: m.id, ids: [m.id] }; };
  if (run.length < 2) { solo(f); return; }
  const edges: ChainEdge[] = [];
  for (const m of run) {
    const e = await resolve(m);
    if (!e) { run.forEach(solo); return; }
    edges.push(e);
  }
  const tol = 1e-6 * 10 * Math.max(1, scale, ...edges.flatMap((e) => e.ends.flatMap((p) => p.map(Math.abs))));
  for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) {
    const same = Math.hypot(...[0, 1, 2].map((k) => edges[a].point[k] - edges[b].point[k])) <= tol;
    if (same) { run.forEach(solo); return; } // the same edge twice: planned one by one, as before (the second is no longer there)
  }
  for (const comp of components(edges, tol)) {
    const ids = comp.map((i) => run[i].id);
    const info: ChainInfo = { lead: ids[0], ids };
    for (const id of ids) st.chain[id] = id === ids[0] ? { ...info, points: comp.map((i) => edges[i].point) } : info;
  }
}

/** A straight edge (the mid point is the middle of the end points). */
export const isStraight = (start: V3, mid: V3, end: V3): boolean => {
  const sc = Math.max(1, ...[...start, ...end].map(Math.abs));
  return Math.hypot(...[0, 1, 2].map((k) => mid[k] - (start[k] + end[k]) / 2)) <= 1e-7 * sc && Math.hypot(...[0, 1, 2].map((k) => end[k] - start[k])) > 1e-9 * sc;
};

/** The measure of the part a feature on `id` is applied to (following the holes, pockets and grooves that changed it in place, as needBody does). */
export function beforeOf(st: TranslateState, id: string | undefined): Aggregate | undefined {
  if (!id) return undefined;
  let h = id; const seen = new Set<string>();
  while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; }
  return st.measure[h] ?? st.measure[id];
}
/** what a step reads of a plan for the check below */
export const blendOf = (plan: unknown): BlendInfo | undefined => (plan as { blend?: BlendInfo } | null)?.blend;

/** 'bevel' or 'round' by the id, as the fillet-chamfer set's host decides (fillet-chamfer.ts wordOf). */
const wordOf = (id: string): string => (/^bevel|^chamfer/.test(id) ? 'bevel' : 'round');
/** The guard code of the post-build check: the fillet-chamfer set's code for the same verdict. */
export const BLEND_FACE_GUARD = 'FC-FACE-COUNT';

/**
 * The post-build check of a blend that went to the engine as ONE straight edge between two planar faces: the part must have exactly one face more than before
 * (fc-guard.ts postCheck). `before` is the measure of the part the blend was applied to. Returns the refusal (the fillet-chamfer set's face-count sentence), or null.
 */
export function blendRefusal(f: Feature, blend: BlendInfo | undefined, before: Aggregate | undefined, m: Aggregate, ctx: TranslateCtx): { sentence: string; guard: string } | null {
  if (f.kind !== 'fillet' || !blend || ctx.skipFilletChain) return null;
  if (blend.edges !== 1 || !blend.straightPlanar || !before) return null;
  if (m.faces === before.faces + 1) return null;
  return { sentence: guardSentence({ code: 'face-count', args: { facesBefore: before.faces, facesAfter: m.faces } }, f.id, wordOf(f.id))!, guard: BLEND_FACE_GUARD };
}
