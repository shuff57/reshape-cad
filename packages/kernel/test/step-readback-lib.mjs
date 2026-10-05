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
  let valid;
  try { const an = new oc.BRepCheck_Analyzer(shape, true, false, false); valid = an.IsValid_2 ? an.IsValid_2() : an.IsValid(); } catch { valid = 'threw'; }
  return {
    volume: g.Mass(),
    bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]],
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
  return { want, got, dv, db, step: out.step };
}
export const okRead = (r, tol = 1e-6) => !!r.got && !r.bad && r.dv <= tol && r.db <= 1e-5 && r.got.valid === true && r.got.solids >= 1;
