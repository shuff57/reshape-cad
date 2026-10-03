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
    assert.ok(Math.abs(back.volume - volume) < 1e-6 * volume, `${back.volume} vs ${volume}`);
    assert.equal(back.solids, 1);
    assert.equal(back.valid, true);
  });
}
