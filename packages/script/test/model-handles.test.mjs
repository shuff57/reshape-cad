// SPEC-extrude-drag-handle.md — the Pull height handle. Import from the built
// output the same way a browser or studio import would resolve it (dist/ is
// produced by `npm run build --workspaces`, which the self-check runs first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlesFor } from '../dist/model-handles.js';
import { generatedParams, applyParam } from '../dist/model-codegen.js';
import { topLevel } from '../dist/model-types.js';

const EPS = 1e-9;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < EPS, msg ?? `expected ${a} ~= ${b}`);
const closeVec = (a, b, msg) => {
  assert.equal(a.length, b.length, msg);
  for (let i = 0; i < a.length; i++) close(a[i], b[i], `${msg ?? ''} [${i}]: ${a[i]} !~ ${b[i]}`);
};

const RECT = [[0, 0], [30, 0], [30, 5], [0, 5]];

function sketch(id, plane, offset, points, shape) {
  const f = { id, kind: 'sketch', plane, offset, points };
  if (shape) f.shape = shape;
  return f;
}

function extrude(id, target, height) {
  return { id, kind: 'extrude', target, height };
}

function docWith(...features) {
  return { version: 1, features };
}

// --- #1: xy@0 RECT-40x25, h 12 -----------------------------------------
test('#1 xy@0 RECT 40x25, h12 -> exactly one spec at the cap centre', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  const s = specs[0];
  assert.equal(s.kind, 'size');
  assert.equal(s.param, 'pull1_height');
  closeVec(s.origin, [20, 12.5, 12]);
  closeVec(s.axis, [0, 0, 1]);
  assert.equal(s.scale, 1);
  assert.equal(s.label, 'height');
});

// --- #2: as #1, h 30 -----------------------------------------------------
test('#2 as #1 but h30 -> origin follows the cap', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]);
  const pull1 = extrude('pull1', 'sk1', 30);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [20, 12.5, 30]);
});

// --- #3: xz@0 RECT h12 -- the direction trap -----------------------------
test('#3 xz@0 RECT h12 -- direction trap, cap at y=-12', () => {
  const sk1 = sketch('sk1', 'xz', 0, RECT);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [15, -12, 2.5]);
  closeVec(specs[0].axis, [0, -1, 0]);
});

// --- #4: xz@10 RECT h12 ---------------------------------------------------
test('#4 xz@10 RECT h12 -- offset carried with the right sign', () => {
  const sk1 = sketch('sk1', 'xz', 10, RECT);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [15, -2, 2.5]);
  closeVec(specs[0].axis, [0, -1, 0]);
});

// --- #5: yz@-8 RECT h12 ----------------------------------------------------
test('#5 yz@-8 RECT h12 -- dir stays +1 off xz', () => {
  const sk1 = sketch('sk1', 'yz', -8, RECT);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [4, 15, 2.5]);
  closeVec(specs[0].axis, [1, 0, 0]);
});

// --- #6: xy@15 RECT h12 -----------------------------------------------------
test('#6 xy@15 RECT h12 -- offset not dropped', () => {
  const sk1 = sketch('sk1', 'xy', 15, RECT);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [15, 2.5, 27]);
  closeVec(specs[0].axis, [0, 0, 1]);
});

// --- #7: circle sketch at origin --------------------------------------------
test('#7 xy@0 circle centred at origin, h12', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[-10, 0], [10, 0]], 'circle');
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [0, 0, 12]);
});

// --- #8: circle sketch off-centre -------------------------------------------
test('#8 as #7 but centred at [30,-5]', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[20, -5], [40, -5]], 'circle');
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [30, -5, 12]);
});

// --- #9: target names nothing -----------------------------------------------
test('#9 pull1.target names no feature in the doc -> []', () => {
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(pull1);
  assert.deepEqual(handlesFor(pull1, doc), []);
});

// --- #10: target names a box -------------------------------------------------
test('#10 pull1.target names a box, not a sketch -> []', () => {
  const box1 = { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] };
  const pull1 = extrude('pull1', 'box1', 12);
  const doc = docWith(box1, pull1);
  assert.deepEqual(handlesFor(pull1, doc), []);
});

// --- #11: no doc at all -------------------------------------------------------
test('#11 handlesFor(pull1) with no doc -> []', () => {
  const pull1 = extrude('pull1', 'sk1', 12);
  assert.deepEqual(handlesFor(pull1), []);
});

// --- #12: sketch cannot close --------------------------------------------------
test('#12 target sketch has 2 points, not tagged circle -> []', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [10, 0]]);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  assert.deepEqual(handlesFor(pull1, doc), []);
});

// --- #13: generatedParams param name matches -----------------------------------
test('#13 generatedParams emits pull1_height=12 matching the handle param', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const params = generatedParams(doc);
  const p = params.find((x) => x.name === 'pull1_height');
  assert.ok(p, 'pull1_height exists in generatedParams');
  assert.equal(p.value, 12);
  const specs = handlesFor(pull1, doc);
  assert.equal(specs[0].param, p.name);
});

// --- #14: applyParam writes back the height, nothing else ------------------------
test('#14 applyParam(doc, "pull1_height", 25) sets pull1.height, nothing else changes', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const next = applyParam(doc, 'pull1_height', 25);
  const nextPull = next.features.find((f) => f.id === 'pull1');
  const nextSk = next.features.find((f) => f.id === 'sk1');
  assert.equal(nextPull.height, 25);
  assert.deepEqual(nextSk, sk1);
});

// --- #15: origin tracks the value it drives, for every fixture #1-#8 -------------
function fixtureDoc(n) {
  switch (n) {
    case 1: return docWith(
      sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]),
      extrude('pull1', 'sk1', 12),
    );
    case 2: return docWith(
      sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]),
      extrude('pull1', 'sk1', 30),
    );
    case 3: return docWith(sketch('sk1', 'xz', 0, RECT), extrude('pull1', 'sk1', 12));
    case 4: return docWith(sketch('sk1', 'xz', 10, RECT), extrude('pull1', 'sk1', 12));
    case 5: return docWith(sketch('sk1', 'yz', -8, RECT), extrude('pull1', 'sk1', 12));
    case 6: return docWith(sketch('sk1', 'xy', 15, RECT), extrude('pull1', 'sk1', 12));
    case 7: return docWith(
      sketch('sk1', 'xy', 0, [[-10, 0], [10, 0]], 'circle'),
      extrude('pull1', 'sk1', 12),
    );
    case 8: return docWith(
      sketch('sk1', 'xy', 0, [[20, -5], [40, -5]], 'circle'),
      extrude('pull1', 'sk1', 12),
    );
    default: throw new Error(`no fixture ${n}`);
  }
}

for (let n = 1; n <= 8; n++) {
  test(`#15 fixture #${n}: origin moves exactly 5 x axis after applyParam(+5)`, () => {
    const doc = fixtureDoc(n);
    const pull1 = doc.features.find((f) => f.kind === 'extrude');
    const before = handlesFor(pull1, doc)[0];
    const nextDoc = applyParam(doc, before.param, pull1.height + 5);
    const nextPull = nextDoc.features.find((f) => f.id === pull1.id);
    const after = handlesFor(nextPull, nextDoc)[0];

    closeVec(after.axis, before.axis, `fixture #${n} axis unchanged`);
    assert.equal(after.scale, before.scale, `fixture #${n} scale unchanged`);
    for (let i = 0; i < 3; i++) {
      const moved = after.origin[i] - before.origin[i];
      const expected = 5 * before.axis[i];
      close(moved, expected, `fixture #${n} axis ${i}: moved ${moved} !~ expected ${expected}`);
    }
  });
}

// --- #16: scales map builds scale 1, not 2 ---------------------------------------
test('#16 scales map from specs -> pull1_height is 1', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(pull1, doc);
  const scales = Object.fromEntries(specs.map((h) => [h.param, h.scale]));
  assert.equal(scales['pull1_height'], 1);
});

// --- #17: handlesFor(sketch) unaffected -------------------------------------------
test('#17 handlesFor(sk1, doc) still returns its 4 corner handles', () => {
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [40, 0], [40, 25], [0, 25]]);
  const pull1 = extrude('pull1', 'sk1', 12);
  const doc = docWith(sk1, pull1);
  const specs = handlesFor(sk1, doc);
  assert.equal(specs.length, 4);
  for (const s of specs) assert.equal(s.kind, 'point');
});

// --- #18: every emitted axis is a unit vector --------------------------------------
test('#18 every fixture #1-#8 emits a unit-length axis', () => {
  for (let n = 1; n <= 8; n++) {
    const doc = fixtureDoc(n);
    const pull1 = doc.features.find((f) => f.kind === 'extrude');
    const specs = handlesFor(pull1, doc);
    for (const s of specs) {
      const len = Math.hypot(s.axis[0], s.axis[1], s.axis[2]);
      close(len, 1, `fixture #${n}: axis length ${len} !~ 1`);
    }
  }
});

// =====================================================================
// SPEC-pocket-drag-handle.md — the Pocket depth handle. §7's table,
// rows 1-18. `RECT`/`SQ8` and the [M] markers are the spec's own.
// =====================================================================

const SQ8 = [[-5, -4], [5, -4], [5, 4], [-5, 4]]; // centre [0, 0]

function pocket(id, target, into, depth) {
  return { id, kind: 'pocket', target, into, depth };
}

function box(id, size, center) {
  return { id, kind: 'box', size, center };
}

// Every pocket fixture also carries box1 so the `into` guard is satisfied.
function pocketFixtureDoc(n) {
  const box1 = box('box1', [100, 100, 100], [0, 0, 0]);
  switch (n) {
    case 1: return docWith(box1, sketch('sk1', 'xy', 0, RECT), pocket('pk1', 'sk1', 'box1', 12));
    case 2: return docWith(box1, sketch('sk1', 'xy', 6, SQ8), pocket('pk1', 'sk1', 'box1', 5));
    case 3: return docWith(box1, sketch('sk1', 'xz', 2, SQ8), pocket('pk1', 'sk1', 'box1', 5));
    case 4: return docWith(box1, sketch('sk1', 'yz', 6, SQ8), pocket('pk1', 'sk1', 'box1', 5));
    case 5: return docWith(box1, sketch('sk1', 'xz', 10, RECT), pocket('pk1', 'sk1', 'box1', 6));
    case 6: return docWith(box1, sketch('sk1', 'xy', 6, [[7, -6], [17, -6]], 'circle'), pocket('pk1', 'sk1', 'box1', 5));
    default: throw new Error(`no pocket fixture ${n}`);
  }
}

// --- SPEC-pocket-crossbody.md §8.3/§4.4 pin -----------------------------
// No behaviour change expected here: pocketHandles() reads only sk.plane,
// sk.offset, f.depth and the EXISTENCE of f.into, all off the ModelDoc --
// never a body, an engine, a face, or an EngineBuildResult. `into` naming a
// separate feature (rather than the profile's own extrude) is already the
// shape it guards for, so lifting the FreeCAD engine's cross-body pocket
// refusal needed no handle work. This pins that a doc of three genuinely
// independent features -- box, sketch, pocket -- still yields exactly one
// handle, so a later reader does not "fix" pocketHandles() for this case.
test('pocket into a cross-body target (box + sketch + pocket, three independent features) -> exactly one handle, unchanged', () => {
  const box1 = box('box1', [100, 100, 100], [0, 0, 0]);
  const sk1 = sketch('sk1', 'xy', 6, SQ8);
  const p1 = pocket('p1', 'sk1', 'box1', 5);
  const doc = docWith(box1, sk1, p1);
  const specs = handlesFor(p1, doc);
  assert.equal(specs.length, 1);
  const s = specs[0];
  assert.equal(s.kind, 'size');
  assert.equal(s.param, 'p1_depth');
  closeVec(s.origin, [0, 0, 1], 'origin z = offset(6) - depth(5) = 1');
  closeVec(s.axis, [0, 0, -1]);
});

// --- pocket #1: xy@0 RECT, depth 12 -------------------------------------
test('pocket #1 xy@0 RECT depth12 -> exactly one spec at the floor', () => {
  const doc = pocketFixtureDoc(1);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const specs = handlesFor(pk1, doc);
  assert.equal(specs.length, 1);
  const s = specs[0];
  assert.equal(s.kind, 'size');
  assert.equal(s.param, 'pk1_depth');
  closeVec(s.origin, [15, 2.5, -12]);
  closeVec(s.axis, [0, 0, -1]);
  assert.equal(s.scale, 1);
  assert.equal(s.label, 'deep');
});

// --- pocket #2: xy@6 SQ8, depth 5 -- fixture G1 -------------------------
test('pocket #2 [M] xy@6 SQ8 depth5 -- fixture G1, floor at z=1', () => {
  const doc = pocketFixtureDoc(2);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const specs = handlesFor(pk1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [0, 0, 1]);
  closeVec(specs[0].axis, [0, 0, -1]);
});

// --- pocket #3: xz@2 SQ8, depth 5 -- fixture G2 -------------------------
test('pocket #3 [M] xz@2 SQ8 depth5 -- fixture G2, floor at y=7', () => {
  const doc = pocketFixtureDoc(3);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const specs = handlesFor(pk1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [0, 7, 0]);
  closeVec(specs[0].axis, [0, 1, 0]);
});

// --- pocket #4: yz@6 SQ8, depth 5 -- fixture G3 -------------------------
test('pocket #4 [M] yz@6 SQ8 depth5 -- fixture G3, floor at x=1', () => {
  const doc = pocketFixtureDoc(4);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const specs = handlesFor(pk1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [1, 0, 0]);
  closeVec(specs[0].axis, [-1, 0, 0]);
});

// --- pocket #5: xz@10 RECT, depth 6 -- the worked example ---------------
test('pocket #5 [M] xz@10 RECT depth6 -- worked example, measured 71100/24600', () => {
  const doc = pocketFixtureDoc(5);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const specs = handlesFor(pk1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [15, 16, 2.5]);
  closeVec(specs[0].axis, [0, 1, 0]);
});

// --- pocket #6: xy@6 circle off-centre, depth 5 -- fixture G5 -----------
test('pocket #6 [M] xy@6 circle depth5 -- fixture G5, bbox centre off-axis', () => {
  const doc = pocketFixtureDoc(6);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const specs = handlesFor(pk1, doc);
  assert.equal(specs.length, 1);
  closeVec(specs[0].origin, [12, -6, 1]);
});

// --- pocket #7: target names no feature ---------------------------------
test('pocket #7 pk1.target names no feature -> []', () => {
  const box1 = box('box1', [100, 100, 100], [0, 0, 0]);
  const pk1 = pocket('pk1', 'sk1', 'box1', 12);
  const doc = docWith(box1, pk1);
  assert.deepEqual(handlesFor(pk1, doc), []);
});

// --- pocket #8: target names a box --------------------------------------
test('pocket #8 pk1.target names a box, not a sketch -> []', () => {
  const box1 = box('box1', [100, 100, 100], [0, 0, 0]);
  const box2 = box('box2', [10, 10, 10], [0, 0, 0]);
  const pk1 = pocket('pk1', 'box2', 'box1', 12);
  const doc = docWith(box1, box2, pk1);
  assert.deepEqual(handlesFor(pk1, doc), []);
});

// --- pocket #9: into names no feature ------------------------------------
test('pocket #9 pk1.into names no feature -> []', () => {
  const sk1 = sketch('sk1', 'xy', 0, RECT);
  const pk1 = pocket('pk1', 'sk1', 'box1', 12);
  const doc = docWith(sk1, pk1);
  assert.deepEqual(handlesFor(pk1, doc), []);
});

// --- pocket #10: no doc at all --------------------------------------------
test('pocket #10 handlesFor(pk1) with no doc -> []', () => {
  const pk1 = pocket('pk1', 'sk1', 'box1', 12);
  assert.deepEqual(handlesFor(pk1), []);
});

// --- pocket #11: sketch cannot close --------------------------------------
test('pocket #11 target sketch has 2 points, not tagged circle -> []', () => {
  const box1 = box('box1', [100, 100, 100], [0, 0, 0]);
  const sk1 = sketch('sk1', 'xy', 0, [[0, 0], [10, 0]]);
  const pk1 = pocket('pk1', 'sk1', 'box1', 12);
  const doc = docWith(box1, sk1, pk1);
  assert.deepEqual(handlesFor(pk1, doc), []);
});

// --- pocket #12: generatedParams param name matches -----------------------
test('pocket #12 generatedParams emits pk1_depth=12 matching the handle param', () => {
  const doc = pocketFixtureDoc(1);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const params = generatedParams(doc);
  const p = params.find((x) => x.name === 'pk1_depth');
  assert.ok(p, 'pk1_depth exists in generatedParams');
  assert.equal(p.value, 12);
  const specs = handlesFor(pk1, doc);
  assert.equal(specs[0].param, p.name);
});

// --- pocket #13: applyParam writes back the depth, nothing else -----------
test('pocket #13 applyParam(doc, "pk1_depth", 25) sets pk1.depth, nothing else changes', () => {
  const doc = pocketFixtureDoc(1);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const sk1 = doc.features.find((f) => f.id === 'sk1');
  const next = applyParam(doc, 'pk1_depth', 25);
  const nextPk1 = next.features.find((f) => f.id === 'pk1');
  const nextSk1 = next.features.find((f) => f.id === 'sk1');
  assert.equal(nextPk1.depth, 25);
  assert.deepEqual(nextSk1, sk1);
});

// --- pocket #14: origin tracks the value it drives, for every fixture #1-#6 -
for (let n = 1; n <= 6; n++) {
  test(`pocket #14 fixture #${n}: origin moves exactly 5 x axis after applyParam(+5)`, () => {
    const doc = pocketFixtureDoc(n);
    const pk1 = doc.features.find((f) => f.kind === 'pocket');
    const before = handlesFor(pk1, doc)[0];
    const nextDoc = applyParam(doc, before.param, pk1.depth + 5);
    const nextPk1 = nextDoc.features.find((f) => f.id === pk1.id);
    const after = handlesFor(nextPk1, nextDoc)[0];

    closeVec(after.axis, before.axis, `pocket fixture #${n} axis unchanged`);
    assert.equal(after.scale, before.scale, `pocket fixture #${n} scale unchanged`);
    for (let i = 0; i < 3; i++) {
      const moved = after.origin[i] - before.origin[i];
      const expected = 5 * before.axis[i];
      close(moved, expected, `pocket fixture #${n} axis ${i}: moved ${moved} !~ expected ${expected}`);
    }
  });
}

// --- pocket #15: every emitted axis is a unit vector -----------------------
test('pocket #15 every fixture #1-#6 emits a unit-length axis', () => {
  for (let n = 1; n <= 6; n++) {
    const doc = pocketFixtureDoc(n);
    const pk1 = doc.features.find((f) => f.kind === 'pocket');
    const specs = handlesFor(pk1, doc);
    for (const s of specs) {
      const len = Math.hypot(s.axis[0], s.axis[1], s.axis[2]);
      close(len, 1, `pocket fixture #${n}: axis length ${len} !~ 1`);
    }
  }
});

// --- pocket #16: scales map builds scale 1 ----------------------------------
test('pocket #16 scales map from specs -> pk1_depth is 1', () => {
  const doc = pocketFixtureDoc(1);
  const pk1 = doc.features.find((f) => f.kind === 'pocket');
  const specs = handlesFor(pk1, doc);
  const scales = Object.fromEntries(specs.map((h) => [h.param, h.scale]));
  assert.equal(scales['pk1_depth'], 1);
});

// --- pocket #17: extrude vs pocket on the same sketch -- exact negatives ----
test('pocket #17 [M] same sketch, extrude vs pocket -> axes are exact componentwise negatives on xy/xz/yz', () => {
  const box1 = box('box1', [100, 100, 100], [0, 0, 0]);
  for (const plane of ['xy', 'xz', 'yz']) {
    const sk1 = sketch('sk1', plane, 0, RECT);
    const pull1 = extrude('pull1', 'sk1', 12);
    const pk1 = pocket('pk1', 'sk1', 'box1', 12);
    const doc = docWith(box1, sk1, pull1, pk1);
    const extrudeAxis = handlesFor(pull1, doc)[0].axis;
    const pocketAxis = handlesFor(pk1, doc)[0].axis;
    for (let i = 0; i < 3; i++) {
      close(pocketAxis[i], -extrudeAxis[i], `plane ${plane} axis ${i}: pocket ${pocketAxis[i]} !~ -extrude ${-extrudeAxis[i]}`);
    }
  }
});

// --- pocket #18: topLevel() consumes the pocket's victim --------------------
test('pocket #18 topLevel(doc) for fixture #1 does not contain box1, does contain pk1', () => {
  const doc = pocketFixtureDoc(1);
  const top = topLevel(doc);
  const ids = top.map((f) => f.id);
  assert.ok(!ids.includes('box1'), `topLevel should not contain box1, got ${ids}`);
  assert.ok(ids.includes('pk1'), `topLevel should contain pk1, got ${ids}`);
});
