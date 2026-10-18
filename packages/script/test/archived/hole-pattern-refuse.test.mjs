// A pattern of a hole, pocket or pad on a box: copies that overlap or leave the part are refused in a sentence, never
// handed to the whole-solid pattern (which copied the plate itself and grew its bounding box). The numbers in the
// "builds" cases were measured against FreeCAD 26.3 (box minus cylinders): see docs/replica/freecad/gauntlet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const HB = `const plate = box(40, 20, 10);\n`;
const SK = (r) => `const sk = sketch('top', 10); sk.circle(${r}, { at: [-12, 0] });\nconst p = pocket(sk, plate, 4);\n`;
const PAD = `const sk = sketch('top', 10); sk.rect(6, 6, { at: [-12, 0] });\nconst p = join(plate, pull(sk, 4));\n`;
const hole = (d, x) => HB + `const h = hole(plate, { across: ${d}, at: [${x}, 0] });\n`;

const refused = [
  ['hole line leaves the plate (count 4 step 12)', hole(4, -12) + `linearPattern(h, { count: 4, step: 12 });`, /repeat\(\) of a hole/],
  ['hole copies overlap (step 4)', hole(4, -12) + `linearPattern(h, { count: 3, step: 4 });`, /overlap/],
  ['wide hole copies overlap', hole(6, -10) + `linearPattern(h, { count: 3, step: 4 });`, /overlap/],
  ['hole copy breaks the rim', hole(4, -18) + `linearPattern(h, { count: 2, step: 12 });`, /edge of the part/],
  ['polar hole leaves the plate', hole(4, 15) + `repeatAround(h, { count: 4, axis: 'z' });`, /repeatAround\(\) of a hole/],
  ['polar holes overlap', hole(6, 3) + `repeatAround(h, { count: 6, axis: 'z' });`, /overlap/],
  ['mirrored hole lands off the plate', hole(4, -12) + `mirror(h, 'left-right', { at: 30 });`, /mirror\(\) of a hole/],
  ['repeat() of a hole leaves the plate', hole(4, -12) + `repeat(h, { count: 4, step: 12 });`, /repeat\(\) of a hole/],
  ['pocket copies leave the plate', HB + SK(4) + `linearPattern(p, { count: 4, step: 12 });`, /of a pocket/],
  ['pad copies leave the plate', HB + PAD + `linearPattern(p, { count: 4, step: 12 });`, /of a pad/],
  ['pad copies overlap', HB + PAD + `linearPattern(p, { count: 3, step: 4 });`, /overlap/],
  ['mirrored pocket lands off the plate', HB + SK(4) + `mirror(p, 'left-right', { at: 30 });`, /of a pocket/],
  ['mirrored pad lands off the plate', HB + PAD + `mirror(p, 'left-right', { at: 30 });`, /of a pad/],
  ['polar pocket leaves the plate', HB + SK(4) + `repeatAround(p, { count: 4, axis: 'z' });`, /of a pocket/],
];
for (const [name, src, re] of refused) {
  test(`refused in a sentence: ${name}`, () => {
    const r = runScript(src);
    assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
    assert.match(r.errors[0].message, re);
    // no whole-solid pattern feature may be left in the doc
    assert.equal(r.doc.features.some((f) => f.kind === 'pattern'), false);
  });
}

test('holes that fit build as holes only (no whole-solid pattern)', () => {
  const r = runScript(hole(4, -12) + `linearPattern(h, { count: 4, step: 8 });`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.filter((f) => f.kind === 'hole').length, 4);
  assert.equal(r.doc.features.some((f) => f.kind === 'pattern'), false);
});

test('a drilled plate copied clear of itself is refused too (a hole pattern is never the whole-solid pattern)', () => {
  const r = runScript(`const b = box(20, 20, 10)\nhole(b, { across: 6, deep: 4 })\nlinearPattern(b, { count: 3, step: 30 })`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /of a hole/);
  assert.equal(r.doc.features.some((f) => f.kind === 'pattern'), false);
});
test('a plain plate patterned on purpose is still the whole-solid pattern', () => {
  const r = runScript(`const b = box(20, 20, 10)\nlinearPattern(b, { count: 3, step: 30 })`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.some((f) => f.kind === 'pattern'), true);
});
test('a drilled plate copied so the plates overlap is refused, not merged into a longer plate', () => {
  const r = runScript(`const b = box(40, 20, 10)\nhole(b, { across: 4, at: [-12, 0] })\nlinearPattern(b, { count: 4, step: 12 })`);
  assert.equal(r.errors.length, 1);
});

test('hole patterns on a cylinder host are measured: overlap and rim breakout refuse, a fit builds holes only', () => {
  const run = (step, count = 3) => runScript(`const c = cylinder(30, 10)\nconst h = hole(c, { across: 4, at: [-6, 0] })\nlinearPattern(h, { count: ${count}, step: ${step} })`);
  assert.equal(run(2).errors.length, 1);
  assert.equal(run(20).errors.length, 1);
  const ok = run(6);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.doc.features.filter((f) => f.kind === 'hole').length, 3);
  assert.equal(ok.doc.features.some((f) => f.kind === 'pattern'), false);
});

// Round pockets slid along a line and overlapping into a slot are built: the faces match FreeCAD 26.3 (through: 4 holes d6 step 4
// in a 60 x 20 x 10 plate, 12 faces; blind: 3 pockets d6 step 4, 6 deep, 11 faces; see docs/replica/freecad/gauntlet).
test('overlapping round pocket copies in a line are built, not refused', () => {
  const r = runScript(HB + SK(6) + `linearPattern(p, { count: 3, step: 4 });`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.filter((f) => f.kind === 'pocket').length, 3);
  assert.equal(r.doc.features.some((f) => f.kind === 'pattern'), false);
});
