// Random parts with three round holes (through or blind, overlapping or not) built on both kernels.
// Every part brep-rs builds must agree with OpenCascade on volume and bounding box; a part it refuses
// is allowed (counted), a part it builds wrong never is. The seed is fixed so a failure reproduces.
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
  if (!shape) return null;
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]] };
}

let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (lo, hi) => lo + (hi - lo) * rnd();
const round2 = (x) => Math.round(x * 100) / 100;

test('random three-hole parts: every part brep-rs builds agrees with OpenCascade', () => {
  let built = 0, refused = 0;
  for (let n = 0; n < 40; n++) {
    let code = 'const b = cuboid(40, 40, 20)\n';
    for (let k = 0; k < 3; k++) {
      const across = round2(pick(4, 12));
      const at = k === 0 ? [0, 0] : [round2(pick(-9, 9)), round2(pick(-9, 9))];
      const deep = rnd() < 0.4 ? `, deep: ${round2(pick(4, 14))}` : '';
      code += `hole(b, { across: ${across}, at: [${at[0]}, ${at[1]}]${deep} })\n`;
    }
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const doc = JSON.stringify({ ...r.doc, measure: id });
    const out = JSON.parse(brep.build_doc_json(doc));
    if (Object.keys(out.refusals ?? {}).length) { refused++; continue; }
    const mine = JSON.parse(brep.measure_doc(doc)).shapes[id];
    const ref = occt(r.doc.features, id);
    if (!ref) continue; // OpenCascade could not build it either
    built++;
    assert.ok(Math.abs(mine.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${mine.volume} vs OCCT ${ref.volume}\n${code}`);
    for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(mine.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${mine.bbox[a][k]} vs ${ref.bbox[a][k]}\n${code}`);
  }
  console.log(`three-hole parts: ${built} built and agreed with OpenCascade, ${refused} refused`);
  assert.ok(built >= 20, `only ${built} built`);
});
