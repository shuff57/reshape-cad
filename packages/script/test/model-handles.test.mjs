// SPEC-extrude-drag-handle.md — the Pull height handle. Import from the built
// output the same way a browser or studio import would resolve it (dist/ is
// produced by `npm run build --workspaces`, which the self-check runs first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlesFor } from '../dist/model-handles.js';
import { generatedParams, applyParam } from '../dist/model-codegen.js';

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
