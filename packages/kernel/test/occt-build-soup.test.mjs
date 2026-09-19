// The REFEREE learns soup sketches (SPEC-sketcher2 §5.3, §8.2).
//
// WHY THIS SUITE EXISTS. brep-rs shipped multi-loop profiles -- a rectangle
// with a circle inside it extrudes to a washer -- with NO independent oracle.
// occt-build.ts read only `points`, so scripts/brep-parity-gate.mjs could not
// build a soup sketch on OCCT at all and the washer's 11057.522204 was brep-rs
// marking its own homework. packages/kernel/AGENTS.md calls this file "the only
// independent oracle over a kernel whose signature failure is the wrong answer
// rather than the missing one"; a kernel feature outside it has no referee.
//
// THE DANGER THIS SUITE IS SHAPED AROUND. A face with a hole can go wrong three
// ways that all LOOK fine, measured on this build before the code was written:
//   inner wire as built      -> 12942.477796  (bore ADDED, not cut)
//   outer/hole roles swapped -> -11057.522204 (negative volume)
//   inner wire dropped       ->  12000        (a solid plate)
// A referee that returns any of those silently turns a green fixture into a
// lie -- worse than the missing feature, because the gate would REPORT it as
// agreement. So every test here asserts the exact number, not "it built".
//
// Cross-kernel where it counts: the arc case asserts OCCT against brep-rs's own
// measure_doc rather than a hand-typed constant, because an arc convention that
// drifts between the two kernels is exactly what a referee is for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');

const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });

const { buildDoc } = await import('../dist/occt-build.js');
const { facesOf } = await import('../dist/topo-resolve.js');
const arc = await import('../../sketch/dist/sketch-arc.js');

const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

// --- measured exactly as scripts/brep-parity-gate.mjs measures ---------------
function volumeOf(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  return g.Mass();
}
function areaOf(face) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(face, g, false, false);
  return g.Mass();
}
function bboxOf(shape) {
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin();
  const hi = box.CornerMax();
  return [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]];
}
function isValid(shape) {
  return new oc.BRepCheck_Analyzer(shape, true, false).IsValid();
}
function close(got, want, what, tol = 1e-6) {
  assert.ok(
    Number.isFinite(got) && Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)),
    `${what}: got ${got}, want ${want}`,
  );
}

/** brep-rs's own answer for the same doc -- the thing OCCT is refereeing. */
function brepMeasure(doc, id) {
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  if (m.refusals?.[id]) return { refusal: m.refusals[id] };
  const s = m.shapes?.[id];
  return s ? { volume: s.volume, faces: s.faces } : { refusal: 'no shape' };
}

// --- the docs ----------------------------------------------------------------
const WELD = [
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'horizontal', a: 1 },
  { k: 'vertical', a: 2 },
];
const RECT = [
  { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
  { k: 'line', id: 2, a: [40, 0], b: [40, 25] },
  { k: 'line', id: 3, a: [40, 25], b: [0, 25] },
  { k: 'line', id: 4, a: [0, 25], b: [0, 0] },
];

const doc = (geoms, rules = WELD, extrude = true) => ({
  version: 1,
  features: [
    { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, geoms, rules },
    ...(extrude ? [{ id: 'e1', kind: 'extrude', target: 'sk1', height: 12 }] : []),
  ],
});

const WASHER = doc([...RECT, { k: 'circle', id: 5, c: [20, 12.5], r: 5 }]);
const WASHER_VOL = (40 * 25 - Math.PI * 25) * 12;   // 11057.522203923063
const WASHER_AREA = 40 * 25 - Math.PI * 25;         //   921.4601836602552

// --- S1: the point of the slice ---------------------------------------------
test('S1 a soup washer builds on OCCT with a real bore', () => {
  const built = buildDoc(oc, WASHER, arc);
  assert.equal(built.refusals?.get('e1') ?? null, null, 'no refusal on the extrude');
  const shape = built.shapes.get('e1');
  assert.ok(shape, 'OCCT must build the soup washer');

  close(volumeOf(shape), WASHER_VOL, 'washer volume');
  assert.equal(facesOf(oc, shape).length, 7, '4 walls + 1 bore + 2 caps');
  assert.ok(isValid(shape), 'BRepCheck_Analyzer must call the washer valid');
  const bb = bboxOf(shape);
  close(bb[0][0], 0, 'bbox lo x'); close(bb[0][1], 0, 'bbox lo y'); close(bb[0][2], 0, 'bbox lo z');
  close(bb[1][0], 40, 'bbox hi x'); close(bb[1][1], 25, 'bbox hi y'); close(bb[1][2], 12, 'bbox hi z');
});

// --- S6: the trap, asserted at the face where it would start ----------------
test('S6 the profile face carries the bore (area, not just volume)', () => {
  const built = buildDoc(oc, WASHER, arc);
  const face = built.shapes.get('sk1');
  assert.ok(face, 'the sketch itself is kept as a face');
  // 1000 here would mean the inner wire was accepted and silently ignored --
  // the failure mode that survives a volume-blind eye all the way to a green
  // fixture. 921.46 is the only honest answer.
  close(areaOf(face), WASHER_AREA, 'profile face area');
});

// --- S1b: the referee agrees with the kernel it referees --------------------
test('S1b OCCT and brep-rs agree on the soup washer', () => {
  const mine = brepMeasure(WASHER, 'e1');
  assert.equal(mine.refusal ?? null, null, `brep-rs refused: ${mine.refusal}`);
  const ref = volumeOf(buildDoc(oc, WASHER, arc).shapes.get('e1'));
  close(mine.volume, ref, 'brep-rs vs OCCT on the washer');
  // Face counts DIFFER legitimately (brep-rs splits the bore into two half
  // cylinders, 8; OCCT keeps one, 7) and the gate's rule is a BOUND, not
  // equality -- brep-parity-gate.mjs:181, `mine.faces > 2 * occtFaces + 4`.
  assert.equal(mine.faces, 8, 'brep-rs splits the bore wall');
  assert.ok(mine.faces <= 2 * 7 + 4, 'and stays inside the gate face bound');
});

// --- S2: edge, one loop and no hole -----------------------------------------
test('S2 a single-loop soup sketch is still a plain plate', () => {
  const built = buildDoc(oc, doc(RECT), arc);
  const shape = built.shapes.get('e1');
  assert.ok(shape, 'OCCT must build a single-loop soup sketch');
  close(volumeOf(shape), 12000, 'plate volume');
  assert.equal(facesOf(oc, shape).length, 6, 'a swept rectangle is 6 faces');
  assert.ok(isValid(shape), 'BRepCheck must call the plate valid');
  const bb = bboxOf(shape);
  close(bb[1][2], 12, 'pulled the same way the classic path pulls');
});

// --- S2b: edge, a loop wound the wrong way round ----------------------------
test('S2b a clockwise soup loop does not come out negative', () => {
  const cw = [
    { k: 'line', id: 1, a: [0, 0], b: [0, 25] },
    { k: 'line', id: 2, a: [0, 25], b: [40, 25] },
    { k: 'line', id: 3, a: [40, 25], b: [40, 0] },
    { k: 'line', id: 4, a: [40, 0], b: [0, 0] },
  ];
  const shape = buildDoc(oc, doc(cw, [
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
    { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
    { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
    { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  ]), arc).shapes.get('e1');
  assert.ok(shape, 'a clockwise loop still builds');
  close(volumeOf(shape), 12000, 'clockwise plate volume is POSITIVE 12000');
});

// --- S3: edge, arcs (the convention most likely to drift) -------------------
// An obround: two 20-long straights joined by two r10 semicircles.
// 20*20 + pi*100 = 714.1592653589793, pulled 12 -> 8569.911184307752.
const OBROUND = [
  { k: 'line', id: 1, a: [10, 0], b: [30, 0] },
  { k: 'arc', id: 2, c: [30, 10], r: 10, a: [30, 0], b: [30, 20], sense: 'ccw' },
  { k: 'line', id: 3, a: [30, 20], b: [10, 20] },
  { k: 'arc', id: 4, c: [10, 10], r: 10, a: [10, 20], b: [10, 0], sense: 'ccw' },
];
test('S3 a soup loop with arcs matches brep-rs exactly', () => {
  const d = doc(OBROUND, [
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
    { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
    { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
    { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  ]);
  const shape = buildDoc(oc, d, arc).shapes.get('e1');
  assert.ok(shape, 'OCCT must build a soup loop with arcs');
  close(volumeOf(shape), (400 + Math.PI * 100) * 12, 'obround volume, closed form');
  const mine = brepMeasure(d, 'e1');
  assert.equal(mine.refusal ?? null, null, `brep-rs refused: ${mine.refusal}`);
  close(mine.volume, volumeOf(shape), 'brep-rs vs OCCT on arcs');
});

// --- S4: refusal, a chain that does not close -------------------------------
test('S4 an open soup chain refuses rather than inventing a face', () => {
  const built = buildDoc(oc, doc(RECT.slice(0, 3), [
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
    { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  ]), arc);
  assert.equal(built.shapes.get('sk1') ?? null, null, 'no face from an open chain');
  assert.equal(built.shapes.get('e1') ?? null, null, 'and nothing extrudes from it');
  const why = built.refusals?.get('sk1');
  assert.ok(why && /close|loose|open/i.test(why), `refusal must say so, got ${why}`);
});

// --- S5: refusal, construction geometry -------------------------------------
// MEASURED, not assumed: brep-rs parses `construction` and throws the flag away
// (session.rs:101 `let _ = construction;`), so a construction circle STILL cuts
// the bore there -- 11057.522204, not 12000 -- while session.rs:143's own doc
// comment says "construction geometry dropped". Until that disagreement is the
// lead's to settle, the referee refuses instead of picking a side: guessing
// either way makes parity assert a semantic no spec here has decided.
test('S5 construction geometry refuses rather than guessing a semantic', () => {
  const built = buildDoc(
    oc,
    doc([...RECT, { k: 'circle', id: 5, c: [20, 12.5], r: 5, construction: true }]),
    arc,
  );
  assert.equal(built.shapes.get('sk1') ?? null, null, 'no face while the flag is undecided');
  const why = built.refusals?.get('sk1');
  assert.ok(why && /construction/i.test(why), `refusal must name it, got ${why}`);
});

// --- S8: the adversarial hunt -----------------------------------------------
//
// The parity gate scores "brep-rs refused where OCCT built" as a FAIL of
// brep-rs (brep-parity-gate.mjs's own header). So every arrangement the kernel
// refuses by name is a place THIS FILE could wrongly convict it, and each one
// below was run against both kernels before being written down. They agree on
// buildability in all six.

const hole = (id, cx, cy, r) => ({ k: 'circle', id, c: [cx, cy], r });
const soup = (...circles) => doc([...RECT, ...circles]);

test('S8a two separate holes both get bored', () => {
  const d = soup(hole(5, 10, 12.5, 4), hole(6, 30, 12.5, 4));
  const shape = buildDoc(oc, d, arc).shapes.get('e1');
  assert.ok(shape, 'two disjoint holes are an ordinary washer with two bores');
  close(volumeOf(shape), (40 * 25 - 2 * Math.PI * 16) * 12, 'two-bore volume');
  const mine = brepMeasure(d, 'e1');
  close(mine.volume, volumeOf(shape), 'brep-rs vs OCCT on two bores');
});

test('S8b the arrangements brep-rs refuses, this reference refuses too', () => {
  const cases = [
    ['overlapping holes', soup(hole(5, 17, 12.5, 5), hole(6, 23, 12.5, 5))],
    ['a hole poking outside', soup(hole(5, 39, 12.5, 5))],
    ['an island inside a hole', soup(hole(5, 20, 12.5, 8), hole(6, 20, 12.5, 3))],
    ['a second outline beside the first', soup(hole(5, 80, 12.5, 5))],
  ];
  for (const [what, d] of cases) {
    assert.ok(brepMeasure(d, 'e1').refusal, `brep-rs should refuse ${what}`);
    const built = buildDoc(oc, d, arc);
    assert.equal(built.shapes.get('sk1') ?? null, null, `the reference built ${what}`);
    assert.ok(built.refusals?.get('sk1'), `the reference must say why it will not: ${what}`);
  }
});

test('S8c a silently dropped loop is caught by counting wires', () => {
  // THE ONE THAT PAYS FOR GUARD 2. ShapeFix_Face BUILDS a face here -- a
  // circle sitting entirely outside the rectangle is two separate outlines, so
  // OCCT quietly keeps the rectangle, DROPS the circle, and hands back a
  // one-wire face measuring 1000 mm2. BRepCheck calls it perfectly valid,
  // because it IS a valid face; it is just not the sketch. Without a guard the
  // gate would take that 12000 plate as the reference and score brep-rs's
  // honest refusal as a FAIL.
  const built = buildDoc(oc, soup(hole(5, 80, 12.5, 5)), arc);
  const why = built.refusals?.get('sk1') ?? '';
  assert.match(why, /draws 2 loops but OpenCascade kept 1/, `got ${why}`);
});

// --- S9: the defects an adversarial review found, each measured before fixing --
//
// Every case below BUILT (or threw) on the first cut of this reader and is now
// refused. They are grouped because they share one failure shape: the referee
// answering a question the kernel declines, which the parity gate scores
// against the KERNEL ("a refusal from brep-rs where OCCT built the feature is a
// FAIL" -- brep-parity-gate.mjs's own header).

test('S9a two outlines whose areas fit the checksum are still caught', () => {
  // The nastiest of them. A 40x25 outline (1000) beside a 25x20 one (500):
  // OCCT drops the big one, keeps the small one, and 2*1000 - 1500 is EXACTLY
  // 500 -- so the area checksum matched a face that was not the sketch, and
  // BRepCheck called it valid. Measured before the fix: BUILT area=500 vol=6000
  // from a sketch whose own rows describe neither.
  const two = [
    ...RECT,
    { k: 'line', id: 5, a: [50, 0], b: [75, 0] },
    { k: 'line', id: 6, a: [75, 0], b: [75, 20] },
    { k: 'line', id: 7, a: [75, 20], b: [50, 20] },
    { k: 'line', id: 8, a: [50, 20], b: [50, 0] },
  ];
  const weld2 = [
    ...WELD,
    { k: 'coincident', a: 5, aEnd: 'b', b: 6, bEnd: 'a' },
    { k: 'coincident', a: 6, aEnd: 'b', b: 7, bEnd: 'a' },
    { k: 'coincident', a: 7, aEnd: 'b', b: 8, bEnd: 'a' },
    { k: 'coincident', a: 8, aEnd: 'b', b: 5, bEnd: 'a' },
  ];
  const d = doc(two, weld2);
  assert.ok(brepMeasure(d, 'e1').refusal, 'brep-rs refuses two separate outlines');
  const built = buildDoc(oc, d, arc);
  assert.equal(built.shapes.get('sk1') ?? null, null, 'and so must the reference');
  assert.match(built.refusals?.get('sk1') ?? '', /draws 2 loops but OpenCascade kept 1/);
});

test('S9b a loop too small to check refuses instead of vanishing', () => {
  // Under brep-rs's own degeneracy floor (`EPS_AREA_REL * scale^2`). Measured
  // before the fix: BUILT 12000 with the loop gone, for r = 0.0001, 0.001 and
  // 0.01 alike, whether the loop was inside the outline or outside it.
  for (const r of [0.0001, 0.001, 0.01]) {
    for (const cx of [20, 80]) {
      const built = buildDoc(oc, soup(hole(5, cx, 12.5, r)), arc);
      assert.equal(built.shapes.get('sk1') ?? null, null, `r=${r} at x=${cx} built`);
      assert.match(built.refusals?.get('sk1') ?? '', /too small for this reference to tell from nothing/);
    }
  }
});

test('S9c a zero-length edge refuses instead of crashing OpenCascade', () => {
  // Measured before the fix: THREW [object WebAssembly.Exception]. A throw out
  // of buildDoc is read by the gate as "the FIXTURE is broken, not the kernel",
  // which would have hidden a crash in the referee itself.
  const built = buildDoc(oc, doc(
    [{ k: 'line', id: 1, a: [5, 5], b: [5, 5] }, ...RECT.map((g) => ({ ...g, id: g.id + 1 }))],
    [],
  ), arc);
  assert.match(built.refusals?.get('sk1') ?? '', /line 1 at \(5\.0, 5\.0\) mm has no length/);
});

test('S9d a missing or unknown arc sense refuses, as it does in the kernel', () => {
  // Measured before the fix: BUILT 8569.9112 for both, by quietly assuming
  // counterclockwise, while brep-rs refuses -- so a fixture with a typo in
  // `sense` would have convicted a correct kernel.
  for (const sense of [undefined, 'banana']) {
    const d = doc([
      { k: 'line', id: 1, a: [10, 0], b: [30, 0] },
      { k: 'arc', id: 2, c: [30, 10], r: 10, a: [30, 0], b: [30, 20], ...(sense ? { sense } : {}) },
      { k: 'line', id: 3, a: [30, 20], b: [10, 20] },
      { k: 'arc', id: 4, c: [10, 10], r: 10, a: [10, 20], b: [10, 0], sense: 'ccw' },
    ], WELD);
    assert.ok(brepMeasure(d, 'e1').refusal, `brep-rs refuses sense=${sense}`);
    assert.match(buildDoc(oc, d, arc).refusals?.get('sk1') ?? '', /needs sense 'ccw' or 'cw'/);
  }
});

test('S9e a construction POINT draws nothing, so it is not refused', () => {
  // Measured before the fix: the guard caught every construction row including
  // a bare point, refusing a sketch brep-rs builds at 12000 -- and telling the
  // reader the row "still cuts", which for a point is simply false.
  const d = doc([...RECT, { k: 'point', id: 5, p: [20, 12.5], construction: true }], WELD);
  const mine = brepMeasure(d, 'e1');
  close(mine.volume, 12000, 'brep-rs builds it');
  close(volumeOf(buildDoc(oc, d, arc).shapes.get('e1')), 12000, 'and so does the reference');
});

test('S9f a join exists only because a rule says so', () => {
  // brep-rs welds two ends on a `coincident` rule and on nothing else --
  // measured: a rectangle whose corners are BIT-IDENTICAL but carry no rules is
  // refused there, "edge 1 has a loose end". This reader used to weld anything
  // within 1e-7 of the diagonal, so it BUILT 12000 across an unruled 1e-9 gap.
  const exact = doc(RECT, []);
  assert.ok(brepMeasure(exact, 'e1').refusal, 'brep-rs refuses unruled corners');
  assert.match(buildDoc(oc, exact, arc).refusals?.get('sk1') ?? '', /nothing says it meets another edge/);

  // THE ONE DIVERGENCE THIS PATH KEEPS ON PURPOSE, written down rather than
  // hidden. When a rule says two ends meet where they measurably do not, the
  // rows are not at a solution -- and brep-rs SOLVES them rather than refusing.
  // It lands on a least-squares compromise that is NEITHER the 12150 the rows
  // literally draw NOR the 12000 they were meant to, which is exactly why a
  // reader with no solver cannot reproduce it and must not pretend to.
  //
  // So the two disagree here, deliberately, in the safe direction. Refusing
  // makes the gate print "INVALID ... the FIXTURE is broken, not the kernel"
  // (brep-parity-gate.mjs's own catch), which is the true verdict on rows that
  // do not satisfy their own rules. Building the as-given shape instead would
  // make it print FAIL against brep-rs -- convicting the kernel that was right.
  const unsolved = doc([{ ...RECT[0], b: [40.5, 0] }, ...RECT.slice(1)], WELD);
  const moved = brepMeasure(unsolved, 'e1');
  assert.equal(moved.refusal ?? null, null, 'brep-rs solves these rows rather than refusing');
  for (const reader of [40.5 * 25 * 12, 40 * 25 * 12]) {
    assert.ok(
      Math.abs(moved.volume - reader) > 1e-6 * reader,
      `the solver moved the geometry somewhere no reader lands: ${moved.volume} vs ${reader}`,
    );
  }
  assert.match(buildDoc(oc, unsolved, arc).refusals?.get('sk1') ?? '', /have not been solved/);
});

test('S9g a rule naming geometry that is not there refuses', () => {
  // Measured before the fix: an extra rule naming geometry 99, or asking a line
  // for its 'c', or a circle for its 'a', BUILT here while brep-rs refused each
  // by name -- so a fixture with a typo in one rule would have convicted a
  // correct kernel.
  const bad = [
    [{ k: 'coincident', a: 99, aEnd: 'a', b: 1, bEnd: 'a' }, /names geometry 99, which this sketch does not have/],
    [{ k: 'coincident', a: 0, aEnd: 'a', b: 1, bEnd: 'a' }, /names geometry 0, which this sketch does not have/],
    [{ k: 'coincident', a: 1, aEnd: 'c', b: 2, bEnd: 'a' }, /asks geometry 1 for its 'c', which a line does not have/],
    [{ k: 'coincident', a: 5, aEnd: 'a', b: 1, bEnd: 'a' }, /asks geometry 5 for its 'a', which a circle does not have/],
    [{ k: 'radius', a: 1, value: 5 }, /asks geometry 1 to be radius, which only a circle or an arc can be/],
  ];
  for (const [rule, says] of bad) {
    const d = doc([...RECT, hole(5, 20, 12.5, 5)], [...WELD, rule]);
    assert.ok(brepMeasure(d, 'e1').refusal, `brep-rs refuses ${JSON.stringify(rule)}`);
    assert.match(buildDoc(oc, d, arc).refusals?.get('sk1') ?? '', says);
  }
});

// --- S7: adjacent surface, the classic path is untouched --------------------
test('S7 the legacy points path still builds exactly as before', () => {
  const classic = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
      { id: 'hole1', kind: 'hole', target: 'e1', diameter: 10, depth: 14, center: [0, 0, 0], axis: 'z' },
    ],
  };
  const built = buildDoc(oc, classic, arc);
  close(volumeOf(built.shapes.get('e1')), 12000, 'classic plate');
  close(volumeOf(built.shapes.get('hole1')), WASHER_VOL, 'classic bored plate');
  assert.equal(facesOf(oc, built.shapes.get('hole1')).length, 7, 'classic face count');
});

test('S9h a rule the rows do not satisfy refuses, because ignoring it moves the solid', () => {
  // THE SHARPEST CASE ON THIS PATH, and the reason every rule is verified
  // rather than skipped. This file READS rows; brep-rs SOLVES them. A rule this
  // file ignored is one the kernel still obeys, and obeying it MOVES THE
  // GEOMETRY -- so both kernels build, neither refuses, and the gate prints the
  // difference as a FAIL of brep-rs. That is a wrong reference VOLUME, the one
  // thing a referee must never produce. Measured on a rectangle that reads
  // 12000 here, each of these makes brep-rs build something else:
  const moves = [
    { k: 'distance', a: 1, aEnd: 'a', b: 3, bEnd: 'b', value: 40 },
    { k: 'diameter', a: 5, value: 12 },
  ];
  for (const rule of moves) {
    const d = doc([...RECT, hole(5, 20, 12.5, 5)], [...WELD, rule]);
    const mine = brepMeasure(d, 'e1');
    assert.equal(mine.refusal ?? null, null, `brep-rs solves ${rule.k} and builds`);
    // Not a pinned solver output -- the point is only that it is NOT the shape
    // the rows draw, which is the one number a reader could have produced.
    assert.ok(
      Math.abs(mine.volume - WASHER_VOL) > 1e-6 * WASHER_VOL,
      `${rule.k} moved the solid off ${WASHER_VOL}, got ${mine.volume}`,
    );
    const built = buildDoc(oc, d, arc);
    assert.equal(built.shapes.get('sk1') ?? null, null, 'the reference must NOT hand that over as a reference');
    assert.match(built.refusals?.get('sk1') ?? '', /have not been solved/);
  }

  // A rule the rows DO satisfy is free: both kernels agree to the bit.
  for (const rule of [
    { k: 'radius', a: 5, value: 5 },
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 },
    { k: 'parallel', a: 1, b: 3 },
    { k: 'equal', a: 1, b: 3 },
    { k: 'lock', a: 1, aEnd: 'a' },
  ]) {
    const d = doc([...RECT, hole(5, 20, 12.5, 5)], [...WELD, rule]);
    const shape = buildDoc(oc, d, arc).shapes.get('e1');
    assert.ok(shape, `a satisfied ${rule.k} rule must not get in the way`);
    close(volumeOf(shape), brepMeasure(d, 'e1').volume, `satisfied ${rule.k}`);
  }

  // And a kind this path cannot verify in one line says so rather than guessing.
  for (const k of ['tangent', 'angle', 'symmetric', 'pointOnObject']) {
    const d = doc([...RECT, hole(5, 20, 12.5, 5)], [...WELD, { k, a: 1, b: 3, c: 2, degrees: 90 }]);
    assert.match(
      buildDoc(oc, d, arc).refusals?.get('sk1') ?? '',
      /has not been taught to check one/,
      `${k} must be declined by name`,
    );
  }
});
