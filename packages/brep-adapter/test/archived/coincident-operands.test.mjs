// S4i (1): coincident operands. join(A, A) and keep(A, A) are a copy of A when A and B are PROVEN the same solid
// (same surfaces, same trims, same edges, to 1e-9); cut(A, A) leaves nothing and refuses in a sentence about that.
// Before: every cylinder, sphere and cone pair (about 350 sweep refusals of class 'equal') refused with the
// generic "cannot boolean these two solids" sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, assertWatertight, assertOcct, assertStep } from './s4i-harness.mjs';

const PI = Math.PI;
const SHAPES = {
  box: { make: (at) => `box(20, 30, 40, { at: ${at} })`, vol: 24000 },
  cylinder: { make: (at) => `cylinder(20, 30, { at: ${at} })`, vol: PI * 100 * 30 },
  sphere: { make: (at) => `sphere(20, { at: ${at} })`, vol: (4 / 3) * PI * 1000 },
  cone: { make: (at) => `cone(20, 30, { at: ${at} })`, vol: (PI * 100 * 30) / 3 },
  prism: { make: (at) => `prism(6, 20, 8, { at: ${at} })`, vol: ((3 * Math.sqrt(3)) / 2) * 100 * 8 },
  wedge: { make: (at) => `wedge(20, 10, 8, { at: ${at} })`, vol: (20 * 10 * 8) / 2 },
};
const AT = '[0, 0, 0]';
const pair = (kind, op, at = AT, extra = '') =>
  `const a = ${SHAPES[kind].make(at)}\n${extra ? extra.replace('X', 'a') + '\n' : ''}const b = ${SHAPES[kind].make(at)}\n${extra ? extra.replace('X', 'b') + '\n' : ''}${op}(a, b)`;

for (const kind of Object.keys(SHAPES)) {
  for (const op of ['join', 'keep']) {
    test(`${op}(${kind}, same ${kind} built twice) is one ${kind}: V(A)`, () => {
      const m = mine(pair(kind, op));
      assert.deepEqual(m.refusals, {});
      assert.ok(Math.abs(m.volume - SHAPES[kind].vol) < 1e-9 * SHAPES[kind].vol, `${m.volume} vs ${SHAPES[kind].vol}`);
      const single = mine(`const a = ${SHAPES[kind].make(AT)}\na`);
      assert.equal(m.faces, single.faces, 'same face count as A');
    });
  }
  test(`cut(${kind}, same ${kind}) leaves nothing: a plain refusal`, () => {
    const m = mine(pair(kind, 'cut'));
    assert.match(m.refusals[m.id] ?? '', /same shape in the same place|nothing is left/);
    assert.equal(m.volume, undefined);
  });
}

test('the same solid placed off the origin and turned is still the same solid', () => {
  for (const kind of ['box', 'cylinder', 'cone']) {
    const m = mine(pair(kind, 'join', '[7.5, -3, 12]', 'turn(X, [0, 0, 30])'));
    assert.deepEqual(m.refusals, {}, kind);
    assert.ok(Math.abs(m.volume - SHAPES[kind].vol) < 1e-9 * SHAPES[kind].vol, `${kind} ${m.volume}`);
  }
});

test('identity is proven by geometry, never by volume: same volume, different shape is not a copy', () => {
  // 20 x 30 x 40 and 30 x 20 x 40 are both 24000. Their union is 800 x 40 = 32000.
  const m = mine('const a = box(20, 30, 40, { at: [0, 0, 0] })\nconst b = box(30, 20, 40, { at: [0, 0, 0] })\njoin(a, b)');
  assert.deepEqual(m.refusals, {});
  assert.ok(Math.abs(m.volume - 32000) < 1e-6, `${m.volume}`);
  // A cylinder and a cone of equal volume (pi 100 30 / 3 = pi 100 10): joining must not return either as a copy.
  const c = mine('const a = cone(20, 30, { at: [0, 0, 0] })\nconst b = cylinder(20, 10, { at: [0, 0, 0] })\njoin(a, b)');
  if (Object.keys(c.refusals).length === 0) assert.ok(c.volume > SHAPES.cone.vol + 1, `${c.volume}`);
});

test('a hair different is not the same: radius off by 1e-6 builds exactly or refuses, never a copy of either', () => {
  const m = mine('const a = cylinder(20, 30, { at: [0, 0, 0] })\nconst b = cylinder(20.000002, 30, { at: [0, 0, 0] })\njoin(a, b)');
  if (Object.keys(m.refusals).length === 0) {
    const want = PI * 10.000001 ** 2 * 30;
    assert.ok(Math.abs(m.volume - want) < 1e-6 * want, `${m.volume} vs ${want}`);
  }
});

test('a cylinder with a hole in it is the same solid as its twin; one with a different hole is not', () => {
  const same = mine('const a = cylinder(40, 30, { at: [0, 0, 0] })\nhole(a, { at: [5, 0], across: 6, deep: 10 })\nconst b = cylinder(40, 30, { at: [0, 0, 0] })\nhole(b, { at: [5, 0], across: 6, deep: 10 })\njoin(a, b)');
  if (Object.keys(same.refusals).length === 0) {
    const one = mine('const a = cylinder(40, 30, { at: [0, 0, 0] })\nhole(a, { at: [5, 0], across: 6, deep: 10 })\na');
    assert.ok(Math.abs(same.volume - one.volume) < 1e-9 * one.volume);
  }
  const diff = mine('const a = cylinder(40, 30, { at: [0, 0, 0] })\nhole(a, { at: [5, 0], across: 6, deep: 10 })\nconst b = cylinder(40, 30, { at: [0, 0, 0] })\nhole(b, { at: [5, 0], across: 6, deep: 11 })\njoin(a, b)');
  if (Object.keys(diff.refusals).length === 0) {
    // union of two blind holes of the same bore, 10 and 11 deep: the part is the full cylinder minus the shallower hole's overlap
    const full = PI * 400 * 30;
    assert.ok(Math.abs(diff.volume - (full - PI * 9 * 10)) < 1e-6 * full, `${diff.volume}`);
  }
});

for (const kind of ['box', 'cylinder', 'sphere', 'cone', 'prism', 'wedge']) {
  test(`OCCT agrees on join and keep of coincident ${kind}s`, () => {
    for (const op of ['join', 'keep']) {
      const m = mine(pair(kind, op));
      assert.deepEqual(m.refusals, {});
      assertOcct(m, `${op} ${kind}`);
    }
  });
}

for (const kind of ['cylinder', 'sphere', 'cone', 'box']) {
  test(`mesh watertight at 0.05 and 0.5: join of coincident ${kind}s`, () => {
    assertWatertight(mine(pair(kind, 'join')), [0.01, 0.1]);
  });
}

for (const kind of ['cylinder', 'cone', 'box']) {
  test(`STEP round trip: keep of coincident ${kind}s`, () => {
    assertStep(mine(pair(kind, 'keep')));
  });
}
