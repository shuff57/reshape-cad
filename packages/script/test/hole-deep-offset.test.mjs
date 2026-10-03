// The axial component of a hole's center is derived from deep: + the thickness
// (blind hole starts at the +axis face); toScript must never leak it into at:.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '@shuff57/reshape-script/reshape-script';
import { toScript } from '@shuff57/reshape-script/reshape-script-gen';
import { applyParam, generatedParams } from '@shuff57/reshape-script/model-codegen';
import { holeAxialOffset, withHoleDepth } from '@shuff57/reshape-script/model-types';
import { featureCenter } from '@shuff57/reshape-script/model-handles';

const BOX = 'const b = cuboid(40, 40, 20); ';
const hole = (code) => {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  return { r, f: r.doc.features.at(-1) };
};

test('blind deep puts the axial offset at (thickness - deep) / 2', () => {
  assert.deepEqual(hole(BOX + 'hole(b, { across: 6, deep: 10 })').f.center, [0, 0, 5]);
  assert.deepEqual(hole(BOX + 'hole(b, { across: 6, deep: 4, at: [5, -3] })').f.center, [5, -3, 8]);
  assert.deepEqual(hole('const b = cuboid(40, 30, 20); hole(b, { across: 6, deep: 10, along: "x" })').f.center, [15, 0, 0]);
  assert.deepEqual(hole('const b = cuboid(40, 30, 20); hole(b, { across: 6, deep: 10, along: "y" })').f.center, [0, 10, 0]);
});

test('through holes keep a zero offset (deep == thickness, beyond, or absent)', () => {
  for (const o of ['', ', deep: 20', ', deep: 30']) {
    assert.deepEqual(hole(BOX + `hole(b, { across: 6${o} })`).f.center, [0, 0, 0], o);
  }
});

test('holes() gets the same offset', () => {
  assert.deepEqual(hole(BOX + 'holes(b, { across: 6, apart: [20, 20], deep: 10 })').f.center, [0, 0, 5]);
});

test('unknown thickness (turned box): deep keeps working (offset stays 0), as the pinned contract says', () => {
  const r = runScript('const t = cuboid(20, 20, 20); turn(t, [0, 90, 0]); hole(t, { across: 6, deep: 10 })');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.features.at(-1).center, [0, 0, 0]);
});

test('a pulled sketch has an exact thickness, so deep: starts at its top face', () => {
  const r = runScript("const sk = sketch('top'); sk.rect(20, 20); const e = extrude(sk, 20); hole(e, { across: 6, deep: 10 })");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.features.at(-1).center, [0, 0, 5]);
});

test('toScript does not leak the axial offset into at:, and the round trip is a fixpoint', () => {
  for (const code of [
    BOX + 'hole(b, { across: 6, deep: 10, at: [5, 5] })',
    BOX + 'hole(b, { across: 6, deep: 10 })',
    BOX + "hole(b, { across: 6, deep: 10, along: 'x', at: [2, 3] })",
    BOX + 'holes(b, { across: 6, apart: [20, 20], deep: 10 })',
  ]) {
    const r1 = runScript(code);
    const src = toScript(r1.doc);
    const r2 = runScript(src);
    assert.deepEqual(r2.errors, [], src);
    assert.deepEqual(r2.doc, r1.doc, src);
    assert.equal(toScript(r2.doc), src);
  }
  const src = toScript(runScript(BOX + 'hole(b, { across: 6, deep: 10, at: [5, 5] })').doc);
  assert.match(src, /at: \[5, 5\]/);
  assert.doesNotMatch(toScript(runScript(BOX + 'hole(b, { across: 6, deep: 10 })').doc), /at:/);
  assert.match(toScript(runScript(BOX + "hole(b, { across: 6, deep: 10, along: 'x', at: [2, 3] })").doc), /at: \[2, 3\]/);
});

test('an old doc (axial center 0, blind depth) still loads and builds; withHoleDepth fixes it up', () => {
  const { r, f } = hole(BOX + 'hole(b, { across: 6, deep: 10 })');
  const old = { ...r.doc, features: r.doc.features.map((x) => (x.id === f.id ? { ...x, center: [0, 0, 0] } : x)) };
  assert.equal(toScript(old), toScript(r.doc)); // same script: the offset is derived on reload
  assert.equal(withHoleDepth(old, old.features.at(-1), 10).center[2], 5);
});

test('changing depth through the panel keeps the offset in step; the axial slot is not offered', () => {
  const { r, f } = hole(BOX + 'hole(b, { across: 6, deep: 10 })');
  const d2 = applyParam(r.doc, `${f.id}_depth`, 4);
  assert.deepEqual(d2.features.at(-1).center, [0, 0, 8]);
  const d3 = applyParam(d2, `${f.id}_depth`, 25);
  assert.deepEqual(d3.features.at(-1).center, [0, 0, 0]);
  const names = generatedParams(r.doc).map((p) => p.name);
  assert.ok(!names.includes(`${f.id}_z`));
  assert.ok(names.includes(`${f.id}_x`) && names.includes(`${f.id}_y`));
  assert.equal(applyParam(r.doc, `${f.id}_z`, 99), r.doc);
});

test('the context-bar mouth is the drilled face, not double-counted', () => {
  const { r, f } = hole(BOX + 'hole(b, { across: 6, deep: 10, at: [5, 5] })');
  const m = featureCenter(f, r.doc);
  assert.deepEqual(m, [5, 5, 10]);
  const through = hole(BOX + 'hole(b, { across: 6, at: [5, 5] })');
  assert.deepEqual(featureCenter(through.f, through.r.doc), [5, 5, 10]);
});

test('holeAxialOffset: closed form', () => {
  const { r, f } = hole(BOX + 'hole(b, { across: 6, deep: 10 })');
  assert.equal(holeAxialOffset(r.doc, f.target, 'z', 6), 7);
  assert.equal(holeAxialOffset(r.doc, f.target, 'z', 20), 0);
});
