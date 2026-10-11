// Matrix D of docs/PLAN-scripting-layers.md (task S-1): every LIVE refusal of
// SPEC-sketcher2 §5.3 'The 12 refusals', pinned from the student's side.
//
// Refusal 7 (multi-loop) was retired by 82ec736, so the live count is 11; the
// 12th row is a POSITIVE one: a washer builds, and a plug sitting inside a
// bore still refuses (SPEC §8.2).
//
// Each fixture is a soup (geom + rules rows) and is run TWO ways on the real
// wasm, with the SAME sentence expected from both:
//   (1) sketch_open / sketch_solve / sketch_profile via SketchSession2D;
//   (2) the full build path: runScript(...) -> brep.build_doc_json, plus
//       brep.measure_doc, which must carry NO shape for the extrude.
// The sentences are the Rust ones from packages/brep-rs/src/sketch/wires.rs
// (t_refusal_sentences, ~:2088-2241), so the two suites cannot drift. Where
// that test fakes the solve (`run_with(&moved)`: refusals 3 and 9) these
// fixtures reach the same refusal through a REAL solve instead.
//
// "Never return a wrong solid": a fixture that BUILDS is a wrong-solid
// candidate and fails loudly; it is never loosened to pass.
//
// The wasm must be rebuilt before this suite runs (see AGENTS.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../brep-rs/pkg',
);
const brep = await import(
  new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href
);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const { SketchSession2D } = await import('../dist/sketch-session.js');
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

const session = new SketchSession2D();
session.loadFromBytes(brep);

// --- row helpers -------------------------------------------------------------
const L = (id, a, b) => ({ k: 'line', id, a, b });
const arc = (id, c, r, a, b, sense) => ({ k: 'arc', id, c, r, a, b, sense });
const cc = (a, aEnd, b, bEnd) => ({ k: 'coincident', a, aEnd, b, bEnd });
const polyRows = (pts) => pts.map((p, i) => L(i + 1, p, pts[(i + 1) % pts.length]));
const weldRows = (n) =>
  Array.from({ length: n }, (_, i) => cc(i + 1, 'b', ((i + 1) % n) + 1, 'a'));

const TRI = [L(1, [0, 0], [100, 0]), L(2, [100, 0], [50, 80]), L(3, [50, 80], [0, 0])];
const TRI_WELD = weldRows(3);
const SQ = polyRows([[0, 0], [40, 0], [40, 30], [0, 30]]);
const SQ_RULES = [...weldRows(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }];
const RECT = polyRows([[0, 0], [100, 0], [100, 50], [0, 50]]);
const HEIGHT = 12;

// --- the two runners ---------------------------------------------------------
function viaSession(geoms, rules) {
  const err = session.open(geoms, rules);
  assert.equal(err, null, `sketch_open refused the rows: ${err}`);
  session.solve();
  return session.profile();
}

function viaBuild(geoms, rules) {
  const code =
    `const s1 = sketch('top'); s1.geom(${JSON.stringify(geoms)}); ` +
    `s1.rules(${JSON.stringify(rules)}); const e = pull(s1, ${HEIGHT});`;
  const r = runScript(code);
  assert.equal(r.error, undefined, `script does not run: ${r.error}`);
  const doc = { version: 1, features: r.doc.features };
  const ext = r.doc.features.find((f) => f.kind === 'extrude');
  assert.ok(ext, 'the script produced an extrude feature');
  const built = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  const measured = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  return { id: ext.id, built, measured };
}

/** One refusal row: both paths refuse with `sentence`, and no solid exists. */
function refuses(n, name, geoms, rules, sentence) {
  test(`refusal ${n}: ${name}`, () => {
    const prof = viaSession(geoms, rules);
    assert.ok(
      'refusal' in prof,
      `sketch_profile BUILT a profile for refusal ${n}: ${JSON.stringify(prof)}`,
    );
    assert.ok(
      prof.refusal.includes(sentence),
      `profile sentence for ${n}: wanted "${sentence}", got "${prof.refusal}"`,
    );
    assert.match(prof.refusal, /^[A-Za-z]/, 'a plain sentence, not a code');

    const { id, built, measured } = viaBuild(geoms, rules);
    const why = built.refusals?.[id];
    assert.ok(
      why,
      `WRONG-SOLID CANDIDATE: refusal ${n} fixture BUILT ${id}: ` +
        `${JSON.stringify(measured.shapes?.[id])}`,
    );
    assert.ok(why.includes(sentence), `build sentence for ${n}: wanted "${sentence}", got "${why}"`);
    assert.ok(!built.built.includes(id), `${id} must not be in built[]`);
    assert.equal(measured.shapes?.[id], undefined, 'no solid is measurable for the extrude');
    assert.ok(measured.refusals?.[id], 'measure_doc refuses it too');
  });
}

// --- the 11 live refusals ----------------------------------------------------
// 1. Dangling end: a triangle with its closing weld left out.
refuses(1, 'dangling end', TRI, [TRI_WELD[0], TRI_WELD[1]],
  'edge 1 has a loose end; the outline must close');

// 2. Near-touch: the C shape of wires.rs c_shape(); corners (100,49.95) and
//    (100,50.05) are each welded to their own neighbours but not to each other.
{
  const P = [[0, 0], [100, 0], [100, 49.95], [20, 40], [20, 60], [100, 50.05], [100, 100], [0, 100]];
  refuses(2, 'near-touch without a coincident', polyRows(P), weldRows(8),
    'edge 2 and edge 5 nearly touch but nothing says they meet. Add a coincident rule.');
}

// 3. Weld too wide: a REAL solve that cannot close. Triangle sides pinned to
//    100, 100 and 300 violate the triangle inequality; the solve cannot bring
//    the welded corners together (wires.rs fakes this with run_with).
refuses(3, 'weld too wide (infeasible side lengths)', TRI,
  [
    ...TRI_WELD,
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 100 },
    { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 100 },
    { k: 'distance', a: 3, aEnd: 'a', b: 3, bEnd: 'b', value: 300 },
  ],
  'these corners were asked to meet, but your rules pull them apart; the closest they can get is');

// 4. Crossing at a non-vertex: a bowtie.
refuses(4, 'self-crossing bowtie',
  polyRows([[0, 0], [100, 100], [100, 0], [0, 100]]), weldRows(4),
  'edge 1 crosses edge 3. An outline cannot cross itself.');

// 5. Duplicate half-edges: two edges drawn on top of each other.
refuses(5, 'duplicate half-edges',
  [L(1, [0, 0], [100, 0]), L(2, [0, 0], [100, 0])],
  [cc(1, 'a', 2, 'a'), cc(1, 'b', 2, 'b')],
  'two edges leave the same corner along the same path');

// 6a/6b. Degenerate geometry: zero-length line; arc that sweeps nothing.
refuses('6a', 'zero-length line',
  [...TRI, L(4, [100, 0], [100, 0])],
  [...TRI_WELD, cc(4, 'a', 1, 'b'), cc(4, 'b', 1, 'b')],
  'edge 4 has zero length');
refuses('6b', 'arc with no sweep',
  [...TRI, arc(4, [100, 50], 50, [100, 0], [100, 0], 'ccw')],
  [...TRI_WELD, cc(4, 'a', 1, 'b'), cc(4, 'b', 1, 'b')],
  'arc 4 has sweep near zero');

// 8. No closed loop at all: a lone point has no edges.
refuses(8, 'no closed loop', [{ k: 'point', id: 1, p: [5, 5] }], [],
  'no closed outline found');

// 9. Collapsed loop: a REAL solve flattens a 100x50 rectangle to 0.5 high
//    (50 square mm from 5000) -- wider than eps_gap so it is a collapse, not
//    a near-touch. wires.rs fakes this with run_with.
refuses(9, 'collapsed loop (rectangle solved flat)', RECT,
  [
    ...weldRows(4),
    { k: 'horizontal', a: 1 },
    { k: 'horizontal', a: 3 },
    { k: 'vertical', a: 2 },
    { k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 0.5 },
  ],
  'the outline collapsed while solving');

// 10. A circle in a mixed wire.
refuses(10, 'circle welded into a mixed wire',
  [...TRI, { k: 'circle', id: 4, c: [0, 0], r: 200 }],
  [...TRI_WELD, cc(4, 'c', 1, 'a')],
  'a circle can only be its own outline in this version; use two arcs to join it to other edges');

// 11. A conflicting solve must never extrude (the most important row).
refuses(11, 'conflicting dimensions never extrude', SQ,
  [
    ...SQ_RULES,
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 },
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 20 },
  ],
  "the sketch's rules conflict, so no profile can be trusted; resolve the conflict first");

// 12. Endpoint tangency converged to a cusp: line arrives one way, the cw arc
//     leaves the other way.
refuses(12, 'tangency converged to a cusp',
  [L(1, [0, 0], [100, 0]), arc(2, [100, 30], 30, [100, 0], [70, 30], 'cw'), L(3, [70, 30], [0, 0])],
  [...weldRows(3), { k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }],
  'meet in a point rather than running smoothly; reverse one of them');

// --- the retired refusal 7: multi-loop now BUILDS, a plug still refuses -------
test('refusal 7 retired (82ec736): a washer BUILDS with the closed-form volume', () => {
  const geoms = [...SQ, { k: 'circle', id: 5, c: [20, 15], r: 5 }];
  const prof = viaSession(geoms, SQ_RULES);
  assert.ok(!('refusal' in prof), `a washer profiles clean: ${JSON.stringify(prof)}`);
  assert.deepEqual(prof.loops.map((l) => l.role), ['outer', 'hole']);

  const { id, built, measured } = viaBuild(geoms, SQ_RULES);
  assert.deepEqual(built.refusals, {}, 'no refusals');
  assert.ok(built.built.includes(id));
  const want = (40 * 30 - Math.PI * 25) * HEIGHT; // 13457.522203923063
  const got = measured.shapes[id].volume;
  assert.ok(Math.abs(got - want) <= 1e-6 * want, `washer volume ${got}, want ${want}`);
});

test('refusal 7 retired: a plug sitting inside a bore still refuses', () => {
  const geoms = [
    ...SQ,
    { k: 'circle', id: 5, c: [20, 15], r: 8 },
    { k: 'circle', id: 6, c: [20, 15], r: 3 },
  ];
  const sentence = 'sits inside the hole near (20.0, 15.0) mm; an island inside a hole is not a shape this builds';
  const prof = viaSession(geoms, SQ_RULES);
  assert.ok('refusal' in prof, `a plug in a bore must refuse: ${JSON.stringify(prof)}`);
  assert.ok(prof.refusal.includes(sentence), prof.refusal);
  const { id, built, measured } = viaBuild(geoms, SQ_RULES);
  assert.ok(built.refusals[id]?.includes(sentence), `build refusal: ${built.refusals[id]}`);
  assert.equal(measured.shapes?.[id], undefined, 'no solid');
});

test('side-by-side outlines still refuse (the surviving half of 7)', () => {
  const two = [...SQ, ...polyRows([[100, 0], [140, 0], [140, 30], [100, 30]]).map((l) => ({ ...l, id: l.id + 4 }))];
  const rules = [...SQ_RULES, ...weldRows(4).map((c) => ({ ...c, a: c.a + 4, b: c.b + 4 }))];
  const prof = viaSession(two, rules);
  assert.ok('refusal' in prof, JSON.stringify(prof));
  assert.ok(prof.refusal.includes('this sketch has 2 separate outlines'), prof.refusal);
  const { id, built } = viaBuild(two, rules);
  assert.ok(built.refusals[id], 'the build refuses too');
});

// --- the arc-convention trap (sketch-canvas-core.ts slotRows, ~:818-880) -----
// End ORDER, not `sense`, is the direction of travel. The studio's slot (cw
// arcs, reversed ends) builds the obround; the same caps as ccw arcs refuse.
const slot = (sense, swap) => {
  const r = 10;
  const ends1 = [[0, -r], [0, r]];
  const ends2 = [[40, r], [40, -r]]; // cap B runs the opposite way (slotRows)
  const [a1, b1] = swap ? [ends1[1], ends1[0]] : ends1;
  const [a2, b2] = swap ? [ends2[1], ends2[0]] : ends2;
  return {
    geoms: [
      arc(1, [0, 0], r, a1, b1, sense),
      arc(2, [40, 0], r, a2, b2, sense),
      L(3, [0, r], [40, r]),
      L(4, [40, -r], [0, -r]),
    ],
    rules: [
      cc(3, 'a', 1, 'b'), { k: 'tangent', a: 3, aEnd: 'a', b: 1, bEnd: 'b' },
      cc(3, 'b', 2, 'a'), { k: 'tangent', a: 3, aEnd: 'b', b: 2, bEnd: 'a' },
      cc(4, 'a', 2, 'b'), { k: 'tangent', a: 4, aEnd: 'a', b: 2, bEnd: 'b' },
      cc(4, 'b', 1, 'a'), { k: 'tangent', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
    ],
  };
};

test('slot as the studio emits it (cw arcs, end order reversed) builds the obround', () => {
  // slotRows: cap A a=-perp,b=+perp; cap B a=+perp,b=-perp (perp = +y for
  // centres on the x axis): exactly slot('cw', false) above.
  const { geoms, rules } = slot('cw', false);
  const prof = viaSession(geoms, rules);
  assert.ok(!('refusal' in prof), `the studio slot must build: ${JSON.stringify(prof)}`);
  const { id, built, measured } = viaBuild(geoms, rules);
  assert.deepEqual(built.refusals, {});
  const want = (2 * 10 * 40 + Math.PI * 100) * HEIGHT; // obround, 13369.911184
  const got = measured.shapes[id].volume;
  assert.ok(Math.abs(got - want) <= 1e-6 * want, `slot volume ${got}, want ${want}`);
});

test('the same slot with ccw arcs refuses with the cusp sentence, never a notch', () => {
  const { geoms, rules } = slot('ccw', false);
  const sentence = 'meet in a point rather than running smoothly';
  const prof = viaSession(geoms, rules);
  assert.ok('refusal' in prof, `ccw with this end order must refuse: ${JSON.stringify(prof)}`);
  assert.ok(prof.refusal.includes(sentence), prof.refusal);
  const { id, built, measured } = viaBuild(geoms, rules);
  assert.ok(built.refusals[id]?.includes(sentence), `build: ${built.refusals[id]}`);
  assert.equal(measured.shapes?.[id], undefined);
});
