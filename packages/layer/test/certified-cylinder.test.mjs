// certifiedShape() on the measures SolidCraft 0.30.1 really reports for a plain cylinder (live host page, pinned engines, 2026-11-24).
// SolidCraft's box for a cylinder comes from its tessellation, out of square by 8.2e-6 to 1.14e-5; the spike's 1e-6 never certified one, so a full-turn groove
// on a cylinder's own axis was refused as off-axis (S_FULL). These pin that the measured cylinders now certify, that the groove cost rule then lets the
// coaxial groove through and still refuses an off-axis one, and that a box out of round, or a "cylinder" whose volume is wrong, is still not certified.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = await import(pathToFileURL(path.join(here, '../dist/revolve-groove-guard.js')).href);

// Measured on SolidCraft 0.30.1: cylinder(40, 60) at the origin, and cylinder(30, 40, { at: [17.3, -8.1, 5] }).
const measured = [
  { volume: 75389.52412139067, bbox: [-19.999691124264768, -19.99946267481286, -30.00000000000005, 19.999691124264764, 19.99946267481286, 30.000000000000014], faceTypes: { cylinder: 1, plane: 2 }, bodies: ['b_cyl1'] },
];
const R = 20; const H = 60;
const fake = (sq, volErr, R2 = R) => {
  const a = R2; const b = R2 * (1 - sq);
  return { volume: Math.PI * R2 * R2 * H * (1 - volErr), bbox: [-a, -b, -H / 2, a, b, H / 2], faceTypes: { cylinder: 1, plane: 2 }, bodies: ['b'] };
};

test('a cylinder as SolidCraft 0.30.1 measures it is certified', () => {
  for (const m of measured) {
    const c = g.certifiedShape(m);
    assert.equal(c?.kind, 'cylinder');
    assert.equal(c.axis, 2);
    assert.ok(Math.abs(c.R - R) < 1e-3);
  }
  // the measured range at every size: 8.2e-6 to 1.14e-5 out of square, volume within 1.22e-4
  for (const sq of [8.17e-6, 1.14e-5]) assert.equal(g.certifiedShape(fake(sq, 1.22e-4))?.kind, 'cylinder', `out of square by ${sq}`);
});

test('not round enough, or the wrong volume, is still not a cylinder', () => {
  assert.equal(g.certifiedShape(fake(2e-4, 1e-4)), null, 'out of square by 2e-4 (an oval) is not certified');
  assert.equal(g.certifiedShape(fake(1e-5, 5e-4)), null, 'a volume 5e-4 off the closed form is not certified');
  assert.equal(g.certifiedShape({ ...fake(1e-5, 1e-4), faceTypes: { cylinder: 1, plane: 2, cone: 1 } }), null, 'a cone face rules it out');
  assert.equal(g.certifiedShape({ ...fake(1e-5, 1e-4), bodies: ['a', 'b'] }), null, 'two pieces rule it out');
  assert.ok(g.ROUND_TOL >= 1e-4 / 1.0001 && g.ROUND_TOL <= 1e-4 * 1.0001, 'the tolerance is the documented 1e-4');
});

test('the groove cost rule: coaxial on a measured cylinder passes, off its axis is still refused', () => {
  const m = measured[0];
  const p = { umin: 16, umax: 24, vmin: 7, vmax: 13, scale: 24 };
  const sk = { id: 's', kind: 'sketch', plane: 'xy' };
  const arcFlat = { outlineOf: () => ({ ok: true, points: [[16, 7], [24, 7], [24, 13], [16, 13]], bulges: [0, 0, 0, 0] }), arcFromBulge: () => ({ center: [0, 0] }) };
  const on = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
  const off = { ...on, origin: [30, 0, 0] };
  const cOn = g.costFeatures(p, sk, arcFlat, on, m, 360);
  assert.equal(cOn.coaxial, true);
  assert.equal(g.costRefusal(cOn), null, 'a full-turn groove on the cylinder\'s own axis is not refused by the cost rule');
  const cOff = g.costFeatures(p, sk, arcFlat, off, m, 360);
  assert.equal(cOff.coaxial, false);
  assert.match(g.costRefusal(cOff) ?? '', /own axis/, 'off the axis it is still refused');
});
