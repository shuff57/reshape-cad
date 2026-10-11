// Fixes from the review of repeat / mirror of pockets and holes (B1-B4, M3, M5). The documents are checked here; the solids
// they build are measured against closed forms in packages/brep-adapter/test/pattern-review-measured.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { solveDoc } from '../dist/model-codegen.js';
import { extentBoundAlong, throughExtentAlong } from '../dist/model-types.js';

const kinds = (r, k) => r.doc.features.filter((f) => f.kind === k);
const msg = (r) => r.errors.map((e) => String(e.message ?? e)).join(' | ');

// ---- B1: a join is followed into EVERY shape it joins ----
const JOINED = (tail) => `const s = sketch('top'); s.rect(40, 30); const plate = pull(s, 10);
const s2 = sketch('top'); s2.rect(40, 30, { at: [30, 0] });
const body = join(plate, pull(s2, 10));
const c = sketch('top', 10); c.circle(6, { at: [0, 0] });
const p = pocket(c, body, 5);
${tail}`;

test('B1: a copy that lies off the first shape but on the joined pad is cut, not dropped', () => {
  const r = runScript(JOINED('repeat(p, { count: 2, step: 40 })'));
  assert.deepEqual(r.errors, []);
  const pk = kinds(r, 'pocket');
  assert.equal(pk.length, 2);
  assert.equal(pk[1].into, pk[0].id);
  const sk = r.doc.features.find((f) => f.id === pk[1].target);
  const cx = (sk.points[0][0] + sk.points[1][0]) / 2;
  assert.equal(cx, 40);
});

test('B1: a copy clear of every joined shape (all straight pulls) is still left out, as FreeCAD does', () => {
  // copy 3 at x = 80 lies off the plate (-20..20) and off the pad (10..50)
  const r = runScript(JOINED('repeat(p, { count: 3, step: 40 })'));
  assert.deepEqual(r.errors, []);
  assert.equal(kinds(r, 'pocket').length, 2);
});

test('B1: a copy that straddles the seam of two joined shapes is refused in a sentence', () => {
  // the pad is shorter than the plate across y, so a copy at x = 20 runs over the plate's end into the narrower pad
  const src = `const s = sketch('top'); s.rect(40, 30); const plate = pull(s, 10);
const s2 = sketch('top'); s2.rect(40, 10, { at: [30, 0] });
const body = join(plate, pull(s2, 10));
const c = sketch('top', 10); c.rect(6, 20, { at: [0, 0] });
const p = pocket(c, body, 5);
repeat(p, { count: 2, step: 20 })`;
  const r = runScript(src);
  assert.equal(r.errors.length, 1);
  assert.match(msg(r), /copy 2 of the cut runs across where two shapes of the part are joined, or reaches the part's edge/);
});

test('B1: a joined shape with no known outline is never used to drop a copy; a copy clear of its box is refused', () => {
  const head = `const s = sketch('top'); s.rect(40, 30); const plate = pull(s, 10);
const ball = sphere(20, { at: [40, 0, 5] });
const body = join(plate, ball);
const c = sketch('top', 10); c.circle(6, { at: [0, 0] });
const p = pocket(c, body, 5);
`;
  // copy 2 at x = 40 lies off the plate but over the ball: it is kept for the kernel to cut, not dropped
  const kept = runScript(head + 'repeat(p, { count: 2, step: 40 })');
  assert.deepEqual(kept.errors, []);
  assert.equal(kinds(kept, 'pocket').length, 2);
  // copy 2 at x = 80 lies clear of the plate and of the ball's box: refused, naming the copy
  const off = runScript(head + 'repeat(p, { count: 2, step: 80 })');
  assert.equal(off.errors.length, 1);
  assert.match(msg(off), /copy 2 of the cut lies wholly off the part, so it would cut nothing/);
});

// ---- B2: a hole on a slanted or tapered pull is not copied from the sketch's middle ----
test('B2: mirror, repeat and repeatAround of a hole on a slanted or tapered pull are refused in a sentence', () => {
  for (const [opts, how] of [['{ direction: [1, 0, 1] }', 'along a slant'], ['{ taper: 5 }', 'with a taper']]) {
    const head = `const s = sketch('top'); s.rect(60, 20); const p = pull(s, 10, ${opts}); const h = hole(p, { across: 4, at: [5, 0] });\n`;
    for (const tail of ["mirror(h, 'left-right', { at: 0 })", 'repeat(h, { count: 2, step: 10 })', "repeatAround(h, { count: 2, axis: 'z' })"]) {
      const r = runScript(head + tail);
      assert.equal(r.errors.length, 1, `${opts} ${tail}`);
      assert.match(msg(r), new RegExp(`the part it drills was pulled ${how}, so brep-rs cannot yet tell where the middle of the part is`), `${opts} ${tail}`);
      assert.equal(kinds(r, 'hole').length, 1, 'the original hole stays; no copy is added');
    }
  }
});

test('B2: the same hole pattern on a straight pull still lowers to copies', () => {
  const r = runScript(`const s = sketch('top'); s.rect(60, 20); const p = pull(s, 10); const h = hole(p, { across: 4, at: [5, 0] });
mirror(h, 'left-right', { at: 0 })`);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(kinds(r, 'hole').map((h) => h.center[0]), [5, -5]);
});

// ---- B3: a saved repeat or mirror of a pocket opens again ----
const ROUND_HEAD = `const s = sketch('top'); s.rect(80, 30); const plate = pull(s, 10);
const c = sketch('top', 10); c.circle(6, { at: [-20, 0] });
const p = pocket(c, plate, 4);
`;
/** The document as JSON, with a circle's two stored points in a fixed order (a reflection swaps them; the circle is the same). */
const norm = (doc) => JSON.parse(JSON.stringify(doc.features)).map((f) =>
  f.kind === 'sketch' && f.shape === 'circle' ? { ...f, points: [...f.points].sort((a, b) => a[0] - b[0] || a[1] - b[1]) } : f);

for (const [name, tail] of [
  ['repeat', 'repeat(p, { count: 3, step: 20 })'],
  ['mirror', "mirror(p, 'left-right', { at: 0 })"],
  ['a hand pocket cut into another pocket', "const c2 = sketch('top', 10); c2.circle(6, { at: [20, 0] }); pocket(c2, p, 4)"],
]) {
  test(`B3: ${name} of a pocket is saved as a script that reopens to the same document`, () => {
    const r = runScript(ROUND_HEAD + tail);
    assert.deepEqual(r.errors, []);
    const text = toScript(r.doc);
    const back = runScript(text);
    assert.deepEqual(back.errors, [], text);
    assert.deepEqual(norm(back.doc), norm(r.doc));
    assert.equal(toScript(back.doc), text, 'the second trip is stable');
    // each pocket a later pocket cuts into is declared before it is named
    for (const pk of kinds(r, 'pocket').slice(1)) assert.match(text, new RegExp(`const ${pk.into} = pocket\\(`));
  });
}

test('B3: a pocket nothing builds on keeps its plain text', () => {
  const r = runScript(ROUND_HEAD);
  assert.match(toScript(r.doc), /^pocket\(sk2, pull1, 4\)$/m);
});

// ---- B4: copies of a sketch with rules are copies of the SOLVED outline ----
const RULED = (tail) => `const s = sketch('top'); s.rect(80, 30); const plate = pull(s, 10);
const c = sketch('top', 10); c.polygon([[-30,-5],[-20,-5],[-20,5],[-30,5]]); c.length(1, 4);
const p = pocket(c, plate, 4);
${tail}`;

test('B4: a repeat copy of a ruled sketch is the solved outline moved, and it survives solveDoc unchanged', () => {
  const r = runScript(RULED('repeat(p, { count: 2, step: 30 })'));
  assert.deepEqual(r.errors, []);
  const solved = solveDoc(r.doc);
  const [orig, copy] = solved.features.filter((f) => f.kind === 'sketch').slice(1);
  assert.equal(copy.constraints, undefined, 'the copy carries no rules to re-solve');
  assert.equal(copy.points.length, orig.points.length);
  copy.points.forEach((q, i) => {
    assert.ok(Math.abs(q[0] - (orig.points[i][0] + 30)) < 1e-12 && Math.abs(q[1] - orig.points[i][1]) < 1e-12, JSON.stringify([q, orig.points[i]]));
  });
  // the rule held: the solved first edge is 4 long (the drawn one was 10)
  const [a, b] = orig.points;
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 4) < 1e-6);
});

test('B4: the edge check reads the solved outline, not the drawn one', () => {
  // Drawn, the square [-12,-2]..[-8,2] is 4 wide; the rule makes its first edge 20 long (x -20..0 solved). Slid by -25, the
  // drawn copy (x -37..-33) fits inside the plate's end at x = -40, the solved one (x -45..-25) runs past it.
  const src = `const s = sketch('top'); s.rect(80, 30); const plate = pull(s, 10);
const c = sketch('top', 10); c.polygon([[-12,-2],[-8,-2],[-8,2],[-12,2]]); c.length(1, 20);
const p = pocket(c, plate, 4);
repeat(p, { count: 2, step: -25 })`;
  const r = runScript(src);
  const drawn = r.doc.features.filter((f) => f.kind === 'sketch')[1];
  assert.ok(Math.min(...drawn.points.map((q) => q[0] - 25)) > -40, 'the drawn copy would fit');
  const solved = solveDoc(r.doc).features.filter((f) => f.kind === 'sketch')[1];
  const xs = solved.points.map((q) => q[0] - 25);
  assert.ok(Math.min(...xs) < -40, `solved copy reaches ${Math.min(...xs)}`);
  assert.equal(r.errors.length, 1);
  assert.match(msg(r), /copy 2 of the cut reaches the edge of the part/);
});

// ---- M3: across a tapered or slanted pull, the outline is not a bound ----
test('M3: a taper or a slant leaves the in-plane range unknown, the sweep range a bound', () => {
  for (const opts of ['{ taper: 10 }', '{ direction: [1, 0, 1] }']) {
    const r = runScript(`const s = sketch('top'); s.rect(60, 20); pull(s, 20, ${opts})`);
    assert.equal(extentBoundAlong(r.doc, 'pull1', 'x'), null, opts);
    assert.equal(extentBoundAlong(r.doc, 'pull1', 'y'), null, opts);
    assert.deepEqual(extentBoundAlong(r.doc, 'pull1', 'z'), { extent: 20, exact: false }, opts);
  }
  // a straight pull is unchanged: exact all round
  const plain = runScript(`const s = sketch('top'); s.rect(60, 20); pull(s, 20)`);
  assert.deepEqual(extentBoundAlong(plain.doc, 'pull1', 'x'), { extent: 60, exact: true });
});

test('M3: a through hole across a tapered or slanted pull asks for a depth instead of stopping short', () => {
  for (const opts of ['{ taper: 10 }', '{ direction: [1, 0, 1] }']) {
    const r = runScript(`const s = sketch('top'); s.rect(60, 20); const p = pull(s, 20, ${opts}); hole(p, { across: 4, along: 'x' })`);
    assert.equal(r.errors.length, 1, opts);
    assert.match(msg(r), /hole\(\) cannot find how thick this extrude is along x yet, so it cannot drill all the way through/, opts);
    assert.equal(throughExtentAlong(r.doc, 'pull1', 'x'), null);
  }
  // down the sweep, the through hole is still drilled
  const down = runScript(`const s = sketch('top'); s.rect(60, 20); const p = pull(s, 20, { taper: 10 }); hole(p, { across: 4 })`);
  assert.deepEqual(down.errors, []);
});

// ---- M5: a copy that misses a cylinder is refused by the script, so no copy is left pointing at a refused one ----
test('M5: a pocket pattern whose copy misses an upright cylinder is refused in one sentence naming that copy', () => {
  const r = runScript(`const b = cylinder(40, 10);
const c = sketch('top', 5); c.circle(6, { at: [10, 0] });
const p = pocket(c, b, 4);
repeat(p, { count: 3, step: 20 })`);
  assert.equal(r.errors.length, 1);
  assert.equal(msg(r), 'repeat() of a pocket cuts a copy of the pocket at each place, and copy 2 of the cut lies wholly off the part, so it would cut nothing. Cut the extra pockets yourself, one sketch and pocket(...) each.');
  assert.equal(kinds(r, 'pocket').length, 1, 'no copy is added');
});

test('M5: copies that stay on the cylinder are cut; one crossing its rim is refused', () => {
  const head = `const b = cylinder(40, 10);
const c = sketch('top', 5); c.circle(6, { at: [-10, 0] });
const p = pocket(c, b, 4);
`;
  const ok = runScript(head + 'repeat(p, { count: 3, step: 10 })');
  assert.deepEqual(ok.errors, []);
  assert.equal(kinds(ok, 'pocket').length, 3);
  const rim = runScript(head + 'repeat(p, { count: 2, step: 28 })');
  assert.match(msg(rim), /copy 2 of the cut reaches the edge of the part/);
});
