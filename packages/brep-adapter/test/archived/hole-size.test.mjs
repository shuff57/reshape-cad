// W-4 on the real wasm: size:'M6' (6.6 mm clearance) through a 40x40x20 block
// removes exactly pi * 3.3^2 * 20. Closed form, measured, never hardcoded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function measure(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  const doc = { version: 1, features: r.doc.features };
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  assert.deepEqual(out.refusals ?? {}, {});
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const id = r.doc.features.at(-1).id; // last FEATURE, not last map key
  return m.shapes[id].volume;
}

test("hole(b, { size: 'M6' }) removes pi * 3.3^2 * 20", () => {
  const v = measure("const b = cuboid(40, 40, 20)\nhole(b, { size: 'M6' })");
  const want = 32000 - Math.PI * 3.3 ** 2 * 20;
  assert.ok(Math.abs(v - want) < 1e-6, `${v} vs ${want}`);
});

test('size M6 and across 6.6 build the identical volume', () => {
  const a = measure("const b = cuboid(40, 40, 20)\nhole(b, { size: 'M6' })");
  const c = measure('const b = cuboid(40, 40, 20)\nhole(b, { across: 6.6 })');
  assert.equal(a, c);
});
