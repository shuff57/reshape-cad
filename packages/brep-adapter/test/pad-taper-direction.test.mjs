// Pad / Pocket taper angle and custom direction, measured on the solid brep-rs builds from reSHape Script.
// Oracles are closed forms (the prismatoid rule for a ruled solid between two parallel outlines, area x height for a
// sheared prism) and the FreeCAD 26.3rc1 PartDesign numbers for the same 10 x 10 pad of length 10 (headless):
//   Taper 10: bbox -1.76327..11.7633 in x and y, z 0..10, volume 1394.1089
//   Custom direction (1,0,1), length along the sketch normal: x 0..20, z 0..10, volume 1000
//   Custom direction (1,0,1), length along the vector: x 0..17.0711, z 0..7.07107, volume 707.107
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, assertWatertight } from './s4i-harness.mjs';

const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const PAD = (opts) => `const s = sketch('top'); s.rect(10, 10, { at: [5, 5] }); const p = extrude(s, 10${opts ? `, ${opts}` : ''});`;

test('a positive taper grows the outline outward, as FreeCAD does', () => {
  const m = mine(PAD('{ taper: 10 }'));
  assert.deepEqual(m.refusals, {});
  const a = 10 * Math.tan((10 * Math.PI) / 180);
  assert.ok(near(m.bbox[0][0], -a) && near(m.bbox[1][0], 10 + a), JSON.stringify(m.bbox));
  const am = (10 + a) ** 2;
  assert.ok(near(m.volume, (10 / 6) * (100 + 4 * am + (10 + 2 * a) ** 2)), String(m.volume));
  assertWatertight(m);
});

test('a negative taper narrows it', () => {
  const m = mine(PAD('{ taper: -10 }'));
  assert.deepEqual(m.refusals, {});
  assert.deepEqual([m.bbox[0][0], m.bbox[1][0]], [0, 10]);
  assert.ok(m.volume < 1000);
});

test('a taper that folds the outline over is refused in a sentence, not built', () => {
  const m = mine(PAD('{ taper: -60 }'));
  assert.ok(Object.values(m.refusals).some((r) => /too steep/.test(String(r))), JSON.stringify(m.refusals));
});

test('a custom direction shears the prism; the length is measured along the normal by default', () => {
  const m = mine(PAD('{ direction: [1, 0, 1] }'));
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, 1000));
  assert.ok(near(m.bbox[1][0], 20) && near(m.bbox[1][2], 10), JSON.stringify(m.bbox));
  assertWatertight(m);
});

test('alongNormal false measures the length along the vector itself', () => {
  const m = mine(PAD('{ direction: [1, 0, 1], alongNormal: false }'));
  assert.ok(near(m.volume, 1000 * Math.SQRT1_2));
  assert.ok(near(m.bbox[1][2], 10 * Math.SQRT1_2), JSON.stringify(m.bbox));
});

test('a pocket takes a taper and a direction', () => {
  const PLATE = (o) => `const s1 = sketch('top'); s1.rect(60, 40, { at: [0, 0] }); const plate = extrude(s1, 8);
const s2 = sketch('top', 8); s2.rect(20, 12, { at: [0, 0] }); const part = pocket(s2, plate, 3, ${o});`;
  const plain = mine(PLATE('{}'));
  const tapered = mine(PLATE('{ taper: 15 }'));
  assert.deepEqual(tapered.refusals, {});
  assert.ok(tapered.volume < plain.volume, 'a widening cut removes more');
  const slanted = mine(PLATE('{ direction: [1, 0, -1] }'));
  assert.deepEqual(slanted.refusals, {});
  assert.ok(near(slanted.volume, plain.volume), 'an angled cut of the same depth removes the same volume');
});

test('a pocket taper has FreeCAD\'s sign and size: positive widens the cut, negative narrows it', () => {
  // FreeCAD 26.3rc1 headless, Pocket TaperAngle on a 60 x 40 x 8 plate with a 20 x 12 sketch on the top, depth 3
  // (the script is docs/replica/freecad/gauntlet/baseline/ref-pocket-taper.py):
  //   0 deg 18480 (19200 - 720), 15 deg 18400.245948869757, -15 deg 18554.58468371008, 11 faces each, bbox unchanged.
  // Closed form: the cut is a frustum, h/6 (A0 + 4 Am + A1) over its two outlines, each side growing by h tan(angle).
  const PLATE = (o) => `const s1 = sketch('top'); s1.rect(60, 40, { at: [0, 0] }); const plate = extrude(s1, 8);
const s2 = sketch('top', 8); s2.rect(20, 12, { at: [0, 0] }); const part = pocket(s2, plate, 3, ${o});`;
  const frustum = (deg) => {
    const a = 3 * Math.tan((deg * Math.PI) / 180);
    const area = (g) => (20 + 2 * g) * (12 + 2 * g);
    return (3 / 6) * (area(0) + 4 * area(a / 2) + area(a));
  };
  for (const [deg, freecad] of [[15, 18400.245948869757], [-15, 18554.58468371008], [0, 18480]]) {
    const m = mine(PLATE(deg === 0 ? '{}' : `{ taper: ${deg} }`));
    assert.deepEqual(m.refusals, {}, String(deg));
    assert.ok(near(m.volume, 19200 - frustum(deg), 1e-9), `${deg}: ${m.volume} vs closed form ${19200 - frustum(deg)}`);
    assert.ok(near(m.volume, freecad, 1e-9), `${deg}: ${m.volume} vs FreeCAD ${freecad}`);
    assert.deepEqual(m.bbox, [[-30, -20, 0], [30, 20, 8]], String(deg));
    assertWatertight(m);
  }
});
