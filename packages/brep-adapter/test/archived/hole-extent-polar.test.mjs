// A polar pattern's thickness is exact where it is provable in closed form:
// about the hole's own axis (the range is the target's), and for a box,
// cylinder or sphere spun about another axis. Every number is measured on the
// real wasm; the formula is never its own oracle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { extentBoundAlong } = await import('@shuff57/reshape-script/model-types');

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} vs ${b}`);
const AX = ['x', 'y', 'z'];
const measure = (doc, id) => JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes[id];

const patterns = [
  "const b = cuboid(10, 10, 10, { at: [25, 0, 0] }); polarPattern(b, { count: 3, axis: 'z' })",
  "const b = cuboid(10, 6, 8, { at: [25, 0, 5] }); polarPattern(b, { count: 4, axis: 'z' })",
  "const b = cuboid(10, 10, 10, { at: [25, 0, 0] }); polarPattern(b, { count: 3, axis: 'y' })",
  "const b = cuboid(10, 6, 8, { at: [30, 4, 5] }); polarPattern(b, { count: 4, axis: 'x' })",
  "const b = cuboid(10, 6, 8, { at: [30, 0, 0] }); polarPattern(b, { count: 3, axis: 'z', angle: 180 })",
  "const b = cuboid(10, 6, 8, { at: [0, 30, 0] }); polarPattern(b, { count: 5, axis: 'x', angle: 200 })",
  "const b = cylinder(4, 12, { at: [25, 0, 0] }); polarPattern(b, { count: 3, axis: 'y' })",
  "const b = cylinder(4, 12, { at: [5, 20, 3] }); polarPattern(b, { count: 4, axis: 'x' })",
  "const b = sphere(5, { at: [25, 0, 0] }); polarPattern(b, { count: 3, axis: 'y' })",
  "const b = cuboid(10, 10, 10, { at: [25, 0, 0] }); turn(b, [0, 0, 30]); polarPattern(b, { count: 3, axis: 'y' })",
];

for (const code of patterns) {
  test(`extent matches the kernel bbox on x, y, z: ${code}`, () => {
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const m = measure(r.doc, id);
    assert.ok(m, 'pattern built');
    AX.forEach((ax, i) => {
      const e = extentBoundAlong(r.doc, id, ax);
      assert.ok(e && e.exact, `${ax} not exact for ${code}`);
      near(e.extent, m.bbox[1][i] - m.bbox[0][i]);
    });
  });
}

test('not provable stays null: a wedge target spun about another axis', () => {
  const r = runScript("const b = wedge(6, 8, 12, { at: [25, 0, 0] }); polarPattern(b, { count: 3, axis: 'y' })");
  assert.deepEqual(r.errors, []);
  assert.equal(extentBoundAlong(r.doc, r.doc.features.at(-1).id, 'x'), null);
});

// K-4 (PLAN-next): cone, torus and prism have a closed-form reach, so a turned one and a
// polar copy of one are exact too (a cone's is the kernel's symmetric box, not its tight hull). The kernel's own
// bbox is the oracle; the formula never checks itself.
const hull = [];
for (const rot of ['[0, 0, 0]', '[30, 0, 0]', '[0, 40, 0]', '[25, 35, 50]', '[90, 0, 0]']) {
  hull.push(`const b = cone(6, 12, { at: [3, -2, 5] }); turn(b, ${rot})`);
  hull.push(`const b = torus(14, 4, { at: [3, -2, 5] }); turn(b, ${rot})`);
}
// turn() refuses a prism, so a prism is only ever axis-aligned or spun by a pattern
for (const n of [3, 4, 5, 6, 7, 12]) hull.push(`const b = prism(${n}, 7, 9, { at: [3, -2, 5] })`);
for (const [shape, at] of [['cone(6, 12', '[25, 0, 0]'], ['torus(14, 4', '[25, 0, 0]'], ['prism(5, 7, 9', '[25, 4, 2]']]) {
  for (const ax of ['x', 'y', 'z']) hull.push(`const b = ${shape}, { at: ${ax === 'x' ? '[0, 25, 3]' : at} }); polarPattern(b, { count: 3, axis: '${ax}' })`);
  hull.push(`const b = ${shape}, { at: ${at} }); ${shape.startsWith('prism') ? '' : 'turn(b, [20, 30, 40]); '}polarPattern(b, { count: 4, axis: 'y', angle: 200 })`);
}
for (const code of hull) {
  test(`K-4 extent matches the kernel bbox on x, y, z: ${code}`, () => {
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const m = measure(r.doc, id);
    assert.ok(m, 'built');
    AX.forEach((ax, i) => {
      const e = extentBoundAlong(r.doc, id, ax);
      assert.ok(e && e.exact, `${ax} not exact for ${code}`);
      near(e.extent, m.bbox[1][i] - m.bbox[0][i], 1e-6);
    });
  });
}

// The kernel centres a hole's tool on the PATTERN's bbox centre plus `at`, so aim
// at a copy by subtracting that centre (read from the kernel, not computed).
function drill(base, opts, aim) {
  const pre = runScript(base);
  assert.deepEqual(pre.errors, [], base);
  const pat = pre.doc.features.at(-1);
  const bb = measure(pre.doc, pat.id).bbox;
  const c = [0, 1, 2].map(i => (bb[0][i] + bb[1][i]) / 2);
  const code = `${base.replace(/polarPattern\(/, 'const pp = polarPattern(')}; hole(pp, { ${opts}, at: [${aim[0] - c[0]}, ${aim[1] - c[1]}] })`;
  const t = runScript(code);
  assert.deepEqual(t.errors, [], code);
  const refusals = JSON.parse(brep.build_doc_json(JSON.stringify(t.doc))).refusals;
  assert.deepEqual(refusals, {}, code);
  return { t, pat, before: measure(t.doc, pat.id), after: measure(t.doc, t.doc.features.at(-1).id) };
}

const Z2 = "const b = cuboid(10, 10, 10, { at: [25, 0, 0] }); polarPattern(b, { count: 2, axis: 'z' })";
// 90 degrees apart about y: every copy is axis-aligned, copies at z = +-25 are 10 thick along z.
const Y4 = "const b = cuboid(10, 10, 6, { at: [25, 0, 0] }); polarPattern(b, { count: 4, axis: 'y' })";

test('through hole in a copy, pattern about z (the hole axis): volume and faces', () => {
  const { before, after } = drill(Z2, 'across: 4', [25, 0]);
  near(before.volume, 2000);
  near(after.volume, 2000 - 10 * Math.PI * 4);
  assert.equal(after.faces, 2 * 6 + 1);
});

test('through hole along z, pattern about y: exact 60 reach, one bore through each of two copies', () => {
  const { t, pat, before, after } = drill(Y4, 'across: 4', [0, 0]);
  const e = extentBoundAlong(t.doc, pat.id, 'z');
  assert.ok(e && e.exact);
  near(e.extent, 60);
  near(before.bbox[1][2] - before.bbox[0][2], 60);
  near(before.volume, 2400);
  // the bore at (0,0) crosses the copies at z = -25 and z = +25, 10 thick each
  near(after.volume, 2400 - 2 * 10 * Math.PI * 4);
  assert.equal(after.faces, 24 + 2);
});

test('through hole along z, pattern about y, into the 6-thick copy at z = 0', () => {
  const { after } = drill(Y4, 'across: 4', [25, 0]);
  near(after.volume, 2400 - 6 * Math.PI * 4);
  assert.equal(after.faces, 24 + 1);
});

test('blind hole on a multi-copy pattern: the offset is flush with the measured top, and the hole is cut into the copy it lands in (K-3)', () => {
  // Our start offset puts the tool's top on the kernel-measured top face; the kernel
  // cuts the one copy the tool lands in (K-3) and the volume is the closed form.
  const base = Y4;
  const pre = runScript(base);
  const patId = pre.doc.features.at(-1).id;
  const bb = measure(pre.doc, patId).bbox;
  const code = `${base.replace(/polarPattern\(/, 'const pp = polarPattern(')}; hole(pp, { across: 4, deep: 4, at: [0, 0] })`;
  const t = runScript(code);
  assert.deepEqual(t.errors, [], code);
  const h = t.doc.features.at(-1);
  near(h.center[2] + 4 / 2, (bb[1][2] - bb[0][2]) / 2); // tool top - bbox centre = half extent
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(t.doc)));
  assert.deepEqual(out.refusals, {});
  near(measure(t.doc, h.id).volume, 2400 - Math.PI * 4 * 4); // pi r^2 d, r = 2, d = 4
});

test('blind hole in a one-copy polar pattern about y is cut for real, from the top face', () => {
  const code = "const b = cuboid(10, 10, 6, { at: [25, 0, 0] }); const p = polarPattern(b, { count: 1, axis: 'y' }); hole(p, { across: 4, deep: 2, at: [0, 0] })";
  const t = runScript(code);
  assert.deepEqual(t.errors, [], code);
  const h = t.doc.features.at(-1);
  assert.deepEqual(JSON.parse(brep.build_doc_json(JSON.stringify(t.doc))).refusals, {});
  const m = measure(t.doc, h.id);
  near(m.volume, 600 - 2 * Math.PI * 4);
  assert.equal(m.faces, 8);
});
