// W-5 step 1 on the real wasm: handedness. Normal = u x v; the named planes
// deliberately do not go through a cross product (model-types.ts:155-168).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');

function measure(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  const doc = { version: 1, features: r.doc.features };
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  assert.deepEqual(out.refusals ?? {}, {}, 'no refusals');
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const s = m.shapes[r.doc.features.at(-1).id]; // last FEATURE, not last key
  return { volume: s.volume, bbox: s.bbox, r };
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const nearBox = (a, b, msg) => a.flat().forEach((x, i) => near(x, b.flat()[i], `${msg}[${i}]`));
const body = (s) => `pull(${s}.rect(30, 20), 10)`;

test("frame equal to 'top' = sketch('top'): same volume AND bbox", () => {
  const a = measure(body("sketch('top')"));
  const b = measure(body('sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] })'));
  near(b.volume, a.volume, 'volume');
  nearBox(b.bbox, a.bbox, 'bbox');
  near(b.volume, 6000, 'closed form 30*20*10');
});

test("frame u=x, v=z (normal u x v = -y) = sketch('front'): same volume AND bbox", () => {
  const a = measure(body("sketch('front')"));
  const b = measure(body('sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] })'));
  near(b.volume, a.volume, 'volume');
  nearBox(b.bbox, a.bbox, 'bbox');
});

test('an offset origin translates the part', () => {
  const b = measure(body('sketch({ origin: [5, 6, 7], u: [1, 0, 0], v: [0, 1, 0] })'));
  nearBox(b.bbox, [[-10, -4, 7], [20, 16, 17]], 'bbox');
});

test('a tilted frame gives the sheared-by-normal bbox', () => {
  const s = Math.SQRT1_2;
  const b = measure(body(`sketch({ origin: [0, 0, 0], u: [${s}, 0, ${s}], v: [0, 1, 0] })`));
  near(b.volume, 6000, 'volume');
  // normal = u x v = (-s, 0, s); the 30x20 rect spans +-15 along u, +-10 along y
  nearBox(b.bbox, [[-15 * s - 10 * s, -10, -15 * s], [15 * s, 10, 15 * s + 10 * s]], 'bbox');
});

test('swapping u and v flips the normal: the part goes to -z, it is NOT silently mirrored back', () => {
  const a = measure(body('sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] })'));
  const b = measure(body('sketch({ origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] })'));
  nearBox(a.bbox, [[-15, -10, 0], [15, 10, 10]], 'right-handed');
  nearBox(b.bbox, [[-10, -15, -10], [10, 15, 0]], 'u x v = -z');
});

test('round trip: framed sketch -> toScript -> runScript gives the same volume AND bbox', () => {
  const a = measure(body('sketch({ origin: [5, 6, 7], u: [1, 0, 0], v: [0, 0, 1] })'));
  const t = toScript(a.r.doc);
  const b = measure(t);
  near(b.volume, a.volume, 'volume');
  nearBox(b.bbox, a.bbox, 'bbox');
});
