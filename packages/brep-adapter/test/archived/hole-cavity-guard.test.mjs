// A hole whose tool lies wholly inside the part must REFUSE (sealed cavity),
// not build a closed inner shell. Hand-built docs on the real wasm; positive
// controls on the same box keep their closed-form volumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const box = { id: 'b1', kind: 'box', size: [40, 40, 20] };
const hole = (extra = {}) => ({ id: 'h1', kind: 'hole', target: 'b1', diameter: 6, depth: 10, center: [0, 0, 0], axis: 'z', ...extra });
function run(h) {
  const doc = JSON.stringify({ version: 1, features: [box, h], measure: 'h1' });
  const refusals = JSON.parse(brep.build_doc_json(doc)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(doc)).shapes?.h1;
  return { refusals, s };
}
const SENTENCE = /^hole h1 would leave a sealed cavity inside the part instead of opening onto a face -- h1 is shown without it\.$/;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

for (const axis of ['z', 'x', 'y']) {
  test(`centred blind-depth hole along ${axis} refuses`, () => {
    const { refusals } = run(hole({ axis }));
    assert.match(refusals.h1, SENTENCE);
  });
}
test('counterbore on a centred (sealed) bore refuses and builds no solid', () => {
  // The recess is measured from the face, so it is detached from the floating
  // bore; the existing recess-shape refusal catches it before the cavity guard.
  const { refusals, s } = run(hole({ counterbore: { diameter: 8, depth: 2 } }));
  assert.ok(refusals.h1, 'refused');
  assert.equal(s, undefined);
});
test('sealed holes pattern refuses', () => {
  assert.match(run(hole({ corners: { dx: 10, dy: 10 } })).refusals.h1, SENTENCE);
});
test('blind hole from the top face still builds: 8 faces, closed form', () => {
  const { refusals, s } = run(hole({ center: [0, 0, 5] }));
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 90 * Math.PI);
  assert.equal(s.faces ?? s.faceCount ?? s.face_count, 8);
});
test('through hole still builds', () => {
  const { refusals, s } = run(hole({ depth: 22 }));
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 180 * Math.PI);
});
