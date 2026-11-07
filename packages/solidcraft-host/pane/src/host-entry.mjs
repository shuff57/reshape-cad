// Host-origin modules ONLY: the solver, the sketch outline, the translator, the phase 2 sketch mapper helpers.
// reshape-script.ts is NOT here (it runs only in the sandboxed iframe, see runner-entry.mjs).
export { solveDoc } from '../../../script/dist/model-codegen.js';
export * as mt from '../../../script/dist/model-types.js';
export * as arc from '../../../sketch/dist/sketch-arc.js';
// The translator is the layer's: the UNIFIED set (base + six groups' planners and guards, packages/layer Phase 2).
import { createTranslator } from '../../../layer/dist/index.js';
import { hostPreflight } from './host-guards.mjs';
export { hostPreflight, soupSolveVerdict, staleConsumers } from './host-guards.mjs';
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
};
/** The layer's translation of `doc` without the features of `pre` (id -> { refusal, guard }), which are reported refused in doc order. */
async function translateWithout(doc, ctx, pre) {
  if (!pre.size) return layer.translateDoc(doc, ctx);
  const tr = await layer.translateDoc({ ...doc, features: doc.features.filter((f) => !pre.has(f.id)) }, ctx);
  const by = new Map(tr.features.map((f) => [f.id, f]));
  tr.features = doc.features.map((f) => (pre.has(f.id)
    ? { id: f.id, kind: f.kind, status: 'refused', refusal: pre.get(f.id).refusal, guard: pre.get(f.id).guard }
    : by.get(f.id))).filter(Boolean);
  return tr;
}
export const resolveAfter = layer.resolveAfter;
export const FEATURE_KINDS = layer.FEATURE_KINDS;
export { checkRules } from '../../../layer/dist/index.js';
