// Several closed shapes drawn on ONE sketch (rect()/circle()/polygon() called more than once).
//
// Before: the second call replaced the first without a word (a silent wrong part), then it was made a refusal. Now every
// shape stays as its own loop and the kernel nests them by the even-odd rule FreeCAD uses:
//   a loop inside a loop            -> a hole
//   a loop inside that hole         -> a piece of its own, standing in the hole
//   loops side by side              -> separate pieces of the same pad
//   loops that cross, or touch      -> refused in a sentence, nothing is built
//
// Every volume below is a closed form (areas x height), and every case that has a FreeCAD reference in
// docs/replica/freecad/gauntlet/variants/refs is compared with it too (volume, bbox, faces), so neither side is
// hard-coded to the other. The wasm must be built first (see AGENTS.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PKG = path.resolve(HERE, '../../brep-rs/pkg');
const REFS = path.resolve(HERE, '../../../docs/replica/freecad/gauntlet/variants/refs');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');

const PI = Math.PI;
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

function build(src) {
  const r = runScript(src);
  assert.deepEqual(r.errors ?? [], [], `the script runs: ${JSON.stringify(r.errors)}`);
  const doc = { version: 1, features: r.doc.features };
  const last = doc.features.at(-1).id;
  const built = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  const measured = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  return { r, doc, last, built, measured, refusal: built.refusals?.[last] ?? null, shape: measured.shapes?.[last] ?? null };
}

function fcRef(id) {
  const f = path.join(REFS, `ref-${id}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

/** Builds `body` on a top sketch `sk`, pads it `h`, and checks volume (closed form) and, when a FreeCAD reference exists, it too. */
function builds(name, body, h, volume, { faces, variant } = {}) {
  test(name, () => {
    const b = build(`const sk = sketch('top'); ${body} extrude(sk, ${h});`);
    assert.equal(b.refusal, null, `refused: ${b.refusal}`);
    assert.ok(b.shape, 'a solid was measured');
    assert.ok(near(b.shape.volume, volume), `volume ${b.shape.volume} vs closed form ${volume}`);
    if (faces !== undefined) assert.equal(b.shape.faces ?? b.shape.face_count, faces, 'face count');
    const ref = variant ? fcRef(variant) : null;
    if (ref && ref.ok) {
      assert.ok(near(b.shape.volume, ref.volume, 1e-6), `volume ${b.shape.volume} vs FreeCAD ${ref.volume}`);
      assert.equal(b.shape.faces ?? b.shape.face_count, ref.faces, 'faces vs FreeCAD');
      const bb = [...b.shape.bbox[0], ...b.shape.bbox[1]];
      for (let i = 0; i < 6; i++) assert.ok(Math.abs(bb[i] - ref.bbox[i]) <= 1e-6, `bbox[${i}] ${bb[i]} vs FreeCAD ${ref.bbox[i]}`);
    }
  });
}

/** Refuses with a sentence, builds nothing. */
function refuses(name, body, h, pattern) {
  test(name, () => {
    const b = build(`const sk = sketch('top'); ${body} extrude(sk, ${h});`);
    assert.ok(b.refusal, `WRONG-SOLID CANDIDATE: it built ${JSON.stringify(b.shape)}`);
    assert.match(b.refusal, pattern);
    assert.ok(!b.built.built.includes(b.last), 'not in built[]');
    assert.equal(b.shape, null, 'nothing measurable');
  });
}

// --- nesting one level: a hole -------------------------------------------------------------------------------------
builds('two circle() calls: a ring', 'sk.circle(40); sk.circle(20);', 15, PI * (400 - 100) * 15, { faces: 4, variant: 'pad-basic__two-circle-calls-one-sketch' });
builds('two rect() calls: a frame', 'sk.rect(40, 30); sk.rect(10, 10);', 15, (1200 - 100) * 15, { faces: 10, variant: 'pad-basic__rect-and-rect-one-sketch' });
builds('a rect and a circle in it', 'sk.rect(40, 30); sk.circle(10);', 15, (1200 - PI * 25) * 15, { faces: 7, variant: 'pad-basic__circle-in-rect-one-sketch' });
builds('a circle and a rect in it', 'sk.circle(40); sk.rect(10, 10);', 15, (PI * 400 - 100) * 15, { faces: 7, variant: 'pad-basic__rect-in-circle-one-sketch' });
builds('a plate with two holes', 'sk.rect(60, 40); sk.circle(12, { at: [-15, 0] }); sk.circle(12, { at: [15, 0] });', 15, (2400 - 2 * PI * 36) * 15, { faces: 8, variant: 'pad-basic__two-holes-one-sketch' });
builds('a polygon with a rect hole', 'sk.polygon([[-20, -20], [20, -20], [0, 20]]); sk.rect(4, 4, { at: [0, -8] });', 15, (800 - 16) * 15, { variant: 'pad-basic__polygon-with-rect-hole-one-sketch' });

// --- side by side: separate pieces of one pad ----------------------------------------------------------------------
builds('two squares apart', 'sk.rect(20, 20, { at: [-20, 0] }); sk.rect(20, 20, { at: [20, 0] });', 15, 2 * 400 * 15, { faces: 12, variant: 'pad-basic__two-disjoint-rects-one-sketch' });
builds('two discs apart', 'sk.circle(16, { at: [-20, 0] }); sk.circle(16, { at: [20, 0] });', 15, 2 * PI * 64 * 15, { faces: 6, variant: 'pad-basic__two-disjoint-circles-one-sketch' });
builds('a square and a disc apart', 'sk.rect(20, 20, { at: [-20, 0] }); sk.circle(16, { at: [20, 0] });', 10, (400 + PI * 64) * 10, { variant: 'pad-basic__rect-and-circle-apart-one-sketch' });

// --- nesting deeper: even-odd ------------------------------------------------------------------------------------------
builds('three concentric circles: a ring and a disc in its hole', 'sk.circle(60); sk.circle(40); sk.circle(20);', 15, PI * (900 - 400 + 100) * 15, { faces: 7, variant: 'pad-basic__three-deep-circles-one-sketch' });
builds('three nested squares: a frame and a block in its hole', 'sk.rect(60, 60); sk.rect(40, 40); sk.rect(20, 20);', 15, (3600 - 1600 + 400) * 15, { faces: 16, variant: 'pad-basic__three-deep-rects-one-sketch' });
builds('four concentric circles: two rings', 'sk.circle(80); sk.circle(60); sk.circle(40); sk.circle(20);', 10, PI * (1600 - 900 + 400 - 100) * 10, { variant: 'pad-basic__four-deep-circles-one-sketch' });
builds('a ring, a disc in its hole, and a far disc: three pieces', 'sk.circle(60); sk.circle(40); sk.circle(20); sk.circle(10, { at: [60, 0] });', 15, PI * (900 - 400 + 100 + 25) * 15, { variant: 'pad-basic__island-and-far-disc-one-sketch' });
builds('a holed plate and a square beside it', 'sk.rect(40, 30); sk.circle(10); sk.rect(10, 10, { at: [40, 0] });', 15, (1200 - PI * 25 + 100) * 15, { variant: 'pad-basic__holed-plate-and-far-rect-one-sketch' });

// --- refused: never a wrong solid ------------------------------------------------------------------------------------
refuses('rectangles that overlap', 'sk.rect(30, 20, { at: [-5, 0] }); sk.rect(30, 20, { at: [5, -10] });', 15, /cross/);
refuses('circles that overlap', 'sk.circle(20, { at: [-5, 0] }); sk.circle(20, { at: [5, 0] });', 15, /not fully inside the outline|cross or touch/);
refuses('circles that touch from the outside', 'sk.circle(20, { at: [-10, 0] }); sk.circle(20, { at: [10, 0] });', 15, /cross or touch each other/);
refuses('a circle touching the circle that holds it', 'sk.circle(40); sk.circle(20, { at: [10, 0] });', 15, /not fully inside the outline|cross or touch/);
refuses('rectangles that share a side', 'sk.rect(20, 20, { at: [-10, 0] }); sk.rect(20, 20, { at: [10, 0] });', 15, /nearly touch|cross or touch|touch/);

// --- pocket ---------------------------------------------------------------------------------------------------------
function pocketVolume(name, body, depth, volume, variant, opts = '') {
  test(name, () => {
    const src = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10); const s2 = sketch('top', 10); ${body} pocket(s2, plate, ${depth}${opts});`;
    const b = build(src);
    assert.equal(b.refusal, null, `refused: ${b.refusal}`);
    assert.ok(near(b.shape.volume, volume), `volume ${b.shape.volume} vs closed form ${volume}`);
    const ref = variant ? fcRef(variant) : null;
    if (ref && ref.ok) {
      assert.ok(near(b.shape.volume, ref.volume, 1e-6), `vs FreeCAD ${ref.volume}`);
      assert.equal(b.shape.faces ?? b.shape.face_count, ref.faces, 'faces vs FreeCAD');
    }
  });
}
pocketVolume('two round pockets on one sketch', 's2.circle(8, { at: [10, 15] }); s2.circle(8, { at: [30, 15] });', 4, 12000 - 2 * PI * 16 * 4, 'pocket-blind__two-holes-one-sketch');
pocketVolume('a square and a round pocket on one sketch', 's2.rect(8, 8, { at: [10, 15] }); s2.circle(8, { at: [30, 15] });', 3, 12000 - (64 + PI * 16) * 3, 'pocket-blind__rect-and-circle-one-sketch');
pocketVolume('a ring pocket from two circle() calls', 's2.circle(20, { at: [20, 15] }); s2.circle(8, { at: [20, 15] });', 4, 12000 - PI * (100 - 16) * 4, 'pocket-blind__ring-island-one-sketch');
pocketVolume('through pockets from one sketch', 's2.circle(8, { at: [10, 15] }); s2.circle(8, { at: [30, 15] });', 10, 12000 - 2 * PI * 16 * 10, 'pocket-through__two-holes-one-sketch', ', { through: true }');

test('a ring-pocket sketch with a disc in its hole (three-deep) is cut as even-odd: ring out, middle ring stays, centre out', () => {
  const b = build("const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10); const s2 = sketch('top', 10); s2.circle(24, { at: [20, 15] }); s2.circle(16, { at: [20, 15] }); s2.circle(8, { at: [20, 15] }); pocket(s2, plate, 4);");
  const closed = 12000 - PI * (144 - 64 + 16) * 4;
  const ref = fcRef('pocket-blind__three-deep-one-sketch');
  if (b.refusal) {
    assert.match(b.refusal, /\S/);
    assert.equal(b.shape, null, 'a refusal builds nothing');
  } else {
    assert.ok(near(b.shape.volume, closed), `volume ${b.shape.volume} vs closed form ${closed}`);
    if (ref && ref.ok) assert.ok(near(b.shape.volume, ref.volume, 1e-6), `vs FreeCAD ${ref.volume}`);
  }
});

for (const [name, tail, volume, variant] of [
  ['a ring pocket and a square pocket on one sketch, blind', 'pocket(s2, plate, 4);', 18000 - (PI * (144 - 64) + 64) * 4, 'pocket-blind__ring-and-far-rect-one-sketch'],
  ['a ring pocket and a square pocket on one sketch, through (the ring leaves its disc standing apart)', 'pocket(s2, plate, 10, { through: true });', 18000 - (PI * (144 - 64) + 64) * 10, 'pocket-through__ring-and-far-rect-one-sketch'],
]) {
  test(name, () => {
    const b = build(`const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,30],[0,30]]); const plate = extrude(s1, 10); const s2 = sketch('top', 10); s2.circle(24, { at: [15, 15] }); s2.circle(16, { at: [15, 15] }); s2.rect(8, 8, { at: [45, 15] }); ${tail}`);
    assert.equal(b.refusal, null, `refused: ${b.refusal}`);
    assert.ok(near(b.shape.volume, volume), `volume ${b.shape.volume} vs closed form ${volume}`);
    const ref = fcRef(variant);
    if (ref && ref.ok) {
      assert.ok(near(b.shape.volume, ref.volume, 1e-6), `vs FreeCAD ${ref.volume}`);
      assert.equal(b.shape.faces ?? b.shape.face_count, ref.faces, 'faces vs FreeCAD');
    }
  });
}

// --- the document: rows, one loop per shape, and a stable round trip -------------------------------------------------
test('a multi-shape sketch is written as rows and the round trip is stable', () => {
  const src = "const sk = sketch('top'); sk.rect(40, 30); sk.circle(10, { at: [5, 0] }); sk.rect(6, 6, { at: [-10, 5] }); extrude(sk, 15);";
  const a = build(src);
  const sk = a.doc.features.find((f) => f.kind === 'sketch');
  assert.equal(sk.geoms.filter((g) => g.k === 'line').length, 8, 'two rectangles, four lines each');
  assert.equal(sk.geoms.filter((g) => g.k === 'circle').length, 1);
  assert.deepEqual(sk.geoms.map((g) => g.id), sk.geoms.map((_, i) => i + 1), 'ids are dense and 1-based');
  const text = toScript(a.r.doc);
  const again = runScript(text);
  assert.deepEqual(again.errors ?? [], []);
  assert.deepEqual(JSON.parse(JSON.stringify(again.doc.features)), JSON.parse(JSON.stringify(a.r.doc.features)), 'runScript(toScript(doc)) is the same document');
  const b = build(text);
  assert.ok(near(b.shape.volume, a.shape.volume), 'and it builds the same part');
  assert.ok(near(a.shape.volume, (1200 - PI * 25 - 36) * 15), `closed form, got ${a.shape.volume}`);
});

test('a hole() on a multi-shape pad is cut from the part like any other', () => {
  const b = build("const sk = sketch('top'); sk.rect(60, 40); sk.circle(12, { at: [-15, 0] }); const p = extrude(sk, 15); hole(p, { across: 6, at: [15, 0], deep: 20 });");
  assert.equal(b.refusal, null, `refused: ${b.refusal}`);
  assert.ok(b.shape.volume < (2400 - PI * 36) * 15 - 1, 'the hole took material away');
});
