// A hole drilled into a pointed cone. The kernel carries a cylinder meeting a
// cone only where that meeting is a circle (the bore on the cone's own axis),
// or where it never happens (an off-axis bore that stays clear of the sloping
// wall). Everything else refuses in a sentence that says what to do instead.
// Closed forms are derived here, not read off the kernel: the removed volume is
// the integral of pi*min(r, R(z))^2 dz with R(z) = R(1 - z/H).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  const m = JSON.parse(brep.measure_doc(j));
  const last = r.doc.features.at(-1).id;
  return { refusals, s: m.shapes[last] ?? m.shapes[r.doc.features[0].id] }; // a refused hole leaves the target shown
}
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

// cone(20, 20): base diameter 20 (R = 10), height 20.
const R = 10, H = 20;
const coneTo = z => Math.PI * R * R * H / 3 * (1 - (1 - z / H) ** 3); // volume below height z
const whole = coneTo(H);
// left after a coaxial bore of radius r over heights [a, b] (0 = base)
function left(r, a, b) {
  a = Math.max(a, 0); b = Math.min(b, H);
  const zc = H * (1 - r / R);
  const cyl = (lo, hi) => (hi > lo ? Math.PI * r * r * (hi - lo) : 0);
  const cone = (lo, hi) => (hi > lo ? coneTo(hi) - coneTo(lo) : 0);
  return whole - cyl(a, Math.min(b, zc)) - cone(Math.max(a, zc), b);
}

test('through bore down the cone axis: exact, 3 faces, tip removed', () => {
  const { refusals, s } = build('const c = cone(20, 20); hole(c, { across: 4 })');
  assert.deepEqual(refusals, {});
  near(s.volume, left(2, -50, 80), 1e-9);
  assert.equal(s.faces, 3); // base annulus, bore wall, cone band
  near(s.bbox[1][2], -10 + H * (1 - 2 / R)); // the cone is cut off where it narrows to the bore
});

for (const [deep, faces] of [[6, 4], [18, 4]]) {
  test(`blind bore deep ${deep} from the tip end: exact`, () => {
    const { refusals, s } = build(`const c = cone(20, 20); hole(c, { across: 4, deep: ${deep} })`);
    assert.deepEqual(refusals, {});
    near(s.volume, left(2, H - deep, H), 1e-9);
    assert.equal(s.faces, faces);
  });
}

test('a bore across a cone, or one that meets the sloping wall off-axis, refuses and says how to drill it', () => {
  for (const code of [
    "const c = cone(20, 20); hole(c, { across: 2, along: 'x' })",
    'const c = cone(20, 20); hole(c, { across: 2, at: [3, 0], deep: 6 })',
  ]) {
    const { refusals, s } = build(code);
    assert.match(refusals.hole1, /down its own axis/, code);
    near(s.volume, whole); // shown without the hole: the cone, untouched
  }
});

test('the countersink on a box still builds (the cone tool was never the problem)', () => {
  const { refusals, s } = build('const b = box(30, 30, 10); hole(b, { across: 8, countersink: { across: 14, angle: 90 } })');
  assert.deepEqual(refusals, {});
  near(s.volume, 8355.973506014092, 1e-9);
});
