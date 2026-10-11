// Shared loader for the variant sweep: the real brep-rs wasm + the built script/kernel dist (one kernel, no fallback).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const imp = (p) => import(pathToFileURL(p).href);

let ctx = null;
export async function load() {
  if (ctx) return ctx;
  const brep = await imp(path.join(PKG, 'brep_rs.js'));
  brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
  const { runScript } = await imp(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
  const { BrepRsEngineAdapter } = await imp(path.join(ROOT, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));
  const { SketchSession2D } = await imp(path.join(ROOT, 'packages/brep-adapter/dist/sketch-session.js'));
  const stub = { BufferGeometry: class { setAttribute() {} setIndex() {} computeVertexNormals() {} addGroup() {} }, Float32BufferAttribute: class {} };
  const adapter = new BrepRsEngineAdapter(stub); adapter.loadFromBytes(brep);
  ctx = { brep, runScript, adapter, SketchSession2D };
  return ctx;
}

/** Build one reSHape Script source on the real kernel. Returns {outcome, volume, bbox, faces, refusal, ...}.
 *  outcome: built | refused | script-error | error.  A script error is NOT a kernel refusal and is reported as such. */
export async function measureScript(src) {
  const { runScript } = await load();
  try {
    const run = runScript(src);
    if (run.errors?.length) return { src, outcome: 'script-error', refusal: run.errors.map((e) => e.message ?? String(e)).join(' | ') };
    return { src, ...(await measureDoc(run.doc)) };
  } catch (e) { return { src, outcome: 'error', refusal: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
}

/** Build a ModelDoc on the real kernel (no script layer in between) and measure its last feature. */
export async function measureDoc(doc) {
  const { brep, adapter } = await load();
  const o = {};
  try {
    o.featureKinds = doc.features.map((f) => f.kind);
    const built = adapter.build(doc);
    const refusals = Object.fromEntries(built.refusals ?? []);
    o.refusals = refusals;
    const last = doc.features.at(-1).id;
    o.lastFeature = last;
    if (Object.keys(refusals).length) { o.outcome = 'refused'; o.refusal = Object.values(refusals).join(' | '); return o; }
    if (!built.shapes.has(last)) { o.outcome = 'refused'; o.refusal = 'no shape built and no refusal sentence'; return o; }
    const meas = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const m = meas.shapes?.[last];
    if (!m) { o.outcome = 'error'; o.refusal = 'no measurement for last feature'; return o; }
    o.volume = m.volume; o.faces = m.faces ?? m.face_count; o.bbox = [...m.bbox[0], ...m.bbox[1]];
    const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), last, 0.01));
    o.meshTris = mesh.indices ? mesh.indices.length / 3 : 0;
    if (o.meshTris > 0) Object.assign(o, meshMoments(mesh.positions, mesh.indices));
    o.outcome = o.meshTris > 0 && Number.isFinite(o.volume) ? 'built' : 'error';
  } catch (e) { o.outcome = 'error'; o.refusal = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); }
  return o;
}

/** The first feature of `kind` in a ModelDoc gets `set` assigned over it: how a kernel input the script layer now refuses is still reached. */
export function patchDoc(doc, kind, set) {
  const d = JSON.parse(JSON.stringify(doc));
  const f = d.features.find((x) => x.kind === kind);
  if (!f) throw new Error(`no ${kind} feature to patch`);
  Object.assign(f, set);
  return d;
}

/** Volume and centre of mass of a closed triangle mesh (signed tetrahedra about the origin). Independent of the kernel's
 *  exact volume: it comes from the tessellation, so it also catches a mesh that is open or inside-out. */
export function meshMoments(pos, idx) {
  let v = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx_ = pos[c], cy_ = pos[c + 1], cz_ = pos[c + 2];
    const d = ax * (by * cz_ - bz * cy_) - ay * (bx * cz_ - bz * cx_) + az * (bx * cy_ - by * cx_);
    v += d / 6;
    cx += (d / 24) * (ax + bx + cx_); cy += (d / 24) * (ay + by + cy_); cz += (d / 24) * (az + bz + cz_);
  }
  return { meshVolume: v, com: v ? [cx / v, cy / v, cz / v] : null };
}
