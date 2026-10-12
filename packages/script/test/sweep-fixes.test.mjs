// Script-layer fixes from the FreeCAD variant sweep (docs/replica/freecad/gauntlet/variants). Each one was a silent wrong part:
//   - sk.circle(40); sk.circle(20) on one sketch kept only the LAST shape (the second call replaced the first), so a ring extruded
//     as the 20 disc (4712.39 mm^3 where FreeCAD, given both loops, gives 14137.17).
//   - revolve(sk, -90) and revolve(sk, 400) once reached a kernel that built the wrong solid; the kernel now equals FreeCAD for
//     both, so only 0 and absurd magnitudes (past 720 degrees) are still refused.
//   - pocket(sk, shape, 0) / a negative depth came back as "does not touch the part", which names the wrong cause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const errs = (src) => runScript(src).errors.map((e) => e.message ?? String(e));
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10); const s2 = sketch('top', 10); s2.circle(8, { at: [20, 15] });";

test('a second shape call on one sketch is refused instead of replacing the first', () => {
  for (const src of [
    "const sk = sketch('top'); sk.circle(40); sk.circle(20); extrude(sk, 15);",
    "const sk = sketch('top'); sk.rect(40, 30); sk.circle(10); extrude(sk, 15);",
    "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[0,10]]); sk.rect(4, 4); extrude(sk, 15);",
    "const sk = sketch('top'); sk.rect(40, 30); sk.rect(10, 10); extrude(sk, 15);",
  ]) {
    const e = errs(src);
    assert.equal(e.length, 1, src);
    assert.match(e[0], /would replace the \w+ already drawn on this sketch: a sketch holds one outline/);
    assert.match(e[0], /sk\.geom\(\[\.\.\.\]\)/, 'the sentence names the way to get several loops');
  }
});

test('one shape per sketch, a shape on each of two sketches, and rounds on the one outline all still run', () => {
  assert.deepEqual(errs("const sk = sketch('top'); sk.rect(40, 30); sk.round(1, 4); extrude(sk, 15);"), []);
  assert.deepEqual(errs("const a = sketch('top'); a.circle(40); const b = sketch('top'); b.circle(20); extrude(a, 5); extrude(b, 5);"), []);
  assert.deepEqual(errs("const sk = sketch('top'); sk.geom([{ k: 'circle', id: 1, c: [0, 0], r: 20 }, { k: 'circle', id: 2, c: [0, 0], r: 10 }]); extrude(sk, 15);"), []);
});

test('revolve takes a negative angle and a turn past 360; 0, NaN and absurd magnitudes still refuse in a sentence', () => {
  for (const a of [-90, -180, -360, 400, 361, 720, -720, 1, 359]) {
    assert.deepEqual(errs(`const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, ${a});`), [], `revolve ${a}`);
  }
  for (const a of [0, 721, -721, 1e9, -1e9]) {
    const e = errs(`const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, ${a});`);
    assert.equal(e.length, 1, `revolve ${a}`);
    assert.match(e[0], /spin\(\): the angle is how far the sketch turns/);
  }
  const nan = errs("const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, NaN);");
  assert.equal(nan.length, 1);
  assert.match(nan[0], /has to be a number/);
});

test('groove keeps its angle above 0 and at most 360', () => {
  for (const a of [-90, 0, 400]) {
    const g = errs(`const b = box(40, 40, 20); const sk = sketch('front'); sk.rect(6, 8, { at: [3, 18] }); groove(sk, b, ${a});`);
    assert.equal(g.length, 1, `groove ${a}`);
    assert.match(g[0], /groove\(\): the angle is how far the sketch turns/);
  }
});

test('a pocket depth has to be positive, in a sentence that names the depth', () => {
  for (const d of [0, -3]) {
    const e = errs(`${PLATE} pocket(s2, plate, ${d});`);
    assert.equal(e.length, 1, `depth ${d}`);
    assert.match(e[0], /pocket\(\): the depth is how far the cut goes into the material, so it has to be a positive number/);
  }
  assert.deepEqual(errs(`${PLATE} pocket(s2, plate, 4);`), []);
  assert.deepEqual(errs(`${PLATE} pocket(s2, plate, param('d', 4));`), [], 'a slider value is read, not the boxed number');
});
