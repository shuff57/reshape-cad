// Host-origin modules ONLY: the solver, the sketch outline, the translator, the phase 2 sketch mapper helpers.
// reshape-script.ts is NOT here (it runs only in the sandboxed iframe, see runner-entry.mjs).
export { solveDoc } from '../../../script/dist/model-codegen.js';
export * as mt from '../../../script/dist/model-types.js';
export * as arc from '../../../sketch/dist/sketch-arc.js';
// The translator is the layer's: the UNIFIED set (base + six groups' planners and guards, packages/layer Phase 2).
import { createTranslator } from '../../../layer/dist/index.js';
export { docProfileIndices } from '../../../layer/dist/index.js';
const layer = createTranslator({ planners: 'unified' });
// Student pilot: kinds whose guards are not folded in yet (Phase 2 "rest": blend-loft) are refused here in one sentence, not built.
const NOT_YET = {
  blend: 'a loft between two sketches is not available in this version yet, so {id} is shown without it.',
};
export const translateDoc = async (doc, ctx) => {
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
