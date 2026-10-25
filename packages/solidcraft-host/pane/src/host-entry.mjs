// Host-origin modules ONLY: the solver, the sketch outline, the translator, the phase 2 sketch mapper helpers.
// reshape-script.ts is NOT here (it runs only in the sandboxed iframe, see runner-entry.mjs).
export { solveDoc } from '../../../script/dist/model-codegen.js';
export * as mt from '../../../script/dist/model-types.js';
export * as arc from '../../../sketch/dist/sketch-arc.js';
// The translator is the layer's: base + the extrude-pocket group's planners and guards (packages/layer, Phase 2 fold 1).
import { createTranslator } from '../../../layer/dist/index.js';
export { docProfileIndices } from '../../../layer/dist/index.js';
const layer = createTranslator({ planners: 'extrude-pocket' });
export const translateDoc = layer.translateDoc;
export const resolveAfter = layer.resolveAfter;
export const FEATURE_KINDS = layer.FEATURE_KINDS;
export { checkRules } from '../../../layer/dist/index.js';
