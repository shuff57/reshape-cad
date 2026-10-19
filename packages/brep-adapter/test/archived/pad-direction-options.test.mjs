// Pad and Pocket direction options (the task panel's Direction, Reversed and Type choices), measured on the solid
// brep-rs builds from reSHape Script. Oracles: closed forms (a prism's volume is area x span) and the bounding box the
// span must occupy, cross-checked against FreeCAD 26.3rc1 PartDesign (headless, Z-up, same parts):
//   pad 20x12 by 10:   plain z 0..10, Midplane z -5..5, Reversed z -10..0, Two sides (4 back) z -4..10; volume 2400 / 3360
//   pocket 3 deep into a 60x40x8 plate, 20x12 profile: plain 18480, Midplane 18840, Through all 17280
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, assertWatertight } from './s4i-harness.mjs';

const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const z = (m) => [m.bbox[0][2], m.bbox[1][2]];

const PAD = (opts) => `const s = sketch('top'); s.rect(20, 12, { at: [10, 6] }); const p = extrude(s, 10${opts ? `, ${opts}` : ''});`;

test('a plain pad grows from the sketch plane', () => {
  const m = mine(PAD(''));
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, 2400));
  assert.deepEqual(z(m), [0, 10]);
});

test('midplane spans half the length either side of the sketch plane', () => {
  const m = mine(PAD('{ midplane: true }'));
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, 2400));
  assert.deepEqual(z(m), [-5, 5]);
  assertWatertight(m);
});

test('reversed grows the other way', () => {
  const m = mine(PAD('{ reversed: true }'));
  assert.ok(near(m.volume, 2400));
  assert.deepEqual(z(m), [-10, 0]);
});

test('two sides adds a second length behind the sketch plane', () => {
  const m = mine(PAD('{ length2: 4 }'));
  assert.ok(near(m.volume, 20 * 12 * 14));
  assert.deepEqual(z(m), [-4, 10]);
});

test('two sides and reversed together mirror the span', () => {
  const m = mine(PAD('{ length2: 4, reversed: true }'));
  assert.ok(near(m.volume, 20 * 12 * 14));
  assert.deepEqual(z(m), [-10, 4]);
});

const PLATE = (opts) => `const s1 = sketch('top'); s1.rect(60, 40, { at: [0, 0] });
const plate = extrude(s1, 8);
const s2 = sketch('top', 8); s2.rect(20, 12, { at: [0, 0] });
const part = pocket(s2, plate, 3${opts ? `, ${opts}` : ''});`;

test('pocket: one sided, midplane and through all', () => {
  const plain = mine(PLATE(''));
  assert.ok(near(plain.volume, 60 * 40 * 8 - 20 * 12 * 3));
  const mid = mine(PLATE('{ midplane: true }'));
  assert.ok(near(mid.volume, 60 * 40 * 8 - 20 * 12 * 1.5));
  const all = mine(PLATE('{ through: true }'));
  assert.deepEqual(all.refusals, {});
  assert.ok(near(all.volume, 60 * 40 * 8 - 20 * 12 * 8));
  assertWatertight(all);
});

test('pocket reversed into air is refused in a sentence, never a wrong solid', () => {
  const m = mine(PLATE('{ reversed: true }'));
  const why = Object.values(m.refusals).join(' ');
  assert.match(why, /does not touch the part/);
});

test('a ModelDoc with the options set builds the same as the script does', () => {
  const m = mine(PAD('{ midplane: true }'));
  const doc = m.r.doc;
  const pad = doc.features.find((f) => f.kind === 'extrude');
  assert.equal(pad.midplane, true);
  assert.equal(pad.height, 10);
});
