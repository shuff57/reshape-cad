// A 180-degree disc groove that crosses a face builds exactly (half disc cut by
// one chord through its centre); every other partial angle refuses plainly, and
// a partial groove that never reaches a face is still a sealed cavity.
// Hand-built docs on the real wasm (companion of pocket-groove-cavity-guard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const box = { id: 'b1', kind: 'box', size: [40, 40, 20] }; // x,y +-20, z +-10
const groove = (r1, v0, v1, angle, r0 = 0) => [
  box,
  { id: 's1', kind: 'sketch', plane: 'xz', offset: 0, points: [[r0, v0], [r1, v0], [r1, v1], [r0, v1]] },
  { id: 'g1', kind: 'groove', target: 's1', into: 'b1', angle },
];
function run(features) {
  const doc = JSON.stringify({ version: 1, features, measure: 'g1' });
  const refusals = JSON.parse(brep.build_doc_json(doc)).refusals ?? {};
  const m = JSON.parse(brep.measure_doc(doc));
  assert.equal(m.errors === undefined || m.errors.length === 0, true, JSON.stringify(m.errors));
  return { refusals, s: m.shapes?.g1 };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const sealed = /^groove g1 would leave a sealed cavity inside the part instead of opening onto a face -- g1 is shown without it\.$/;
const cannot = /^groove g1: brep-rs cannot cut this groove yet /;

test('180-degree disc groove r8 over y15..22 crosses the y=+20 face: 32000 - 160*pi', () => {
  const { refusals, s } = run(groove(8, 15, 22, 180));
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 160 * Math.PI);
  assert.equal(s.faces, 10); // 5 untouched box faces + pierced face + floor + wall + 2 diametral halves
  assert.equal(s.edges, 22);
});
test('180-degree disc groove r6 over y16..24 (straddles the face): 32000 - 72*pi', () => {
  const { refusals, s } = run(groove(6, 16, 24, 180));
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 72 * Math.PI);
});
for (const angle of [90, 270]) {
  test(`${angle}-degree disc groove across a face refuses plainly, no solid`, () => {
    const { refusals, s } = run(groove(8, 15, 22, angle));
    assert.match(refusals.g1, cannot);
    assert.equal(s, undefined);
  });
}
test('180-degree disc groove that never reaches a face is a sealed cavity: refuses', () => {
  const { refusals, s } = run(groove(6, 2, 10, 180));
  assert.match(refusals.g1, sealed);
  assert.equal(s, undefined);
});
test('180-degree ANNULAR groove across a face refuses plainly, no solid', () => {
  const { refusals, s } = run(groove(8, 15, 22, 180, 4));
  assert.match(refusals.g1, cannot);
  assert.equal(s, undefined);
});
