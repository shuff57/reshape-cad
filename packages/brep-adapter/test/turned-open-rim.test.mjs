// W3: a rounded rim at the OPEN end of a hollowed cylinder (S4f refused "a rounded rim at the open end").
//
// Semantics, by the CAD convention of a shell with its end face removed: the cavity wall runs flush up to the open
// plane, and round(v.edge('top', 'side'), r) rounds the OUTER rim of the lip only (the inner lip edge is a separate
// edge, and the script language names no bore or cavity edge). The lip keeps a flat of width (wall - r) between the
// round and the cavity, so the order does not matter: round then hollow == hollow then round. A round as wide as the
// wall, or wider, would eat the lip: refused in a sentence.
//
// Oracles, none of them the code under test:
//   Pappus     V = pi R^2 H - 2 pi (rho-bar) A_corner - pi (R - w)^2 (H - w)   (corner square less quarter disc)
//   field      an independent 2D grid over the (rho, z) half plane of the INTENDED membership ("inside the
//              rounded outer profile and not in the cavity cylinder"), integrated with Pappus weights: no formula
//              of the kernel and none of the closed form above is used
//   mesh       closed at 0.05 and 0.5, the volume it encloses within chord error
//   OpenCascade  where its shell agrees (it does for an open rounded rim: it extends the cavity wall too)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, occt, assertWatertight, brep } from './s4i-harness.mjs';

const PI = Math.PI;
const R = 20;
const ring = (rho, r, sign) => {
  const A = (1 - PI / 4) * r * r;
  const square = rho + (sign * r) / 2;
  const disc = rho + sign * (r - (4 * r) / (3 * PI));
  return 2 * PI * ((r * r * square - ((PI * r * r) / 4) * disc) / A) * A;
};
const cyl = (d, h) => `let v = cylinder(${d}, ${h})\n`;
const rnd = (end, s) => `round(v.edge('${end}', 'side'), ${s})\n`;
const hollowS = (w, open) => `hollow(v, { wall: ${w}, open: '${open}' })\n`;
const holeS = (d) => `hole(v, { across: ${d} })\n`;

/** Intended membership integrated on a grid: a point (rho, z) is material when inside the rounded outer profile and
 *  outside the cavity cylinder (rho < R - w, from the closed end up to the open plane). Volume = sum 2 pi rho dA. */
function field({ Ro, H, r, w, bore = 0, topOpen = true }) {
  const N = 1600;
  let v = 0;
  const dr = Ro / N, dz = H / N;
  for (let i = 0; i < N; i++) {
    const rho = (i + 0.5) * dr;
    for (let j = 0; j < N; j++) {
      const z = (j + 0.5) * dz; // z from the closed end up (the open end is the top; flipped for a bottom opening by symmetry)
      let inside = true;
      // outer rounded rim at the OPEN end (z = H): the quarter disc centred (Ro - r, H - r)
      if (rho > Ro - r && z > H - r) inside = Math.hypot(rho - (Ro - r), z - (H - r)) <= r;
      // the cavity: rho in (bore + w, Ro - w), z in (w, H]
      if (rho < Ro - w && rho > bore + (bore ? w : 0) && z > w) inside = false;
      if (rho < bore) inside = false;
      if (inside) v += 2 * PI * rho * dr * dz;
    }
  }
  return v;
}

// [name, script, outer round r, wall w, bore diameter, open end]
const CASES = [
  ['hollow open top, then round the outer rim 1 (wall 2)', cyl(40, 20) + hollowS(2, 'top') + rnd('top', 1), 1, 2, 0, 'top'],
  ['round the rim 1, THEN hollow open at it (wall 2): the same part', cyl(40, 20) + rnd('top', 1) + hollowS(2, 'top'), 1, 2, 0, 'top'],
  ['round 1.5 then hollow open top, wall 2', cyl(40, 20) + rnd('top', 1.5) + hollowS(2, 'top'), 1.5, 2, 0, 'top'],
  ['round 1.9 then hollow open top, wall 2 (a 0.1 lip)', cyl(40, 20) + rnd('top', 1.9) + hollowS(2, 'top'), 1.9, 2, 0, 'top'],
  ['round 2 then hollow open top, wall 4', cyl(40, 20) + rnd('top', 2) + hollowS(4, 'top'), 2, 4, 0, 'top'],
  ['round 3.9 then hollow open top, wall 4', cyl(40, 20) + rnd('top', 3.9) + hollowS(4, 'top'), 3.9, 4, 0, 'top'],
  ['a tiny round 0.25, wall 3', cyl(40, 20) + rnd('top', 0.25) + hollowS(3, 'top'), 0.25, 3, 0, 'top'],
  ['a tall tube 24 x 60, round 2, wall 3', cyl(24, 60) + rnd('top', 2) + hollowS(3, 'top'), 2, 3, 0, 'top', 12, 60],
  ['a squat cup 60 x 12, round 3, wall 5', cyl(60, 12) + rnd('top', 3) + hollowS(5, 'top'), 3, 5, 0, 'top', 30, 12],
  ['open at the BOTTOM: round the bottom rim 1.5, hollow open bottom, wall 2', cyl(40, 20) + rnd('bottom', 1.5) + hollowS(2, 'bottom'), 1.5, 2, 0, 'bottom'],
  ['open at the bottom, hollow then round the bottom rim', cyl(40, 20) + hollowS(2, 'bottom') + rnd('bottom', 1), 1, 2, 0, 'bottom'],
];

let referee = 0;
for (const [name, code, r, w, , open, Ro = R, H = 20] of CASES) {
  const hollowFirst = code.indexOf('hollow(') < code.indexOf('round(');
  test(`open-end rim: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {}, name);
    const cav = PI * (Ro - w) ** 2 * (H - w);
    const want = PI * Ro * Ro * H - ring(Ro, r, -1) - cav;
    assert.ok(Math.abs(m.volume - want) <= 1e-9 * want, `${name}: ${m.volume} vs Pappus ${want}`);
    const f = field({ Ro, H, r, w });
    assert.ok(Math.abs(m.volume - f) <= 1e-3 * want, `${name}: ${m.volume} vs distance field ${f}`);
    assert.ok(Math.abs(m.bbox[1][2] - m.bbox[0][2] - H) < 1e-9 && Math.abs(m.bbox[1][0] - Ro) < 1e-9, 'bbox is the cylinder');
    assertWatertight(m);
    // OpenCascade is the referee only where the hollow comes first (its `shell` of a rounded closed solid of revolution
    // is not reliable: with the round first it returns a part with a cavity 12 deep where the wall says 18). The two
    // orders are the SAME part, so the round-first cases are held to the hollow-first answer instead.
    if (hollowFirst) {
      const o = occt(m.r.doc.features, m.id);
      assert.ok(Math.abs(o.volume - want) <= 1e-6 * want, `${name}: OpenCascade ${o.volume} vs ${want}`);
      referee++;
    } else {
      const flipped = code.replace(/(round\(v\.edge\([^\n]*\n)(hollow\([^\n]*\n)/, '$2$1');
      assert.notEqual(flipped, code, 'the order was swapped');
      const swapped = mine(flipped);
      assert.deepEqual(swapped.refusals, {});
      assert.ok(Math.abs(m.volume - swapped.volume) <= 1e-9 * want, `${name}: order changed the part ${m.volume} vs ${swapped.volume}`);
    }
  });
}

test('OpenCascade was the referee for the hollow-first cases', () => {
  assert.equal(referee, CASES.filter((c) => c[1].indexOf('hollow(') < c[1].indexOf('round(')).length);
});

test('a bushing: the outer rim rounded, bore 8, hollow open top: the annulus cavity (Pappus; the referee for a bore is blind)', () => {
  const m = mine(cyl(40, 20) + holeS(8) + rnd('top', 1) + hollowS(2, 'top'));
  assert.deepEqual(m.refusals, {});
  const cav = PI * ((R - 2) ** 2 - (4 + 2) ** 2) * (20 - 2);
  const want = PI * R * R * 20 - PI * 16 * 20 - ring(R, 1, -1) - cav;
  assert.ok(Math.abs(m.volume - want) <= 1e-9 * want, `${m.volume} vs ${want}`);
  const f = field({ Ro: R, H: 20, r: 1, w: 2, bore: 4 });
  assert.ok(Math.abs(m.volume - f) <= 1e-3 * want, `${m.volume} vs field ${f}`);
  assertWatertight(m);
});

test('a round as wide as the wall, or wider, refuses in a sentence and shows the part without the hollow', () => {
  for (const [r, w] of [[2, 2], [3, 2], [5, 4]]) {
    const m = mine(cyl(40, 20) + rnd('top', r) + hollowS(w, 'top'));
    const text = Object.values(m.refusals).join(' ');
    assert.match(text, /a rounded rim at the open end/, `${r} / ${w}: ${text}`);
  }
  // hollow first, then a round that does not fit the lip: its own sentence (it always had one)
  const m = mine(cyl(40, 20) + hollowS(2, 'top') + rnd('top', 3));
  assert.match(Object.values(m.refusals).join(' '), /would not fit its edge/);
});

test('the open end rounded and the other end rounded too: both rims, one cavity', () => {
  const m = mine(cyl(40, 20) + rnd('top', 1) + rnd('bottom', 3) + hollowS(2, 'top'));
  assert.deepEqual(m.refusals, {});
  // the bottom round 3 against wall 2 dissolves (the closed end's offset is the meet of its neighbours): the cavity loses
  // the corner square-minus-disc of radius 3 - 2 = 1 at its bottom edge, exactly as for any closed end
  const cav = PI * (R - 2) ** 2 * (20 - 2) - ring(R - 2, 1, -1);
  const want = PI * R * R * 20 - ring(R, 1, -1) - ring(R, 3, -1) - cav;
  assert.ok(Math.abs(m.volume - want) <= 1e-9 * want, `${m.volume} vs ${want}`);
  assertWatertight(m);
});

test('a rounded open-end rim writes to STEP and reads back in OpenCascade at the exact volume (W3 STEP)', async () => {
  const { stepRoundTrip, okRead } = await import('./step-readback-lib.mjs');
  const r = stepRoundTrip(cyl(40, 20) + rnd('top', 1) + hollowS(2, 'top'));
  assert.ok(!r.refused && !r.buildRefused && okRead(r), JSON.stringify({ ...r, step: undefined }).slice(0, 300));
});
