// The planar split-and-classify boolean (SPEC-brep-boolean-split-classify, S1):
// subtract from a part that is not convex. Every volume is a closed form, never
// a number read back from the kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(r.doc)));
  const id = r.doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(JSON.stringify(r.doc))).shapes[id];
  return { refusals: out.refusals, m };
}

const HOLLOW = 'const b = cuboid(40, 40, 20)\nshell(b, { wall: 2 })\n';
const CUP = "const b = cuboid(40, 40, 20)\nshell(b, { wall: 2, open: 'top' })\n";
const HALF = 'const c = cuboid(60, 30, 40, { at: [0, 15, 0] })\nsubtract(b, c)';

const cases = [
  ['hollow box cut in half through the cavity: exactly half of 11264', HOLLOW + HALF, 5632, 11],
  ['open cup (8672) cut in half', CUP + HALF, 4336, 10],
  ['open cup with a notch through one wall: 8672 - 2 x 10 x 6', CUP + 'const c = cuboid(10, 10, 6, { at: [20, 0, 0] })\nsubtract(b, c)', 8552, 15],
  ['hollow then chamfer 1.5 on a 40 edge: 11264 - 1/2 x 1.5^2 x 40', HOLLOW + "chamfer(b.edge('top', 'front'), 1.5)", 11219, 13],
  ['hollow then chamfer 3: the wedge stays inside the 2 mm wall zone', HOLLOW + "chamfer(b.edge('top', 'front'), 3)", 11084, 13],
];

for (const [name, code, volume, faces] of cases) {
  test(name, () => {
    const { refusals, m } = build(code);
    assert.deepEqual(refusals, {}, JSON.stringify(refusals));
    assert.ok(m, 'built');
    assert.ok(Math.abs(m.volume - volume) < 1e-6, `${m.volume} vs ${volume}`);
    assert.equal(m.faces, faces);
  });
}

const PI = Math.PI;
test('a round hole then a half cut through its axis: exactly half of 32000 - pi r^2 h (S2)', () => {
  const { refusals, m } = build('const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\n' + HALF);
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(m.volume - (32000 - PI * 36 * 20) / 2) < 1e-6, `${m.volume}`);
});

test('a blind hole then a half cut: exactly half of 32000 - pi r^2 d (S2)', () => {
  const { refusals, m } = build('const b = cuboid(40, 40, 20)\nhole(b, { across: 12, deep: 8 })\n' + HALF);
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(m.volume - (32000 - PI * 36 * 8) / 2) < 1e-6, `${m.volume}`);
});

test('a cutter that crosses only part of a bore wall refuses, in a sentence', () => {
  // 6 mm tall in z against a 20 mm tall bore wall: the cut ends inside the wall.
  const { refusals, m } = build('const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\nconst c = cuboid(60, 30, 6, { at: [0, 15, 0] })\nsubtract(b, c)');
  assert.ok(refusals.op1 && /cannot boolean these two solids/.test(refusals.op1), JSON.stringify(refusals));
  assert.equal(m, undefined);
});
