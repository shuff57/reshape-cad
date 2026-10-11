// A pattern of a pocket lowers to N copies of the CUT (a sketch + a pocket each), never to the whole-solid pattern
// feature, which would copy the disc and union the copies back over the holes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const HEAD = `const sk1 = sketch('top'); sk1.circle(60);
const disc = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.circle(6, { at: [20, 0] });
const holed = pocket(sk2, disc, 10);
`;
const kinds = (r) => r.doc.features.map((f) => f.kind);
const centres = (r) => r.doc.features.filter((f) => f.kind === 'sketch').slice(1).map((s) => {
  const [[x0, y0], [x1, y1]] = s.points;
  return [(x0 + x1) / 2, (y0 + y1) / 2].map((n) => Math.round(n * 1e9) / 1e9);
});

test('polarPattern of a pocket makes no pattern feature, only pockets at the rotated places', () => {
  const r = runScript(HEAD + `polarPattern(holed, { count: 4, axis: 'z', angle: 360 });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!kinds(r).includes('pattern'));
  assert.equal(kinds(r).filter((k) => k === 'pocket').length, 4);
  assert.deepEqual(centres(r).map((c) => c.map((n) => n + 0)), [[20, 0], [0, 20], [-20, 0], [0, -20]]);
  const ids = new Set(r.doc.features.map((f) => f.id));
  assert.equal(ids.size, r.doc.features.length);
  // each pocket cuts into the one before it, so nothing is refilled
  const pockets = r.doc.features.filter((f) => f.kind === 'pocket');
  for (let i = 1; i < pockets.length; i++) assert.equal(pockets[i].into, pockets[i - 1].id);
});

test('a partial-angle polarPattern of a pocket puts the last copy AT the end angle (angle / (count - 1), as FreeCAD does)', () => {
  const r = runScript(HEAD + `polarPattern(holed, { count: 3, axis: 'z', angle: 90 });`);
  assert.deepEqual(r.errors, []);
  const c = centres(r);
  assert.ok(Math.abs(c[1][0] - 20 * Math.cos(Math.PI / 4)) < 1e-9 && Math.abs(c[1][1] - 20 * Math.sin(Math.PI / 4)) < 1e-9);
  assert.ok(Math.abs(c[2][0]) < 1e-9 && Math.abs(c[2][1] - 20) < 1e-9);
});

test('round cuts turned about an axis that overlap each other are cut, as FreeCAD builds them', () => {
  // measured against FreeCAD 26.3: volume, and face count (9) of four through holes 12 across, 15 degrees apart
  const r = runScript(HEAD + `polarPattern(holed, { count: 4, axis: 'z', angle: 45 });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!kinds(r).includes('pattern'));
  assert.equal(kinds(r).filter((k) => k === 'pocket').length, 4);
});

test('a pattern whose cuts only just touch (a pinched web) is refused in a sentence', () => {
  // six holes 20 across on a ring of radius 20: neighbours are exactly 20 apart, so each web is a zero-width pinch
  const src = HEAD.replace('circle(6,', 'circle(20,') + `polarPattern(holed, { count: 6, axis: 'z', angle: 360 });`;
  const r = runScript(src);
  assert.equal(r.errors.length, 1);
  assert.match(JSON.stringify(r.errors), /overlap each other/);
});

test('a pattern whose cut reaches the rim of the part is refused in a sentence', () => {
  const src = HEAD.replace('at: [20, 0]', 'at: [28, 0]') + `polarPattern(holed, { count: 4, axis: 'z' });`;
  const r = runScript(src);
  assert.equal(r.errors.length, 1);
  assert.match(JSON.stringify(r.errors), /edge of the part/);
});

test('linearPattern of a pocket slides the cut', () => {
  const r = runScript(HEAD + `linearPattern(holed, { count: 3, step: [-14, 0, 0] });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!kinds(r).includes('pattern'));
  assert.deepEqual(centres(r), [[20, 0], [6, 0], [-8, 0]]);
});

test('a pocket whose plane the spin would tilt is refused in a sentence', () => {
  const src = `const sk1 = sketch('top'); sk1.circle(60);
const disc = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.circle(6, { at: [20, 0] });
const holed = pocket(sk2, disc, 10);
polarPattern(holed, { count: 4, axis: 'x' });`;
  const r = runScript(src);
  assert.equal(r.errors.length, 1);
  assert.match(JSON.stringify(r.errors), /cuts a copy of the pocket/);
});

test('a pattern of a plain solid is still the whole-solid pattern feature', () => {
  const r = runScript(`const b = cuboid(10, 10, 10); linearPattern(b, { count: 3, step: 20 });`);
  assert.deepEqual(r.errors, []);
  assert.ok(kinds(r).includes('pattern'));
});

// ---- holes and pads: the same rule, a pattern lowers to copies of the FEATURE ----
const DISC = `const s = sketch('top'); s.circle(60); const d = extrude(s, 10);\n`;
const holeCentres = (r) => r.doc.features.filter((f) => f.kind === 'hole').map((h) => h.center.slice(0, 2).map((n) => Math.round(n * 1e9) / 1e9 + 0));

test('polarPattern of a hole makes holes at the rotated places, never a pattern feature', () => {
  const r = runScript(DISC + `const h = hole(d, { across: 6, at: [20, 0] }); polarPattern(h, { count: 4, axis: 'z' });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!kinds(r).includes('pattern'));
  assert.deepEqual(holeCentres(r), [[20, 0], [0, 20], [-20, 0], [0, -20]]);
  const holes = r.doc.features.filter((f) => f.kind === 'hole');
  for (let i = 1; i < holes.length; i++) assert.equal(holes[i].target, holes[i - 1].id);
});

test('a partial-angle polarPattern of a hole ends AT the end angle', () => {
  const r = runScript(DISC + `const h = hole(d, { across: 6, at: [20, 0] }); polarPattern(h, { count: 3, axis: 'z', angle: 180 });`);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(holeCentres(r), [[20, 0], [0, 20], [-20, 0]]);
});

test('linearPattern of a hole slides the hole', () => {
  const r = runScript(DISC + `const h = hole(d, { across: 6, at: [-20, 0] }); repeat(h, { count: 3, step: [10, 5, 0] });`);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(holeCentres(r), [[-20, 0], [-10, 5], [0, 10]]);
});

test('holes that overlap, reach the rim, are stepped along the drill, or spun about another axis are refused in a sentence', () => {
  const cases = [
    [`hole(d, { across: 6, at: [20, 0] })`, `polarPattern(h, { count: 12, axis: 'z', angle: 45 })`, /overlap each other/],
    [`hole(d, { across: 6, at: [28, 0] })`, `polarPattern(h, { count: 4, axis: 'z' })`, /edge of the part/],
    [`hole(d, { across: 6, at: [20, 0] })`, `repeat(h, { count: 2, step: [0, 0, 5] })`, /drill direction/],
    [`hole(d, { across: 6, at: [20, 0] })`, `polarPattern(h, { count: 2, axis: 'x' })`, /tilt the drill/],
  ];
  for (const [mk, pat, re] of cases) {
    const r = runScript(DISC + `const h = ${mk}; ${pat};`);
    assert.equal(r.errors.length, 1, pat);
    assert.match(JSON.stringify(r.errors), re);
  }
});

test('polarPattern of a pad adds a pad at each place, never a pattern feature', () => {
  const r = runScript(DISC + `const t = sketch('top', 10); t.circle(6, { at: [20, 0] }); const u = join(d, pull(t, 5)); polarPattern(u, { count: 4, axis: 'z' });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!kinds(r).includes('pattern'));
  assert.equal(kinds(r).filter((k) => k === 'extrude').length, 5);
  assert.equal(kinds(r).filter((k) => k === 'combine').length, 4);
});

test('a pad pattern whose pads overlap, or whose pad leaves the base, is refused in a sentence', () => {
  let r = runScript(DISC + `const t = sketch('top', 10); t.circle(6, { at: [20, 0] }); const u = join(d, pull(t, 5)); polarPattern(u, { count: 4, axis: 'z', angle: 45 });`);
  assert.match(JSON.stringify(r.errors), /overlap each other/);
  r = runScript(DISC + `const t = sketch('top', 10); t.circle(6, { at: [28, 0] }); const u = join(d, pull(t, 5)); polarPattern(u, { count: 4, axis: 'z' });`);
  assert.match(JSON.stringify(r.errors), /edge of the part/);
});

// Circle copies that only touch (or all but touch) would leave a pinched zero-width web: refused in a sentence, not built.
for (const [name, step] of [['tangent', 6], ['near-tangent', 5.9999]]) {
  test(`pocket row of ${name} circles is refused`, () => {
    const r = runScript(`const plate = box(40, 20, 10);\nconst sk = sketch('top', 10); sk.circle(6, { at: [-9, 0] });\nconst p = pocket(sk, plate, 4);\nlinearPattern(p, { count: 4, step: ${step} });`);
    assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
    assert.match(r.errors[0].message, /overlap/);
  });
}
