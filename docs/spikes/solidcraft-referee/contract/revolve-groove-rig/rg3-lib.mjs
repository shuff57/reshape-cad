// Round-3 helper for the revolve-groove rig: loads the repo dists, the guarded translators and (optionally) live OCCT, and runs ONE script through
// translator -> solidcraft (+ OCCT volume as the oracle). Self-locating (REPO from this file). Needs SOLIDCRAFT_REFEREE_PKG.
//   import { init } from './rg3-lib.mjs'; const L = await init({ occt: true }); const r = await L.run(src, { tr: 'g0' });
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.join(HERE, '..', '..', '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
export async function init({ occt = false, brep = false } = {}) {
  const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
  if (!PKG) throw new Error('SOLIDCRAFT_REFEREE_PKG is unset');
  const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
  const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
  const arc = await load('packages/sketch/dist/sketch-arc.js');
  const mt = await load('packages/script/dist/model-types.js');
  const { solveDoc } = await load('packages/script/dist/model-codegen.js');
  const { runScript } = await load('packages/script/dist/reshape-script.js');
  const T = {};
  const tr = async (name) => (T[name] ??= (await import(pathToFileURL(path.join(HERE, { g0: 'rg-translate-p0.mjs', g4: 'rg-translate-p4.mjs', raw0: '../../phase0/translate.mjs', raw4: '../../phase7/pane/lib/translate-p4.mjs' }[name])).href)).translateDoc);
  let oc = null; let buildDoc = null; let facesOf = null;
  if (occt) {
    const D = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
    const glue = await import(pathToFileURL(path.join(D, 'replicad_single.js')).href);
    oc = await glue.default({ locateFile: (f) => path.join(D, f) });
    ({ buildDoc } = await load('packages/brep-adapter/dist/occt-build.js'));
    ({ facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js'));
  }
  let brepM = null;
  if (brep) {
    const dir = [path.join(REPO, 'packages', 'brep-rs', 'pkg'), path.join(REPO, 'archive', 'brep-rs', 'pkg')].find((d) => existsSync(path.join(d, 'brep_rs.js')));
    brepM = await import(pathToFileURL(path.join(dir, 'brep_rs.js')).href);
    brepM.initSync({ module: readFileSync(path.join(dir, 'brep_rs_bg.wasm')) });
  }
  const occtMeasure = (shape) => {
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const c = g.CentreOfMass(); const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(); const hi = bx.CornerMax();
    return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: facesOf(oc, shape).length, area: (() => { const a = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(shape, a, false, false); return a.Mass(); })() };
  };
  /** run a script: { errors } if the script layer refuses; else the translated features (last one is the measured one) and optionally the OCCT / brep-rs numbers. */
  async function run(src, { trName = 'g0', oracle = false, brepToo = false, featuresOnly = false } = {}) {
    const rs = runScript(src);
    if (rs.errors?.length) return { scriptErrors: rs.errors.map((e) => e.message ?? String(e)) };
    const doc = solveDoc(rs.doc); const last = doc.features.at(-1).id;
    const translate = await tr(trName);
    const t0 = Date.now(); const c0 = process.cpuUsage();
    // featuresOnly: every cutting revolve is answered with a fake failure instead of being computed, so only the guard's inputs (head measure, profile, frame) are produced
    const rs2 = featuresOnly ? (cmds) => (cmds.some((c) => c.command === 'solid.revolve' && c.params.operation === 'cut') ? { ok: false, failed: { command: 'solid.revolve', error: 'skipped (features only)' } } : runSC(cmds)) : runSC;
    const out = await translate(doc, { arc, mt, runSC: rs2, resolveAt: () => null });
    const c1 = process.cpuUsage(c0);
    const r = { ms: Date.now() - t0, cpuMs: Math.round((c1.user + c1.system) / 1000), load: os.loadavg()[0], features: out.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, guard: f.guard, measure: f.measure })), commands: out.commands, last };
    r.truck = r.features.find((f) => f.id === last);
    if (oracle && oc) {
      try {
        const built = buildDoc(oc, { version: 1, features: rs.doc.features }, arc);
        const shape = built.shapes.get(last); r.occt = shape ? occtMeasure(shape) : { refused: String(built.refusals?.get?.(last) ?? 'none') };
      } catch (e) { r.occt = { refused: e.message }; }
    }
    if (brepToo && brepM) {
      try { const got = JSON.parse(brepM.measure_doc(JSON.stringify({ version: 1, features: rs.doc.features }))); const s = got.shapes?.[last]; r.brep = s ? { volume: s.volume, bbox: [...s.bbox[0], ...s.bbox[1]], faces: s.faces } : { refused: got.refusals?.[last] ?? 'no shape' }; } catch (e) { r.brep = { refused: e.message }; }
    }
    return r;
  }
  return { run, runSC, arc, mt, solveDoc, runScript, oc, occtMeasure };
}
export const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
