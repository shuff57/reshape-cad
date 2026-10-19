// Group 'sketch-dof-diagnosis' shared rig. Referee only: reads packages/*/dist, archive/brep-rs/pkg, the SolidCraft referee pkg
// (phase0 wrapper: `run` returns the FIRST failing command's error or the final inspect.measure, nothing else).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../../../..');
export const SPIKE = path.resolve(HERE, '../..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const imp = (p) => import(pathToFileURL(p).href);
export const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- SolidCraft (phase0 wrapper) ----
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
/** Run a command list. Returns {ok:true, measure} or {ok:false, index, command, error}. Stops at the first failing command. */
export function scRun(commands) {
  const r = JSON.parse(sc.run(JSON.stringify({ commands })));
  if (r.ok) return { ok: true, measure: r.measure };
  if (r.failed) return { ok: false, index: r.failed.index, command: r.failed.command, error: r.failed.error };
  return { ok: false, index: -1, command: null, error: r.error };
}

// ---- brep-rs (archive/brep-rs/pkg: packages/brep-rs/pkg no longer exists) ----
const BPKG = path.join(REPO, 'archive/brep-rs/pkg');
const brep = await imp(path.join(BPKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(BPKG, 'brep_rs_bg.wasm')) });
export { brep };
const { SketchSession2D } = await imp(path.join(REPO, 'packages/brep-adapter/dist/sketch-session.js'));
const { BrepRsEngineAdapter } = await imp(path.join(REPO, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));
const stub = { BufferGeometry: class { setAttribute() {} setIndex() {} computeVertexNormals() {} addGroup() {} }, Float32BufferAttribute: class {} };
const adapter = new BrepRsEngineAdapter(stub); adapter.loadFromBytes(brep);
export { SketchSession2D };
export const { runScript } = await imp(path.join(REPO, 'packages/script/dist/reshape-script.js'));
export const solve = await imp(path.join(REPO, 'packages/sketch/dist/sketch-solve.js'));
export const outline = await imp(path.join(REPO, 'packages/sketch/dist/sketch-outline.js'));
export const modelCodegen = await imp(path.join(REPO, 'packages/script/dist/model-codegen.js'));
export const mapper = await imp(path.join(SPIKE, 'phase2/sketch-map.mjs'));
export const ruleCheck = await imp(path.join(SPIKE, 'phase2/rule-check.mjs'));
export const fixtures = await imp(path.join(SPIKE, 'phase2/fixtures-p2.mjs'));

/** brep-rs sketch session: open + solve + diagnose + solved rows. */
export function brepSketch(geoms, rules) {
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  const o = { open: null, solved: null, diag: null, geoms: null, lastError: null };
  o.open = s.open(clone(geoms), clone(rules));
  if (!o.open) {
    o.solved = s.solve();
    o.lastError = o.solved ? null : s.lastError();
    o.diag = s.diagnose();
    if (o.solved) { try { o.geoms = s.solvedGeoms(); } catch { /* none */ } }
  }
  s.close();
  return o;
}

/** brep-rs build of a doc: volume / bbox / faces (measure_doc) or the refusal sentence. */
export function brepBuild(doc) {
  const o = {};
  try {
    const built = adapter.build(doc);
    const refusals = Object.fromEntries(built.refusals ?? []);
    const last = doc.features.at(-1).id;
    if (Object.keys(refusals).length) return { outcome: 'refused', refusal: Object.values(refusals).join(' | ') };
    if (!built.shapes.has(last)) return { outcome: 'refused', refusal: 'no shape built and no refusal sentence' };
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (!m) return { outcome: 'error', refusal: 'no measurement' };
    return { outcome: 'built', volume: m.volume, faces: m.faces ?? m.face_count, bbox: [...m.bbox[0], ...m.bbox[1]] };
  } catch (e) { return { outcome: 'error', refusal: String(e).slice(0, 200) }; }
}

export const GAUNTLET = path.join(REPO, 'docs/replica/freecad/gauntlet/variants');
export function fcRef(id) {
  try {
    const r = JSON.parse(readFileSync(path.join(GAUNTLET, 'refs', `ref-${id}.json`), 'utf8'));
    return { dof: r.dof, conflicting: r.conflicting ?? [], redundant: r.redundant ?? [], bbox: r.bbox,
      bucket: (r.conflicting ?? []).length ? 'conflicting' : (r.redundant ?? []).length ? 'redundant' : 'consistent' };
  } catch { return null; }
}

export const fx = (x) => (typeof x === 'number' ? +x.toPrecision(10) : Array.isArray(x) ? x.map(fx) : x);
export const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);

// ---- OCCT (live, replicad-opencascadejs) + the phase0 translator: a real script -> ModelDoc -> solveDoc -> {OCCT, brep-rs, SolidCraft} ----
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await imp(path.join(OCCT_DIR, 'replicad_single.js'));
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await imp(path.join(REPO, 'packages/brep-adapter/dist/occt-build.js'));
const { facesOf } = await imp(path.join(REPO, 'packages/brep-adapter/dist/topo-resolve.js'));
export const arc = await imp(path.join(REPO, 'packages/sketch/dist/sketch-arc.js'));
export const mt = await imp(path.join(REPO, 'packages/script/dist/model-types.js'));
const { translateDoc } = await imp(path.join(SPIKE, 'phase0/translate.mjs'));

export function occtMeasure(doc, id) {
  try {
    const built = buildDoc(oc, doc, arc);
    const shape = built.shapes.get(id);
    if (!shape) return { outcome: 'refused', refusal: built.refusals?.get?.(id) ?? 'OCCT built nothing' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const c = g.CentreOfMass(); const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(), hi = bx.CornerMax();
    return { outcome: 'built', volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: facesOf(oc, shape).length };
  } catch (e) { return { outcome: 'error', refusal: String(e).slice(0, 200) }; }
}
const runSCfull = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
export function scTranslate(doc) {
  const tr = translateDoc(doc, { arc, mt, runSC: runSCfull, resolveAt: () => null });
  const last = tr.features.at(-1);
  if (last?.status !== 'built') return { outcome: 'refused', refusal: last?.refusal ?? 'not built', features: tr.features.map((f) => ({ id: f.id, status: f.status, refusal: f.refusal })) };
  const m = last.measure;
  return { outcome: 'built', volume: m.volume, bbox: m.bbox, faces: m.faces, com: m.com };
}
/** reSHape Script source -> ModelDoc (TS-solved) -> all three kernels on the LAST feature. */
export function pipeline(src) {
  const run = runScript(src);
  if (run.errors?.length) return { scriptErrors: run.errors.map((e) => e.message ?? String(e)), warnings: run.warnings };
  const doc = modelCodegen.solveDoc(run.doc);
  const last = doc.features.at(-1).id;
  return { doc, last, warnings: run.warnings ?? [], occt: occtMeasure(doc, last), brep: brepBuild(doc), sc: scTranslate(doc) };
}
