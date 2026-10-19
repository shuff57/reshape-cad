import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
export const PKG = process.env.SOLIDCRAFT_REFEREE_PKG; // not needed by the angle probe
const imp = (p) => import(pathToFileURL(p.startsWith('/') ? p : path.join(REPO, p)).href);
export const arc = await imp('packages/sketch/dist/sketch-arc.js');
export const mt = await imp('packages/script/dist/model-types.js');
const { runScript } = await imp('packages/script/dist/reshape-script.js');
const { solveDoc } = await imp('packages/script/dist/model-codegen.js');
export { runScript, solveDoc };
export function docOfScript(src) {
  const r = runScript(src);
  if (r.errors?.length) return { error: r.errors.map((e) => e.message ?? String(e)).join(' | ') };
  return { doc: solveDoc(r.doc), raw: r.doc };
}
export async function loadSC() { return createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js')); }
export async function loadOracles() {
  const OCCT_DIR = path.join(REPO, 'node_modules/replicad-opencascadejs/dist');
  const glue = await imp(path.join(OCCT_DIR, 'replicad_single.js'));
  const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
  const { buildDoc } = await imp('packages/brep-adapter/dist/occt-build.js');
  const { facesOf } = await imp('packages/brep-adapter/dist/topo-resolve.js');
  const brepDir = path.join(REPO, 'archive/brep-rs/pkg');
  const brep = await imp(path.join(brepDir, 'brep_rs.js'));
  brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
  const occt = (doc, id) => {
    const built = buildDoc(oc, doc, arc);
    const ref = built.refusals?.get?.(id);
    const shape = built.shapes.get(id);
    if (!shape) return { refused: ref ?? 'OCCT built nothing' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const c = g.CentreOfMass(); const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(), hi = bx.CornerMax();
    return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: facesOf(oc, shape).length, refusal: ref };
  };
  const brepM = (doc, id) => {
    try {
      const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
      const s = got.shapes?.[id];
      if (!s) return { refused: got.refusals?.[id] ?? 'no shape' };
      return { volume: s.volume, bbox: [...s.bbox[0], ...s.bbox[1]], faces: s.faces, refusal: got.refusals?.[id] };
    } catch (e) { return { refused: 'brep-rs threw: ' + e.message }; }
  };
  return { occt, brepM };
}
