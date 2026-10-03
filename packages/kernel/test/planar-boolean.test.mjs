// The planar split-and-classify boolean (SPEC-brep-boolean-split-classify, S1):
// subtract from a part that is not convex. Every volume is a closed form, never
// a number read back from the kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(r.doc)));
  const id = r.doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(JSON.stringify(r.doc))).shapes[id];
  return { refusals: out.refusals, m };
}

const HOLLOW = 'const b = cuboid(40, 40, 20)\nshell(b, { wall: 2 })\n';
const CUP = "const b = cuboid(40, 40, 20)\nshell(b, { wall: 2, open: 'top' })\n";
const HALF = 'const c = cuboid(60, 30, 40, { at: [0, 15, 0] })\nsubtract(b, c)';

const cases = [
  ['hollow box cut in half through the cavity: exactly half of 11264', HOLLOW + HALF, 5632, 11],
  ['open cup (8672) cut in half', CUP + HALF, 4336, 10],
  ['open cup with a notch through one wall: 8672 - 2 x 10 x 6', CUP + 'const c = cuboid(10, 10, 6, { at: [20, 0, 0] })\nsubtract(b, c)', 8552, 15],
  ['hollow then chamfer 1.5 on a 40 edge: 11264 - 1/2 x 1.5^2 x 40', HOLLOW + "chamfer(b.edge('top', 'front'), 1.5)", 11219, 13],
  ['hollow then chamfer 3: the wedge stays inside the 2 mm wall zone', HOLLOW + "chamfer(b.edge('top', 'front'), 3)", 11084, 13],
];

for (const [name, code, volume, faces] of cases) {
  test(name, () => {
    const { refusals, m } = build(code);
    assert.deepEqual(refusals, {}, JSON.stringify(refusals));
    assert.ok(m, 'built');
    assert.ok(Math.abs(m.volume - volume) < 1e-6, `${m.volume} vs ${volume}`);
    assert.equal(m.faces, faces);
  });
}

const PI = Math.PI;
test('a round hole then a half cut through its axis: exactly half of 32000 - pi r^2 h (S2)', () => {
  const { refusals, m } = build('const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\n' + HALF);
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(m.volume - (32000 - PI * 36 * 20) / 2) < 1e-6, `${m.volume}`);
});

test('a blind hole then a half cut: exactly half of 32000 - pi r^2 d (S2)', () => {
  const { refusals, m } = build('const b = cuboid(40, 40, 20)\nhole(b, { across: 12, deep: 8 })\n' + HALF);
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(m.volume - (32000 - PI * 36 * 8) / 2) < 1e-6, `${m.volume}`);
});

test('a cutter that crosses only part of a bore wall builds exactly (S3a): box slab less the half bore', () => {
  // 6 mm tall in z against a 20 mm tall bore wall: removes 20 x 40 x 6 less the half bore pi r^2 / 2 x 6.
  const { refusals, m } = build('const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\nconst c = cuboid(60, 30, 6, { at: [0, 15, 0] })\nsubtract(b, c)');
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(m.volume - (32000 - PI * 36 * 20 - (4800 - PI * 36 * 3))) < 1e-6, `${m.volume}`);
});

// ---- S3b: a second round hole crossing the first -------------------------------------------
// The volume two perpendicular cylinders (R > r, axes meeting) share is 4 integral sqrt(R^2 - y^2) sqrt(r^2 - y^2) dy over
// [-r, r], Simpson on y = r sin t (the same oracle transverse-bore.test.mjs uses); the side bore removes pi r^2 x 40 less that.
function steinmetz(R, r) {
  const n = 200000, h = (Math.PI / 2) / n;
  const f = (t) => { const y = r * Math.sin(t); return 4 * Math.sqrt(R * R - y * y) * Math.sqrt(Math.max(r * r - y * y, 0)) * r * Math.cos(t); };
  let sum = f(0) + f(Math.PI / 2);
  for (let i = 1; i < n; i++) sum += f(i * h) * (i % 2 ? 4 : 2);
  return 2 * sum * h / 3;
}
const P = "const b = cuboid(40, 40, 20)\n";
// [name, script, first bore radius, side bore radius, first bore length, side bore length through the block]
for (const [name, code, R, r, depth, toolLen] of [
  ['through z bore (r4), through x bore (r2)', P + "hole(b, { across: 8 })\nhole(b, { across: 4, along: 'x' })", 4, 2, 20, 40],
  ['through z bore (r4), through y bore (r3)', P + "hole(b, { across: 8 })\nhole(b, { across: 6, along: 'y' })", 4, 3, 20, 40],
  ['through x bore (r4), through z bore (r2)', P + "hole(b, { across: 8, along: 'x' })\nhole(b, { across: 4 })", 4, 2, 40, 20],
  ['through z bore (r5), x bore (r2) 3 mm above mid-height', P + "hole(b, { across: 10 })\nhole(b, { across: 4, along: 'x', at: [0, 3] })", 5, 2, 20, 40],
  ['blind z bore 14 deep (r4), through x bore (r2)', P + "hole(b, { across: 8, deep: 14 })\nhole(b, { across: 4, along: 'x' })", 4, 2, 14, 40],
]) {
  test(`two crossing holes build exactly: ${name}`, () => {
    const { refusals, m } = build(code);
    assert.deepEqual(refusals, {});
    const first = 32000 - PI * R * R * depth;
    const want = first - (PI * r * r * toolLen - steinmetz(R, r));
    assert.ok(Math.abs(m.volume - want) < 1e-5, `${m.volume} vs ${want}`);
  });
}
test('two crossing holes that must still refuse say so in a sentence: as wide as the first, wider than it, off its axis', () => {
  for (const code of [
    P + "hole(b, { across: 8 })\nhole(b, { across: 8, along: 'x' })",
    P + "hole(b, { across: 8 })\nhole(b, { across: 12, along: 'x' })",
    P + "hole(b, { across: 8 })\nhole(b, { across: 4, along: 'x', at: [2, 0] })",
  ]) {
    const { refusals, m } = build(code);
    assert.match(refusals.hole2 ?? '', /cannot cut this hole yet/, code);
    assert.equal(m, undefined);
  }
});
