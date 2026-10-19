// round(part.rim(sk), r) and bevel(part.rim(sk), c) on a CIRCULAR pocket: the rim is one closed circle (the edge between
// the plate's top face and the pocket's cylinder wall). brep-rs has no boolean that holds a torus, so the kernel assembles
// the part (turned::round_pocket_rim): the plate's own faces kept, the pocket's wall shortened, a quarter torus (a cone
// for a chamfer) in the rim, and the top face given the larger circle.
//
// Oracles, all measured: the closed form (Pappus: the ring the blend takes off), FreeCAD 26.3rc1 headless
// (Part.makeBox(40,30,10).cut(cylinder) then makeFillet / makeChamfer on the circle at z = 10, run for this test:
//   d5 blind 4 deep, r1: 11917.78804033823 (9 faces)    chamfer 1: 11912.559004475084 (9)
//   d5 through,      r1: 11799.978315828612 (8)         chamfer 1: 11794.749279965465 (8)
//   d12 blind 6 deep, r2: 11286.645307821858 (9)        chamfer 2.5: 11187.24380057754 (9)),
// the OCCT referee through the same named edge, a closed mesh and a STEP read-back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '@shuff57/reshape-script/reshape-script';
import { toScript } from '@shuff57/reshape-script/reshape-script-gen';
import { mine, assertWatertight, assertStep, assertOcct } from './s4i-harness.mjs';

const PI = Math.PI;
const rounded = (R, r) => 2 * PI * (r * r * (R + r / 2) - (PI * r * r / 4) * (R + r - 4 * r / (3 * PI)));
const chamfered = (R, c) => 2 * PI * (R + c / 3) * c * c / 2;
const close = (got, want, rel, what) => assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${what}: ${got} vs ${want}`);

// `across` is the circle's diameter, as circle(d) is everywhere in reSHape Script. 'through' is a plain pocket as deep as
// the plate (a { through: true } pocket cannot have its walls named, so it cannot be asked for its rim).
const script = (across, depth, call, at = [20, 15]) => `
const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] });
const plate = extrude(s1, 10);
const s2 = sketch('top', 10); s2.circle(${across}, { at: [${at}] });
const part = pocket(s2, plate, ${depth === 'through' ? 10 : depth});
${call}`;

const CASES = [
  // [across, depth, op, size, FreeCAD volume, FreeCAD faces]
  [5, 4, 'round', 1, 11917.78804033823, 9],
  [5, 4, 'bevel', 1, 11912.559004475084, 9],
  [5, 'through', 'round', 1, 11799.978315828612, 8],
  [5, 'through', 'bevel', 1, 11794.749279965465, 8],
  [12, 6, 'round', 2, 11286.645307821858, 9],
  [12, 6, 'bevel', 2.5, 11187.24380057754, 9],
];

for (const [across, depth, op, size, fc, faces] of CASES) {
  const R = across / 2;
  test(`${op}(part.rim(sk), ${size}) on a circular pocket, diameter ${across}, ${depth === 'through' ? 'through' : depth + ' deep'}: exact, = FreeCAD`, () => {
    const m = mine(script(across, depth, `${op}(part.rim(s2), ${size});`));
    assert.deepEqual(m.refusals, {});
    const base = 40 * 30 * 10 - PI * R * R * (depth === 'through' ? 10 : depth);
    close(m.volume, base - (op === 'round' ? rounded(R, size) : chamfered(R, size)), 1e-9, 'closed form');
    close(m.volume, fc, 1e-9, 'FreeCAD');
    assert.equal(m.faces, faces, 'faces (FreeCAD)');
    assert.deepEqual(m.bbox, [[0, 0, 0], [40, 30, 10]]);
    assertOcct(m, `${op} ${across}`, 1e-6);
    assertWatertight(m);
    assertStep(m);
  });
}

test('the same rim rounded through the one-edge name (wall + top) is the same part, and the script round-trips', () => {
  const a = mine(script(5, 4, 'round(part.rim(s2), 1);'));
  const b = mine(script(5, 4, "round(part.edge('top', part.wall(s2, 1)), 1);"));
  assert.deepEqual(b.refusals, {});
  assert.equal(b.volume, a.volume);
  const text = toScript(a.r.doc);
  const back = runScript(text);
  assert.deepEqual(back.errors, []);
  assert.equal(toScript(back.doc), text.replaceAll('pocket1', 'op1'));
  // the re-run document builds the same part
  const again = mine(text);
  assert.deepEqual(again.refusals, {});
  assert.equal(again.volume, a.volume);
});

test('an off-centre circular pocket rounds with the same closed form (the place does not matter)', () => {
  const m = mine(script(6, 5, 'round(part.rim(s2), 1.5);', [11, 8]));
  assert.deepEqual(m.refusals, {});
  close(m.volume, 40 * 30 * 10 - PI * 9 * 5 - rounded(3, 1.5), 1e-9, 'closed form');
  assertWatertight(m);
});

test('a circular rim that does not fit is a sentence and the part is shown without it', () => {
  // the round is as deep as the pocket
  let m = mine(script(5, 4, 'round(part.rim(s2), 4);'));
  assert.match(m.refusals.round1 ?? '', /would not fit|cannot/);
  close(m.volume, 12000 - PI * 6.25 * 4, 1e-12, 'shown without it');
  // the blend would run out of the plate's side: the axis is 3 from the left face, radius 2.5 and round 1 reach 3.5
  m = mine(script(5, 4, 'round(part.rim(s2), 1);', [3, 15]));
  assert.ok(m.refusals.round1, 'refused');
  close(m.volume, 12000 - PI * 6.25 * 4, 1e-12, 'shown without it');
  m = mine(script(5, 4, 'bevel(part.rim(s2), 1);', [3, 15]));
  assert.ok(m.refusals.bevel1, 'refused');
});
