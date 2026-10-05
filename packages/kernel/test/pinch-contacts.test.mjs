// W4 pinch contacts: a result whose skin touches itself along a line or at a point is not a manifold solid.
// Two defects of S4i (section 34, "existing defects not changed"), plus the point and tangent-bore variants:
//   (1) a cylinder wholly inside a box that grazes its face from inside, cut from it: built as a sealed void.
//   (2) a cylinder joined to a box it touches from OUTSIDE along a line: built as two lumps meeting on a line.
// Both now refuse in a plain sentence. A genuine sealed void, a through cut, a face contact and a real overlap still build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, assertWatertight } from './s4i-harness.mjs';

const PI = Math.PI;
const PINCH = /touch/;
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1);
const refused = (m) => m.refusals[m.id] ?? '';

// ---- defect 1: grazing from inside -------------------------------------------------------------------------------
const BOX = 'const a = box(40, 40, 20, { at: [0, 0, 0] })\n';
const sideCyl = (dia, len, at, turn = '[0, 90, 0]') => `const c = cylinder(${dia}, ${len}, { at: [${at}] })\nturn(c, ${turn})\ncut(a, c)`;

test('a cylinder inside a box grazing its top face along a line refuses, in a sentence', () => {
  const m = mine(BOX + sideCyl(10, 30, '0, 0, 5'));
  assert.match(refused(m), PINCH, JSON.stringify(m.refusals));
});

test('the graze is found at any angle of the cylinder wall, not only where a sample point lies', () => {
  for (const len of [7, 13, 29, 31, 33.3]) {
    for (const x of [0, 1.7, -1.1]) {
      const m = mine(BOX + sideCyl(10, len, `${x}, 0, 5`));
      assert.match(refused(m), PINCH, `len ${len} x ${x}: ${JSON.stringify(m.refusals)}`);
    }
  }
});

test('grazing the bottom face, a face along y, and a vertical cylinder flush with a wall refuse', () => {
  for (const code of [
    BOX + sideCyl(10, 30, '0, 0, -5'),
    BOX + sideCyl(10, 30, '0, 0, 5', '[90, 0, 0]'),
    BOX + 'const c = cylinder(10, 10, { at: [15, 0, 0] })\ncut(a, c)',
  ]) {
    const m = mine(code);
    assert.match(refused(m), PINCH, `${code}\n${JSON.stringify(m.refusals)}`);
  }
});

test('a sphere inside a box touching its top face at one point refuses (point contact)', () => {
  const m = mine(BOX + 'const s = sphere(20, { at: [0, 0, 0] })\ncut(a, s)');
  assert.match(refused(m), PINCH, JSON.stringify(m.refusals));
});

test('a cylinder inside a round block, tangent to its wall from inside along a line, refuses', () => {
  const m = mine('const a = cylinder(40, 20, { at: [0, 0, 0] })\nconst c = cylinder(20, 10, { at: [10, 0, 0] })\ncut(a, c)');
  assert.match(refused(m), PINCH, JSON.stringify(m.refusals));
});

test('a cylinder tangent from inside the material to the wall of a bore: never built as a solid', () => {
  const m = mine(BOX + 'hole(a, { across: 20, deep: 20 })\nconst c = cylinder(8, 10, { at: [14, 0, 0] })\ncut(a, c)');
  assert.match(refused(m), /touch|brep-rs cannot/, `built, volume ${m.volume}`);
});

test('controls: a sealed void strictly inside, and a through cut, still build with the exact volume', () => {
  const v = mine(BOX + sideCyl(10, 30, '0, 0, 2'));
  assert.deepEqual(v.refusals, {});
  assert.ok(near(v.volume, 40 * 40 * 20 - PI * 25 * 30), `${v.volume}`);
  const t = mine(BOX + sideCyl(10, 60, '0, 0, 0'));
  assert.deepEqual(t.refusals, {});
  assert.ok(near(t.volume, 40 * 40 * 20 - PI * 25 * 40), `${t.volume}`);
  const s = mine(BOX + 'const s = sphere(10, { at: [0, 0, 0] })\ncut(a, s)');
  assert.deepEqual(s.refusals, {});
  assert.ok(near(s.volume, 32000 - (4 / 3) * PI * 125), `${s.volume}`);
  assertWatertight(v);
});

test('a gap of a thousandth of a millimetre is a real wall, not a graze', () => {
  const m = mine(BOX + sideCyl(10, 30, '0, 0, 4.999'));
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, 32000 - PI * 25 * 30), `${m.volume}`);
});

// A false alarm found by the sweep: a hollowed part with a bore. The cavity's end face has a round hole, and
// `plane_face_contains` misjudges points inside that hole; the contact search must not take them for contact.
test('hollowed boxes with a bore (a cavity with a tube cut out of it) are still built, never read as a pinch', () => {
  for (const code of [
    "let v = box(30.55, 52.25, 36.44, { at: [6.55, -2.33, 2.13] })\nhole(v, { across: 6.59, along: 'x' })\nhollow(v, { wall: 4.19 })",
    "let v = box(50.59, 37.59, 41.24, { at: [0.6, 7.14, -3.38] })\nhole(v, { across: 14.68, at: [-5.56, -0.42] })\nhollow(v, { wall: 4.75, open: 'top' })",
    "const b = box(40, 40, 20)\nhole(b, { across: 30 })\nhollow(b, { wall: 2 })",
  ]) {
    const m = mine(code);
    assert.deepEqual(m.refusals, {}, code);
  }
});

// Another false alarm class found by the sweep: a cutter wholly inside the part's outline that crosses a SMALL hole
// (the hole slips between the samples of the cutter's boundary, but not between those of the hole's own wall), and a
// cutter whose flat end lies on a hole's floor (a small area of contact, found by sliding rather than by a grid hit).
test('a cutter that crosses a small hole, or ends on its floor, is a real cut, not a pinch', () => {
  for (const code of [
    "const v = prism(8, 23.82, 11.78, { at: [0, 0, 0] })\nhole(v, { across: 2.55, at: [-1.46, -0.87], counterbore: { across: 3.97, deep: 5.4 } })\nconst p1 = cylinder(16.21, 7.23, { at: [0.65, 2.3, 0.58] })\ncut(v, p1)",
    "const v = cylinder(28.97, 49.02, { at: [-6.74, 3.08, 9.54] })\nhole(v, { across: 3.43, deep: 35.44 })\nconst p1 = prism(8, 17.19, 7.67, { at: [-5.61, 5.69, 5.98] })\ncut(v, p1)",
    "const v = box(41.17, 46.98, 39.24, { at: [5.95, 2.75, 7.52] })\nhole(v, { across: 4.3 })\nconst p1 = prism(4, 6.7, 10.62, { at: [4.86, -1.76, 3.61] })\nconst w = join(v, p1)\nconst p2 = cylinder(10.58, 10.75, { at: [5.9, 5.33, 9.8] })\ncut(w, p2)",
  ]) {
    const m = mine(code);
    assert.deepEqual(m.refusals, {}, code);
  }
});

// ---- defect 2: touching from outside ---------------------------------------------------------------------------
const BOX2 = 'const a = box(20, 20, 20, { at: [0, 0, 0] })\n';

test('join of a box and a cylinder that only touch along a line refuses, in a sentence', () => {
  const m = mine(BOX2 + 'const c = cylinder(20, 30, { at: [20, 0, 0] })\njoin(a, c)');
  assert.match(refused(m), PINCH, JSON.stringify(m.refusals));
});

test('join of two boxes that only share an edge, and of two that only share a corner, refuses', () => {
  const e = mine(BOX2 + 'const b = box(20, 20, 20, { at: [20, 20, 0] })\njoin(a, b)');
  assert.match(refused(e), PINCH, JSON.stringify(e.refusals));
  const c = mine(BOX2 + 'const b = box(20, 20, 20, { at: [20, 20, 20] })\njoin(a, b)');
  assert.match(refused(c), PINCH, JSON.stringify(c.refusals));
});

test('join of a box and a sphere that touch at one point refuses', () => {
  const m = mine(BOX2 + 'const s = sphere(20, { at: [20, 0, 0] })\njoin(a, s)');
  assert.match(refused(m), PINCH, JSON.stringify(m.refusals));
});

test('controls: joins that share an area or overlap build', () => {
  const face = mine(BOX2 + 'const b = box(20, 20, 20, { at: [20, 0, 0] })\njoin(a, b)');
  assert.deepEqual(face.refusals, {});
  assert.ok(near(face.volume, 16000), `${face.volume}`);
  const lap = mine(BOX2 + 'const c = cylinder(20, 30, { at: [15, 0, 0] })\njoin(a, c)');
  assert.deepEqual(lap.refusals, {});
  const bite = mine(BOX2 + 'const c = cylinder(20, 30, { at: [10, 0, 0] })\njoin(a, c)');
  assert.deepEqual(bite.refusals, {});
});

test('S4i tangent cases that are manifold by construction still build', () => {
  const half = mine('const a = cylinder(20, 30, { at: [0, 0, 0] })\nconst b = box(20, 20, 40, { at: [0, 10, 0] })\ncut(a, b)');
  assert.deepEqual(half.refusals, {});
  assert.ok(near(half.volume, (PI * 100 * 30) / 2), `${half.volume}`);
  const peg = mine('const a = box(40, 40, 20, { at: [0, 0, 0] })\nhole(a, { across: 8, deep: 10 })\nconst p = cylinder(8, 10, { at: [0, 0, 5] })\njoin(a, p)');
  assert.deepEqual(peg.refusals, {});
  assert.ok(near(peg.volume, 32000), `${peg.volume}`);
});
