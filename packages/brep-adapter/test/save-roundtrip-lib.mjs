// Save / reload / reopen (docs/PLAN-next.md "W4 save round trip"): the shared harness. A student's model is saved as
// its doc (JSON) or as its script text; both must come back as the SAME model. Pure helpers over the real interpreter,
// emitter and wasm; the corpora live in save-roundtrip.test.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
export const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
export const { runScript } = await import('@shuff57/reshape-script/reshape-script');
export const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');

/** Everything the kernel says about a doc: per-feature volume/bbox/faces/edges and the refusals. */
export const measure = (doc) => {
  const m = JSON.parse(brep.measure_doc(JSON.stringify({ version: 1, features: doc.features })));
  return { shapes: m.shapes ?? {}, refusals: m.refusals ?? {} };
};

/** First difference between two JSON-like values as a path + the two values, or null. */
export function firstDiff(a, b, at = '$', tol = 0) {
  if (a === b) return null;
  if (tol && typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))) return null;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object')
    return `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) {
    if (a[k] === undefined && b[k] === undefined) continue;
    // a rotate of [0,0,0] is the same as none (model-types.ts: "Absent means unrotated")
    if (k === 'rotate' && [a[k], b[k]].every((r) => r === undefined || (Array.isArray(r) && r.every((n) => n === 0)))) continue;
    const d = firstDiff(a[k], b[k], `${at}.${k}`, tol);
    if (d) return d;
  }
  return null;
}

/** The emitter writes dimensions to 1e-6 and sketch-row coordinates to 1e-9 (lit / lit9 in reshape-script-gen.ts), so the
 *  FIRST trip may move a number that far; the SECOND trip must move nothing (the text is a fixpoint). */
export const QUANT = 1e-6;

/**
 * script -> doc -> script -> doc -> script -> doc. Returns the problems found (empty = the round trip holds):
 *  - every run has no errors, and the emitted text is a fixpoint after one trip,
 *  - doc A and doc B agree to the emitter's rounding (features, ids, names, sketch rows, rules, geom, params),
 *  - doc B and doc C (a second trip) are bit-identical, and so is the kernel's measure of them,
 *  - the kernel's measure of A and B agrees to QUANT (volume, bbox, faces, edges, refusals),
 *  - the doc survives JSON.stringify/parse bit for bit and emits the same text from the parsed copy.
 */
export function roundTrip(code, { build = true } = {}) {
  const bad = [];
  const a = runScript(code);
  if (a.errors?.length) return { skipped: a.errors[0].message ?? JSON.stringify(a.errors[0]), bad };
  const text = toScript(a.doc, a.namedParams);
  const b = runScript(text);
  if (b.errors?.length) { bad.push(`emitted script does not run: ${b.errors[0].message}`); return { bad, text }; }
  const d = firstDiff(a.doc, b.doc, '$', QUANT);
  if (d) bad.push(`doc differs after toScript -> runScript: ${d}`);
  const text2 = toScript(b.doc, b.namedParams);
  if (text2 !== text) bad.push('toScript is not a fixpoint');
  const c = runScript(text2);
  const dc = c.errors?.length ? `second trip errors: ${c.errors[0].message}` : firstDiff(b.doc, c.doc);
  if (dc) bad.push(`second trip moved the doc: ${dc}`);
  const parsed = JSON.parse(JSON.stringify(a.doc));
  const dj = firstDiff(a.doc, parsed);
  if (dj) bad.push(`doc JSON round trip differs: ${dj}`);
  if (toScript(parsed, a.namedParams) !== text) bad.push('toScript(JSON.parse(JSON.stringify(doc))) differs from toScript(doc)');
  let m1 = null, m2 = null;
  if (build) {
    m1 = measure(a.doc);
    m2 = measure(b.doc);
    const dm = firstDiff(m1, m2, '$', QUANT);
    if (dm) bad.push(`kernel measure differs after the round trip: ${dm}`);
    if (!dc) { const d2 = firstDiff(m2, measure(c.doc)); if (d2) bad.push(`kernel measure moved on the second trip: ${d2}`); }
    const d3 = firstDiff(m1, measure(parsed));
    if (d3) bad.push(`kernel measure differs after the JSON round trip: ${d3}`);
  }
  return { bad, text, a, b, m1, m2 };
}
