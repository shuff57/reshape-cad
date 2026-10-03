// The planar split-and-classify boolean against OpenCascade, the independent referee: every
// script that used to refuse and now builds is built on both kernels, and the volume and bounding
// box must agree. (The closed forms are pinned in planar-boolean.test.mjs and round-after-cut.test.mjs;
// this file is the check that does not depend on our own arithmetic.)
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
const arc = await import('../../sketch/dist/sketch-arc.js');

function occt(features, id) {
  const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
  assert.ok(shape, 'OCCT built it');
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]] };
}

const HALF = 'const c = cuboid(60, 30, 40, { at: [0, 15, 0] })\nsubtract(b, c)';
const scripts = {
  'blind hole then round': "const b = box(40, 40, 20)\nhole(b, { across: 8, deep: 6 })\nround(b.edge('top', 'front'), 3)",
  'round then blind hole': "const b = box(40, 40, 20)\nround(b.edge('top', 'front'), 3)\nhole(b, { across: 8, deep: 6 })",
  'hole then chamfer': "const b = box(40, 40, 20)\nhole(b, { across: 8 })\nchamfer(b.edge('top', 'front'), 3)",
  'chamfer then hole': "const b = box(40, 40, 20)\nchamfer(b.edge('top', 'front'), 3)\nhole(b, { across: 8 })",
  'hole then half cut': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\n' + HALF,
  'blind hole then half cut': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12, deep: 8 })\n' + HALF,
  'hole then off-axis cut': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\nconst c = cuboid(60, 60, 40, { at: [33, 0, 0] })\nsubtract(b, c)',
  'hole then partial-height cut': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\nconst c = cuboid(60, 30, 6, { at: [0, 15, 0] })\nsubtract(b, c)',
  'off-centre hole then corner cut': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 10, at: [-6, -4] })\nconst c = cuboid(30, 30, 8, { at: [-3, -2, 2] })\nsubtract(b, c)',
  'blind off-centre hole then partial cut': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 10, deep: 12, at: [5, 3] })\nconst c = cuboid(20, 24, 9, { at: [8, 3, 4] })\nsubtract(b, c)',
  'z bore then smaller x bore': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8 })\nhole(b, { across: 4, along: "x" })',
  'z bore then smaller y bore': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8 })\nhole(b, { across: 4, along: "y" })',
  'x bore then smaller z bore': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8, along: "x" })\nhole(b, { across: 4 })',
  'z bore then x bore off the mid-height': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 10 })\nhole(b, { across: 4, along: "x", at: [0, 3] })',
  'deep blind z bore then x bore': 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8, deep: 14 })\nhole(b, { across: 4, along: "x" })',
  'hollow then half cut': 'const b = cuboid(40, 40, 20)\nshell(b, { wall: 2 })\n' + HALF,
};

for (const [name, code] of Object.entries(scripts)) {
  test(`OCCT agrees: ${name}`, () => {
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const doc = JSON.stringify({ ...r.doc, measure: id });
    assert.deepEqual(JSON.parse(brep.build_doc_json(doc)).refusals ?? {}, {}, name);
    const mine = JSON.parse(brep.measure_doc(doc)).shapes[id];
    const ref = occt(r.doc.features, id);
    assert.ok(Math.abs(mine.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${mine.volume} vs OCCT ${ref.volume}`);
    for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(mine.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${mine.bbox[a][k]} vs ${ref.bbox[a][k]}`);
  });
}
