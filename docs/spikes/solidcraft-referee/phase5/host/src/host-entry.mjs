// Host-origin modules ONLY: the solver, the sketch outline, the translator, the phase 2 sketch mapper helpers.
// reshape-script.ts is NOT here (it runs only in the sandboxed iframe, see runner-entry.mjs).
export { solveDoc } from '../../../../../../packages/script/dist/model-codegen.js';
export * as mt from '../../../../../../packages/script/dist/model-types.js';
export * as arc from '../../../../../../packages/sketch/dist/sketch-arc.js';
export { translateDoc, resolveAfter, FEATURE_KINDS } from '../translate-p4.mjs';
export { docProfileIndices } from '../../../phase2/sketch-map.mjs';
export { checkRules } from '../../../phase2/rule-check.mjs';
