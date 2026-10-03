// S-4: sk.slot(a, b, r) is INPUT-ONLY sugar. It expands at interpret time to
// the studio slot tool's rows (4 geometry + 8 rule); toScript emits those rows
// as geom([...]) / rules([...]) and never the word "slot" (SPEC-sketcher2 6.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { buildSlotRows } from '@shuff57/reshape-sketch/sketch-slot';

const sketchOf = (r) => r.doc.features.find((f) => f.kind === 'sketch');

test('slot expands to 4 geometry rows and 8 rule rows, same as the shared builder', () => {
  const r = runScript("sketch('top').slot([-20, 0], [20, 0], 5)");
  assert.deepEqual(r.errors, []);
  const s = sketchOf(r);
  const want = buildSlotRows([-20, 0], [20, 0], 5, 1);
  assert.equal(s.geoms.length, 4);
  assert.equal(s.rules.length, 8);
  assert.deepEqual(s.geoms, want.geoms);
  assert.deepEqual(s.rules, want.rules);
  assert.deepEqual(s.geoms.map((g) => g.id), [1, 2, 3, 4]);
  assert.ok(s.geoms.slice(0, 2).every((g) => g.k === 'arc' && g.sense === 'cw'));
});

test('ids continue after existing rows (dense, 1-based)', () => {
  const r = runScript("sketch('top').geom([{ k: 'point', id: 1, p: [0, 0] }, { k: 'point', id: 2, p: [1, 1] }]).slot([0, 0], [30, 0], 4)");
  assert.deepEqual(r.errors, []);
  const s = sketchOf(r);
  assert.deepEqual(s.geoms.map((g) => g.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(s.rules[0].a, 5); // top line = base + 2
});

test('toScript emits geom/rules rows, never the word slot, and reaches a fixpoint', () => {
  const r = runScript("const sk = sketch('top').slot([-20, 0], [20, 0], 5)\npull(sk, 10)");
  assert.deepEqual(r.errors, []);
  const t1 = toScript(r.doc);
  assert.match(t1, /geom\(\[/);
  assert.match(t1, /rules\(\[/);
  assert.doesNotMatch(t1, /slot/);
  const r2 = runScript(t1);
  assert.deepEqual(r2.errors, []);
  const t2 = toScript(r2.doc);
  assert.equal(t2, t1, 'D6 fixpoint');
  assert.deepEqual(sketchOf(r2).geoms, sketchOf(r).geoms);
  assert.deepEqual(sketchOf(r2).rules, sketchOf(r).rules);
});

test('param() radius is accepted and resolves on both arcs (same binding path as geom() arc/circle r)', () => {
  const r = runScript("const w = param('w', 5)\nconst sk = sketch('top').slot([-20, 0], [20, 0], w)\npull(sk, 10)");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(sketchOf(r).geoms.filter((g) => g.k === 'arc').map((g) => g.r), [5, 5]);
  const t = toScript(r.doc);
  assert.doesNotMatch(t, /slot/);
  assert.equal(toScript(runScript(t).doc), t);
});

test('error cases are plain sentences', () => {
  const bad = {
    'a equals b': "sketch('top').slot([0, 0], [0, 0], 5)",
    'zero radius': "sketch('top').slot([0, 0], [10, 0], 0)",
    'negative radius': "sketch('top').slot([0, 0], [10, 0], -3)",
    'string radius': "sketch('top').slot([0, 0], [10, 0], 'five')",
    'non-numeric centre': "sketch('top').slot(['x', 0], [10, 0], 5)",
    'centre not an array': "sketch('top').slot(3, [10, 0], 5)",
    'missing radius': "sketch('top').slot([0, 0], [10, 0])",
  };
  for (const [name, code] of Object.entries(bad)) {
    const r = runScript(code);
    assert.equal(r.errors.length, 1, name);
    assert.match(r.errors[0].message, /slot|radius|size|number/i, name);
  }
});
