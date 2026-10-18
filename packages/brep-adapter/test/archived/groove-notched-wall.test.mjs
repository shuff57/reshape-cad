// A groove ring that lies ON the part's own round wall (x 18..20 on a radius-20 post, or a ring whose inner wall is a
// bore's) over only PART of a turn leaves that wall as ONE face with a rectangular notch in it, exactly as FreeCAD does
// (8 faces for a ring inside the wall's height, 7 where the ring runs to an end face). Before, brep-rs held a wall only as
// rectangles and refused these in a sentence (docs/replica/freecad/gauntlet K18: FreeCAD 37102.2092, 8 faces).
// The wall is now one `Cross::Notch` face: a whole wall less one (u, v) rectangle, measured in closed form and meshed on
// its own boundary samples with the notch's cells left out.
//
// Oracles, none of them brep-rs's own bookkeeping:
//   * the closed form  V = pi R^2 h - pi (R^2 - r^2) dh * angle / 360  and its centroid;
//   * FreeCAD 26.3.0 RC1 headless, PartDesign Pad + Groove about the sketch's V axis, measured 2026-10-12 (volume, faces,
//     centre of mass and bbox, recorded below);
//   * OpenCascade reading brep-rs's STEP back (valid, one solid, same face count and volume);
//   * the mesh: closed, and its volume against the exact one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRoundTrip, okRead, brep } from './step-readback-lib.mjs';

const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const PI = Math.PI;
const POST = 'const s1 = sketch("top"); s1.circle(40); const cyl = extrude(s1, 30);';
const TUBE = 'const s1 = sketch("top"); s1.circle(40); const c0 = extrude(s1, 30); const cyl = hole(c0, { across: 20, deep: 30 });';
const ring = (x0, x1, z0, z1, n = 2) => `const s${n} = sketch("top"); s${n}.rect(${x1 - x0}, ${z1 - z0}, { at: [${(x0 + x1) / 2}, ${(z0 + z1) / 2}] });`;
const POST_VOL = PI * 400 * 30;
const TUBE_VOL = PI * 300 * 30;

/** The script spins only (0, 360] (a negative angle is refused at the script layer), so patch the feature. */
function docOf(code, angle) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const doc = structuredClone(r.doc);
  if (angle !== undefined) doc.features.findLast((f) => f.kind === 'groove').angle = angle;
  return doc;
}
function built(code, angle) {
  const doc = docOf(code, angle);
  const json = JSON.stringify(doc);
  const id = doc.features.at(-1).id;
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes?.[id];
  return { refusals, s, json, id, doc };
}
/** Mesh volume, centroid and the number of edges not used exactly twice (welded by position). */
function mesh(json, id, defl) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  assert.ok(!m.error, m.error);
  const key = (i) => [0, 1, 2].map((k) => Math.round(m.positions[i * 3 + k] * 1e6)).join(',');
  const uses = new Map();
  let v = 0;
  const c = [0, 0, 0];
  for (let t = 0; t < m.indices.length; t += 3) {
    const ix = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const p = ix.map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
    const dv = (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    v += dv;
    for (let k = 0; k < 3; k++) c[k] += dv * (p[0][k] + p[1][k] + p[2][k]) / 4;
    for (let e = 0; e < 3; e++) {
      const a = key(ix[e]), b = key(ix[(e + 1) % 3]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (n !== 2) open++;
  return { vol: v, open, centroid: c.map((x) => x / v), faces: m.faces.length };
}
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const rounded = (b) => b.flat().map((x) => Math.round(x * 1e6) / 1e6);

/** Centroid of the post (0, 0, 15) less a ring sector spun from angle 0 through `deg` (counter-clockwise, negative the other way). */
function centroidAfter(host, hostCz, r0, r1, z0, z1, deg) {
  const a = deg * PI / 180;
  const vr = PI * (r1 * r1 - r0 * r0) * (z1 - z0) * Math.abs(deg) / 360;
  const rho = (2 / 3) * (r1 ** 3 - r0 ** 3) / (r1 * r1 - r0 * r0) * Math.sin(a / 2) / (a / 2);
  const cr = [rho * Math.cos(a / 2), rho * Math.sin(a / 2), (z0 + z1) / 2];
  const left = host - vr;
  return { vol: left, c: [-vr * cr[0] / left, -vr * cr[1] / left, (host * hostCz - vr * cr[2]) / left] };
}

// FreeCAD, PartDesign Groove about the V axis of an XZ sketch (rect x18..20, z10..15), Pad r20 h30. com is the solid's centre of mass.
const FREECAD = {
  45: { vol: 37549.886192032, com: [-0.06804314904234487, -0.028184395159910763, 15.00993516000837] },
  90: { vol: 37400.6605409865, com: [-0.09661148442481547, -0.09661148442481592, 15.019949601007974] },
  120: { vol: 37301.17677362282, com: [-0.08389114579410849, -0.14530372682056236, 15.026670409882087] },
  180: { vol: 37102.20923889546, com: [-9.376307518190837e-16, -0.19477726030100478, 15.040220152413207] },
  270: { vol: 36803.75793680443, com: [0.09817838003221763, -0.09817838003221804, 15.06081946222791] },
  300: { vol: 36704.27416944075, com: [0.08525542405666975, -0.04922224202899174, 15.067760342368045] },
};
const WALL = POST + ring(18, 20, 10, 15) + 'groove(s2, cyl, 180);';

for (const a of [45, 90, 120, 180, 270, 300]) {
  test(`ring x18..20 z10..15 on the post's wall, ${a} degrees: one notched wall, 8 faces, volume and centre of mass as FreeCAD, mesh closed`, () => {
    const { refusals, s, json, id } = built(WALL, a);
    assert.deepEqual(refusals, {});
    near(s.volume, POST_VOL - PI * 76 * 5 * a / 360, 1e-12);
    near(s.volume, FREECAD[a].vol, 1e-12);
    assert.deepEqual(rounded(s.bbox), [-20, -20, 0, 20, 20, 30]);
    assert.equal(s.faces, 8, 'FreeCAD: top, bottom, one notched wall, inner wall, two floors, two end planes');
    const want = centroidAfter(POST_VOL, 15, 18, 20, 10, 15, a);
    for (const defl of [0.5, 0.05, 0.02]) {
      const m = mesh(json, id, defl);
      assert.equal(m.open, 0, `mesh closed at ${defl}`);
      assert.equal(m.faces, 8);
      assert.ok(m.vol <= s.volume + 1e-6 && m.vol >= s.volume * (1 - 0.12 * defl), `mesh volume ${m.vol} vs ${s.volume} at ${defl}`);
    }
    const fine = mesh(json, id, 0.01);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(fine.centroid[k] - want.c[k]) < 4e-3, `centroid ${k}: mesh ${fine.centroid[k]} vs closed form ${want.c[k]}`);
      assert.ok(Math.abs(want.c[k] - FREECAD[a].com[k]) < 1e-9, `closed form ${want.c[k]} vs FreeCAD ${FREECAD[a].com[k]}`);
    }
  });
}

for (const a of [-90, -180, -270]) {
  test(`ring x18..20 z10..15 on the post's wall, ${a} degrees (the other way round): same volume as the positive turn, 8 faces, mesh closed`, () => {
    const { refusals, s, json, id } = built(WALL, a);
    assert.deepEqual(refusals, {});
    near(s.volume, POST_VOL - PI * 76 * 5 * Math.abs(a) / 360, 1e-12);
    assert.equal(s.faces, 8);
    assert.equal(mesh(json, id, 0.05).open, 0);
    const want = centroidAfter(POST_VOL, 15, 18, 20, 10, 15, a);
    const fine = mesh(json, id, 0.01);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(fine.centroid[k] - want.c[k]) < 4e-3, `centroid ${k}: ${fine.centroid[k]} vs ${want.c[k]}`);
  });
}

for (const a of [90, 180, 270]) {
  test(`STEP of the ${a} degree notched wall reads back in OpenCascade: valid, one solid, 8 faces, volume matches`, () => {
    const r = stepRoundTrip(docOf(WALL, a));
    assert.equal(r.buildRefused, undefined, JSON.stringify(r.buildRefused));
    assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
    assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv, db: r.db }));
    assert.equal(r.got.faces, 8);
    near(r.got.volume, FREECAD[a].vol, 1e-6);
  });
}

// the notch reaches an end face: one wall with a bite out of its rim (FreeCAD 7 faces, 35499.99698556466)
for (const [z0, z1] of [[0, 8], [22, 30]]) {
  test(`ring x15..20 z${z0}..${z1} flush with an end face, 180 degrees: one wall with a notch to the rim, 7 faces as FreeCAD`, () => {
    const { refusals, s, json, id, doc } = built(POST + ring(15, 20, z0, z1) + 'groove(s2, cyl, 180);', 180);
    assert.deepEqual(refusals, {});
    near(s.volume, POST_VOL - PI * 175 * 8 / 2, 1e-12);
    near(s.volume, 35499.99698556466, 1e-12);
    assert.equal(s.faces, 7);
    assert.deepEqual(rounded(s.bbox), [-20, -20, 0, 20, 20, 30]);
    assert.equal(mesh(json, id, 0.05).open, 0);
    const r = stepRoundTrip(doc);
    assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv }));
    assert.equal(r.got.faces, 7);
  });
}

test('ring x15..20 z10..15 (wider than the wall: it only touches r = 20), 120 degrees: 8 faces, FreeCAD 36782.8139857805', () => {
  const { refusals, s, json, id } = built(POST + ring(15, 20, 10, 15) + 'groove(s2, cyl, 180);', 120);
  assert.deepEqual(refusals, {});
  near(s.volume, POST_VOL - PI * 175 * 5 * 120 / 360, 1e-12);
  near(s.volume, 36782.8139857805, 1e-12);
  assert.equal(s.faces, 8);
  assert.equal(mesh(json, id, 0.05).open, 0);
});

test('a tall thin ring x19..20 z3..27, 270 degrees: the notch nearly spans the wall, 8 faces, FreeCAD 35493.71380025748', () => {
  const { refusals, s, json, id } = built(POST + ring(19, 20, 3, 27) + 'groove(s2, cyl, 180);', 270);
  assert.deepEqual(refusals, {});
  near(s.volume, 35493.71380025748, 1e-12);
  assert.equal(s.faces, 8);
  assert.equal(mesh(json, id, 0.02).open, 0);
});

// a bore: the ring's INNER wall is the bore's wall (FreeCAD 9 faces)
const TUBE_FREECAD = { 90: 27897.342763877365, 180: 27520.35164544659, 270: 27143.360527015815 };
for (const a of [90, 180, 270]) {
  test(`ring x10..14 z10..15 on a bore's wall, ${a} degrees: one notched bore wall, 9 faces as FreeCAD, mesh closed, STEP valid`, () => {
    const { refusals, s, json, id, doc } = built(TUBE + ring(10, 14, 10, 15) + 'groove(s2, cyl, 180);', a);
    assert.deepEqual(refusals, {});
    near(s.volume, TUBE_VOL - PI * 96 * 5 * a / 360, 1e-12);
    near(s.volume, TUBE_FREECAD[a], 1e-12);
    assert.equal(s.faces, 9);
    for (const defl of [0.5, 0.05]) assert.equal(mesh(json, id, defl).open, 0, `closed at ${defl}`);
    const r = stepRoundTrip(doc);
    assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
    assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv }));
  });
}

// ---- what a notched part still cannot take, and what it can ---------------------------------------------------------
const NOTCHED = POST + ring(18, 20, 10, 15) + 'const g1 = groove(s2, cyl, 180);';
test('a cut after a notched groove refuses in a sentence that names the notch, not a bore across its side', () => {
  const { refusals, s } = built(NOTCHED + 'hole(g1, { across: 6, deep: 30 });', 180);
  assert.equal(s, undefined);
  assert.match(refusals.hole1, /^hole hole1: groove1 already has a round wall with a notch cut out of it by a part turn of a groove, and brep-rs can only move or copy a part like that yet -- hole1 is shown without it\.$/);
});

test('a notched part moves exactly: same volume, 8 faces, mesh closed, bbox shifted', () => {
  const { refusals, s, json, id } = built(NOTCHED + 'move(g1, [5, 0, 0]);', 180);
  assert.deepEqual(refusals, {});
  near(s.volume, FREECAD[180].vol, 1e-12);
  assert.equal(s.faces, 8);
  assert.deepEqual(rounded(s.bbox), [-15, -20, 0, 25, 20, 30]);
  assert.equal(mesh(json, id, 0.05).open, 0);
});

// what still refuses: the gauntlet's front-plane script spins about the plane's normal (Y) while the post is along Z.
// FreeCAD (PartDesign Groove on an XY sketch about its V axis = Y, the same part) builds it: volume 37332.6605 and 7 faces,
// but the two mirror placements it was measured at disagree at the 8th digit (37332.660504640626 and 37332.66160342251):
// a ring of the post's own radius crossing the post at right angles is a singular intersection even for FreeCAD.
test('the baseline front-plane groove, whose axis crosses a bare post, still refuses naming that cause (never a wrong solid)', () => {
  const code = 'const sk1 = sketch("top"); sk1.circle(40); const cyl = extrude(sk1, 30); const sk2 = sketch("front"); sk2.rect(2, 5, { at: [19, 12.5] }); groove(sk2, cyl, 360);';
  const { refusals, s } = built(code);
  assert.equal(s, undefined);
  assert.match(refusals.groove1, /^groove groove1: the ring is spun about the normal of its sketch, which crosses the axis of .*'s round wall .* -- groove1 is shown without it\.$/);
});

// a second bite out of the same wall is a second notch, which a face of this kernel does not hold
test('a second groove on a part whose wall is already notched refuses in the notch sentence, not a wrong solid', () => {
  const { refusals, s } = built(NOTCHED + ring(18, 20, 20, 25, 3) + 'groove(s3, g1, 180);', 180);
  assert.equal(s, undefined);
  assert.match(refusals.groove2, /already has a round wall with a notch/);
});
