// STEP of a PARTIAL revolve (a spin of less than a full turn, either way round) reads back in OpenCascade.
// These used to refuse with "a face whose wire is not a closed chain": the annulus sector a partial spin leaves on
// each flat end of the profile is bounded by an outer arc from angle 0, a radial line, an inner arc back from the far
// end and a radial line home, and the inner arc's end vertex was placed by turning its start about e2 rather than
// about axis x start (build.rs revolve_profile_partial). That lands home only for an arc that starts at e1, or at half
// a turn, which is why 180, 360, 400 and their negatives wrote and 30, 90, 120, 270 did not.
// The oracle is OpenCascade's own STEP reader: the file must read back valid, as one solid, at brep-rs's exact volume
// (1e-6 relative) and bounding box, and at the closed-form volume of the sector. An outline with an arc, part of a
// turn, used to refuse here; it builds and writes now (the end of this file, and partial-revolve-arc.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRoundTrip, okRead, brep } from './step-readback-lib.mjs';
import { rectSpin } from './sketch-audit-lib.mjs';

const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const PI = Math.PI;

/** The script spins `angle` only in (0, 360] (a negative angle is refused at the script layer), so the doc is built at a
 *  legal angle and its revolve/groove feature patched: the kernel spins a negative angle the other way round. */
function docAt(code, angle) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const doc = structuredClone(r.doc);
  const f = doc.features.findLast((x) => x.kind === 'revolve' || x.kind === 'groove');
  f.angle = angle;
  return doc;
}

function readsBack(name, code, angle, closedForm) {
  test(`STEP reads back in OpenCascade: ${name}, ${angle} degrees`, () => {
    const r = stepRoundTrip(docAt(code, angle));
    assert.equal(r.buildRefused, undefined, JSON.stringify(r.buildRefused));
    assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
    assert.equal(r.bad, undefined, r.bad);
    assert.equal(r.got.valid, true, 'BRepCheck says the read-back shape is valid');
    assert.equal(r.got.solids, 1, 'one solid');
    assert.ok(r.dv <= 1e-6, `read-back volume ${r.got.volume} vs brep-rs ${r.want.volume} (relative ${r.dv})`);
    assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv, db: r.db }));
    const want = closedForm(Math.abs(angle) / 360);
    assert.ok(Math.abs(r.got.volume - want) <= 1e-6 * want, `read-back ${r.got.volume} vs closed form ${want}`);
    assert.ok(Math.abs(r.want.volume - want) <= 1e-6 * want, `brep-rs ${r.want.volume} vs closed form ${want}`);
  });
}

// ---- the plain rectangle: an annulus r 10..20, 30 tall (the gauntlet's revolution profile), every angle the K rounds refused
const ANNULUS = "const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, 90);";
const annulus = (f) => PI * (20 ** 2 - 10 ** 2) * 30 * f;
for (const a of [30, 90, 120, 270, -90, -30, -120, -270]) readsBack('annulus r10..20 on the top plane', ANNULUS, a, annulus);
// the same profile on the other two planes, and lifted along its axis (the spin starts at the sketch's own origin)
for (const a of [90, -90]) {
  readsBack('annulus on the front plane', "const sk = sketch('front'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, 90);", a, annulus);
  readsBack('annulus on the side plane', "const sk = sketch('side'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, 90);", a, annulus);
}
for (const a of [120, -120]) readsBack('annulus on the top plane lifted 5', "const sk = sketch('top', 5); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, 90);", a, annulus);

// ---- partial sweeps of other straight outlines, positive and negative
// an off-axis L: four flat ends, so four annulus sectors, each with its own inner arc
const L = "const sk = sketch('top'); sk.polygon([[6, 2], [16, 2], [16, 8], [10, 8], [10, 20], [6, 20]]); revolve(sk, 90);";
const lVol = (f) => PI * ((16 ** 2 - 6 ** 2) * 6 + (10 ** 2 - 6 ** 2) * 12) * f;
for (const a of [45, -45, 300, -300]) readsBack('an off-axis L outline', L, a, lVol);
// a profile that touches the axis: each flat end is a pie slice, its inner arc of radius 0
const ROD = "const sk = sketch('top'); sk.rect(12, 30, { at: [6, 15] }); revolve(sk, 90);";
for (const a of [90, -90]) readsBack('a rectangle touching the axis (a solid sector)', ROD, a, (f) => PI * 144 * 30 * f);
// a profile wholly on the far side of the axis: spun reflected, then turned half a turn
const FAR = "const sk = sketch('front'); sk.rect(10, 20, { at: [-10, 10] }); spin(sk, 90);";
for (const a of [90, -90]) readsBack('a profile on the far side of the axis', FAR, a, (f) => PI * (15 ** 2 - 5 ** 2) * 20 * f);
// a partial groove: the same sector cut out of a box across its y = +20 face (5 mm of the 7 mm tool inside the box)
const GROOVE = "const b = box(40, 40, 20); const s = sketch('front', 0); s.rect(8, 7, { at: [4, 18.5] }); groove(s, b, 90);";
for (const a of [90, -90, 270, -270]) readsBack('a partial groove across a face', GROOVE, a, (f) => 32000 - PI * 64 * 5 * f);

// ---- an outline with an arc: a full turn writes, and so does part of a turn (it refused until turned.rs build_solid_partial;
// partial-revolve-arc.test.mjs pins the full set of angles, outlines and closed forms)
const ROUNDED = "const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); sk.round(2, 3); revolve(sk, 360);";
test('STEP reads back in OpenCascade: an outline with a round, a full turn (control for the part turns below)', () => {
  const r = stepRoundTrip(docAt(ROUNDED, 360));
  assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
  assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv }));
  assert.ok(r.dv <= 1e-6);
});
for (const a of [30, 90, -90, 270]) {
  test(`STEP reads back in OpenCascade: an outline with a round spun ${a} degrees`, () => {
    const r = stepRoundTrip(docAt(ROUNDED, a));
    assert.equal(r.buildRefused, undefined, JSON.stringify(r.buildRefused));
    assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
    assert.equal(r.got.valid, true);
    assert.equal(r.got.solids, 1);
    assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv, db: r.db }));
    // the closed form: the whole ring's Pappus volume less the corner piece (textbook centroids), times the part of a turn
    const want = rectSpin(15, 10, 30, { 2: ['R', 3] }) * Math.abs(a) / 360;
    assert.ok(Math.abs(r.got.volume - want) <= 1e-6 * want, `read-back ${r.got.volume} vs closed form ${want}`);
    assert.ok(Math.abs(r.want.volume - want) <= 1e-9 * want, `brep-rs ${r.want.volume} vs closed form ${want}`);
  });
}
