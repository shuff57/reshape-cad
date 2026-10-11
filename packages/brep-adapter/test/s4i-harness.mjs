// Shared helpers for the S4i tests (coincident operands, tangent / coincident surfaces, mirrored chamfer):
// brep-rs build + measure, OCCT referee, mesh closure, STEP read-back. Not a test file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
export const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import('../dist/occt-build.js');
const arc = await import('../../sketch/dist/sketch-arc.js');

export function mine(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const id = r.doc.features.at(-1).id;
  const json = JSON.stringify({ ...r.doc, measure: id });
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes[id];
  return { refusals, volume: s?.volume, bbox: s?.bbox, faces: s?.faces, r, id, json };
}

export function occt(features, id) {
  const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
  assert.ok(shape, 'OCCT built it');
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]] };
}

// Mesh volume plus closure (every undirected edge used by exactly two triangles, vertices welded by position).
// `lumps`: a part of touching lumps (a mirror, a pattern) uses the edges along the contact 4 times (two faces of each
// lump), so only an ODD use count is open.
export function meshStats(json, id, defl, lumps = false) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  assert.ok(!m.error, m.error);
  const key = (i) => [0, 1, 2].map((k) => Math.round(m.positions[i * 3 + k] * 1e6)).join(',');
  const uses = new Map();
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const ix = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const p = ix.map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
    v += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    for (let e = 0; e < 3; e++) {
      const a = key(ix[e]), b = key(ix[(e + 1) % 3]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (lumps ? n % 2 !== 0 : n !== 2) open++;
  return { vol: v, open };
}

export function readStep(text) {
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

/** Mesh closed at 0.05 and 0.5, mesh volume within chord error of the exact one. */
export function assertWatertight(m, tol = [0.01, 0.06], lumps = false) {
  [0.05, 0.5].forEach((defl, i) => {
    const s = meshStats(m.json, m.id, defl, lumps);
    assert.equal(s.open, 0, `open edges at ${defl}`);
    assert.ok(Math.abs(s.vol - m.volume) < tol[i] * m.volume, `mesh ${s.vol} vs ${m.volume} at ${defl}`);
  });
}

export function assertOcct(m, name = '', rel = 1e-6) {
  const ref = occt(m.r.doc.features, m.id);
  assert.ok(Math.abs(m.volume - ref.volume) <= rel * ref.volume, `${name} volume ${m.volume} vs OCCT ${ref.volume}`);
  for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
    assert.ok(Math.abs(m.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `${name} bbox[${a}][${k}] ${m.bbox[a][k]} vs OCCT ${ref.bbox[a][k]}`);
}

export function assertStep(m) {
  const f = JSON.parse(brep.export_step(m.json, m.id));
  assert.ok(f.step, JSON.stringify(f).slice(0, 200));
  const back = readStep(f.step);
  assert.ok(Math.abs(back.volume - m.volume) < 1e-6 * m.volume, `STEP ${back.volume} vs ${m.volume}`);
  assert.equal(back.solids, 1);
  assert.equal(back.valid, true);
}
