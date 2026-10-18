// The named edges of a fresh prism or wedge. Their faces used to carry edge objects of their own (every edge used once), so no edge was
// ever "between" two faces and every named edge of one read as "could not be found". They share their edges now, like a box.
// Oracle: OpenCascade, the independent referee, on the volume of the chamfered part, for every ordered pair of the six face words.
// A face word is the face farthest that way; on a polygon prism two sides can tie (the pentagon's 'right' and 'front'), and the kernel takes the
// first by its own face order, deterministically. OpenCascade takes its own first, which on a pentagon can be a side that is not next to the other
// face named (so it chamfers nothing where we chamfer an edge): those pairs are counted but not compared. Where the tied sides are mirror images
// (a hexagon's or octagon's), either choice gives the same volume, and the comparison is made.
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

function occtVolume(features, id) {
  try {
    const sh = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
    const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(sh, g, 1e-7, false, false);
    return g.Mass();
  } catch { return null; }
}
// the face words two sides tie for on each polygon prism (the first by each engine's own face order is taken)
const TIES = { 'prism of 5': ['right', 'front'], 'prism of 6': ['left', 'right'], 'prism of 8': ['front', 'back', 'left', 'right'] };
const WORDS = ['top', 'bottom', 'front', 'back', 'left', 'right'];
const HOSTS = { box: 'box(30, 24, 20)', 'prism of 5': 'prism(5, 30, 20)', 'prism of 6': 'prism(6, 30, 20)', 'prism of 8': 'prism(8, 30, 20)', wedge: 'wedge(30, 24, 20)' };

test('every named edge of a prism or wedge chamfers to the volume OpenCascade gets, or refuses', () => {
  const bad = [];
  const seen = {};
  for (const [name, ctor] of Object.entries(HOSTS)) {
    seen[name] = { agree: 0, notUnique: 0, /* notUnique: tie pairs not compared */ otherRefusal: 0, bothNothing: 0 };
    for (const a of WORDS) for (const b of WORDS) {
      if (a === b) continue;
      const code = `let v = ${ctor}\nbevel(v.edge('${a}', '${b}'), 1.2)`;
      const r = runScript(code);
      if (r.errors.length) continue;
      const id = r.doc.features.at(-1).id;
      const doc = JSON.stringify({ ...r.doc, measure: id });
      const out = JSON.parse(brep.build_doc_json(doc));
      const refusal = Object.values(out.refusals ?? {})[0];
      const tied = (TIES[name] ?? []).some((w) => a === w || b === w);
      const ov = occtVolume(r.doc.features, id), base = occtVolume(r.doc.features.slice(0, -1), r.doc.features.at(-2).id);
      const occtCut = ov !== null && base !== null && ov < base - 1e-6;
      if (refusal) {
        if (tied) seen[name].notUnique++;
        else if (occtCut) { seen[name].otherRefusal++; bad.push(`${name} ${a}-${b}: refused (${String(refusal).slice(0, 90)}) where OpenCascade chamfers`); }
        else seen[name].bothNothing++;
        continue;
      }
      const bv = JSON.parse(brep.measure_doc(doc)).shapes[id].volume;
      if (tied) { seen[name].notUnique++; continue; }
      if (ov === null || Math.abs(bv - ov) > 1e-6 * ov) bad.push(`${name} ${a}-${b}: brep ${bv} OpenCascade ${ov}`);
      else seen[name].agree++;
    }
  }
  console.log('prism and wedge edges:', JSON.stringify(seen));
  assert.deepEqual(bad, [], bad.slice(0, 4).join('\n'));
  assert.ok(seen.box.agree >= 24 && seen.wedge.agree >= 24, 'the box and the wedge chamfer every one of their edges');
  for (const name of ['prism of 5', 'prism of 6']) assert.ok(seen[name].agree >= 6, `${name}: only ${seen[name].agree} untied edges chamfer`);
});
