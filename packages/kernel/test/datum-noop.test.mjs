// Datum Stage 3 (SPEC-datum-family.md section 5): a `datum` feature is a
// deliberate no-op in the kernel. It builds nothing, refuses nothing, and a doc
// with datums behaves exactly as the same doc without them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const box = { id: 'b1', kind: 'box', size: [10, 10, 10] };
const sk = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 20, points: [[0, 0], [5, 0], [5, 5], [0, 5]] };
const ex = { id: 'e1', kind: 'extrude', target: 'sk1', height: 4 };
const dat = (id = 'pl1') => ({ id, kind: 'datum', type: 'plane', plane: 'xy', offset: 5 });
const mk = (features) => JSON.stringify({ version: 1, features });
const build = (d) => JSON.parse(brep.build_doc_json(d));
const measure = (d) => JSON.parse(brep.measure_doc(d));

const base = [box, sk, ex];
const baseM = measure(mk(base));

test('baseline builds the extrude: 5*5*4 = 100', () => {
  assert.deepEqual(build(mk(base)).refusals, {});
  assert.ok(Math.abs(baseM.shapes.e1.volume - 100) < 1e-9);
});

for (const [label, feats] of [
  ['before everything', [dat(), box, sk, ex]],
  ['between box and sketch', [box, dat(), sk, ex]],
  ['between sketch and extrude', [box, sk, dat(), ex]],
  ['after everything', [box, sk, ex, dat()]],
  ['two datums', [dat('pl1'), box, dat('pl2'), sk, ex]],
]) {
  test(`datum ${label}: refusals {}, same volume/faces/bbox, no datum shape`, () => {
    const d = mk(feats);
    const b = build(d);
    assert.deepEqual(b.refusals, {});
    assert.deepEqual(b.built, ['b1', 'e1']);
    const m = measure(d);
    assert.deepEqual(m.refusals, {});
    assert.deepEqual(m.shapes, baseM.shapes);
    assert.ok(!('pl1' in m.shapes) && !('pl2' in m.shapes));
  });
}

test('mesh_feature and export_step of the extrude work with a datum present', () => {
  const d = mk([box, dat(), sk, ex]);
  const plain = mk(base);
  const mesh = JSON.parse(brep.mesh_feature(d, 'e1', 0.1));
  assert.equal(mesh.error, undefined);
  assert.deepEqual(mesh, JSON.parse(brep.mesh_feature(plain, 'e1', 0.1)));
  const step = brep.export_step(d, 'e1');
  assert.match(step, /ISO-10303-21/);
  assert.equal(step, brep.export_step(plain, 'e1'));
});

test('a doc of ONLY a datum builds nothing and refuses nothing', () => {
  const d = mk([dat()]);
  const b = build(d);
  assert.deepEqual(b.built, []);
  assert.deepEqual(b.refusals, {});
  const m = measure(d);
  assert.deepEqual(m.shapes, {});
  assert.deepEqual(m.refusals, {});
});

test("an unknown kind still refuses with the plain sentence (no-op is not a catch-all)", () => {
  const b = build(mk([box, dat(), { id: 'z1', kind: 'zzz' }]));
  assert.deepEqual(Object.keys(b.refusals), ['z1']);
  assert.equal(b.refusals.z1, "brep-rs does not build 'zzz' yet -- z1 is shown without it.");
  assert.deepEqual(b.built, ['b1']);
});

test("a sketch carrying onDatum builds exactly as without the field (kernel ignores it)", () => {
  const withField = mk([dat(), box, { ...sk, onDatum: 'pl1' }, ex]);
  const b = build(withField);
  assert.deepEqual(b.refusals, {});
  assert.deepEqual(measure(withField).shapes, baseM.shapes);
});
