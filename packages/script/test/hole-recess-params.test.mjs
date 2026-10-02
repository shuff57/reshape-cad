// 2026-10-01 (Track A slice A2): the Dimensions panel could not see a recess.
//
// The studio does not edit a hole with inline inputs -- it edits one through
// generatedParams()'s scalar slots, which ReshapeParamsPanel renders. A recess
// has no slots, so a counterbore authored in a script (slice A1) built correctly
// in the kernel and was completely invisible and untunable in the UI: a student
// could not change it, and could not see what the shape actually had.
//
// `corners` is the precedent followed here -- an optional nested object surfaces
// slots ONLY when the field is present, so the panel never offers a recess the
// shape does not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatedParams, applyParam } from '../dist/model-codegen.js';

const BOX = { id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] };
const hole = (id, at, extra = {}) => ({
  id, kind: 'hole', target: 'b1', axis: 'z', center: at, diameter: 6, depth: 25, ...extra,
});
const docOf = (...holes) => ({ version: 1, features: [BOX, ...holes] });

const slot = (d, name) => generatedParams(d).find((p) => p.name === name);
const holeOf = (d, id) => d.features.find((f) => f.id === id);

test('a counterbore surfaces its two slots, named in the panel\'s own voice', () => {
  const d = docOf(hole('h1', [0, 0, 0], { counterbore: { diameter: 12, depth: 6 } }));
  const across = slot(d, 'h1_counterboreAcross');
  const deep = slot(d, 'h1_counterboreDeep');
  assert.ok(across, 'the recess must be visible or it cannot be edited');
  assert.equal(across.value, 12);
  assert.match(across.caption, /counterbore across/);
  assert.equal(deep.value, 6);
  assert.match(deep.caption, /counterbore deep/);
});

test('a countersink surfaces width and its INCLUDED angle, capped at 90', () => {
  const d = docOf(hole('h1', [0, 0, 0], { countersink: { diameter: 12, angleDeg: 90 } }));
  const angle = slot(d, 'h1_countersinkAngle');
  assert.ok(angle);
  assert.equal(angle.value, 90);
  assert.equal(angle.max, 90, 'an included angle cannot exceed 90');
});

test('a hole with NO recess gets no recess slots', () => {
  // The property that keeps the panel honest: offering a counterbore on a plain
  // hole would let a student set a number that silently does nothing.
  const d = docOf(hole('h1', [0, 0, 0]));
  const names = generatedParams(d).map((p) => p.name);
  assert.ok(!names.some((n) => n.includes('counterbore')), `unexpected slots: ${names}`);
  assert.ok(!names.some((n) => n.includes('countersink')));
});

test('editing one recess leaf leaves its sibling and the hole alone', () => {
  // The bug this catches is a spread that rebuilds the recess from two numbers and
  // drops the other, or that writes the value onto the hole instead of the recess.
  const d = docOf(hole('h1', [0, 0, 0], { counterbore: { diameter: 12, depth: 6 } }));
  const after = applyParam(d, 'h1_counterboreAcross', 14);
  assert.deepEqual(holeOf(after, 'h1').counterbore, { diameter: 14, depth: 6 });
  assert.equal(holeOf(after, 'h1').diameter, 6, 'the bore is not the recess');
  assert.equal(holeOf(after, 'h1').depth, 25, 'the bore depth is untouched');

  const deep = applyParam(d, 'h1_counterboreDeep', 3);
  assert.deepEqual(holeOf(deep, 'h1').counterbore, { diameter: 12, depth: 3 });
});

test('editing a countersink angle does not disturb its width', () => {
  const d = docOf(hole('h1', [0, 0, 0], { countersink: { diameter: 12, angleDeg: 90 } }));
  assert.deepEqual(holeOf(applyParam(d, 'h1_countersinkAngle', 60), 'h1').countersink,
    { diameter: 12, angleDeg: 60 });
  assert.deepEqual(holeOf(applyParam(d, 'h1_countersinkAcross', 16), 'h1').countersink,
    { diameter: 16, angleDeg: 90 });
});

test('a recess slot on a plain hole changes nothing at all', () => {
  // Belt and braces: if the slot is not generated, applyParam must not invent the
  // field either. Creating a recess behind the panel's back would be the exact
  // class of silent change this campaign keeps refusing.
  const d = docOf(hole('h1', [0, 0, 0]));
  assert.equal(applyParam(d, 'h1_counterboreAcross', 14), d);
});

test('the recess bounds do NOT clamp to the bore radius', () => {
  // A counterbore narrower than its bore is geometrically impossible, and by the
  // split pinned in slice A1 that is a KERNEL refusal, not a panel clamp. Clamping
  // here would silently substitute a different, buildable shape for the one the
  // student asked for -- the failure mode this campaign exists to prevent. So the
  // floor is an absolute one and the impossible value reaches the kernel.
  const d = docOf(hole('h1', [0, 0, 0], { counterbore: { diameter: 12, depth: 6 } }));
  const across = slot(d, 'h1_counterboreAcross');
  assert.ok(across.min < 6, `min ${across.min} must not sit at the bore radius 6`);
  assert.equal(across.min, 0.5);
});

test('two holes keep independent recesses', () => {
  // The panel edits the SELECTED feature, so a shared slot name would let editing
  // one hole's recess rewrite another's.
  const d = docOf(
    hole('h1', [0, 0, 0], { counterbore: { diameter: 12, depth: 6 } }),
    hole('h2', [20, 0, 0], { counterbore: { diameter: 20, depth: 10 } }),
  );
  const after = applyParam(d, 'h2_counterboreAcross', 24);
  assert.deepEqual(holeOf(after, 'h1').counterbore, { diameter: 12, depth: 6 });
  assert.deepEqual(holeOf(after, 'h2').counterbore, { diameter: 24, depth: 10 });
});
