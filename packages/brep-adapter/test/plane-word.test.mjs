// Stage 2 of SPEC-datum-family on the real wasm: plane() word, measured.
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

test('40x25 rect pulled 12 on plane({origin z=10}): 12000, z in [10,22]', () => {
  const m = measure("const sk = sketch(plane({ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }))\nsk.rect(40, 25)\npull(sk, 12)");
  near(m.volume, 12000, 'volume');
  nearBox(m.bbox, [[-20, -12.5, 10], [20, 12.5, 22]], 'bbox');
});

test("plane('top',10) builds the same part as sketch('top',10)", () => {
  const a = measure("const sk = sketch('top', 10)\nsk.rect(40, 25)\npull(sk, 12)");
  const b = measure("const sk = sketch(plane('top', 10))\nsk.rect(40, 25)\npull(sk, 12)");
  near(b.volume, a.volume, 'volume');
  nearBox(b.bbox, a.bbox, 'bbox');
  near(b.volume, 12000, 'closed form');
});

test('handedness: front, plane(front) and the literal u=x,v=z frame agree (y in [-12,0])', () => {
  const body = (s) => `const sk = ${s}\nsk.rect(40, 25)\npull(sk, 12)`;
  const a = measure(body("sketch('front')"));
  const b = measure(body("sketch(plane('front'))"));
  const c = measure(body('sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] })'));
  const d = measure(body('sketch(plane({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] }))'));
  for (const m of [a, b, c, d]) {
    near(m.volume, 12000, 'volume');
    nearBox(m.bbox, a.bbox, 'bbox');
  }
  near(a.bbox[0][1], -12, 'y min');
  near(a.bbox[1][1], 0, 'y max');
});

test('swapped u,v mirrors: the part goes the other way (documented)', () => {
  const m = measure("const sk = sketch(plane({ origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] }))\nsk.rect(40, 25)\npull(sk, 12)");
  near(m.volume, 12000, 'volume');
  assert.ok(m.bbox[1][2] <= 1e-9 && Math.abs(m.bbox[0][2] + 12) < 1e-6, `z goes to -12: ${JSON.stringify(m.bbox)}`);
});

test('round trip through toScript emits the plane statement and measures the same', () => {
  const a = measure("const sk = sketch(plane({ origin: [5, 6, 7], u: [1, 0, 0], v: [0, 0, 1] }))\nsk.rect(30, 20)\npull(sk, 10)");
  const t = toScript(a.r.doc);
  assert.match(t, /const pl1 = plane\(\{ origin: \[5, 6, 7\]/);
  const b = measure(t);
  near(b.volume, a.volume, 'volume');
  nearBox(b.bbox, a.bbox, 'bbox');
});
