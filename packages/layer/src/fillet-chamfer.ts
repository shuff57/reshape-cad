// TypeScript port of the fillet-chamfer group's translator: docs/spikes/solidcraft-referee/contract/fillet-chamfer-evidence/live/lib/translate-fc.mjs (the phase 7 pane translator translate-p4.mjs with the group's two
// hooks in planFeature and the group's loop, all switched by ctx.fc = { guard, group, lib }), with fc-guard.mjs (fc-guard.ts) and fc-sentences.mjs (fc-sentences.ts). The original is driven by live/fc-page.mjs,
// which also turns every refusal into one plain sentence (guardSentence for a guard's verdict, plainSentence for the rest) and a whole-shape round that was refused into a refused note with the plain primitive standing.
// Behaviour-preserving: same guards in the same order, same command lists, same engine calls (topologyOf calls included), same sentences. The additions and deviations are listed here and in NOTES.md, Fold 7.
//
// THE LAYER'S BASE IS THE PHASE 4 TRANSLATOR, WHICH IS WHAT translate-fc.mjs EXTENDS. The set is
//     base (phase 4) planners  +  the group's loop (fcStep, for EVERY kind, as the original's loop is)
// where the loop differs from the generic one in exactly the original's hooks:
//   * GUARD (ctx.fc.guard): between "name resolved to a pick point" and "send solid.fillet / solid.chamfer", read the topology of the target body (ctx.topologyOf) and run the guard (guardBlend for one edge,
//     guardBatch for a group); a verdict that is not ok refuses the feature and nothing is sent to the kernel. The post-build net checks that a blend of ONE straight planar edge added exactly one face.
//   * GROUP (ctx.fc.group): consecutive fillets on one chain with the SAME style and SIZE (what round(part.rim(sk), r) and round([e1, e2, ..], r) emit, one feature per edge) are resolved against the shape BEFORE
//     the first of them and handed to the kernel as ONE call per connected component of edges (edges that share an end point).
//   * HOOK 1: the whole-shape round of a primitive goes through guardPrimitiveRound; a refused round leaves the plain primitive standing (built WITHOUT the round) and the note is a refusal with the sentence.
//   * HOOK 2: hollow() of a face whose edge was filleted with a radius at least as large as the wall (guardShellRim). This is a guard on a kind another group owns (the shell): FC-KNIFE-RIM (a cross-kind guard).
// The original switches these on with ctx.fc; here they are always on (the pane's mode with every switch off is the base set).
//
// SENTENCES. The original's translator keeps a raw text per refusal and its host maps it. Here the refusal of a feature is the mapped sentence (guardSentence / plainSentence) and `st.refused` keeps the raw text (as the
// original's does, so a feature that depends on a refused blend words its refusal as the original's does); a raw text
// plainSentence does not map (it answers UNMAPPED, for example the engine's own words on the fake) stays as it is. Every kind's refusal is mapped when this set runs a document alone, as the original's host did.
// The layer's `guard` on a note is the CODE ('FC-TOO-BIG' ...); the original's guard object (code and arguments) is `fc`.
//
// DEVIATIONS FROM THE ORIGINAL (all disclosed in NOTES.md, Fold 7):
//   1. FAIL-OPEN FIXED (owner decision). The original skips the post-build face count when the topology reply carries no measure (`facesBefore != null`): a blend that added no face is then built. The face count before
//      the blend now also comes from the measure the translator holds for the part (st.measure of the target), and a blend whose count cannot be known at all is refused (FC-NO-TOPOLOGY). A named exception in the differential.
//   2. The notes of a group of blends are emitted in DOCUMENT order, one per feature (the original emits them component by component).
//   3. The face count and the shell/measure bookkeeping of the other loops (onAccepted of every member) run for each accepted blend.
// No kernel is named: everything that touches an engine comes in through the context object.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { Cmd, RunResult, TranslateCtx, TopologyReply, V3 } from './types.js';
import { BASE_PROFILE, aggregate, confirmOnTarget, makeEnv, planFeature, refuse, resolveNamesFor, membersOf } from './translate.js';
import type { Aggregate, FeatureResult, LoopEnv, Plan, PlanCtx, Profile, ShapeCache, TranslateState } from './translate.js';
import { resolveName } from './resolve-names.js';
import { SKETCH_VOLUME_GUARD, sketchVolumeRefusal } from './sketch-volume.js';
import { POCKET_CUT_GUARD, pocketCutRefusal, rememberRun } from './pocket-cut.js';
import { hollowRefusal } from './hollow-check.js';
import { motionRefusal, motionRepair } from './move-turn.js';
import { ERRORED_BODY_GUARD, erroredBodySentence } from './errored-body.js';
import { isVerbatimGuard } from './translate.js';
import type { EdgeRes, Resolved } from './resolve-names.js';
import { guardBatch, guardBlend, guardPrimitiveRound, guardShellRim, postCheck } from './fc-guard.js';
import type { BlendStyle, FcBad, FcTopo, RimFeature, RoundFeature } from './fc-guard.js';
import { guardSentence, plainSentence } from './fc-sentences.js';
import type { SentenceCtx } from './fc-sentences.js';

export * as fcGuard from './fc-guard.js';
export * as fcSentences from './fc-sentences.js';

/** The kind this set owns. */
export const FC_KINDS = ['fillet'];
/**
 * The guards of this set that look at features of kinds it does not own: the knife-edge rim (a hollow whose open edge was rounded with a radius as large as the wall, a refusal of a SHELL), and the guards of the
 * whole-shape round of a primitive (a box or a cylinder has no owner; a refused round leaves the plain primitive standing). The set has no time limit and no chain of its own.
 */
export const FC_CROSS_KIND_GUARDS = ['FC-KNIFE-RIM', 'FC-WHOLE-CHAMFER', 'FC-NEGATIVE', 'FC-TOO-SMALL'];
/** The kinds that carry a whole-shape `round` (the original's hook 1 sits in the planner of all of them). */
export const FC_PRIMITIVES = ['box', 'cylinder', 'sphere', 'torus', 'cone', 'prism', 'wedge'];

/** The group's bookkeeping beside the generic state. */
export interface FCState {
  /** the fillets a grouped blend already handled (the original's consumedByGroup), by id */
  consumed: Record<string, true>;
}

/** The layer's guard code for a verdict code. */
export const fcCode = (code: string): string => `FC-${code.toUpperCase()}`;

const headId = (st: TranslateState, id: string): string => { let h = id; const seen = new Set<string>(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };

/** The fields of a feature this module reads (the original reads them unguarded). */
interface FView { id: string; kind: string; target?: string; edge?: unknown; style?: string; size?: number; round?: number; roundStyle?: string }
const FV = (f: Feature): FView => f as unknown as FView;

// ---- sentences -----------------------------------------------------------------------------------------------------------------------------------
/** 'bevel' or 'round' by the id, as the original's host decides (not by the style of the feature). */
const wordOf = (id: string): string => (/^bevel|^chamfer/.test(id) ? 'bevel' : 'round');

/** The causes of an edge that was changed by an earlier step, as fc-page.mjs works them out from the document. */
function sentenceCtx(raw: string, f: Feature, doc: { features: Feature[] }): SentenceCtx {
  const sctx: SentenceCtx = {};
  const m = raw.match(/an operation after (\S+) changed or removed it/);
  const at = doc.features.findIndex((x) => x.id === f.id);
  if (m && at >= 0) {
    const from = doc.features.findIndex((x) => x.id === m[1]);
    sctx.causes = doc.features.slice(from + 1, at).filter((x) => !['sketch', 'extrude', 'datum'].includes(x.kind)).map((x) => ({ id: x.id, kind: x.kind, style: FV(x).style, size: FV(x).size }));
    sctx.self = { style: FV(doc.features[at]).style, size: FV(doc.features[at]).size };
  }
  return sctx;
}
/** The sentence of a refusal: the guard's sentence for a verdict, the mapper's for a raw text, and the raw text when neither maps it. */
export function refusalSentence(f: Feature, raw: string, verdict: { code: string; args?: Record<string, unknown> } | null, doc: { features: Feature[] }): string {
  const s = verdict ? guardSentence(verdict, f.id, wordOf(f.id)) : plainSentence(raw, sentenceCtx(raw, f, doc)).sentence;
  return s ?? raw;
}

// ---- the guard on a blend about to be sent ---------------------------------------------------------------------------------------------------------
type BodyTopo = { ok: true; topo: FcTopo; faces: number | null } | { ok: false; error: string };
async function bodyTopo(ctx: TranslateCtx, accepted: Cmd[], bodyName: string): Promise<BodyTopo> {
  let r: TopologyReply;
  try { r = await ctx.topologyOf!(accepted); } catch (e) { r = { ok: false, error: (e as Error).message }; }
  const body = r.ok && r.topology ? r.topology.bodies.find((b) => b.name === bodyName) : null;
  if (!body || body.error) return { ok: false, error: `no topology for ${bodyName}` };
  const mb = r.measure?.bodies?.find((b) => b.name === bodyName);
  return { ok: true, topo: { faces: body.faces, edges: body.edges }, faces: mb?.faces ?? null };
}
/** What guardCmd answers: a refusal, or the rule that accepted the blend and the face count of the part before it (null: the reply did not say). */
type GuardCmd = FcBad | { ok: true; rule: 'rim' | 'planar' | 'group'; facesBefore: number | null };
/** run the guard on one blend command about to be sent. */
async function guardCmd(ctx: TranslateCtx, accepted: Cmd[], cmd: Cmd): Promise<GuardCmd> {
  const T = await bodyTopo(ctx, accepted, cmd.params.body as string);
  if (!T.ok) return { ok: false, code: 'no-topology', args: { why: T.error } };
  const picks = cmd.params.edges as V3[]; const size = (cmd.params.radius ?? cmd.params.distance) as number; const style: BlendStyle = cmd.command === 'solid.chamfer' ? 'chamfer' : 'fillet';
  const g = picks.length === 1 ? guardBlend(T.topo, picks[0], size, style) : guardBatch(T.topo, picks, size, style);
  return g.ok ? { ok: true, rule: g.rule, facesBefore: T.faces } : g;
}
/**
 * The post-build net of a blend of ONE straight planar edge. DEVIATION 1 (the fail-open fixed): the face count before the blend is the reply's, else the translator's own measure of the part (`before`); with neither the
 * blend is refused, where the original skipped the check.
 */
function faceCheck(gv: GuardCmd, before: number | undefined, after: number): FcBad | null {
  if (!gv.ok || gv.rule !== 'planar') return null;
  const b = gv.facesBefore ?? before;
  if (b === undefined) return { ok: false, code: 'no-topology', args: { why: 'the face count before the blend is not known' } };
  const pc = postCheck(b, after, gv.rule);
  return pc.ok ? null : pc;
}

// ---- the loop ------------------------------------------------------------------------------------------------------------------------------------
export async function fcStep(f: Feature, idx: number, env: LoopEnv): Promise<void> {
  const { doc, ctx, st, accepted, out, shapeCache } = env;
  const fs = st.fc!;
  if (fs.consumed[f.id]) return;
  const fv = FV(f);
  const prefix = doc.features.slice(0, idx);
  const note = (o: Omit<FeatureResult, 'id' | 'kind'>): void => { out.push({ id: f.id, kind: f.kind, ...o }); };
  // a refusal: the sentence for the verdict (or the raw text) is the feature's refusal; st.refused keeps the RAW text, as the original does (a feature that depends on this one words its refusal from it, and the
  // original's mapper only reads the head of that text for a dependent it knows; the unified set puts the plain sentence there instead, unified.ts)
  const refused = (raw: string, o: Omit<FeatureResult, 'id' | 'kind' | 'status' | 'refusal'> & { verdict?: FcBad }): void => {
    const { verdict, ...rest } = o;
    st.refused[f.id] = raw;
    note({ status: 'refused', refusal: refusalSentence(f, raw, verdict ?? null, doc), ...rest, ...(verdict ? { guard: fcCode(verdict.code), fc: verdict } : {}) });
  };
  // ---- GROUP: a run of consecutive same-style same-size fillets on one chain is ONE blend operation
  if (f.kind === 'fillet' && fv.edge && typeof fv.edge === 'object' && ctx.topologyOf) {
    const run: Feature[] = [f];
    for (let j = idx + 1; j < doc.features.length; j++) {
      const g = doc.features[j]; const gv = FV(g);
      if (g.kind !== 'fillet' || gv.style !== fv.style || gv.size !== fv.size || gv.target !== FV(run[run.length - 1]).id || !gv.edge || typeof gv.edge !== 'object') break;
      run.push(g);
    }
    if (run.length > 1) {
      for (const m of run.slice(1)) fs.consumed[m.id] = true;
      await translateGroup(run, prefix, env);
      return;
    }
  }
  // phase 4: resolve the one name this feature needs, from the engine's own topology, before planning it
  const resolved = await resolveNamesFor(f, prefix, { st, accepted, ctx, shapeCache });
  const fctx: PlanCtx = { ...ctx, resolve: (name) => resolved.get(name) ?? null };
  if (f.kind === 'sketch') st.sketches[f.id] = f;
  // HOOK 2: hollow() of a face whose edge was rounded with a radius at least as large as the wall (knife-edge rim)
  if (f.kind === 'shell') {
    const gs = guardShellRim(doc.features as unknown as RimFeature[], idx);
    if (!gs.ok) { refused(`${f.id} (shell): GUARD ${gs.code}`, { commands: [], verdict: gs }); return; }
  }
  // HOOK 1: the whole-shape round of a primitive goes through guardPrimitiveRound; a refused round leaves the plain primitive standing
  let guardNote: FcBad | null = null;
  let pf: Feature = f;
  if (FC_PRIMITIVES.includes(f.kind) && fv.round !== undefined) {
    const g = guardPrimitiveRound(f as unknown as RoundFeature);
    if (!g.ok) { guardNote = g; pf = { ...f, round: undefined, roundStyle: undefined } as unknown as Feature; }
  }
  let plan: Plan;
  try { plan = planFeature(pf, st, fctx, BASE_PROFILE); } catch (e) { plan = refuse(`${f.id} (${f.kind}): translator error: ${(e as Error).message}`); }
  if ('refusal' in plan) {
    if (isVerbatimGuard(plan.guard)) { st.refused[f.id] = plan.refusal; note({ status: 'refused', refusal: plan.refusal, guard: plan.guard, commands: [] }); return; } // the open-outline and move-turn sentences are kept as they are
    refused(plan.refusal, { commands: [] }); return;
  }
  if ('noop' in plan) { note({ status: 'noop', commands: [] }); return; }
  let lastErr: string | null = null;
  let lastFail: RunResult | null = null;
  let errored = false; // an engine reply with an errored body (errored-body.ts)
  for (const variant0 of plan.variants) {
    let variant = variant0;
    let repaired: { pads: number; reason: string } | undefined;
    // ---- GUARD on a single-edge blend about to be sent
    let gv: GuardCmd | null = null;
    const bl = variant[variant.length - 1];
    if (f.kind === 'fillet' && bl && (bl.command === 'solid.fillet' || bl.command === 'solid.chamfer')) {
      gv = await guardCmd(ctx, accepted, bl);
      if (!gv.ok) { refused(`${f.id} (${f.kind}): GUARD ${gv.code}`, { commands: variant, verdict: gv }); return; }
    }
    let res: RunResult;
    try { res = await ctx.runSC([...accepted, ...variant]); } catch (e) { res = { ok: false, failed: { error: `bridge error: ${(e as Error).message}` } }; }
    if (!res.ok) { if (res.erroredBody) errored = true; lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.rejected ?? res.error ?? 'unknown'); lastFail = res; continue; }
    let m = aggregate(res, plan.produces);
    if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }
    // every set: the built pull against its sketch (sketch-volume.ts)
    const sv = f.kind === 'extrude' ? sketchVolumeRefusal(f, st.sketches[f.target], ctx, res, plan.produces) : null;
    if (sv) { st.refused[f.id] = sv; note({ status: 'refused', refusal: sv, guard: SKETCH_VOLUME_GUARD, commands: variant }); return; }
    // every set: a move or turn against the part it started from, a primitive against its closed-form volume (move-turn.ts)
    const mv = motionRefusal(f, st, ctx, res, plan.produces, accepted);
    // the move-turn group's chain repair: the same feature with one or two no-op moves appended, re-checked by the same invariant (move-turn.ts motionRepair)
    const fx = mv ? await motionRepair(f, st, ctx, mv, plan.produces, accepted, variant, ctx.runSC) : null;
    const m2 = fx ? aggregate(fx.res, plan.produces) : null;
    if (mv && fx && m2) { variant = fx.variant; res = fx.res; m = m2; repaired = { pads: fx.pads, reason: mv.sentence }; }
    else if (mv) { st.refused[f.id] = mv.sentence; note({ status: 'refused', refusal: mv.sentence, guard: mv.guard, commands: variant }); return; }
    // ---- POST-BUILD NET: a blend of ONE straight planar edge adds exactly one face
    if (gv) {
      const pc = faceCheck(gv, f.kind === 'fillet' ? st.measure[headId(st, fv.target!)]?.faces : undefined, m.faces);
      if (pc) { refused(`${f.id} (${f.kind}): GUARD ${pc.code}`, { commands: variant, verdict: pc, measureRefused: m }); return; }
    }
    // the sets with no after-the-build check of a pocket: the cut against the tool that made it (pocket-cut.ts, the extrude-pocket group's check and sentence)
    const pcut = f.kind === 'pocket' ? await pocketCutRefusal(f, ctx, res, accepted, variant, plan.produces, ctx.runSC) : null;
    if (pcut) { st.refused[f.id] = pcut; note({ status: 'refused', refusal: pcut, guard: POCKET_CUT_GUARD, commands: variant }); return; }
    // every set: the hollow of a part with rounded or bevelled edges against its closed form (hollow-check.ts)
    const hc = f.kind === 'shell' ? hollowRefusal(f, doc.features, st, ctx, res, plan.produces, accepted) : null;
    if (hc) { st.refused[f.id] = hc.sentence; note({ status: 'refused', refusal: hc.sentence, guard: hc.guard, commands: variant }); return; }
    accepted.push(...variant);
    rememberRun(accepted, res);
    for (const mp of membersOf(env.profile)) mp.onAccepted?.(st, res, m, plan, { f, ctx });
    st.accLen[f.id] = accepted.length;
    st.bodies[f.id] = m.bodies;
    st.measure[f.id] = m;
    for (const c of plan.consumes) {
      if (c === f.id) continue;
      if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? (f as unknown as { target: string }).target : (f as unknown as { into: string }).into)) st.head[c] = f.id; } else st.stale[c] = f.id;
    }
    const built = { commands: variant, measure: m, pickedFrom: plan.pickedFrom, evidence: plan.evidence ?? null, pick: (variant.find((c) => c.params.edges || c.params.faces)?.params) ?? null, variantsTried: plan.variants.indexOf(variant0) + 1, ...(repaired ? { repaired } : {}) };
    // the plain primitive stands, the note says the round was refused (fc-page.mjs: partialGuard)
    if (guardNote) { const sentence = refusalSentence(f, `${f.id} (${f.kind}): GUARD ${guardNote.code}`, guardNote, doc); note({ status: 'refused', refusal: sentence, guard: fcCode(guardNote.code), fc: guardNote, partial: true, ...built }); } else note({ status: 'built', ...built });
    return;
  }
  // an errored body: the owner's sentence, kept as it is (the raw text stays in st.refused, as for every refusal of this step)
  if (errored) { st.refused[f.id] = `${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`; note({ status: 'refused', refusal: erroredBodySentence(f), guard: ERRORED_BODY_GUARD, commands: plan.variants[0], failed: lastFail?.failed ?? null, sketchAtFailure: lastFail?.sketch_at_failure ?? null }); return; }
  refused(`${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`, { commands: plan.variants[0], failed: lastFail?.failed ?? null, sketchAtFailure: lastFail?.sketch_at_failure ?? null });
}

/** GROUP: resolve every member's edge against the shape BEFORE the group, split into connected components, one blend call per component. */
async function translateGroup(run: Feature[], prefix: Feature[], env: LoopEnv): Promise<void> {
  const { doc, ctx, st, accepted, out, shapeCache } = env;
  const first = run[0]; const f0 = FV(first);
  const ids = run.map((m) => m.id);
  // notes are collected per member and emitted in document order (deviation 2)
  const notes = new Map<string, FeatureResult>();
  const flush = (): void => { for (const m of run) { const n = notes.get(m.id); if (n) out.push(n); } };
  const refuseAll = (raw: string, extra: Partial<FeatureResult> = {}, verdict: { code: FcBad['code']; args: Record<string, unknown>; ok?: false } | null = null): void => {
    for (const m of run) {
      const rawM = raw.replace(/^[a-z]+\d+/i, m.id);
      st.refused[m.id] = rawM;
      notes.set(m.id, { id: m.id, kind: m.kind, status: 'refused', refusal: refusalSentence(m, rawM, verdict, doc), commands: [], group: ids, ...extra, ...(verdict ? { guard: fcCode(verdict.code), fc: verdict } : {}) });
    }
  };
  // 1. every member's name, resolved on the shape before the group, then confirmed on the target body (the same target for all)
  const points: V3[] = []; const evidences: EdgeRes['evidence'][] = [];
  for (const m of run) {
    const renv = makeEnv(st, accepted, prefix, ctx, shapeCache);
    let rr: Resolved = await resolveName(FV(m).edge as never, renv, 'edge');
    rr = await confirmOnTarget(rr, { st, accepted, ctx, targetId: f0.target! });
    if (!rr.ok || rr.kind !== 'edge') { refuseAll(`${m.id} (fillet): ${rr.ok ? `the edge could not be resolved to a single edge (it names ${rr.kind})` : rr.sentence}`); flush(); return; }
    points.push(rr.point); evidences.push(rr.evidence);
  }
  // 2. the plan of the FIRST member gives the body, the dependency checks and the command shape (planFeature is untouched)
  const resolved = new Map<unknown, Resolved>(); resolved.set(f0.edge, { ok: true, kind: 'edge', point: points[0], evidence: evidences[0] } as unknown as EdgeRes);
  const fctx: PlanCtx = { ...ctx, resolve: (nm) => resolved.get(nm) ?? null };
  let plan: Plan;
  try { plan = planFeature(first, st, fctx, BASE_PROFILE); } catch (e) { plan = refuse(`${first.id} (fillet): translator error: ${(e as Error).message}`); }
  if ('refusal' in plan) { refuseAll(plan.refusal); flush(); return; }
  if ('noop' in plan) throw new Error('a fillet cannot plan to nothing'); // (the base planner of a fillet never answers noop)
  const body = plan.produces[0];
  const mk = (pts: V3[]): Cmd => (f0.style === 'chamfer'
    ? { command: 'solid.chamfer', params: { edges: pts, distance: f0.size, body } }
    : { command: 'solid.fillet', params: { edges: pts, radius: f0.size, body } });
  // 3. the same edge named twice is refused (a second blend of an edge that the first one consumed)
  const T0 = await bodyTopo(ctx, accepted, body);
  if (!T0.ok) { refuseAll(`${first.id} (fillet): solidcraft returned no topology for ${body}`); flush(); return; }
  const near = (p: V3, q: V3): boolean => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= 1e-6 * 10 * Math.max(1, ...T0.topo.edges.flatMap((e) => [...e.start, ...e.end].map(Math.abs)));
  const edgeIdx = points.map((p) => { let bi = -1; let bd = Infinity; T0.topo.edges.forEach((e, i) => { const d = Math.min(Math.hypot(...[0, 1, 2].map((k) => e.mid[k] - p[k])), Math.hypot(...[0, 1, 2].map((k) => e.start[k] - p[k])), Math.hypot(...[0, 1, 2].map((k) => e.end[k] - p[k]))); if (d < bd) { bd = d; bi = i; } }); return bi; });
  const dupe = edgeIdx.findIndex((e, i) => e >= 0 && edgeIdx.indexOf(e) !== i);
  if (dupe >= 0) { refuseAll(`${first.id} (fillet): GUARD twice`, {}, { code: 'twice', args: {} }); flush(); return; }
  // 4. connected components by shared end points (a closed loop edge is its own component)
  const ends = edgeIdx.map((i) => (i >= 0 ? [T0.topo.edges[i].start, T0.topo.edges[i].end] : [points[0], points[0]]));
  const parent = run.map((_, i) => i); const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < run.length; a++) for (let b = a + 1; b < run.length; b++) if (ends[a].some((p) => ends[b].some((q) => near(p, q)))) parent[find(a)] = find(b);
  const comps = new Map<number, number[]>(); run.forEach((_, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r)!.push(i); });
  let before = st.measure[headId(st, f0.target!)]?.faces; // the face count of the part before the next component (deviation 1)
  for (const members of comps.values()) {
    const cmd = mk(members.map((i) => points[i]));
    const gv = await guardCmd(ctx, accepted, cmd);
    let res: RunResult | null = null; let lastFail: RunResult | null = null; let m2: Aggregate | null = null;
    let verdict: { guard?: FcBad; raw: string; measureRefused?: Aggregate; errored?: true } | null = null;
    if (!gv.ok) verdict = { guard: gv, raw: `GUARD ${gv.code}` };
    else {
      try { res = await ctx.runSC([...accepted, cmd]); } catch (e) { res = { ok: false, failed: { error: `bridge error: ${(e as Error).message}` } }; }
      if (!res.ok) { const lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.rejected ?? res.error ?? 'unknown'); lastFail = res; verdict = { raw: `solidcraft refused it -- ${lastErr}`, ...(res.erroredBody ? { errored: true as const } : {}) }; } else {
        m2 = aggregate(res, plan.produces);
        if (!m2) verdict = { raw: `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back` };
        else if (members.length === 1) { const pc = faceCheck(gv, before, m2.faces); if (pc) verdict = { guard: pc, raw: `GUARD ${pc.code}`, measureRefused: m2 }; }
      }
    }
    if (verdict) {
      for (const i of members) {
        const m = run[i];
        const rawM = `${m.id} (fillet): ${verdict.raw}`;
        st.refused[m.id] = rawM;
        notes.set(m.id, { id: m.id, kind: 'fillet', status: 'refused', refusal: verdict.errored ? erroredBodySentence(m) : refusalSentence(m, rawM, verdict.guard ?? null, doc), commands: [cmd], group: ids, ...(verdict.errored ? { guard: ERRORED_BODY_GUARD } : verdict.guard ? { guard: fcCode(verdict.guard.code), fc: verdict.guard } : {}), failed: lastFail?.failed ?? null, measureRefused: verdict.measureRefused ?? null });
      }
      continue;
    }
    const mm = m2!;
    accepted.push(cmd);
    rememberRun(accepted, res!);
    members.forEach((i, k) => {
      const m = run[i];
      for (const mp of membersOf(env.profile)) mp.onAccepted?.(st, res!, mm, plan, { f: m, ctx });
      st.accLen[m.id] = accepted.length; st.bodies[m.id] = mm.bodies; st.measure[m.id] = mm;
      st.stale[i === 0 ? f0.target! : run[i - 1].id] = m.id;
      notes.set(m.id, { id: m.id, kind: 'fillet', status: 'built', commands: k === 0 ? [cmd] : [], measure: mm, pickedFrom: plan.pickedFrom, evidence: evidences[i], pick: k === 0 ? cmd.params : null, group: ids, groupSize: members.length, variantsTried: 1 });
    });
    before = mm.faces;
  }
  flush();
}

// ---- the planner set -----------------------------------------------------------------------------------------------------------------------------
/** What `planFeature` does with a fillet under this set: the name is resolved on the engine's topology and the guard reads it, so the step does it, never this. */
const notSync = (): Plan => {
  throw new Error("the 'fillet-chamfer' planner set plans a fillet asynchronously (the name is resolved on the engine, the guard reads its topology); use translateDoc");
};

export const FC_PROFILE: Profile = {
  name: 'fillet-chamfer',
  // claiming the 'fillet' kind is what makes this profile its owner in a composition; the real planning is the base planner, called by the step
  planners: { fillet: notSync },
  verifies: false,
  initState(st: TranslateState) { st.fc = { consumed: {} }; },
  // wording of the generic loop: the step does not use these, they are the base's so the profile is complete
  depSentence: BASE_PROFILE.depSentence,
  noOutline: BASE_PROFILE.noOutline,
  plannerError: BASE_PROFILE.plannerError,
  kernelRefusal: BASE_PROFILE.kernelRefusal,
  step: fcStep,
};
export type { ShapeCache };
