// mirror(cut, word, { at }) of a pocket (or pad) whose sketch has its OWN frame, measured on the solid brep-rs builds.
// The bug: the copy's frame had u and v swapped (to keep the push the reflected one) but its points kept their (a, b), so
// every point landed at o + a v' + b u' -- a pocket at (-20, 10) mirrored at x = 0 came back near (-10, -20), not (20, 10),
// with the same volume and no refusal. Each case here is checked against the same cut made by hand in the same test
// (the reflected corners worked out below, drawn on the original frame), the closed-form volume, the bounding box, and the
// centroid, which a plate symmetric about x = 0 puts on x = 0 once the copy is the true mirror image.
// The second half covers a slanted cut (a world `direction`) copied by mirror or repeatAround: the copy's direction is
// turned (or reflected) with it, where it used to be copied unchanged, so every copy slanted the original's way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const PKG = path.resolve(HERE, '../../brep-rs/pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');
const { solveDoc } = await import('@shuff57/reshape-script/model-codegen');

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

/** Run, solve (as the app does on adoption), build, measure the last feature, and find its centroid from its mesh
 *  (every face here is flat, so the triangles are the faces exactly and the divergence sum is exact to rounding). */
function built(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors.map((e) => String(e.message ?? e)), [], code);
  const doc = solveDoc(r.doc);
  const id = doc.features.at(-1).id;
  const json = JSON.stringify({ ...doc, measure: id });
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes[id];
  const mesh = JSON.parse(brep.mesh_feature(json, id, 0.1));
  assert.ok(!mesh.error, mesh.error);
  const P = mesh.positions, I = mesh.indices;
  let V = 0;
  const c = [0, 0, 0];
  const at = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, d] = [at(I[t]), at(I[t + 1]), at(I[t + 2])];
    const v = (a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0])) / 6;
    V += v;
    for (let k = 0; k < 3; k++) c[k] += (v * (a[k] + b[k] + d[k])) / 4;
  }
  return { r, doc, refusals, volume: s?.volume, bbox: s?.bbox, centroid: c.map((x) => x / V) };
}
const sameSolid = (m, ref, what) => {
  assert.deepEqual(m.refusals, {}, what);
  assert.deepEqual(ref.refusals, {}, `${what} (by hand)`);
  assert.ok(near(m.volume, ref.volume), `${what}: volume ${m.volume} vs by hand ${ref.volume}`);
  assert.deepEqual(m.bbox, ref.bbox, `${what}: bbox`);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(m.centroid[k] - ref.centroid[k]) < 1e-9, `${what}: centroid ${m.centroid} vs by hand ${ref.centroid}`);
  }
};

// a plate symmetric about x = 0: x -40..40, y -30..30, z 0..10
const PLATE = `const s = sketch('top'); s.rect(80, 60); const plate = pull(s, 10);\n`;
const PLATE_VOL = 80 * 60 * 10;
const PLATE_BOX = [[-40, -30, 0], [40, 30, 10]];
const lit = (x) => String(Math.round(x * 1e12) / 1e12);
const litFrame = (f) => `{ origin: [${f.origin.map(lit)}], u: [${f.u.map(lit)}], v: [${f.v.map(lit)}] }`;
const c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6);

/** The four corners of rect(w, h, { at: [ca, cb] }) on frame f, reflected across x = 0, given back in f's own (a, b): the
 *  mirror plane stands square to every sketch plane used here, so the reflected corners stay in it. */
function mirroredCorners(f, w, h, ca, cb) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [ca + (i * w) / 2, cb + (j * h) / 2]);
  return corners.map(([a, b]) => {
    const p = [0, 1, 2].map((k) => f.origin[k] + a * f.u[k] + b * f.v[k]);
    p[0] = -p[0];
    const d = [0, 1, 2].map((k) => p[k] - f.origin[k]);
    const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    return [dot(d, f.u), dot(d, f.v)];
  });
}

const CASES = [
  // the reviewer's repro: a frame that reads as the top face, u = x and v = y
  { name: 'frame u=[1,0,0], v=[0,1,0] on the top face', f: { origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }, w: 10, h: 6, at: [-20, 10] },
  // the same face, axes turned 30 degrees about z
  { name: 'a frame turned 30 degrees on the top face', f: { origin: [0, 0, 10], u: [c30, s30, 0], v: [-s30, c30, 0] }, w: 10, h: 4, at: [-20, 1] },
  // u x v = -z: the other handedness, so it sits on the bottom face and the pocket is pushed up into the plate
  { name: 'a flipped-handedness frame (u=[0,1,0], v=[1,0,0]) on the bottom face', f: { origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] }, w: 4, h: 10, at: [1, -20] },
  // u x v = -y: the front face, so the pocket goes in along +y
  { name: 'a frame on the front face (u=[1,0,0], v=[0,0,1])', f: { origin: [0, -30, 5], u: [1, 0, 0], v: [0, 0, 1] }, w: 10, h: 4, at: [-20, 1] },
];

for (const cs of CASES) {
  test(`mirror of a pocket on ${cs.name} lands at the mirror image (same as cut by hand)`, () => {
    const head = PLATE + `const c = sketch(${litFrame(cs.f)}); c.rect(${cs.w}, ${cs.h}, { at: [${cs.at}] });\nconst p = pocket(c, plate, 4);\n`;
    const m = built(head + "mirror(p, 'left-right', { at: 0 })");
    const pts = mirroredCorners(cs.f, cs.w, cs.h, cs.at[0], cs.at[1]);
    const ref = built(head + `const c2 = sketch(${litFrame(cs.f)}); c2.polygon([${pts.map((q) => `[${q.map(lit)}]`).join(', ')}]);\npocket(c2, p, 4)`);
    sameSolid(m, ref, cs.name);
    // closed forms: two cuts of w x h x 4 inside the plate; the plate and its two mirrored cuts are symmetric about x = 0
    assert.ok(near(m.volume, PLATE_VOL - 2 * cs.w * cs.h * 4), `${m.volume}`);
    assert.deepEqual(m.bbox, PLATE_BOX);
    assert.ok(Math.abs(m.centroid[0]) < 1e-9, `centroid x ${m.centroid[0]} is off the mirror plane`);
    // and the single pocket is NOT symmetric, so the check above has teeth
    const one = built(head);
    assert.ok(Math.abs(one.centroid[0]) > 1e-3, `one pocket's centroid x ${one.centroid[0]}`);
  });
}

test('mirror of a plain top-plane pocket is unchanged (the reflected rectangle, same as cut by hand)', () => {
  const head = PLATE + `const c = sketch('top', 10); c.rect(10, 6, { at: [-20, 10] });\nconst p = pocket(c, plate, 4);\n`;
  const m = built(head + "mirror(p, 'left-right', { at: 0 })");
  const ref = built(head + `const c2 = sketch('top', 10); c2.rect(10, 6, { at: [20, 10] });\npocket(c2, p, 4)`);
  sameSolid(m, ref, 'plain sketch');
  assert.ok(near(m.volume, PLATE_VOL - 2 * 10 * 6 * 4));
  // removed 240 at (-20, 10, 8) and at (20, 10, 8)
  const want = [0, (-240 * 10 * 2) / m.volume, (PLATE_VOL * 5 - 240 * 8 * 2) / m.volume];
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(m.centroid[k] - want[k]) < 1e-9, `${m.centroid} vs ${want}`);
  // the copy is the same sketch kind as before: a top-plane sketch with its points reflected, no frame
  const sk = m.doc.features.filter((f) => f.kind === 'sketch').at(-1);
  assert.equal(sk.frame, undefined);
  assert.equal(sk.plane, 'xy');
});

test('mirror of a pad on its own frame lands at the mirror image (same as joined by hand)', () => {
  const f = { origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] };
  const head = PLATE + `const c = sketch(${litFrame(f)}); c.rect(10, 6, { at: [-20, 10] });\nconst pd = join(plate, pull(c, 4));\n`;
  const m = built(head + "mirror(pd, 'left-right', { at: 0 })");
  const ref = built(head + `const c2 = sketch(${litFrame(f)}); c2.rect(10, 6, { at: [20, 10] });\njoin(pd, pull(c2, 4))`);
  sameSolid(m, ref, 'pad on a frame');
  assert.ok(near(m.volume, PLATE_VOL + 2 * 10 * 6 * 4));
  assert.ok(Math.abs(m.centroid[0]) < 1e-9, `centroid x ${m.centroid[0]}`);
});

test('mirror of a slanted pocket slants the copy the mirrored way (same as cut by hand)', () => {
  for (const sk of ["sketch('top', 10)", 'sketch({ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] })']) {
    const head = PLATE + `const c = ${sk}; c.rect(10, 6, { at: [-20, 10] });\nconst p = pocket(c, plate, 4, { direction: [1, 0, -1] });\n`;
    const m = built(head + "mirror(p, 'left-right', { at: 0 })");
    const ref = built(head + `const c2 = ${sk}; c2.rect(10, 6, { at: [20, 10] });\npocket(c2, p, 4, { direction: [-1, 0, -1] })`);
    sameSolid(m, ref, `slanted, ${sk}`);
    // a sheared prism keeps its volume (area x depth along the normal)
    assert.ok(near(m.volume, PLATE_VOL - 2 * 10 * 6 * 4));
    assert.ok(Math.abs(m.centroid[0]) < 1e-9, `centroid x ${m.centroid[0]}`);
  }
});

test('repeatAround of a slanted pocket turns each copy\'s slant with it (same as cut by hand)', () => {
  const head = `const s = sketch('top'); s.rect(80, 80); const plate = pull(s, 10);
const c = sketch('top', 10); c.rect(6, 6, { at: [20, 0] });
const p = pocket(c, plate, 4, { direction: [1, 0, -1] });
`;
  const m = built(head + 'repeatAround(p, { count: 4 })');
  const ref = built(head + `const c2 = sketch('top', 10); c2.rect(6, 6, { at: [0, 20] }); const p2 = pocket(c2, p, 4, { direction: [0, 1, -1] });
const c3 = sketch('top', 10); c3.rect(6, 6, { at: [-20, 0] }); const p3 = pocket(c3, p2, 4, { direction: [-1, 0, -1] });
const c4 = sketch('top', 10); c4.rect(6, 6, { at: [0, -20] }); pocket(c4, p3, 4, { direction: [0, -1, -1] })`);
  sameSolid(m, ref, 'slanted repeatAround');
  assert.ok(near(m.volume, 80 * 80 * 10 - 4 * 6 * 6 * 4));
  // four copies a quarter turn apart: the centroid is on the axis
  assert.ok(Math.abs(m.centroid[0]) < 1e-9 && Math.abs(m.centroid[1]) < 1e-9, `${m.centroid}`);
});

test('a pocket cut into a groove is saved with the groove named, and reopens to the same solid', () => {
  const src = `const b = box(40, 40, 20);
const sk = sketch('front'); sk.polygon([[0, 15], [8, 15], [8, 22], [0, 22]]);
const g = groove(sk, b, 180);
const c = sketch('top', 10); c.rect(6, 6, { at: [-10, -10] });
pocket(c, g, 4)`;
  const a = built(src);
  const text = toScript(a.r.doc);
  assert.match(text, /^const groove1 = groove\(/m);
  const b = built(text);
  assert.deepEqual(b.r.doc.features, a.r.doc.features);
  assert.deepEqual(a.refusals, {});
  assert.deepEqual(b.refusals, {});
  // the 180-degree groove takes 160 pi (groove-partial-angle), the pocket 6 x 6 x 4
  assert.ok(near(a.volume, 32000 - 160 * Math.PI - 144), String(a.volume));
  assert.ok(near(b.volume, a.volume));
  assert.deepEqual(b.bbox, a.bbox);
});
