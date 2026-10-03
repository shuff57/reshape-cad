// A whole-body fillet/chamfer/polarPattern/hole that cannot be done must be a
// plain script error, never a silent no-op or a silent blind hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const msg = (code) => {
  const r = runScript(code);
  assert.equal(r.errors.length, 1, `${code} -> ${JSON.stringify(r.errors)}`);
  return r.errors[0].message;
};

const FILLET = {
  sphere: ['const t = sphere(20); fillet(t, 1)', /no edges to round/],
  torus: ['const t = torus(30, 6); fillet(t, 1)', /no edges to round/],
  cone: ['const t = cone(20, 10); fillet(t, 1)', /cone is not supported/],
  prism: ['const t = prism(6, 10, 20); fillet(t, 1)', /does not work on this shape/],
  wedge: ['const t = wedge(10, 20, 30); fillet(t, 1)', /does not work on this shape/],
  extrude: ["const s = sketch('top'); s.rect(10, 10); const t = extrude(s, 10); fillet(t, 1)", /not one pulled from a sketch/],
  subtract: ['const b = cuboid(30, 20, 10); const t = subtract(b, cylinder(5, 20)); fillet(t, 1)', /not a combination/],
  hole: ['const t = cuboid(30, 20, 10); hole(t, { across: 4 }); fillet(t, 1)', /not the hole/],
};
for (const [name, [code, re]] of Object.entries(FILLET)) {
  test(`whole-body fillet of ${name} is a plain error`, () => assert.match(msg(code), re));
}

for (const [name, code] of Object.entries({
  box: 'const t = cuboid(30, 20, 10); chamfer(t, 1)',
  cylinder: 'const t = cylinder(20, 10); chamfer(t, 1)',
  sphere: 'const t = sphere(20); chamfer(t, 1)',
  prism: 'const t = prism(6, 10, 20); chamfer(t, 1)',
})) {
  test(`whole-body chamfer of ${name} is a plain error`, () =>
    assert.match(msg(code), /whole shape is not supported yet/));
}

test('whole-body fillet of a box and a cylinder still builds', () => {
  for (const code of ['const t = cuboid(30, 20, 10); fillet(t, 3)', 'const t = cylinder(20, 10); fillet(t, 1)']) {
    const r = runScript(code);
    assert.deepEqual(r.errors, []);
    assert.ok(r.doc.features[0].round > 0);
  }
});

test('polarPattern without a count is an error for every primitive', () => {
  for (const t of ['cuboid(10, 10, 10', 'cylinder(10, 10', 'sphere(10', 'cone(10, 10', 'torus(10, 3']) {
    assert.match(msg(`const t = ${t}, { at: [30, 0, 0] }); polarPattern(t)`), /needs \{ count/);
  }
});

test('polarPattern with a count emits a pattern for every primitive', () => {
  for (const t of ['cuboid(10, 10, 10', 'cylinder(10, 10', 'sphere(10', 'cone(10, 10', 'torus(10, 3']) {
    const r = runScript(`const t = ${t}, { at: [30, 0, 0] }); polarPattern(t, { count: 4 })`);
    assert.deepEqual(r.errors, []);
    assert.equal(r.doc.features.at(-1).kind, 'pattern');
  }
});

test('hole with no deep: goes through a prism, wedge, cone, sphere and torus', () => {
  const want = {
    'prism(6, 10, 20)': 22,
    'wedge(10, 20, 30)': 32,
    'cone(20, 30)': 32,
    'sphere(20)': 22,
    'torus(30, 6)': 8,
  };
  for (const [shape, depth] of Object.entries(want)) {
    const r = runScript(`const t = ${shape}; hole(t, { across: 2 })`);
    assert.deepEqual(r.errors, [], shape);
    assert.ok(r.doc.features.at(-1).depth >= depth, `${shape}: ${r.doc.features.at(-1).depth}`);
  }
});

test('hole with no deep: on a shape of unknown thickness is an error, not a blind 10 mm', () => {
  assert.match(msg('const t = intersect(cuboid(10, 10, 10), cuboid(10, 10, 10)); hole(t, { across: 2 })'), /cannot find how thick this combine is/);
  assert.match(msg('const t = intersect(cuboid(10, 10, 10), cylinder(8, 30, { at: [5, 0, 0] })); hole(t, { across: 2 })'), /cannot find how thick/);
  assert.match(msg("const b = cuboid(10, 10, 10, { at: [25, 0, 0] }); const p = polarPattern(b, { count: 3, axis: 'z' }); hole(p, { across: 2 })"), /cannot find how thick/);
  assert.match(msg('const t = intersect(cuboid(10, 10, 10), cuboid(10, 10, 10)); holes(t, { across: 2, apart: [4, 4] })'), /holes\(\) cannot find how thick/);
});

// Intent kept and strengthened (extent-extrude work): an explicit deep: still
// BUILDS where the thickness is not provable (centred, offset 0); the kernel's
// sealed-cavity refusal -- pinned end to end in
// packages/kernel/test/hole-extent-extrude.test.mjs -- is what stops a wrong
// solid. A pulled shape is no longer such a case: its thickness is exact.
test('explicit deep: still builds where thickness is unknown (intersect of two boxes), centred', () => {
  const r = runScript('const t = intersect(cuboid(10, 10, 10), cuboid(10, 10, 10)); hole(t, { across: 2, deep: 4 })');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.features.at(-1).center, [0, 0, 0]);
});
