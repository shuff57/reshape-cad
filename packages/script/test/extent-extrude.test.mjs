// The exact extent along a drill axis, for the shapes a student actually
// drills: a pulled sketch, a union, a linear pattern, a spun profile ...
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { extentBoundAlong, exactExtentAlong, throughExtentAlong } from '../dist/model-types.js';

function ext(code, axis, id) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const last = id ?? r.doc.features.at(-1).id;
  return { e: extentBoundAlong(r.doc, last, axis), exact: exactExtentAlong(r.doc, last, axis), doc: r.doc };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('extrude on top/front/side: sweep axis is the depth, in-plane axes the outline', () => {
  for (const [pl, want] of [['top', { x: 30, y: 20, z: 12 }], ['front', { x: 30, y: 12, z: 20 }], ['side', { x: 12, y: 30, z: 20 }]]) {
    for (const ax of ['x', 'y', 'z']) {
      const { e } = ext(`const sk = sketch('${pl}'); sk.rect(30, 20); extrude(sk, 12)`, ax);
      assert.equal(e.exact, true, `${pl} ${ax}`);
      near(e.extent, want[ax]);
    }
  }
});

test('circle sketch uses the real diameter; a rounded corner keeps the outline extent; a bulged edge reaches its arc extreme', () => {
  near(ext("const sk = sketch('top'); sk.circle(10); extrude(sk, 5)", 'x').e.extent, 10);
  // a rounded corner on the extreme corner shrinks the box nowhere (the other
  // corners still reach the edge), so the extent stays the full 30 x 20
  near(ext("const sk = sketch('top'); sk.rect(30, 20); sk.round(0, 3); extrude(sk, 5)", 'x').e.extent, 30);
});

test('bulged edge: semicircle on the right edge of a 10 x 10 square reaches x = 15 (or 5 inward)', () => {
  const doc = (bulge) => ({ features: [
    { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [10, 0], [10, 10], [0, 10]], bulges: { 1: bulge } },
    { id: 'pull1', kind: 'extrude', target: 'sk1', height: 4 },
  ] });
  const out = extentBoundAlong(doc(1), 'pull1', 'x').extent;
  const inn = extentBoundAlong(doc(-1), 'pull1', 'x').extent;
  assert.ok(Math.abs(out - 15) < 1e-9 || Math.abs(inn - 15) < 1e-9, `${out} ${inn}`);
  assert.ok(Math.abs(Math.min(out, inn) - 10) < 1e-9, `${out} ${inn}`);
  near(extentBoundAlong(doc(1), 'pull1', 'y').extent, 10);
});

test('offset sketch extrude: extent along the sweep is still the depth', () => {
  near(ext("const sk = sketch('top', 5); sk.rect(30, 20); extrude(sk, 20)", 'z').e.extent, 20);
});

test('union of stacked boxes: bbox union; separated boxes include the gap', () => {
  near(ext('const a = cuboid(20, 20, 10); const b = cuboid(20, 20, 10, { at: [0, 0, 10] }); union(a, b)', 'z').e.extent, 20);
  near(ext('const a = cuboid(20, 20, 10); const b = cuboid(20, 20, 10, { at: [0, 0, 30] }); union(a, b)', 'z').e.extent, 40);
});

test('subtract: only a bound (a cut can slice an end off), usable for through, not for blind', () => {
  const { e, exact } = ext('const a = cuboid(40, 40, 20); const c = cylinder(5, 10, { at: [10, 10, 0] }); cut(a, c)', 'z');
  assert.equal(e.exact, false);
  near(e.extent, 20);
  assert.equal(exact, null);
  const r = runScript('const a = cuboid(40, 40, 20); const c = cylinder(5, 10, { at: [10, 10, 0] }); const s = cut(a, c); hole(s, { across: 4, deep: 8 })');
  assert.match(r.errors[0].message, /cannot find where the top of this combine is along z exactly/);
  assert.deepEqual(runScript('const a = cuboid(40, 40, 20); const c = cylinder(5, 10, { at: [10, 10, 0] }); const s = cut(a, c); hole(s, { across: 4 })').errors, []);
});

test('wedge is exact (width x depth x height) but a prism across its corners is only a bound', () => {
  assert.equal(ext('wedge(30, 20, 10)', 'y').e.exact, true);
  const p = ext('prism(6, 10, 20)', 'x');
  assert.equal(p.e.exact, false);
  assert.equal(ext('prism(6, 10, 20)', 'z').e.exact, true);
  const r = runScript('const p = prism(6, 10, 20); hole(p, { across: 2, deep: 5, along: "x" })');
  assert.match(r.errors[0].message, /cannot find where the top of this prism is/);
});

test('linear pattern adds step * (count - 1) along its own direction', () => {
  near(ext('const b = cuboid(20, 20, 10); linearPattern(b, { count: 3, step: [0, 0, 15] })', 'z').e.extent, 40);
  near(ext('const b = cuboid(20, 20, 10); linearPattern(b, { count: 3, step: [0, 0, -15] })', 'z').e.extent, 40);
  near(ext('const b = cuboid(20, 20, 10); linearPattern(b, { count: 3, step: [0, 0, 15] })', 'x').e.extent, 20);
});

test('move (also a copy) shifts, never grows; mirror is exact off its own axis only', () => {
  near(ext('const b = cuboid(20, 20, 10); move(b, [0, 0, 30], { copy: true })', 'z').e.extent, 10);
  near(ext("const b = cuboid(20, 20, 10, { at: [0, 0, 10] }); mirror(b, 'top-bottom')", 'x').e.extent, 20);
  assert.equal(ext("const b = cuboid(20, 20, 10, { at: [0, 0, 10] }); mirror(b, 'top-bottom')", 'z').e, null);
});

test('revolve: height along the plane normal, 2 x outer radius across (xz, 360)', () => {
  const code = "const sk = sketch('front'); sk.rect(10, 20, { at: [15, 5] }); revolve(sk, 360)";
  near(ext(code, 'y').e.extent, 20);
  near(ext(code, 'x').e.extent, 40);
  near(ext(code, 'z').e.extent, 40);
  assert.equal(ext("const sk = sketch('front'); sk.rect(10, 20, { at: [15, 5] }); revolve(sk, 90)", 'x').e, null);
});

test('hole through an extrude needs no depth, and deep: sets the offset from the exact thickness', () => {
  const r = runScript("const sk = sketch('top'); sk.rect(30, 20); const b = extrude(sk, 20); hole(b, { across: 6 }); ");
  assert.deepEqual(r.errors, []);
  const d = runScript("const sk = sketch('top'); sk.rect(30, 20); const b = extrude(sk, 20); hole(b, { across: 6, deep: 8 })");
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.doc.features.at(-1).center, [0, 0, 6]);
});

test('not provable stays null: intersect of two boxes, polar pattern of a cone about another axis', () => {
  const doc = (c) => runScript(c).doc;
  assert.equal(throughExtentAlong(doc('const t = intersect(cuboid(10, 10, 10), cuboid(10, 10, 10))'), 'combine1', 'z'), null);
  const p = runScript("const b = cone(6, 12, { at: [25, 0, 0] }); polarPattern(b, { count: 3, axis: 'y' })");
  assert.equal(throughExtentAlong(p.doc, p.doc.features.at(-1).id, 'z'), null);
  assert.match(runScript("const b = cone(6, 12, { at: [25, 0, 0] }); const p = polarPattern(b, { count: 3, axis: 'y' }); hole(p, { across: 2 })").errors[0].message, /cannot find how thick this cone is/);
});
