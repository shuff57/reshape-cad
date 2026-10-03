// A hole in a PULLED sketch (and in unions, patterns ...) must go through, or
// start at the drilled face, with the extent worked out exactly. Measured on
// the real wasm against closed-form volumes and face counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function measureDoc(doc, last = doc.features.at(-1).id) {
  const j = JSON.stringify(doc);
  const m = JSON.parse(brep.measure_doc(j));
  return { refusals: JSON.parse(brep.build_doc_json(j)).refusals, s: m.shapes[last] }; // keyed by id, sorted
}
function measure(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const { refusals, s } = measureDoc(r.doc);
  assert.deepEqual(refusals, {}, code);
  return s;
}
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} vs ${b}`);

// 30 x 20 pulled 20: volume 12000, 6 faces.
for (const [plane, along, bbox] of [
  ['top', 'z', [[-15, -10, 0], [15, 10, 20]]],
  ['front', 'y', [[-15, -20, -10], [15, 0, 10]]],
  ['side', 'x', [[0, -15, -10], [20, 15, 10]]],
]) {
  const sk = `const sk = sketch('${plane}'); sk.rect(30, 20); const b = extrude(sk, 20); `;
  test(`${plane}: through bore along ${along} = box faces + 1, 12000 - 180 pi`, () => {
    const s = measure(sk + `hole(b, { across: 6, along: '${along}' })`);
    near(s.volume, 12000 - 180 * Math.PI);
    assert.equal(s.faces, 7);
    s.bbox.forEach((p, i) => p.forEach((v, k) => near(v, bbox[i][k] ?? v)));
  });
  test(`${plane}: blind deep 8 along ${along} opens on a face (8 faces), bbox unchanged`, () => {
    const s = measure(sk + `hole(b, { across: 6, deep: 8, along: '${along}' })`);
    near(s.volume, 12000 - 72 * Math.PI);
    assert.equal(s.faces, 8);
    s.bbox.forEach((p, i) => p.forEach((v, k) => near(v, bbox[i][k] ?? v)));
  });
}

test('a sketch on a frame (sketch-on-a-face) extrudes and drills the same way', () => {
  const r = runScript("const sk = sketch('top'); sk.rect(30, 20); const b = extrude(sk, 20); hole(b, { across: 6, deep: 8 })");
  assert.deepEqual(r.errors, []);
  const doc = structuredClone(r.doc);
  const sk = doc.features.find(f => f.kind === 'sketch');
  sk.frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] };
  const { refusals, s } = measureDoc(doc);
  assert.deepEqual(refusals, {});
  near(s.volume, 12000 - 72 * Math.PI);
  assert.equal(s.faces, 8);
  assert.deepEqual(doc.features.at(-1).center, [0, 0, 6]);
});

test('circle sketch extrude: blind deep 8 opens on the top (the through bore on a round part is a kernel refusal, same as a plain cylinder: not an extent problem)', () => {
  const sk = "const sk = sketch('top'); sk.circle(30); const b = extrude(sk, 20); ";
  const d = measure(sk + 'hole(b, { across: 6, deep: 8 })');
  near(d.volume, Math.PI * 225 * 20 - 72 * Math.PI);
  assert.equal(d.faces, 6); // base 3 + floor + a bore wall the kernel counts as two (seam)
  const r = runScript(sk + 'hole(b, { across: 6 })');
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.at(-1).depth, 22);
});

test('offset sketch (sketch("top", 5)): blind hole still opens on the top face', () => {
  const s = measure("const sk = sketch('top', 5); sk.rect(30, 20); const b = extrude(sk, 20); hole(b, { across: 6, deep: 8 })");
  near(s.volume, 12000 - 72 * Math.PI);
  assert.equal(s.faces, 8);
  near(s.bbox[0][2], 5); near(s.bbox[1][2], 25);
});

test('union of two stacked boxes: through 8000 - 80 pi, blind 8000 - 32 pi', () => {
  const u = 'const a = cuboid(20, 20, 10); const b = cuboid(20, 20, 10, { at: [0, 0, 10] }); const u = union(a, b); ';
  const t = measure(u + 'hole(u, { across: 4 })');
  near(t.volume, 8000 - 80 * Math.PI);
  assert.equal(t.faces, 11);
  const d = measure(u + 'hole(u, { across: 4, deep: 8 })');
  near(d.volume, 8000 - 32 * Math.PI);
  assert.equal(d.faces, 12);
});

test('subtract result: through works with the first operand as a bound', () => {
  const s = measure('const a = cuboid(40, 40, 20); const c = cylinder(5, 30, { at: [10, 10, 0] }); const q = cut(a, c); hole(q, { across: 4 })');
  near(s.volume, 32000 - 6.25 * Math.PI * 20 - 80 * Math.PI); // 5 mm across = r 2.5, then a 4 mm bore
  assert.equal(s.faces, 8);
});

test('linear pattern along the axis: through every copy; blind starts at the top copy', () => {
  const p = 'const b = cuboid(20, 20, 10); const p = linearPattern(b, { count: 3, step: [0, 0, 15] }); ';
  const t = measure(p + 'hole(p, { across: 4 })');
  near(t.volume, 12000 - 3 * 40 * Math.PI);
  assert.equal(t.faces, 21);
  const d = measure(p + 'hole(p, { across: 4, deep: 8 })');
  near(d.volume, 12000 - 32 * Math.PI);
  assert.equal(d.faces, 20);
  near(d.bbox[1][2], 35);
});

test('a hole in a cut-shape with deep: is a plain script error, not a floating cavity', () => {
  const r = runScript('const a = cuboid(40, 40, 20); const c = cylinder(5, 10, { at: [10, 10, 0] }); const q = cut(a, c); hole(q, { across: 4, deep: 8 })');
  assert.match(r.errors[0].message, /cannot find where the top of this combine is along z exactly/);
});

test('revolve: the extent is read, and a through hole parallel to the axis now cuts exactly (K8)', () => {
  const r = runScript("const sk = sketch('front'); sk.rect(10, 20, { at: [15, 5] }); const r = revolve(sk, 360); hole(r, { across: 4, along: 'y', at: [15, 0] })");
  assert.deepEqual(r.errors, []);
  const { refusals, s } = measureDoc(r.doc);
  assert.deepEqual(refusals, {});
  near(s.volume, Math.PI * (400 - 100) * 20 - Math.PI * 4 * 20); // ring minus the bore
  assert.equal(s.faces, 5);
});

test('unknown thickness (turned box): deep still builds centred and the KERNEL refuses the sealed cavity', () => {
  const r = runScript('const t = cuboid(10, 10, 10); turn(t, [0, 90, 0]); hole(t, { across: 2, deep: 4 })');
  assert.deepEqual(r.errors, []);
  const { refusals, s } = measureDoc(r.doc);
  assert.match(Object.values(refusals)[0], /sealed cavity/);
  assert.equal(s, undefined);
  // a deep that reaches the far side is a through hole and works
  const t = measureDoc(runScript('const t = cuboid(10, 10, 10); turn(t, [0, 90, 0]); hole(t, { across: 2, deep: 14 })').doc);
  near(t.s.volume, 1000 - 10 * Math.PI);
});

test('negatives keep the plain error: a polar pattern and an intersect', () => {
  assert.match(runScript("const b = cuboid(10, 10, 10, { at: [25, 0, 0] }); const p = polarPattern(b, { count: 3, axis: 'z' }); hole(p, { across: 2 })").errors[0].message, /cannot find how thick/);
  assert.match(runScript('const t = intersect(cuboid(10, 10, 10), cylinder(8, 30)); hole(t, { across: 2 })').errors[0].message, /cannot find how thick/);
});
