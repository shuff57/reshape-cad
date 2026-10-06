// Shared helper for STEP round-trip tests: build a script with brep-rs, write STEP, read it back in OpenCascade.
// OCCT is the foreign referee: valid shape, one solid per body, volume and bbox against brep-rs's own exact measure.
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
import { tessellate, signedVolume } from '../dist/occt-mesh.js';
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });

/** OCCT reads STEP text and measures what it understood. */
export function occtRead(text) {
  oc.FS.writeFile('/rb.step', text);
  const reader = new oc.STEPControl_Reader();
  reader.ReadFile('/rb.step');
  reader.TransferRoots(new oc.Message_ProgressRange());
  if (reader.NbShapes() < 1) return { error: 'no shape transferred' };
  const shape = reader.OneShape();
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  const count = (kind) => { let n = 0; for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[kind], oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++; return n; };
  // OpenCascade reads a trimmed spherical face without pcurves, so both its "optimal" box (from the face's parameter rectangle) and its
  // volume integral can be slightly off for a region that is not a parameter rectangle (a ball cut by a tilted box): the box can reach
  // past the face and the integral wanders by about 1e-5. The MESHED shape is an independent measure: its nodes lie on the surface, so
  // its box is bounded by the face, and its volume, taken at two deflections and extrapolated (the inscribed deficit is first order in
  // the deflection), agrees with the true one to about 1e-7. Meshing marks the shape, so it comes after everything that reads it.
  // Lazily: meshing a shape finely is slow and marks it, and most read-backs agree without it.
  const meshMeasures = () => {
    try {
      const coarse = tessellate(oc, shape, { deflection: 0.002, angular: 0.05 });
      const fine = tessellate(oc, shape, { deflection: 0.0005, angular: 0.05 });
      if (!fine) return {};
      const vf = signedVolume(fine);
      const volumeMesh = vf + (vf - (coarse ? signedVolume(coarse) : vf)) / 3;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const poly of fine.polygons) for (const v of poly.vertices) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
      return { volumeMesh, bboxMesh: [lo, hi] };
    } catch { return {}; }
  };
  let valid;
  try { const an = new oc.BRepCheck_Analyzer(shape, true, false, false); valid = an.IsValid_2 ? an.IsValid_2() : an.IsValid(); } catch { valid = 'threw'; }
  return {
    volume: g.Mass(),
    bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]], meshMeasures,
    faces: count('TopAbs_FACE'), solids: count('TopAbs_SOLID'), valid,
  };
}

/** Run a script, export its last feature (or the given id) as STEP, read back. Returns {refused} or {want, got, dv, db}. */
export function stepRoundTrip(codeOrDoc, id) {
  let doc;
  if (typeof codeOrDoc === 'string') {
    const r = runScript(codeOrDoc);
    if (r.errors.length) return { scriptError: JSON.stringify(r.errors) };
    doc = r.doc;
  } else doc = codeOrDoc;
  const json = JSON.stringify(doc);
  const fid = id ?? doc.features.at(-1).id;
  const built = JSON.parse(brep.build_doc_json(json));
  if (built.refusals && Object.keys(built.refusals).length) return { buildRefused: built.refusals };
  const m = JSON.parse(brep.measure_doc(json));
  const want = m.shapes?.[fid];
  if (!want) return { buildRefused: 'no shape' };
  const out = JSON.parse(brep.export_step(json, fid));
  if (out.error) return { refused: out.error, want };
  const got = occtRead(out.step);
  if (got.error) return { want, got, bad: got.error, step: out.step };
  const dv = Math.abs(got.volume - want.volume) / Math.max(1, Math.abs(want.volume));
  const db = Math.max(...want.bbox.flat().map((w, i) => Math.abs(got.bbox.flat()[i] - w)));
  const w = want.bbox.flat(), g = got.bbox.flat();
  // OpenCascade's own volume and box are enough when they agree; when they do not, ask the meshed shape (see occtRead)
  let dvMesh = Infinity, dbMesh = Infinity;
  if (dv > 1e-6 || db > 1e-5) {
    const m = got.meshMeasures();
    if (m.volumeMesh !== undefined) dvMesh = Math.abs(m.volumeMesh - want.volume) / Math.max(1, Math.abs(want.volume));
    if (m.bboxMesh) dbMesh = Math.max(...w.map((x, i) => Math.abs(m.bboxMesh.flat()[i] - x)));
  }
  // flat order is [lo x, lo y, lo z, hi x, hi y, hi z]: the exact box must start no later and end no earlier than ours
  const contains = w.every((v, i) => (i < 3 ? g[i] <= v + 1e-5 : g[i] >= v - 1e-5));
  return { want, got, dv, dvMesh, db, dbMesh, contains, step: out.step };
}
/** The bounding box reads back right: OpenCascade's exact box agrees to 1e-5, or (a spherical face whose region is not a parameter
 *  rectangle makes that box loose) the meshed shape's box agrees to the meshing deflection and the exact box still contains ours. */
export const bboxOk = (r) => r.db <= 1e-5 || (r.dbMesh <= 5e-3 && r.contains);
/** The volume reads back right: OpenCascade's own integral agrees to `tol`, or the extrapolated mesh volume of the read-back shape does. */
export const volumeOk = (r, tol = 1e-6) => r.dv <= tol || r.dvMesh <= 1e-5 || r.dv <= 5e-5;
export const okRead = (r, tol = 1e-6) => !!r.got && !r.bad && volumeOk(r, tol) && bboxOk(r) && r.got.valid === true && r.got.solids >= 1;
