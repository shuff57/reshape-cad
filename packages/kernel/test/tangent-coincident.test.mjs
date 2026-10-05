// S4i (2): tangent and coincident-surface booleans that the split-and-classify framework gets right by construction.
//   * a box face tangent to a cylinder wall (cylinder(20, 30) cut by a same-width box): the tangent line is an
//     ordinary grid line of the wall and an ordinary edge, never a slit. Closed form: disk-rectangle area x height.
//   * a peg joined into, cut from or kept in a hole of the SAME diameter: the two walls are one surface, OnOpposite
//     (a peg in a hole) or OnSame (two bores), classed per cell exactly like a coplanar face.
// What the framework cannot make a manifold from stays refused, in a sentence: a cylinder cut out of a solid that
// it touches from inside along a line (a tunnel that grazes the face), and a line contact between two lumps.
// OCCT is NOT the oracle for tangent joins (it returns negative or halved volumes there): closed forms are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diskRect } from './wrong-solid-sweep-oracle.mjs';
import { mine, assertWatertight, assertOcct, assertStep } from './s4i-harness.mjs';

const PI = Math.PI;
const R = 10, H = 30; // cylinder(20, 30) centred on the origin: z in [-15, 15]
const VC = PI * R * R * H;
const zOverlap = (z0, z1) => Math.max(0, Math.min(z1, H / 2) - Math.max(z0, -H / 2));

// box(sx, sy, sz) centred at (bx, by, bz) against the cylinder: closed forms for the three operations.
function expected(sx, sy, sz, bx, by, bz) {
  const inter = diskRect(R, bx - sx / 2, bx + sx / 2, by - sy / 2, by + sy / 2) * zOverlap(bz - sz / 2, bz + sz / 2);
  const vb = sx * sy * sz;
  return { cut: VC - inter, keep: inter, join: VC + vb - inter };
}
const script = (op, sx, sy, sz, bx, by, bz) =>
  `const a = cylinder(20, 30, { at: [0, 0, 0] })\nconst b = box(${sx}, ${sy}, ${sz}, { at: [${bx}, ${by}, ${bz}] })\n${op}(a, b)`;

// [name, sx, sy, sz, bx, by, bz]: every one has a box face tangent to the wall along a line (x = +-10 or y = +-10).
const TANGENT = [
  ['upper half, taller than the cylinder', 20, 20, 40, 0, 10, 0],
  ['lower half', 20, 20, 40, 0, -10, 0],
  ['upper half, flush with both caps', 20, 20, 30, 0, 10, 0],
  ['right half (tangent y = +-10)', 20, 20, 40, 10, 0, 0],
  ['left half, flush with both caps', 20, 20, 30, -10, 0, 0],
  ['upper half, only the middle 10 of the height', 20, 20, 10, 0, 10, 0],
  ['upper half, flush with the top cap only', 20, 20, 10, 0, 10, 10],
  ['wider than the cylinder (not tangent), as a control', 40, 20, 40, 0, 10, 0],
];
const MUST_BUILD = new Set([TANGENT[0][0], TANGENT[1][0], TANGENT[2][0], TANGENT[3][0], TANGENT[4][0], TANGENT[7][0]]);

for (const [name, ...box] of TANGENT) {
  for (const op of ['cut', 'keep', 'join']) {
    test(`tangent box (${name}): ${op} is the closed form or a plain refusal`, () => {
      const m = mine(script(op, ...box));
      const want = expected(...box)[op];
      if (Object.keys(m.refusals).length) {
        assert.ok(!MUST_BUILD.has(name), `must build: ${JSON.stringify(m.refusals)}`);
        assert.match(m.refusals[m.id], /brep-rs cannot|shown without it/);
        return;
      }
      assert.ok(Math.abs(m.volume - want) <= 1e-9 * Math.max(want, 1), `${m.volume} vs ${want}`);
    });
  }
}

test('the headline case: cylinder(20, 30) cut by a same-width box is exactly half a cylinder', () => {
  const m = mine(script('cut', 20, 20, 40, 0, 10, 0));
  assert.deepEqual(m.refusals, {});
  assert.ok(Math.abs(m.volume - (PI * 100 * 30) / 2) < 1e-9 * VC, `${m.volume}`);
  assert.ok(m.faces >= 3, `faces ${m.faces}`); // half wall + flat face + two caps
});

test('a box touching a cylinder from OUTSIDE along a line: cut changes nothing, a join would hold a line contact', () => {
  const cut = mine('const a = cylinder(20, 30, { at: [0, 0, 0] })\nconst b = box(20, 20, 40, { at: [20, 0, 0] })\ncut(a, b)');
  assert.deepEqual(cut.refusals, {});
  assert.ok(Math.abs(cut.volume - VC) < 1e-9 * VC);
  // W4: the join of a plain cylinder with a box meeting it along a line used to be a legacy two-lump build; it now
  // refuses in a sentence, as a cylinder that carries a hole always did (the planar path must not build a line contact).
  const plain = mine('const a = cylinder(20, 30, { at: [0, 0, 0] })\nconst b = box(20, 20, 40, { at: [20, 0, 0] })\njoin(a, b)');
  assert.match(plain.refusals[plain.id] ?? '', /only touch along a line or at a point/);
  const j = mine('const a = cylinder(20, 30, { at: [0, 0, 0] })\nhole(a, { across: 4, deep: 10 })\nconst b = box(20, 20, 40, { at: [20, 0, 0] })\njoin(a, b)');
  if (Object.keys(j.refusals).length === 0) {
    const want = VC - PI * 4 * 10 + 20 * 20 * 40;
    assert.ok(Math.abs(j.volume - want) < 1e-6 * want, `${j.volume} vs ${want}`);
    assertWatertight(j);
  } else assert.match(j.refusals[j.id], /only touch along a line or at a point|brep-rs cannot/);
});

test('a cylinder cut out of a box it grazes from inside along a line (a tunnel) refuses', () => {
  const m = mine('const a = box(40, 40, 20, { at: [0, 0, 0] })\nconst c = cylinder(10, 50, { at: [0, 0, 5] })\nturn(c, [0, 90, 0])\ncut(a, c)');
  assert.match(m.refusals[m.id] ?? '', /brep-rs cannot/);
  const h = mine('const a = box(40, 40, 20, { at: [0, 0, 0] })\nhole(a, { across: 10, at: [15, 0] })');
  assert.match(h.refusals[h.id] ?? '', /cannot cut this hole/);
});

// Random tangent boxes: a face at x = +-r or y = +-r, the other extents and the z range random. Exact or refused, never wrong.
test('250 random tangent boxes (3 operations each): exact against the closed form or refused, none wrong', () => {
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let built = 0, refused = 0;
  for (let i = 0; i < 250; i++) {
    const r = 5 + Math.floor(rnd() * 15), h = 10 + Math.floor(rnd() * 30);
    const axis = rnd() < 0.5 ? 0 : 1, side = rnd() < 0.5 ? -1 : 1;
    const w = 1 + Math.floor(rnd() * 3 * r), len = 2 + Math.floor(rnd() * 3 * r); // extent along the tangent normal, along the other axis
    const off = Math.round((rnd() - 0.5) * 2 * r);
    const sz = 5 + Math.floor(rnd() * 2 * h), bz = Math.round((rnd() - 0.5) * h);
    const sx = axis === 0 ? w : len, sy = axis === 0 ? len : w;
    // one face of the box is the tangent plane at coordinate -side*r, and the box extends from it toward +side
    const c = [0, 0];
    c[axis] = -side * r + (side * w) / 2;
    c[1 - axis] = off;
    const code = (op) => `const a = cylinder(${2 * r}, ${h}, { at: [0, 0, 0] })\nconst b = box(${sx}, ${sy}, ${sz}, { at: [${c[0]}, ${c[1]}, ${bz}] })\n${op}(a, b)`;
    const inter = diskRect(r, c[0] - sx / 2, c[0] + sx / 2, c[1] - sy / 2, c[1] + sy / 2) * Math.max(0, Math.min(bz + sz / 2, h / 2) - Math.max(bz - sz / 2, -h / 2));
    const vc = PI * r * r * h, vb = sx * sy * sz;
    for (const [op, want] of [['cut', vc - inter], ['keep', inter], ['join', vc + vb - inter]]) {
      const m = mine(code(op));
      if (Object.keys(m.refusals).length) { refused++; continue; }
      built++;
      assert.ok(Math.abs(m.volume - want) <= 1e-8 * Math.max(want, vc), `#${i} ${op} r=${r} h=${h} box ${sx}x${sy}x${sz}@${c},${bz}: ${m.volume} vs ${want}\n${code(op)}`);
    }
  }
  console.log(`random tangent boxes: built ${built}, refused ${refused}`);
  assert.ok(built >= 100, `only ${built} built`);
});

// ---- the peg in a hole of the same diameter -------------------------------------------------------------------
const BOX = 'const a = box(40, 40, 20, { at: [0, 0, 0] })';
const BLIND = `${BOX}\nhole(a, { across: 10, deep: 12 })`; // z from -2 to 10
const THRU = `${BOX}\nhole(a, { across: 10 })`;
const PEG = (h, z) => `const p = cylinder(10, ${h}, { at: [0, 0, ${z}] })`;
const A = 40 * 40 * 20, PA = PI * 25;
const PEGS = [
  ['blind hole, peg flush with the top and the floor', BLIND, PEG(12, 4), 'join', A],
  ['blind hole, peg flush, cut leaves the hole', BLIND, PEG(12, 4), 'cut', A - PA * 12],
  ['blind hole, peg sticking out 4 above', BLIND, PEG(16, 6), 'join', A + PA * 4],
  ['blind hole, peg sinking 4 below the floor into the material', BLIND, PEG(16, 2), 'join', A],
  ['blind hole, peg 8 long stopping flush with the top', BLIND, PEG(8, 6), 'join', A - PA * 12 + PA * 8],
  ['blind hole, peg 4 long floating mid-hole', BLIND, PEG(4, 4), 'join', A - PA * 12 + PA * 4],
  ['through hole, peg flush with both faces', THRU, PEG(20, 0), 'join', A],
  ['through hole, peg through and 10 out each side', THRU, PEG(40, 0), 'join', A + PA * 20],
  ['through hole, shorter peg inside', THRU, PEG(12, 0), 'join', A - PA * 20 + PA * 12],
  ['through hole, tall peg cut', THRU, PEG(40, 0), 'cut', A - PA * 20],
  ['through hole, peg flush, cut leaves the hole', THRU, PEG(20, 0), 'cut', A - PA * 20],
];
for (const [name, base, peg, op, want] of PEGS) {
  test(`peg in a same-diameter hole: ${name} (${op})`, () => {
    const m = mine(`${base}\n${peg}\n${op}(a, p)`);
    assert.deepEqual(m.refusals, {});
    assert.ok(Math.abs(m.volume - want) <= 1e-9 * want, `${m.volume} vs ${want}`);
  });
}

test('peg in a same-diameter hole: keep is the empty set, a plain refusal', () => {
  const m = mine(`${BLIND}\n${PEG(12, 4)}\nkeep(a, p)`);
  assert.ok(m.refusals[m.id], 'refused');
  assert.equal(m.volume, undefined);
});

test('a peg of a DIFFERENT diameter still refuses or is exact (never the coincident rule by volume)', () => {
  const m = mine(`${BLIND}\nconst p = cylinder(9.5, 12, { at: [0, 0, 4] })\njoin(a, p)`);
  if (Object.keys(m.refusals).length === 0) assert.ok(Math.abs(m.volume - (A - PA * 12 + PI * 9.5 * 9.5 / 4 * 12)) < 1e-6 * A, `${m.volume}`);
});

// ---- the referee: OCCT where OCCT is right ---------------------------------------------------------------------
const OCCT_OK = [
  ['tangent upper half cut', script('cut', 20, 20, 40, 0, 10, 0)],
  ['tangent lower half cut', script('cut', 20, 20, 40, 0, -10, 0)],
  ['tangent upper half keep', script('keep', 20, 20, 40, 0, 10, 0)],
  ['tangent right half cut', script('cut', 20, 20, 40, 10, 0, 0)],
  ['tangent flush half cut', script('cut', 20, 20, 30, -10, 0, 0)],
  ['wide control cut', script('cut', 40, 20, 40, 0, 10, 0)],
  ['peg flush join', `${BLIND}\n${PEG(12, 4)}\njoin(a, p)`],
  ['peg flush cut', `${BLIND}\n${PEG(12, 4)}\ncut(a, p)`],
  ['peg out join', `${BLIND}\n${PEG(16, 6)}\njoin(a, p)`],
  ['through peg join', `${THRU}\n${PEG(40, 0)}\njoin(a, p)`],
  ['through peg flush join', `${THRU}\n${PEG(20, 0)}\njoin(a, p)`],
];
for (const [name, code] of OCCT_OK) {
  test(`OCCT agrees: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {}, name);
    assertOcct(m, name);
  });
}

test('OCCT is wrong where it is wrong: a tangent join, brep-rs matches the closed form', () => {
  const m = mine(script('join', 20, 20, 40, 0, 10, 0));
  const want = expected(20, 20, 40, 0, 10, 0).join;
  if (Object.keys(m.refusals).length === 0) assert.ok(Math.abs(m.volume - want) <= 1e-9 * want, `${m.volume} vs ${want}`);
});

for (const [name, code] of [
  ['half cylinder', script('cut', 20, 20, 40, 0, 10, 0)],
  ['half cylinder flush caps', script('cut', 20, 20, 30, 0, -10, 0)],
  ['tangent join flush', script('join', 20, 20, 30, 0, 10, 0)],
  ['peg flush join', `${BLIND}\n${PEG(12, 4)}\njoin(a, p)`],
  ['peg out join', `${BLIND}\n${PEG(16, 6)}\njoin(a, p)`],
  ['through peg join', `${THRU}\n${PEG(40, 0)}\njoin(a, p)`],
]) {
  test(`mesh watertight at 0.05 and 0.5: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {});
    assertWatertight(m, [0.01, 0.1]);
  });
}

for (const [name, code] of [
  ['half cylinder', script('cut', 20, 20, 40, 0, 10, 0)],
  ['peg out join', `${BLIND}\n${PEG(16, 6)}\njoin(a, p)`],
  ['through peg join', `${THRU}\n${PEG(40, 0)}\njoin(a, p)`],
]) {
  test(`STEP round trip: ${name}`, () => {
    assertStep(mine(code));
  });
}
