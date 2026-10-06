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

// ---- turning a built-up shape (the owner's decision: allowed, in place, about its own centre) ----
import { toScript } from '../dist/reshape-script-gen.js';
import { generatedParams } from '../dist/model-codegen.js';

const BUILT = {
  'a drilled box': "let v = box(40, 30, 20)\nhole(v, { across: 6 })\nturn(v, [0, 90, 0])",
  'a rounded box': "let v = box(40, 30, 20)\nfillet(v.edge('top', 'front'), 2)\nturn(v, [0, 0, 45])",
  'a joined pair': "let a = box(20, 20, 20)\nlet b = cylinder(10, 30, { at: [0, 0, 20] })\nlet v = join(a, b)\nturn(v, [30, 0, 0])",
  'a mirrored box': "let v = box(20, 20, 20, { at: [30, 0, 0] })\nv = mirror(v, 'left-right')\nturn(v, [0, 0, 90])",
  'a prism': 'let v = prism(6, 20, 10)\nturn(v, [0, 30, 0])',
};
for (const [what, code] of Object.entries(BUILT)) {
  test(`turn() on ${what} adds one step that turns it`, () => {
    const r = runScript(code);
    assert.deepEqual(r.errors, [], what);
    const step = r.doc.features.filter((f) => f.kind === 'rotate');
    assert.equal(step.length, 1, 'exactly one rotate step');
    assert.equal(step[0].target, r.doc.features[r.doc.features.indexOf(step[0]) - 1]?.id ?? step[0].target);
    assert.ok(step[0].angles.some((a) => a !== 0));
  });
}

test('a turned plain box still turns itself and adds no step', () => {
  const r = runScript('let v = box(40, 30, 20)\nturn(v, [0, 90, 0])');
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.filter((f) => f.kind === 'rotate').length, 0);
  assert.deepEqual(r.doc.features[0].rotate, [0, 90, 0]);
});

test('a turn step is written back as turn(), and reads in again as the same document', () => {
  const r = runScript(BUILT['a drilled box']);
  const text = toScript(r.doc);
  assert.match(text, /turn\(\w+, \[0, 90, 0\]\)/);
  const again = runScript(text);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.doc.features.map((f) => f.kind), r.doc.features.map((f) => f.kind));
  assert.deepEqual(again.doc.features.find((f) => f.kind === 'rotate').angles, [0, 90, 0]);
});

test('a turn step carries three angle sliders', () => {
  const r = runScript(BUILT['a drilled box']);
  const names = generatedParams(r.doc).map((p) => p.name).filter((n) => /turn\d+_r[xyz]/.test(n));
  assert.equal(names.length, 3, names.join(','));
});

test('a flat sketch cannot be turned', () => {
  const r = runScript("const s = sketch('top')\ns.rect(10, 10)\nturn(s, [0, 0, 45])");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /turn\(\) needs a shape/);
});

test('a hole drilled after turning a built-up shape asks for a depth instead of guessing', () => {
  const r = runScript("let v = box(40, 30, 20)\nhole(v, { across: 6 })\nturn(v, [0, 90, 0])\nhole(v, { across: 3 })");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /cannot find how thick/);
});
