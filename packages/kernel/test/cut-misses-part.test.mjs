// A hole, pocket or groove whose tool never reaches the part must REFUSE with a
// plain sentence, not return the part unchanged with refusals {}. Positive
// controls on the same box still cut with closed-form volumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const box = { id: 'b1', kind: 'box', size: [40, 40, 20] }; // x,y +-20, z +-10
const rect = (plane, offset) => ({ id: 's1', kind: 'sketch', plane, offset, points: [[-5, -4], [5, -4], [5, 4], [-5, 4]] });
const pocket = (plane, offset) => [box, rect(plane, offset), { id: 'p1', kind: 'pocket', target: 's1', into: 'b1', depth: 5 }];
const hole = (extra) => [box, { id: 'h1', kind: 'hole', target: 'b1', diameter: 6, depth: 20, center: [0, 0, 0], axis: 'z', ...extra }];
function run(features, id) {
  const doc = JSON.stringify({ version: 1, features, measure: id });
  const refusals = JSON.parse(brep.build_doc_json(doc)).refusals ?? {};
  const m = JSON.parse(brep.measure_doc(doc));
  assert.equal(m.errors === undefined || m.errors.length === 0, true, JSON.stringify(m.errors));
  return { refusals, s: m.shapes?.[id] };
}
const miss = (id) => `${id} does not touch the part, so it cuts nothing -- ${id} is shown without it.`;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('hole far outside the box refuses', () => {
  const { refusals, s } = run(hole({ center: [100, 0, 0] }), 'h1');
  assert.equal(refusals.h1, miss('h1'));
  assert.equal(s, undefined);
});
test('holes pattern wholly outside the box refuses', () => {
  const { refusals, s } = run(hole({ center: [100, 0, 0], corners: { dx: 10, dy: 10 } }), 'h1');
  assert.equal(refusals.h1, miss('h1'));
  assert.equal(s, undefined);
});
for (const [plane, offset, why] of [['xy', 20, 'above the top face'], ['xy', 15, 'resting on the top face, zero overlap'], ['xz', 25, 'outward past the y=20 face'], ['xz', 20, 'outward, touching the y=20 face only']]) {
  test(`pocket on ${plane} at ${offset} (${why}) refuses`, () => {
    const { refusals, s } = run(pocket(plane, offset), 'p1');
    assert.equal(refusals.p1, miss('p1'));
    assert.equal(s, undefined);
  });
}
test('groove ring wholly beyond the y=20 face refuses', () => {
  const g = [box, { id: 's1', kind: 'sketch', plane: 'xz', offset: 0, points: [[3, 25], [6, 25], [6, 35], [3, 35]] }, { id: 'g1', kind: 'groove', target: 's1', into: 'b1', angle: 360 }];
  const { refusals, s } = run(g, 'g1');
  assert.equal(refusals.g1, miss('g1'));
  assert.equal(s, undefined);
});

// ---- positive controls on the same box -------------------------------------
test('control: through hole d6 cuts 32000 - pi*9*20', () => {
  const { refusals, s } = run(hole({}), 'h1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - Math.PI * 9 * 20);
});
test('control: hole at the edge region still cuts', () => {
  const { refusals, s } = run(hole({ center: [15, 0, 0] }), 'h1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - Math.PI * 9 * 20);
});
test('control: pocket from the top face cuts 32000 - 400, 11 faces', () => {
  const { refusals, s } = run(pocket('xy', 10), 'p1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 400);
  assert.equal(s.faces, 11);
});
test('control: pocket from the y=20 face (xz offset 15) cuts 32000 - 400', () => {
  const { refusals, s } = run(pocket('xz', 15), 'p1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 400);
});
