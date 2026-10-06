// The language rules the owner settled for turn() and repeatAround() (2026-10-06, W7 of PLAN-kernel-next-2026-10-05.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

test('turning a ball is not an error: it is the same ball', () => {
  const plain = runScript('let v = sphere(20, { at: [5, 0, 0] })');
  const turned = runScript('let v = sphere(20, { at: [5, 0, 0] })\nturn(v, [0, 45, 0])');
  assert.deepEqual(turned.errors, []);
  assert.deepEqual(turned.doc.features, plain.doc.features, 'no step is added and the ball is untouched');
});

test('a turned ball can still be drilled', () => {
  const r = runScript('let v = sphere(20)\nturn(v, [10, 20, 30])\nhole(v, { across: 4, deep: 10 })');
  assert.deepEqual(r.errors, []);
  assert.ok(r.doc.features.some((f) => f.kind === 'hole'));
});

test('turn() still insists on three angles for a ball', () => {
  const r = runScript('let v = sphere(20)\nturn(v, [10, 20])');
  assert.equal(r.errors.length, 1);
});

test('repeatAround on a shape at the middle of the world names the fix', () => {
  const r = runScript("let v = box(10, 10, 10)\nrepeatAround(v, { count: 3, axis: 'z' })");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /nothing to spin around/);
  assert.match(r.errors[0].message, /move\(shape, \[30, 0, 0\]\)/);
});
