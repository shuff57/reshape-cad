// mirror(pocket, 'top-bottom', { at }) -- the plane is PARALLEL to the face the pocket sits on -- measured on the solid brep-rs
// builds. FreeCAD's Mirrored cuts the reflected pocket from the opposite side of the part. Each case is checked against
//   * the closed-form volume (cylinders: pi r^2 h),
//   * the same cut written by hand in the same test (a plain pocket on the reflected plane, pushed the other way),
//   * the centroid, which a symmetric pair of cuts puts on the mid-plane,
//   * FreeCAD 26.3rc1 (docs/replica/freecad/gauntlet/variants/refs/ref-mirrored__top-bottom-*.json, written by
//     compare-variants.mjs): volume, bounding box, face count, wherever the reference file is present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const PKG = path.resolve(HERE, '../../brep-rs/pkg');
const REFS = path.resolve(HERE, '../../../docs/replica/freecad/gauntlet/variants/refs');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { solveDoc } = await import('@shuff57/reshape-script/model-codegen');

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

function built(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors.map((e) => String(e.message ?? e)), [], code);
  const doc = solveDoc(r.doc);
  const id = doc.features.at(-1).id;
  const json = JSON.stringify({ ...doc, measure: id });
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes[id];
  const mesh = JSON.parse(brep.mesh_feature(json, id, 0.05));
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
  return { refusals, volume: s?.volume, bbox: s?.bbox, centroid: c.map((x) => x / V), faces: s?.faces ?? s?.faceCount };
}
const sameSolid = (m, ref, what) => {
  assert.deepEqual(m.refusals, {}, what);
  assert.deepEqual(ref.refusals, {}, `${what} (by hand)`);
  assert.ok(near(m.volume, ref.volume, 1e-9), `${what}: volume ${m.volume} vs by hand ${ref.volume}`);
  assert.deepEqual(m.bbox, ref.bbox, `${what}: bbox`);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(m.centroid[k] - ref.centroid[k]) < 1e-6, `${what}: centroid ${m.centroid} vs ${ref.centroid}`);
};
/** the FreeCAD reference of a gauntlet variant, when its file is in the tree: volume and bounding box must agree. */
function againstFreeCad(slug, m) {
  const f = path.join(REFS, `ref-mirrored__${slug}.json`);
  if (!existsSync(f)) return;
  const ref = JSON.parse(readFileSync(f, 'utf8'));
  if (!ref.ok) return;
  assert.ok(near(m.volume, ref.volume, 1e-6), `${slug}: ${m.volume} vs FreeCAD ${ref.volume}`);
  const [x0, y0, z0, x1, y1, z1] = ref.bbox;
  assert.deepEqual(m.bbox.flat().map((x) => Math.round(x * 1e6) / 1e6), [x0, y0, z0, x1, y1, z1]);
  // FreeCAD's centroid is exact; the mesh's is to the deflection
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(m.centroid[k] - ref.com[k]) < 0.02, `${slug}: centroid ${m.centroid} vs FreeCAD ${ref.com}`);
}

const PLATE = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);\n`;
const PLATE_VOL = 40 * 30 * 10;
const cyl = (d, h) => Math.PI * (d / 2) ** 2 * h;

test('a pocket mirrored through the middle plane equals the same pocket cut from the bottom by hand', () => {
  const head = PLATE + `const c = sketch('top', 10); c.circle(6, { at: [10, 15] }); const p = pocket(c, plate, 3);\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 5 });`);
  const ref = built(head + `const c2 = sketch('top', 0); c2.circle(6, { at: [10, 15] }); pocket(c2, p, 3, { reversed: true });`);
  sameSolid(m, ref, 'middle plane');
  assert.ok(near(m.volume, PLATE_VOL - 2 * cyl(6, 3)), String(m.volume));
  assert.deepEqual(m.bbox, [[0, 0, 0], [40, 30, 10]]);
  assert.ok(Math.abs(m.centroid[2] - 5) < 1e-9, `centroid z ${m.centroid[2]}`);
  // one pocket alone is NOT symmetric: the check has teeth
  assert.ok(Math.abs(built(head).centroid[2] - 5) > 1e-4);
  againstFreeCad('top-bottom-pocket', m);
});

test('an off-centre plane carries the copy inside the part as a sealed void, as FreeCAD does', () => {
  const head = PLATE + `const c = sketch('top', 10); c.circle(6, { at: [10, 15] }); const p = pocket(c, plate, 3);\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 6 });`);
  const ref = built(head + `const c2 = sketch('top', 2); c2.circle(6, { at: [10, 15] }); pocket(c2, p, 3, { reversed: true });`);
  sameSolid(m, ref, 'off-centre plane');
  assert.ok(near(m.volume, PLATE_VOL - 2 * cyl(6, 3)), String(m.volume));
  againstFreeCad('top-bottom-offcentre-plane', m);
});

test('a copy that starts below the part opens the bottom face only as deep as it reaches into the part', () => {
  const head = PLATE + `const c = sketch('top', 10); c.circle(6, { at: [10, 15] }); const p = pocket(c, plate, 3);\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 4 });`);
  // the copy spans z = -2 .. 1; only z = 0 .. 1 is inside the plate
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, PLATE_VOL - cyl(6, 3) - cyl(6, 1)), `${m.volume} vs ${PLATE_VOL - cyl(6, 3) - cyl(6, 1)}`);
  againstFreeCad('top-bottom-breaks-bottom', m);
});

test('a pocket cut up from the bottom mirrors onto the top and cuts down', () => {
  const head = PLATE + `const c = sketch('top', 0); c.circle(6, { at: [10, 15] }); const p = pocket(c, plate, 3, { reversed: true });\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 5 });`);
  assert.ok(near(m.volume, PLATE_VOL - 2 * cyl(6, 3)));
  assert.ok(Math.abs(m.centroid[2] - 5) < 1e-9);
  againstFreeCad('top-bottom-from-bottom-reversed', m);
});

test('a through pocket mirrored is the same single hole', () => {
  const head = PLATE + `const c = sketch('top', 10); c.circle(6, { at: [10, 15] }); const p = pocket(c, plate, 10, { through: true });\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 5 });`);
  const one = built(head);
  sameSolid(m, one, 'through');
  assert.ok(near(m.volume, PLATE_VOL - cyl(6, 10)));
  againstFreeCad('top-bottom-through', m);
});

test('a rectangular pocket in a thick block mirrors to the bottom face', () => {
  const head = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 20);
const c = sketch('top', 20); c.rect(16, 12, { at: [16, 14] }); const p = pocket(c, plate, 5);\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 10 });`);
  assert.ok(near(m.volume, 40 * 30 * 20 - 2 * 16 * 12 * 5));
  assert.ok(Math.abs(m.centroid[2] - 10) < 1e-9);
  againstFreeCad('top-bottom-tall-block', m);
});

test('a pocket in a joined boss mirrors onto the plate bottom', () => {
  const head = PLATE + `const sb = sketch('top', 10); sb.circle(20, { at: [20, 15] }); const padded = join(plate, extrude(sb, 6));
const c = sketch('top', 16); c.circle(8, { at: [20, 15] }); const p = pocket(c, padded, 3);\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 8 });`);
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, PLATE_VOL + cyl(20, 6) - 2 * cyl(8, 3)), String(m.volume));
  assert.deepEqual(m.bbox, [[0, 0, 0], [40, 30, 16]]);
  againstFreeCad('top-bottom-in-boss', m);
});

test('a pocket on a cylinder host mirrors through the middle plane', () => {
  const head = `const s1 = sketch('top'); s1.circle(60); const plate = extrude(s1, 10);
const c = sketch('top', 10); c.circle(8, { at: [10, 0] }); const p = pocket(c, plate, 3);\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 5 });`);
  assert.ok(near(m.volume, cyl(60, 10) - 2 * cyl(8, 3)), String(m.volume));
  againstFreeCad('top-bottom-on-disc', m);
});

test('a pocket on its own frame (the top face) mirrors onto the bottom face, as cut by hand', () => {
  const head = PLATE + `const c = sketch({ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }); c.circle(6, { at: [10, 15] }); const p = pocket(c, plate, 3);\n`;
  const m = built(head + `mirror(p, 'top-bottom', { at: 5 });`);
  // u x v = -z on the bottom face, so the push goes up into the plate; the point is written (y, x) on the swapped axes
  const ref = built(head + `const c2 = sketch({ origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] }); c2.circle(6, { at: [15, 10] }); pocket(c2, p, 3);`);
  sameSolid(m, ref, 'frame');
  assert.ok(near(m.volume, PLATE_VOL - 2 * cyl(6, 3)));
  assert.ok(Math.abs(m.centroid[2] - 5) < 1e-9);
});

test('the front-plane pocket (an xz sketch, whose offset runs the other way) mirrors through y = 15', () => {
  const head = PLATE + `const c = sketch('front', 0); c.circle(6, { at: [10, 5] }); const p = pocket(c, plate, 4);\n`;
  const m = built(head + `mirror(p, 'front-back', { at: 15 });`);
  assert.ok(near(m.volume, PLATE_VOL - 2 * cyl(6, 4)), String(m.volume));
  assert.ok(Math.abs(m.centroid[1] - 15) < 1e-9, `centroid y ${m.centroid[1]}`);
});
