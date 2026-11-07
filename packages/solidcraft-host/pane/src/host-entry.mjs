// Host-origin modules ONLY: the solver, the sketch outline, the translator, the phase 2 sketch mapper helpers.
// reshape-script.ts is NOT here (it runs only in the sandboxed iframe, see runner-entry.mjs).
export { solveDoc } from '../../../script/dist/model-codegen.js';
export * as mt from '../../../script/dist/model-types.js';
export * as arc from '../../../sketch/dist/sketch-arc.js';
// The translator is the layer's: the UNIFIED set (base + six groups' planners and guards, packages/layer Phase 2).
import { createTranslator } from '../../../layer/dist/index.js';
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
export const translateDoc = async (doc, ctx0) => {
  const ctx = hostCtx(ctx0);
  const blocked = doc.features.filter((f) => NOT_YET[f.kind]);
  if (!blocked.length) return layer.translateDoc(doc, ctx);
  const ids = new Set(blocked.map((f) => f.id));
  const tr = await layer.translateDoc({ ...doc, features: doc.features.filter((f) => !ids.has(f.id)) }, ctx);
  const by = new Map(tr.features.map((f) => [f.id, f]));
  tr.features = doc.features.map((f) => (ids.has(f.id)
    ? { id: f.id, kind: f.kind, status: 'refused', refusal: NOT_YET[f.kind].replace('{id}', f.id), guard: 'PILOT-NOT-YET' }
    : by.get(f.id))).filter(Boolean);
  return tr;
};
export const resolveAfter = layer.resolveAfter;
export const FEATURE_KINDS = layer.FEATURE_KINDS;
export { checkRules } from '../../../layer/dist/index.js';
