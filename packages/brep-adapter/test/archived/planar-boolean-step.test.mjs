// The planar boolean's results export to STEP and an independent OpenCascade reads the same
// volume back from the file, a valid solid, closed-form expected.
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

function readStep(text) {
  oc.FS.writeFile('/in.step', text);
  const reader = new oc.STEPControl_Reader();
  reader.ReadFile('/in.step');
  reader.TransferRoots(new oc.Message_ProgressRange());
  const shape = reader.OneShape();
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const an = new oc.BRepCheck_Analyzer(shape, true, false, false);
  let solids = 0;
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) solids++;
  return { volume: g.Mass(), valid: an.IsValid_2 ? an.IsValid_2() : an.IsValid(), solids };
}

const HOLLOW = 'const b = cuboid(40, 40, 20)\nshell(b, { wall: 2 })\n';
const CUP = "const b = cuboid(40, 40, 20)\nshell(b, { wall: 2, open: 'top' })\n";
const HALF = 'const c = cuboid(60, 30, 40, { at: [0, 15, 0] })\nsubtract(b, c)';
const cases = [
  ['hollow cut in half', HOLLOW + HALF, 5632],
  ['open cup cut in half', CUP + HALF, 4336],
  ['open cup with a wall notch', CUP + 'const c = cuboid(10, 10, 6, { at: [20, 0, 0] })\nsubtract(b, c)', 8552],
  ['hollow then chamfer', HOLLOW + "chamfer(b.edge('top', 'front'), 1.5)", 11219],
  ['bored box cut in half through the bore', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\n' + HALF.replace('const c', 'const c'), (32000 - Math.PI * 36 * 20) / 2],
  ['blind-bored box cut in half', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12, deep: 8 })\n' + HALF, (32000 - Math.PI * 36 * 8) / 2],
  ['bored box cut across part of the bore height', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\nconst c = cuboid(60, 30, 6, { at: [0, 15, 0] })\nsubtract(b, c)', 32000 - Math.PI * 36 * 20 - (4800 - Math.PI * 36 * 3)],
  ['off-centre blind hole, partial cut', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 10, deep: 12, at: [5, 3] })\nconst c = cuboid(20, 24, 9, { at: [8, 3, 4] })\nsubtract(b, c)', null],
  ['z bore then smaller x bore', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8 })\nhole(b, { across: 4, along: "x" })', null],
  ['x bore then smaller z bore', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8, along: "x" })\nhole(b, { across: 4 })', null],
  ['deep blind z bore then x bore', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8, deep: 14 })\nhole(b, { across: 4, along: "x" })', null],
  ['two overlapping through holes (a slot)', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 10 })\nhole(b, { across: 6, at: [4, 0] })', null],
  ['two overlapping blind holes', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 10, deep: 12 })\nhole(b, { across: 6, deep: 8, at: [4, 0] })', null],
  ['three overlapping holes', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 8 })\nhole(b, { across: 8, at: [6, 0] })\nhole(b, { across: 8, at: [12, 0] })', null],
  ['bored box with the top half removed', 'const b = cuboid(40, 40, 20)\nhole(b, { across: 12 })\nconst c = cuboid(60, 60, 20, { at: [0, 0, 10] })\nsubtract(b, c)', (32000 - Math.PI * 36 * 20) / 2],
];

for (const [name, code, volume] of cases) {
  test(`STEP round trip: ${name}`, () => {
    const r = runScript(code);
    assert.deepEqual(r.errors, []);
    const json = JSON.stringify(r.doc);
    const id = r.doc.features.at(-1).id;
    const f = JSON.parse(brep.export_step(json, id));
    assert.ok(f.step, JSON.stringify(f).slice(0, 200));
    const back = readStep(f.step);
    const want = volume ?? JSON.parse(brep.measure_doc(JSON.stringify({ ...r.doc, measure: id }))).shapes[id].volume;
    assert.ok(Math.abs(back.volume - want) < 1e-6 * want, `${back.volume} vs ${want}`);
    assert.equal(back.solids, 1);
    assert.equal(back.valid, true);
  });
}
