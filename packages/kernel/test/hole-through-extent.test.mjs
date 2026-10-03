// hole() with no deep: must cut THROUGH. Measured on the real wasm against
// closed-form volumes (the old behaviour drilled a blind 10 mm hole).
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
  assert.deepEqual(r.errors, [], code);
  const doc = JSON.stringify(r.doc);
  const last = r.doc.features.at(-1).id; // shapes{} is keyed by id, sorted
  const m = JSON.parse(brep.measure_doc(doc));
  assert.deepEqual(JSON.parse(brep.build_doc_json(doc)).refusals, {});
  return m.shapes[last];
}
const hexArea = (R) => (3 * Math.sqrt(3) / 2) * R * R;

test('through hole in a 20 mm prism removes the whole length', () => {
  const s = measure('const p = prism(6, 10, 20); hole(p, { across: 4 })');
  const want = hexArea(5) * 20 - Math.PI * 4 * 20;
  assert.ok(Math.abs(s.volume - want) < 1e-6, `${s.volume} vs ${want}`);
});

test('through hole in a tall prism (40 mm) still goes all the way', () => {
  const s = measure('const p = prism(6, 10, 40); hole(p, { across: 4 })');
  const want = hexArea(5) * 40 - Math.PI * 4 * 40;
  assert.ok(Math.abs(s.volume - want) < 1e-6, `${s.volume} vs ${want}`);
});

test('through hole in a box is unchanged', () => {
  const s = measure('const b = cuboid(30, 20, 10); hole(b, { across: 4 })');
  assert.ok(Math.abs(s.volume - (6000 - Math.PI * 4 * 10)) < 1e-6);
});

test('wedge at moves the bbox by 50 in x and keeps the volume', () => {
  const s = measure('wedge(10, 20, 30, { at: [50, 0, 0] })');
  assert.ok(Math.abs(s.volume - 3000) < 1e-6);
  assert.ok(Math.abs(s.bbox[0][0] - 45) < 1e-9 && Math.abs(s.bbox[1][0] - 55) < 1e-9, JSON.stringify(s.bbox));
});

test('whole-body fillet of a box is still exact', () => {
  const s = measure('const b = cuboid(30, 20, 10); fillet(b, 3)');
  assert.ok(Math.abs(s.volume - 5572.619) < 0.01, String(s.volume));
});
