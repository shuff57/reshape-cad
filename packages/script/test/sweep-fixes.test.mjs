// Script-layer fixes from the FreeCAD variant sweep (docs/replica/freecad/gauntlet/variants). Each one was a silent wrong part:
//   - sk.circle(40); sk.circle(20) on one sketch kept only the LAST shape (the second call replaced the first), so a ring extruded
//     as the 20 disc (4712.39 mm^3 where FreeCAD, given both loops, gives 14137.17).
//   - revolve(sk, -90) and revolve(sk, 400) reached the kernel, which built a solid of |angle|/360 of the full volume in the wrong
//     place (negative) or MORE than the full turn (400 -> 111%).
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

test('revolve and groove take an angle above 0 and at most 360', () => {
  for (const a of [-90, -360, 0, 400, 361]) {
    const e = errs(`const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, ${a});`);
    assert.equal(e.length, 1, `revolve ${a}`);
    assert.match(e[0], /more than 0 and at most 360 degrees/);
    assert.ok(e[0].includes(`got ${a}`), e[0]);
  }
  for (const a of [1, 90, 359, 360]) {
    assert.deepEqual(errs(`const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, ${a});`), [], `revolve ${a}`);
  }
  const g = errs("const b = box(40, 40, 20); const sk = sketch('front'); sk.rect(6, 8, { at: [3, 18] }); groove(sk, b, -90);");
  assert.equal(g.length, 1);
  assert.match(g[0], /groove\(\): the angle is how far the sketch turns/);
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
