// TS-lane regressions: param()-bound circle/arc radius slots (g{id}r) exist in
// generatedParams and applyParam writes them back; wedge() refuses `at`
// (the kernel ignores a wedge's centre) instead of silently dropping it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { generatedParams, applyParam } from '../dist/model-codegen.js';

test('circle radius slot g1r is a generated param and applyParam updates it', () => {
  const r = runScript("const r = param('holeR', 7)\nconst s = sketch('top')\ns.geom([{ k:'circle', id:1, c:[0,0], r:r }])");
  assert.deepEqual(r.errors, []);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  const slot = generatedParams(r.doc).find((p) => p.name === `${sk.id}_g1r`);
  assert.ok(slot, 'no g1r slot');
  assert.equal(slot.value, 7);
  const next = applyParam(r.doc, slot.name, 11);
  const nsk = next.features.find((f) => f.id === sk.id);
  assert.equal(nsk.geoms[0].r, 11);
  assert.equal(nsk.geom[0].r, 11);
  assert.match(toScript(next, r.namedParams), /r:\s*holeR|r:\s*11/);
});

test('arc radius bound to param() round-trips with its declaration', () => {
  const src = "const r = param('arcR', 10)\nconst s = sketch('top')\ns.geom([{ k:'arc', id:1, c:[0,0], r:r, a:[10,0], b:[0,10], sense:'ccw' }])";
  const a = runScript(src);
  assert.deepEqual(a.errors, []);
  const first = toScript(a.doc, a.namedParams);
  assert.match(first, /param\('arcR', 10/);
  assert.match(first, /r:\s*arcR/);
  const b = runScript(first);
  assert.deepEqual(b.errors, [], JSON.stringify(b.errors));
  assert.equal(toScript(b.doc, b.namedParams), first);
});

test('wedge at option is honoured and round-trips', () => {
  const r = runScript('wedge(10, 20, 30, { at: [50, 0, 0] })');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.features[0].center, [50, 0, 0]);
  const text = toScript(r.doc, r.namedParams);
  assert.match(text, /wedge\(10, 20, 30, \{ at: \[50, 0, 0\] \}\)/);
  const b = runScript(text);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.doc.features[0].center, [50, 0, 0]);
});

test('box at round-trips too', () => {
  const r = runScript('cuboid(30, 20, 10, { at: [5, 0, 0] })');
  assert.deepEqual(r.errors, []);
  assert.match(toScript(r.doc, r.namedParams), /at: \[5, 0, 0\]/);
});

test('wedge placed with move() still works and round-trips', () => {
  const r = runScript('const w = wedge(10, 20, 30)\nmove(w, [50, 0, 0])');
  assert.deepEqual(r.errors, []);
  const b = runScript(toScript(r.doc, r.namedParams));
  assert.deepEqual(b.errors, []);
});

test('prism at moves the centre', () => {
  const r = runScript('prism(6, 10, 5, { at: [50, 0, 0] })');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.features[0].center, [50, 0, 0]);
});
