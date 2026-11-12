// Host-origin modules ONLY: the solver, the sketch outline, the translator, the phase 2 sketch mapper helpers.
// reshape-script.ts is NOT here (it runs only in the sandboxed iframe, see runner-entry.mjs).
export { solveDoc } from '../../../script/dist/model-codegen.js';
export * as mt from '../../../script/dist/model-types.js';
export * as arc from '../../../sketch/dist/sketch-arc.js';
// The translator is the layer's: the UNIFIED set (base + six groups' planners and guards, packages/layer Phase 2).
import { createTranslator } from '../../../layer/dist/index.js';
import { hostPreflight, PREFLIGHT_DEP_GUARD } from './host-guards.mjs';
export { hostPreflight, soupSolveVerdict, staleConsumers } from './host-guards.mjs';
// the student-facing sketch check (sketch-check.mjs) and what it reads: the independent soup solver's count of free ways
export { soupSolve, isSoup } from './host-guards.mjs';
export { sketchCheck, refusedRule, ruleWords } from './sketch-check.mjs';
export { docProfileIndices, draftFromUsage, preflightScript } from '../../../layer/dist/index.js';
import { fromUsageOfDoc } from '../../../layer/dist/index.js';
import { extentAlong } from '../../../script/dist/model-types.js';
// ctx.fromUsage for the from-bottom draft guard (G-FROM), read from the DOC, not from the script text: the sandboxed interpreter records on each draft it
// executes whether its neutral came from a `from:` word (DraftFeature.neutralFrom), so a comment, a string or a loop cannot misalign it (audit SD-5).
// recorded: true for the doc the sandbox returned for the script that ran; false for any other doc (a ModelDoc example, translateRaw), where a draft with
// no record is from-unknown and G-FROM checks every word a `from:` could have read its neutral from (never built unchecked).
export const hostFromUsage = (doc, { recorded }) => fromUsageOfDoc(doc, { recorded, mt: { extentAlong } });

// What pane.js run() does between the sandbox and the translator (DOF-1): solve the doc, then the legacy rule guard (packages/layer legacy-guard.ts, the
// sketch-dof-diagnosis contract's guard). The interpreter settles each rule call by dropping an older rule when the new one does not fit, with no word, so the
// settled doc can build a part that ignores a rule the student wrote (rect(40,30); length(1,20); length(2,15) built 40 x 15). The guard replays what was WRITTEN
// from the runner's rule log: it builds a shape that holds every written rule (checked to 1e-9), or refuses the run in the contract's one sentence.
// `r` is the runner's message { doc, warnings, ruleLog }; `recorded` as hostFromUsage (false: no script ran, the sketch's own rules are what was written).
// Returns { refusal, warnings } or { doc, fromUsage, warnings }. `warnings` are the interpreter's warnings that still stand, verbatim: a rule warning
// ("... cannot hold along with the rules already on this sketch ...") is about the settled doc the guard has replaced, so it no longer stands (contract
// sketch-dof-diagnosis#15: its claim was false where the guard builds, and the refusal sentence replaces it where it does not).
import { solveDoc as solveDocForHost } from '../../../script/dist/model-codegen.js';
import { solveSketch, seedForNewRule } from '../../../sketch/dist/sketch-solve.js';
import { guardLegacySketches } from '../../../layer/dist/index.js';
const LEGACY_SOLVER = { solveSketch, seedForNewRule };
export function hostPrepare(r, { recorded }) {
  const log = recorded && Array.isArray(r.ruleLog) ? r.ruleLog : [];
  const g = guardLegacySketches(r.doc, solveDocForHost(r.doc), log, LEGACY_SOLVER);
  const ruleWarnings = new Set(log.map((e) => e?.warning).filter(Boolean));
  const warnings = (Array.isArray(r.warnings) ? r.warnings : []).map(String).filter((w) => !ruleWarnings.has(w));
  if (g.outcome === 'refused') return { refusal: g.sentence, warnings, sketches: g.sketches };
  return { doc: g.doc, fromUsage: hostFromUsage(g.doc, { recorded }), warnings, sketches: g.sketches };
}
const layer = createTranslator({ planners: 'unified' });
// The host's setting for the extrude-pocket group's join checks on every combine (packages/layer/NOTES.md, owner decision 2026-11-07):
// 'full', so the inclusion-exclusion consistency check runs on every join. At the library default 'cheap' the unified set built 8 wrong
// joins on the real kernel (a join onto a pull of two shapes, a pad overhanging a plate edge by 0.002 to 0.1 mm); 'full' refuses them with
// the group's own sentence. Cost and over-refusals: docs/spikes/solidcraft-referee/GUARD-UNIFIED-JOIN-FULL.md. Set here, after the
// caller's ctx, so every translation the page makes runs at this level.
export const HOST_EP_JOIN_CHECKS = 'full';
const hostCtx = (ctx) => ({ ...ctx, unifiedEpJoinChecks: HOST_EP_JOIN_CHECKS });
// Student pilot: kinds whose guards are not folded in yet (Phase 2 "rest": blend-loft) are refused here in one sentence, not built.
const NOT_YET = {
  blend: 'a loft between two sketches is not available in this version yet, so {id} is shown without it.',
};
// Host-route guards the layer does not run (host-guards.mjs; audit SG-13, PNP-7), and the pilot's NOT_YET kinds. A NOT_YET feature is left out of the doc the
// layer translates and reported refused, as before. The two guards judge a feature the layer BUILT, as the contract's own guards do (r3-guard.mjs refuses a
// stale pick only when the page built it; a sketch's rules matter only to a feature that pulled or cut it): the doc is translated once; when a feature these
// guards are about was built, it is translated again with that guard's feature, and every feature that reads it, left out and reported refused in the guard's
// sentence, in doc order, beside whatever did build. Where the layer already refused the feature (the kernel's own conflict sentence, another guard), its
// sentence stands and the first translation is the result.
export const translateDoc = async (doc, ctx0) => {
  const tr = await translateGuarded(doc, ctx0);
  return ctx0?.probeBlockedSteps ? probeBlockedSteps(doc, ctx0, tr) : tr;
};
async function translateGuarded(doc, ctx0) {
  const ctx = hostCtx(ctx0);
  const notYet = new Map(doc.features.filter((f) => NOT_YET[f.kind]).map((f) => [f.id, { refusal: NOT_YET[f.kind].replace('{id}', f.id), guard: 'PILOT-NOT-YET' }]));
  const tr = await translateWithout(doc, ctx, notYet);
  const flagged = hostPreflight(doc);
  if (!flagged.size) return tr;
  const built = new Set(tr.features.filter((f) => f.status === 'built').map((f) => f.id));
  const fired = new Set([...flagged].filter(([id, v]) => v.subject && built.has(id)).map(([, v]) => v.root));
  if (!fired.size) return tr;
  const pre = hostPreflight(doc, fired);
  for (const [id, v] of notYet) if (!pre.has(id)) pre.set(id, v);
  if (ctx.soups) for (const k of Object.keys(ctx.soups)) delete ctx.soups[k]; // the second translation fills it afresh, as a run of its own
  return translateWithout(doc, ctx, pre);
}

// ---- PROTOTYPE (ctx.probeBlockedSteps, off by default; pilot 2026-11 F5/F8, after the holes' probeBlocked): a hollow, draft, round or bevel that is refused only
// because the step before it was refused is told nothing about itself. Here the script is translated ONCE more without the steps that were not built (a step left
// out hands its part on: what targeted it targets the part it changed), and a blocked step that is refused there for a reason of its own shows THAT sentence. Nothing
// from the second translation is kept: the commands, the measures and the built / refused status of every step are the first translation's. A blocked step that
// would build without the refused steps keeps its blocked sentence, and so does one whose part cannot be handed on (the refused step made the part: a pull, a join,
// a pattern) or whose own fields name a refused step (an edge named by a face of the hole that was not built).
/** The layer's three blocked sentences (shell-draft.ts planShell / planDraft dep, fc-sentences.ts 'dependent'); test/blocked-steps.test.mjs pins them to the layer. */
export const BLOCKED_SENTENCE = {
  shell: /^\S+ \(hollow\): it needs (\S+), which could not be built, so /,
  draft: /^\S+ \(draft\): it needs (\S+), which could not be built, so /,
  fillet: /^\S+ builds on (\S+), which could not be built, so /,
};
const HANDS_ON = new Set(['hole', 'fillet', 'shell', 'draft', 'move', 'rotate']);
const handsOnTo = (f) => (!f ? undefined : f.kind === 'pocket' || f.kind === 'groove' ? f.into : HANDS_ON.has(f.kind) && !(f.kind === 'move' && f.copy) ? f.target : undefined);
/**
 * What the second translation is made of: { candidates, doc, fromUsage } or null when no blocked step can be probed. `candidates` = the ids probed; `doc` = the
 * script without the refused steps (the candidates stay), retargeted; `fromUsage` = ctx.fromUsage without the entries of the drafts left out (it is paired with
 * the doc's drafts by position).
 */
export function blockedProbePlan(doc, tr, fromUsage) {
  const by = new Map(tr.features.map((f) => [f.id, f]));
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const blocked = doc.features.filter((f) => BLOCKED_SENTENCE[f.kind] && by.get(f.id)?.status === 'refused' && BLOCKED_SENTENCE[f.kind].test(by.get(f.id).refusal ?? ''));
  if (!blocked.length) return null;
  const keep = new Set(blocked.map((f) => f.id));
  const drop = new Set(tr.features.filter((f) => f.status === 'refused' && !keep.has(f.id)).map((f) => f.id));
  const res = (id) => { const seen = new Set(); while (drop.has(id) && !seen.has(id)) { seen.add(id); const p = handsOnTo(byId.get(id)); if (typeof p !== 'string') break; id = p; } return id; };
  // a field of the step that names a step left out (other than the part it works on): its own geometry hangs on the refused step, so nothing can be said about it
  const names = (f) => { let hit = false; const walk = (v) => { if (typeof v === 'string') { for (const d of drop) if (v === d || new RegExp(`(^|[^A-Za-z0-9_])${d}([^A-Za-z0-9_]|$)`).test(v)) hit = true; } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; for (const [k, v] of Object.entries(f)) if (!['id', 'kind', 'name', 'target'].includes(k)) walk(v); return hit; };
  const candidates = blocked.filter((f) => typeof f.target === 'string' && !drop.has(res(f.target)) && !names(f)).map((f) => f.id);
  if (!candidates.length) return null;
  const features = doc.features.filter((f) => !drop.has(f.id)).map((f) => {
    const g = { ...f };
    for (const k of ['target', 'into']) if (typeof g[k] === 'string') g[k] = res(g[k]);
    if (Array.isArray(g.targets)) g.targets = g.targets.map((t) => (typeof t === 'string' ? res(t) : t));
    return g;
  });
  const drafts = doc.features.filter((f) => f.kind === 'draft');
  return { candidates, doc: { ...doc, features }, fromUsage: Array.isArray(fromUsage) ? fromUsage.filter((_u, i) => drafts[i] && !drop.has(drafts[i].id)) : fromUsage };
}
// A refusal of the second translation that is NOT shown: text that is about the translation and not about the student's step (the part could not be handed on, a
// name could not be resolved, the engine's own words), and any sentence without a guard code that is still in the raw `id (kind): ...` form.
const NOT_OWN = /solidcraft refused it|could not be resolved|needs a single target body|is not a single solid|translator error|could not be built cleanly|this step could not be built/;
/** Is `own` (the step's result in the second translation) a refusal of its own, in a sentence a student can act on? */
export function ownRefusalShown(kind, own) {
  if (!own || own.status !== 'refused' || typeof own.refusal !== 'string' || !own.refusal) return false;
  if (BLOCKED_SENTENCE[kind]?.test(own.refusal) || own.guard === PREFLIGHT_DEP_GUARD || NOT_OWN.test(own.refusal)) return false;
  return !!own.guard || !/^\S+ \((fillet|chamfer|hollow|shell|draft)\): /.test(own.refusal);
}
async function probeBlockedSteps(doc, ctx0, tr) {
  const plan = blockedProbePlan(doc, tr, ctx0.fromUsage);
  if (!plan) return tr;
  let tr2;
  try { tr2 = await translateGuarded(plan.doc, { ...ctx0, soups: {}, fromUsage: plan.fromUsage }); } catch { return tr; } // the first translation stands
  const by2 = new Map(tr2.features.map((f) => [f.id, f]));
  const kindOf = new Map(doc.features.map((f) => [f.id, f.kind]));
  tr.features = tr.features.map((f) => {
    if (!plan.candidates.includes(f.id)) return f;
    const own = by2.get(f.id);
    if (!ownRefusalShown(kindOf.get(f.id), own)) return f;
    return { ...f, refusal: own.refusal, guard: own.guard, raw: `blocked (${f.refusal}); own refusal found by translating the script without the steps that were not built` };
  });
  return tr;
}
/** The layer's translation of `doc` without the features of `pre` (id -> { refusal, guard }), which are reported refused in doc order. */
async function translateWithout(doc, ctx, pre) {
  if (!pre.size) return layer.translateDoc(doc, ctx);
  // ctx.fromUsage is paired with the doc's drafts BY POSITION (shell-draft.ts fromGuard). A draft left out here (a G-STALE draft, a draft that reads a refused
  // sketch's part) would shift every later draft onto the record of the one before it, and G-FROM would judge it by the wrong word or by none: measured, a
  // from:'bottom' draft on a moved part was BUILT after a stale draft where the same draft alone is refused (HALT-9.md). The record is cut down with the doc.
  const drafts = doc.features.filter((f) => f.kind === 'draft');
  const fromUsage = Array.isArray(ctx.fromUsage) ? ctx.fromUsage.filter((_u, i) => drafts[i] && !pre.has(drafts[i].id)) : ctx.fromUsage;
  const tr = await layer.translateDoc({ ...doc, features: doc.features.filter((f) => !pre.has(f.id)) }, { ...ctx, fromUsage });
  const by = new Map(tr.features.map((f) => [f.id, f]));
  tr.features = doc.features.map((f) => (pre.has(f.id)
    ? { id: f.id, kind: f.kind, status: 'refused', refusal: pre.get(f.id).refusal, guard: pre.get(f.id).guard }
    : by.get(f.id))).filter(Boolean);
  return tr;
}
export const resolveAfter = layer.resolveAfter;
export const FEATURE_KINDS = layer.FEATURE_KINDS;
export { checkRules } from '../../../layer/dist/index.js';
