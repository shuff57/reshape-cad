// A groove ring whose outer wall lies ON the part's own cylinder wall (x 18..20 on a radius-20 post) or whose inner
// wall lies on a bore it opens onto. The tool's cylinder is the host's cylinder over a band of heights (and, for part
// of a turn, a range of angles): the shared cells are neither kept, the ring's floors, inner wall and end caps close
// the cut. Before, a full turn built and ANY part of a turn refused ("the tool is not fully enclosed ...").
// Oracles: the closed form pi*(R^2-r^2)*h*angle/360, FreeCAD 26.3.0 RC1 headless (PartDesign Groove about the
// sketch's V axis, measured 2026-10-11: 180 -> 37102.20923889546, 90 -> 37400.6605409865, 270 -> 36803.75793680443,
// 45 -> 37549.886192032, 300 -> 36704.27416944075, 360 -> 36505.30663471339; bbox [-20,-20,0, 20,20,30] in all),
// OpenCascade reading brep-rs's STEP back, and the mesh (closed, and its volume against the exact one).
// FreeCAD keeps the wall that is left as ONE face with a notch (8 faces for a part turn). brep-rs now holds that wall as
// one face too (`Cross::Notch`; groove-notched-wall.test.mjs measures it against FreeCAD): part turns build here, with
// the faces FreeCAD counts, as do whole turns (7 faces) and part turns that take the wall's whole height (one patch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRoundTrip, okRead, brep } from './step-readback-lib.mjs';

const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const PI = Math.PI;
const POST = 'const s1 = sketch("top"); s1.circle(40); const cyl = extrude(s1, 30);';
const ring = (x0, x1, z0, z1, n = 2) => `const s${n} = sketch("top"); s${n}.rect(${x1 - x0}, ${z1 - z0}, { at: [${(x0 + x1) / 2}, ${(z0 + z1) / 2}] });`;
const POST_VOL = PI * 400 * 30;

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
function mesh(json, id, defl) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  assert.ok(!m.error, m.error);
  const key = (i) => [0, 1, 2].map((k) => Math.round(m.positions[i * 3 + k] * 1e6)).join(',');
  const uses = new Map();
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const ix = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const p = ix.map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
    v += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    for (let e = 0; e < 3; e++) {
      const a = key(ix[e]), b = key(ix[(e + 1) % 3]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (n !== 2) open++;
  return { vol: v, open };
}
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

const WALL = POST + ring(18, 20, 10, 15) + 'groove(s2, cyl, 180);';
const FREECAD_360 = 36505.30663471339;

test("ring x18..20 z10..15 on the post's own wall, full turn: exact, equals FreeCAD (7 faces), mesh closed", () => {
  const { refusals, s, json, id } = built(WALL, 360);
  assert.deepEqual(refusals, {});
  near(s.volume, POST_VOL - PI * 76 * 5);
  near(s.volume, FREECAD_360, 1e-12);
  assert.deepEqual(s.bbox.flat().map((x) => Math.round(x * 1e6) / 1e6), [-20, -20, 0, 20, 20, 30]);
  assert.equal(s.faces, 7, 'FreeCAD: 7');
  for (const defl of [0.5, 0.05]) {
    const m = mesh(json, id, defl);
    assert.equal(m.open, 0, `mesh closed at ${defl}`);
    assert.ok(m.vol <= s.volume + 1e-6 && m.vol >= s.volume * (1 - 0.12 * defl), `mesh volume ${m.vol} vs ${s.volume} at ${defl}`);
  }
});

test('STEP of the full-turn ring on the wall reads back in OpenCascade: valid, one solid, volume matches', () => {
  const r = stepRoundTrip(docOf(WALL, 360));
  assert.equal(r.buildRefused, undefined, JSON.stringify(r.buildRefused));
  assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
  assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv, db: r.db }));
  near(r.got.volume, FREECAD_360, 1e-6);
});

// A part turn leaves one face with a notch (FreeCAD: 8 faces): it builds, exact, 8 faces, mesh closed.
for (const a of [45, 90, 180, 270, 300, -90, -180]) {
  test(`ring x18..20 z10..15 on the post's wall, ${a} degrees, builds one notched wall (8 faces) and its mesh is closed`, () => {
    const { refusals, s, json, id } = built(WALL, a);
    assert.deepEqual(refusals, {});
    near(s.volume, POST_VOL - PI * 76 * 5 * Math.abs(a) / 360);
    assert.equal(s.faces, 8);
    assert.equal(mesh(json, id, 0.05).open, 0);
  });
}

// a ring that takes the wall's whole height leaves ONE patch, as FreeCAD does: builds, exact, faces as FreeCAD
for (const a of [90, 180, 270]) {
  test(`ring x15..20 z0..30 (the whole height) on the wall, ${a} degrees: exact, 6 faces`, () => {
    const { refusals, s, json, id } = built(POST + ring(15, 20, 0, 30) + 'groove(s2, cyl, 180);', a);
    assert.deepEqual(refusals, {});
    near(s.volume, POST_VOL - PI * (400 - 225) * 30 * a / 360);
    assert.deepEqual(s.bbox.flat().map((x) => Math.round(x * 1e6) / 1e6).slice(2, 3), [0]);
    assert.equal(mesh(json, id, 0.1).open, 0);
  });
}
// flush with an end face still bites the wall's side: one wall with a notch that reaches the rim (FreeCAD: 7 faces)
for (const [z0, z1] of [[0, 8], [22, 30]]) {
  test(`ring x15..20 z${z0}..${z1} flush with an end face, 180 degrees, builds one wall with a notch to the rim (7 faces)`, () => {
    const { refusals, s, json, id } = built(POST + ring(15, 20, z0, z1) + 'groove(s2, cyl, 180);', 180);
    assert.deepEqual(refusals, {});
    near(s.volume, POST_VOL - PI * 175 * 8 / 2);
    assert.equal(s.faces, 7);
    assert.equal(mesh(json, id, 0.05).open, 0);
  });
}

// a bore: the ring's INNER wall is the bore's wall
const TUBE = 'const s1 = sketch("top"); s1.circle(40); const c0 = extrude(s1, 30); const cyl = hole(c0, { across: 20, deep: 30 });';
const TUBE_VOL = PI * 300 * 30;
test("ring x10..14 z10..15 on a bore's wall, full turn: exact, mesh closed", () => {
  const { refusals, s, json, id } = built(TUBE + ring(10, 14, 10, 15) + 'groove(s2, cyl, 180);', 360);
  assert.deepEqual(refusals, {});
  near(s.volume, TUBE_VOL - PI * 96 * 5);
  assert.equal(mesh(json, id, 0.1).open, 0);
});
for (const a of [90, 180, 270]) {
  test(`ring x10..14 z10..15 on a bore's wall, ${a} degrees, builds one notched bore wall (9 faces, as FreeCAD)`, () => {
    const { refusals, s, json, id } = built(TUBE + ring(10, 14, 10, 15) + 'groove(s2, cyl, 180);', a);
    assert.deepEqual(refusals, {});
    near(s.volume, TUBE_VOL - PI * 96 * 5 * a / 360);
    assert.equal(s.faces, 9);
    assert.equal(mesh(json, id, 0.05).open, 0);
  });
}
test('STEP of the full-turn ring on a bore wall reads back in OpenCascade', () => {
  const r = stepRoundTrip(docOf(TUBE + ring(10, 14, 10, 15) + 'groove(s2, cyl, 360);'));
  assert.equal(r.buildRefused, undefined, JSON.stringify(r.buildRefused));
  assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv }));
});

// what still refuses: the gauntlet's front-plane script spins about the plane's normal (Y) while the post is along Z
test('the baseline front-plane groove, whose axis crosses a bare post, refuses naming that cause', () => {
  const code = 'const sk1 = sketch("top"); sk1.circle(40); const cyl = extrude(sk1, 30); const sk2 = sketch("front"); sk2.rect(2, 5, { at: [19, 12.5] }); groove(sk2, cyl, 360);';
  const { refusals, s } = built(code);
  assert.equal(s, undefined);
  assert.match(refusals.groove1, /^groove groove1: the ring is spun about the normal of its sketch, which crosses the axis of .*'s round wall .* -- groove1 is shown without it\.$/);
});

// the sentence must not blame the axis on a part that is not a bare post (a box with a cross hole): the generic one stands
test('a box with a front-face cross hole and a ring that fails for another reason does not get the post-axis sentence', () => {
  const code = 'const s1 = sketch("top"); s1.rect(40, 40); const b = extrude(s1, 30); const s2 = sketch("front"); s2.circle(20, { at: [0, 15] }); const h = pocket(s2, b, 40); const s3 = sketch("top"); s3.rect(6, 5, { at: [8, 12.5] }); groove(s3, h, 180);';
  const { refusals } = built(code);
  const why = Object.values(refusals).join(' ');
  assert.doesNotMatch(why, /crosses the axis of/);
});

// ---- the round-3 critic's blockers, each measured -------------------------------------------------------------
/** Like `built`, with an angle per groove id. */
function builtMulti(code, angles) {
  const doc = docOf(code);
  for (const f of doc.features) if (f.kind === 'groove' && angles[f.id] !== undefined) f.angle = angles[f.id];
  const json = JSON.stringify(doc);
  const id = doc.features.at(-1).id;
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes?.[id];
  return { refusals, s, json, id, doc };
}
const FULL = ring(15, 20, 0, 30);

// BLOCKER 1: a second ring from the same start overlaps the first on [0, 90]; its bottom piece's scan line ran along the
// host's 0-degree edge, a seam 1.8e-16 above y = 0 against a neighbour 2.8e-15 below it, so the piece was read as
// outside the host's coplanar face and came out as a second, flipped bottom. Volume right, mesh open, 8 faces.
for (const [a1, a2] of [[90, 270], [90, 180], [180, 270], [270, 90], [30, 330]]) {
  test(`two rings x15..20 z0..30, ${a1} then ${a2} degrees from the same start: exact, one top and one bottom, mesh closed`, () => {
    const { refusals, s, json, id } = builtMulti(POST + FULL + 'const g1 = groove(s2, cyl, 180);' + ring(15, 20, 0, 30, 3) + 'groove(s3, g1, 180);', { groove1: a1, groove2: a2 });
    assert.deepEqual(refusals, {});
    near(s.volume, POST_VOL - PI * 175 * 30 * Math.max(a1, a2) / 360);
    assert.equal(s.faces, 7, 'top, bottom, outer wall, two inner wall patches, two radial planes');
    for (const defl of [0.5, 0.05, 0.02]) assert.equal(mesh(json, id, defl).open, 0, `closed at ${defl}`);
  });
}

// BLOCKER 3: a bore through a groove's cap. The cap's outer wire is an arc that bulges past its chord and a concave arc
// back, whose vertex polygon winds the other way from the region, so the bore's rim was wound WITH the outer wire and
// the divergence sum added the bore's area back (31219.58 reported as 32790.37; the mesh and STEP read it right).
for (const a of [90, 180, 270]) {
  test(`bore across 10 through a ${a} degree groove cap: volume is the closed form, mesh and STEP agree`, () => {
    const code = POST + FULL + 'const g1 = groove(s2, cyl, 180); hole(g1, { across: 10, deep: 30 });';
    const { refusals, s, json, id, doc } = builtMulti(code, { groove1: a });
    assert.deepEqual(refusals, {});
    const want = POST_VOL - PI * 175 * 30 * a / 360 - PI * 25 * 30;
    near(s.volume, want);
    const m = mesh(json, id, 0.05);
    assert.equal(m.open, 0);
    assert.ok(m.vol <= s.volume + 1e-6 && m.vol >= s.volume * 0.99, `mesh ${m.vol}`);
    const r = stepRoundTrip(doc);
    assert.equal(r.refused, undefined);
    assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv }));
    near(r.got.volume, want, 1e-6);
  });
}
test('a bore across 10 through a ring x15..25 z10..15 that is NOT coincident: same winding defect, same fix', () => {
  const code = POST + ring(15, 25, 10, 15) + 'const g1 = groove(s2, cyl, 180); hole(g1, { across: 10, deep: 30 });';
  const { refusals, s } = builtMulti(code, { groove1: 90 });
  assert.deepEqual(refusals, {});
  near(s.volume, POST_VOL - PI * (400 - 225) * 5 / 4 - PI * 25 * 30);
});

// BLOCKER 2 was a misreading: hole() places its centre as an OFFSET from its target's bounding-box centre, and the
// groove leaves a box [-15,-20,0, 20,15,30], so a "centred" r15 hole sits at (2.5, -2.5), not on the axis. The
// built 4870.90 is right (OpenCascade reading brep-rs's STEP, and a 4000 x 4000 grid of the plan, give the same).
test('hole across 30 after a 270 degree groove is centred on the groove result\'s box, not on the axis: volume agrees with OpenCascade', () => {
  const code = POST + FULL + 'const g1 = groove(s2, cyl, 180); hole(g1, { across: 30, deep: 30 });';
  const { refusals, s, doc } = builtMulti(code, { groove1: 270 });
  assert.deepEqual(refusals, {});
  assert.deepEqual(s.bbox.flat().map((x) => Math.round(x * 1e6) / 1e6), [-15, -20, 0, 20, 15, 30]);
  near(s.volume, 4870.893, 2e-6); // grid of the plan, 4000^2 cells
  const r = stepRoundTrip(doc);
  assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv }));
});

// MINOR: a ring a sliver clear of the post's wall left a skin no mesh keeps closed (2 open edges at 1e-6, 86 at 1e-7)
for (const d of [1e-6, 1e-7, 5e-5]) {
  test(`ring x18..${20 - d} against the post's wall: refused in a sentence, not built open`, () => {
    const { refusals, s } = builtMulti(POST + ring(18, 20 - d, 0, 30) + 'groove(s2, cyl, 180);', { groove1: 180 });
    assert.equal(s, undefined);
    assert.match(refusals.groove1, /^groove groove1: the cut would leave a skin of the part's round wall thinner than a ten-thousandth of a millimetre.* -- groove1 is shown without it\.$/);
  });
}
test('ring x18..19.99 (a hundredth clear of the wall) still builds, closed', () => {
  const { refusals, s, json, id } = builtMulti(POST + ring(18, 19.99, 0, 30) + 'groove(s2, cyl, 180);', { groove1: 180 });
  assert.deepEqual(refusals, {});
  near(s.volume, POST_VOL - PI * (19.99 ** 2 - 324) * 30 / 2);
  assert.equal(mesh(json, id, 0.05).open, 0);
});
