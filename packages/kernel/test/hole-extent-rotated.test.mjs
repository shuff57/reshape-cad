// A turned box or cylinder reports the same extent the kernel's own bounding
// box does, along every axis, so a hole in it goes through or starts at the face.
// Measured on the real wasm; the formula is never its own oracle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { extentBoundAlong } = await import('@shuff57/reshape-script/model-types');

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} vs ${b}`);
const AX = ['x', 'y', 'z'];

const shapes = [
  ['box', 'const b = box(30, 20, 10); turn(b, [0, 0, 90])'],
  ['box', 'const b = box(30, 20, 10); turn(b, [30, 0, 0])'],
  ['box', 'const b = box(30, 20, 10); turn(b, [20, 35, 50])'],
  ['cylinder', 'const b = cylinder(8, 25); turn(b, [90, 0, 0])'],
  ['cylinder', 'const b = cylinder(8, 25); turn(b, [40, 0, 25])'],
  ['cylinder', 'const b = cylinder(8, 25); turn(b, [10, 70, 130])'],
];

for (const [kind, code] of shapes) {
  test(`${code}: extent matches the kernel bbox on x, y, z and is exact`, () => {
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const m = JSON.parse(brep.measure_doc(JSON.stringify(r.doc))).shapes[id];
    AX.forEach((ax, i) => {
      const e = extentBoundAlong(r.doc, id, ax);
      assert.ok(e && e.exact, `${ax} not exact for ${code}`);
      near(e.extent, m.bbox[1][i] - m.bbox[0][i]);
    });
  });
}

test('through hole and blind hole in a turned box are exact', () => {
  // 30 x 20 x 10 turned 90 about z is 20 x 30 x 10: z thickness stays 10.
  const t = runScript(`const b = box(30, 20, 10); turn(b, [0, 0, 90]); hole(b, { across: 4 })`);
  assert.deepEqual(t.errors, []);
  const id = t.doc.features.at(-1).id;
  const mt = JSON.parse(brep.measure_doc(JSON.stringify(t.doc))).shapes[id];
  near(mt.volume, 6000 - 10 * Math.PI * 4);
  assert.equal(mt.faces, 7);
  const b = runScript(`const b = box(30, 20, 10); turn(b, [0, 0, 90]); hole(b, { across: 4, deep: 4 })`);
  assert.deepEqual(b.errors, []);
  const refusals = JSON.parse(brep.build_doc_json(JSON.stringify(b.doc))).refusals;
  assert.deepEqual(refusals, {});
  const mb = JSON.parse(brep.measure_doc(JSON.stringify(b.doc))).shapes[b.doc.features.at(-1).id];
  near(mb.volume, 6000 - 4 * Math.PI * 4);
  assert.equal(mb.faces, 8); // open blind: 6 + wall + floor
});
