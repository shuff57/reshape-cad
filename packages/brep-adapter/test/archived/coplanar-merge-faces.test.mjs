// W4: the boolean returns one face for a flat region the student sees as one face.
// Each case carries a face count worked out BY HAND from the geometry (a prism over an n-gon profile has n + 2 faces,
// and so on), never read back from either kernel. brep-rs must equal that count; OpenCascade is the second witness
// where it agrees, and where it keeps a split face (it is allowed to, and does) its larger count is reported, not
// asserted equal. Volume must equal OpenCascade's to 1e-9 on every case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import('../dist/occt-build.js');
const { facesOf } = await import('../dist/topo-resolve.js');
const arc = await import('../../sketch/dist/sketch-arc.js');

function occt(features, id) {
  const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
  assert.ok(shape, 'OCCT built it');
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  return { volume: g.Mass(), faces: facesOf(oc, shape).length };
}

const c = (w, d, h, x, y, z) => `cuboid(${w}, ${d}, ${h}, { at: [${x}, ${y}, ${z}] })`;
const U = (a, b) => `union(${a}, ${b})`;

// [name, script, hand-counted faces]
const cases = [
  // ---- joins ----
  ['two cubes side by side (x)', `const s = ${U(c(20, 20, 20, 10, 10, 10), c(20, 20, 20, 30, 10, 10))}`, 6],
  ['two cubes side by side (y)', `const s = ${U(c(20, 20, 20, 10, 10, 10), c(20, 20, 20, 10, 30, 10))}`, 6],
  ['two cubes stacked (z)', `const s = ${U(c(20, 20, 20, 10, 10, 10), c(20, 20, 20, 10, 10, 30))}`, 6],
  ['three cubes in a row', `const s = union(${U(c(20, 20, 20, 10, 10, 10), c(20, 20, 20, 30, 10, 10))}, ${c(20, 20, 20, 50, 10, 10)})`, 6],
  ['four cubes make a slab', `const s = union(${U(c(20, 20, 20, 10, 10, 10), c(20, 20, 20, 30, 10, 10))}, ${U(c(20, 20, 20, 10, 30, 10), c(20, 20, 20, 30, 30, 10))})`, 6],
  ['L bracket, arms in x and y', `const s = ${U(c(40, 10, 20, 20, 5, 10), c(10, 40, 20, 5, 20, 10))}`, 8],
  ['L bracket, arms in x and z', `const s = ${U(c(40, 20, 10, 20, 10, 5), c(10, 20, 40, 5, 10, 20))}`, 8],
  ['L bracket, arms in y and z', `const s = ${U(c(20, 40, 10, 10, 20, 5), c(20, 10, 40, 10, 5, 20))}`, 8],
  ['L bracket from three cubes', `const s = union(${U(c(20, 20, 20, 10, 10, 10), c(20, 20, 20, 30, 10, 10))}, ${c(20, 20, 20, 10, 30, 10)})`, 8],
  ['T bar: 10 sided profile', `const s = ${U(c(40, 10, 20, 0, 0, 10), c(10, 30, 20, 0, -20, 10))}`, 10],
  ['U channel: 8 vertex profile', `const s = union(${U(c(40, 10, 10, 0, 0, 5), c(10, 30, 10, -15, 20, 5))}, ${c(10, 30, 10, 15, 20, 5)})`, 10],
  ['plus sign', `const s = ${U(c(60, 20, 10, 0, 0, 5), c(20, 60, 10, 0, 0, 5))}`, 14],
  ['stair of two steps', `const s = ${U(c(40, 40, 10, 0, 0, 5), c(20, 40, 10, -10, 0, 15))}`, 8],
  ['stair of three steps', `const s = union(${U(c(30, 20, 10, 15, 0, 5), c(20, 20, 10, 10, 0, 15))}, ${c(10, 20, 10, 5, 0, 25)})`, 10],
  ['two boxes offset diagonally, same height', `const s = ${U(c(20, 20, 10, 0, 0, 5), c(20, 20, 10, 10, 10, 5))}`, 10],
  ['two boxes of different heights, same depth', `const s = ${U(c(20, 20, 10, 0, 0, 0), c(20, 20, 20, 10, 0, 0))}`, 10],
  ['boss on the middle of a block', `const s = ${U(c(40, 40, 10, 0, 0, 5), c(10, 10, 10, 0, 0, 15))}`, 11],
  ['boss flush with one side', `const s = ${U(c(40, 40, 10, 0, 0, 5), c(10, 10, 10, -15, 0, 15))}`, 10],
  ['boss flush with two sides (a corner)', `const s = ${U(c(40, 40, 10, 0, 0, 5), c(10, 10, 10, -15, -15, 15))}`, 9],
  ['small block beside a big one, bottoms flush', `const s = ${U(c(40, 40, 20, 0, 0, 10), c(20, 20, 10, 30, 0, 5))}`, 10],
  ['cylinder boss on a block (nothing to merge)', `const s = ${U(c(40, 40, 10, 0, 0, 5), 'cylinder(10, 10, { at: [0, 0, 10] })')}`, 8],
  // ---- cuts ----
  ['corner notch, top corner (10 cube)', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 20, -20, -20, 20)})`, 9],
  ['corner notch, bottom corner', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 20, 20, 20, 0)})`, 9],
  ['corner notch through the height (an L)', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 40, -20, -20, 10)})`, 8],
  ['two opposite corner notches through', `const s = subtract(subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 40, -20, -20, 10)}), ${c(20, 20, 40, 20, 20, 10)})`, 10],
  ['two corner notches on one top edge', `const s = subtract(subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 20, -20, -20, 20)}), ${c(20, 20, 20, 20, -20, 20)})`, 12],
  ['groove across the whole top', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(10, 60, 10, 0, 0, 20)})`, 10],
  ['pocket in the middle of the top', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(10, 10, 10, 0, 0, 20)})`, 11],
  ['notch in the middle of a top edge', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(10, 10, 10, 0, -20, 20)})`, 10],
  ['rabbet along a top edge', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(10, 60, 10, -20, 0, 20)})`, 8],
  ['square hole right through', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(10, 10, 40, 0, 0, 10)})`, 10],
  ['half taken off', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(60, 60, 40, 30, 0, 10)})`, 6],
  ['slab cut off the top (stays a box)', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(60, 60, 10, 0, 0, 25)})`, 6],
  ['round hole through a block', `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, cylinder(5, 40, { at: [0, 0, 10] }))`, 7],
  ['block with a notch and a round hole', `const s = subtract(subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 20, -20, -20, 20)}), cylinder(4, 40, { at: [8, 8, 10] }))`, 10],
  // ---- intersections ----
  ['two overlapping cubes, intersected', `const s = intersect(${c(20, 20, 20, 10, 10, 10)}, ${c(20, 20, 20, 20, 20, 20)})`, 6],
  ['a box clipped by a box', `const s = intersect(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 60, 20, 10, 0, 10)})`, 6],
  ['an L clipped to a bar', `const s = intersect(${U(c(40, 10, 20, 20, 5, 10), c(10, 40, 20, 5, 20, 10))}, ${c(60, 8, 30, 20, 4, 10)})`, 6],
  // ---- chains ----
  ['L bracket then a notch at its outer corner', `const s = subtract(${U(c(40, 10, 20, 20, 5, 10), c(10, 40, 20, 5, 20, 10))}, ${c(10, 10, 10, 0, 0, 20)})`, 11],
  ['cut a corner, fill the notch again (back to a box)', `const s = union(subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 20, -20, -20, 20)}), ${c(10, 10, 10, -15, -15, 15)})`, 6],
  ['cut a box, put the same piece back', `const s = union(subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 40, 20, 0, 10)}), ${c(10, 20, 20, 15, 0, 10)})`, 6],
];

test('at least forty hand-counted cases', () => assert.ok(cases.length >= 40, `${cases.length}`));

const tally = { occtEqual: 0, occtSplit: 0 };
for (const [name, body, faces] of cases) {
  test(`faces ${faces}: ${name}`, () => {
    const r = runScript(body);
    assert.deepEqual(r.errors, [], body);
    const id = r.doc.features.at(-1).id;
    const doc = JSON.stringify({ ...r.doc, measure: id });
    assert.deepEqual(JSON.parse(brep.build_doc_json(doc)).refusals ?? {}, {}, name);
    const mine = JSON.parse(brep.measure_doc(doc)).shapes[id];
    assert.equal(mine.faces, faces, `brep-rs has ${mine.faces} faces, the geometry has ${faces}`);
    const ref = occt(r.doc.features, id);
    assert.ok(Math.abs(mine.volume - ref.volume) <= 1e-9 * ref.volume, `volume ${mine.volume} vs OCCT ${ref.volume}`);
    assert.ok(mine.faces <= ref.faces, `brep-rs ${mine.faces} faces vs OCCT ${ref.faces}: OCCT merged more than the hand count`);
    if (ref.faces === faces) tally.occtEqual++;
    else { tally.occtSplit++; console.log(`# OCCT keeps ${ref.faces} faces where the geometry has ${faces}: ${name}`); }
  });
}
test('tally', () => console.log(`# OCCT equals the hand count in ${tally.occtEqual}, keeps split faces in ${tally.occtSplit}`));
