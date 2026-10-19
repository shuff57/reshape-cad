// SPIKE, referee only. Shared measuring core for the 'primitives' contract group (round 3).
// Runs one reSHape Script (or raw ModelDoc) through runScript -> solveDoc -> phase0 translateDoc -> SolidCraft rig and returns the truck
// measure next to live OCCT, brep-rs and an analytic closed form, WITH wall-clock time of the SolidCraft call.
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/primitives-sweep.mjs --spec=<spec.json> --out=<results.json>
//
// Finds the repo root by walking up to node_modules/replicad-opencascadejs (no shadow root needed); brep-rs from packages/ or archive/.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = (() => { let d = HERE; for (let i = 0; i < 8; i++) { if (existsSync(path.join(d, 'node_modules', 'replicad-opencascadejs'))) return d; d = path.dirname(d); } throw new Error('repo root not found'); })();
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
export const arc = await load('packages/sketch/dist/sketch-arc.js');
export const mt = await load('packages/script/dist/model-types.js');
export const { solveDoc } = await load('packages/script/dist/model-codegen.js');
export const { runScript } = await load('packages/script/dist/reshape-script.js');
const { translateDoc } = await import(pathToFileURL(path.join(REPO, 'docs/spikes/solidcraft-referee/phase0/translate.mjs')).href);
const brepDir = [path.join(REPO, 'packages', 'brep-rs', 'pkg'), path.join(REPO, 'archive', 'brep-rs', 'pkg')].find((d) => existsSync(path.join(d, 'brep_rs.js')));
export const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

export const relv = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1e-300) : Infinity);
const flat = (b) => [...b[0], ...b[1]];
export const TOL = { planar: 1e-9, curved: 3e-4 };

function typeCounts(fs) {
  const T = oc.GeomAbs_SurfaceType; const out = {};
  for (const f of fs) {
    const t = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true).GetType();
    const k = t === T.GeomAbs_Plane ? 'plane' : t === T.GeomAbs_Cylinder ? 'cylinder' : t === T.GeomAbs_Cone ? 'cone' : t === T.GeomAbs_Sphere ? 'sphere' : t === T.GeomAbs_Torus ? 'torus' : 'other';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
export function occtMeasure(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const c = g.CentreOfMass();
  const bx = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(); const hi = bx.CornerMax();
  const fs = facesOf(oc, shape);
  return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: fs.length, types: typeCounts(fs) };
}

/** exact closed forms, independent of every kernel (volume only) */
export function analyticVolume(f) {
  switch (f.kind) {
    case 'box': return f.round ? analyticRounded(f) : f.size[0] * f.size[1] * f.size[2];
    case 'cylinder': return f.round ? analyticRounded(f) : Math.PI * f.radius ** 2 * f.height;
    case 'sphere': return 4 / 3 * Math.PI * f.radius ** 3;
    case 'cone': return Math.PI * f.radius ** 2 * f.height / 3;
    case 'torus': return 2 * Math.PI ** 2 * f.ringRadius * f.tubeRadius ** 2;
    case 'prism': { const n = f.sides; return 0.5 * n * f.radius ** 2 * Math.sin(2 * Math.PI / n) * f.height; }
    case 'wedge': return f.width * f.depth * f.height / 2;
    default: return null;
  }
}
function analyticRounded(f) {
  if ((f.roundStyle ?? 'fillet') !== 'fillet') return null;
  const r = f.round;
  if (f.kind === 'box') {
    const [a, b, c] = f.size.map((v) => v - 2 * r);
    if (a < 0 || b < 0 || c < 0) return null;
    return a * b * c + 2 * r * (a * b + b * c + a * c) + Math.PI * r * r * (a + b + c) + 4 / 3 * Math.PI * r ** 3;
  }
  if (f.kind === 'cylinder') {
    const R = f.radius; const h = f.height;
    if (r > R || 2 * r > h) return null;
    return Math.PI * R * R * (h - 2 * r) + 2 * (Math.PI * (R - r) ** 2 * r + Math.PI ** 2 * r * r * (R - r) / 2 + 2 * Math.PI * r ** 3 / 3);
  }
  return null;
}

let nowFn = () => Number(process.hrtime.bigint()) / 1e6;

/**
 * measureCase({id, script|doc, occt=true, brep=true, guard=null})
 * guard: optional (doc, scriptText) => {code, sentence} | null -- applied BEFORE the translator; a refused feature never reaches truck.
 */
export function measureCase(c) {
  const row = { id: c.id, note: c.note ?? '' };
  let doc;
  if (c.script !== undefined) {
    row.script = c.script;
    if (c.lint) { const l = c.lint(c.script); if (l.length) { row.status = 'guard-refused'; row.guard = l[0]; return row; } }
    const r = runScript(c.script);
    if (r.errors.length) { row.status = 'script-refused'; row.refusal = r.errors.map((e) => e.message ?? String(e)).join(' | '); return row; }
    doc = r.doc; row.warnings = (r.warnings ?? []).map((w) => w.message ?? String(w));
  } else doc = c.doc;
  row.doc = doc;
  const id = c.measure ?? doc.features[doc.features.length - 1].id;
  const f = doc.features.find((x) => x.id === id);
  row.kind = f.kind;
  row.an = analyticVolume(f);
  if (c.guard) {
    const g = c.guard(doc, c.script ?? null, f);
    if (g) { row.status = 'guard-refused'; row.guard = g; return row; }
  }
  if (c.occt !== false) {
    try {
      const built = buildDoc(oc, doc, arc);
      const shape = built.shapes.get(id);
      if (!shape) throw new Error(built.refusals?.get?.(id) ?? 'OCCT built nothing');
      row.occt = occtMeasure(shape);
    } catch (e) { row.occt = { refused: String(e.message ?? e).slice(0, 200) }; }
  }
  if (c.brep) {
    try {
      const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
      const s = got.shapes?.[id];
      row.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } : { refused: String(got.refusals?.[id] ?? 'no shape').slice(0, 200) };
    } catch (e) { row.brep = { refused: `brep-rs threw: ${String(e.message).slice(0, 120)}` }; }
  }
  // SolidCraft, timed
  const solved = solveDoc(doc);
  let ms = 0; let cpu = 0; let calls = 0;
  const runSC = (cmds) => {
    calls++; const t0 = nowFn(); const c0 = process.cpuUsage();
    let out;
    try { out = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { out = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
    ms += nowFn() - t0; const c1 = process.cpuUsage(c0); cpu += (c1.user + c1.system) / 1000; return out;
  };
  const tr = translateDoc(solved, { arc, mt, runSC, resolveAt: () => null });
  row.ms = Math.round(ms * 10) / 10; row.cpuMs = Math.round(cpu * 10) / 10; row.calls = calls;
  const mf = tr.features.find((x) => x.id === id);
  if (!mf || mf.status !== 'built') { row.status = 'truck-refused'; row.refusal = mf?.refusal ?? 'not built'; return row; }
  const m = mf.measure;
  row.status = 'built';
  const diag = (b) => Math.max(Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]), 1e-300);
  const t = { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, faceTypes: m.faceTypes, curved: m.curved, bodies: m.bodies.length };
  t.tol = m.curved ? TOL.curved : TOL.planar;
  if (row.an != null) t.dVolAn = relv(m.volume, row.an);
  const ref = row.occt && row.occt.volume !== undefined ? row.occt : null;
  if (ref) {
    t.dVolOcct = relv(m.volume, ref.volume);
    t.dBboxOcct = Math.max(...ref.bbox.map((w, i) => Math.abs(m.bbox[i] - w))) / diag(ref.bbox);
    t.dComOcct = Math.max(...m.com.map((v, i) => Math.abs(v - ref.com[i]))) / diag(ref.bbox);
    t.facesOcct = ref.faces;
  }
  if (row.brep?.volume !== undefined) t.dVolBrep = relv(m.volume, row.brep.volume);
  row.truck = t;
  // verdict against the independent oracle (OCCT preferred, else the closed form)
  const planar = !m.curved;
  const volBar = planar ? TOL.planar : TOL.curved;
  const dv = t.dVolOcct ?? t.dVolAn;
  const bboxBar = planar ? 1e-6 : 1e-4; // of the bbox diagonal
  const comBar = planar ? 1e-6 : 1e-4;
  const why = [];
  if (dv === undefined || dv > volBar) why.push(`vol ${dv === undefined ? 'n/a' : dv.toExponential(1)}`);
  if (t.dBboxOcct !== undefined && t.dBboxOcct > bboxBar) why.push(`bbox ${t.dBboxOcct.toExponential(1)}`);
  if (t.dComOcct !== undefined && t.dComOcct > comBar) why.push(`com ${t.dComOcct.toExponential(1)}`);
  if (t.facesOcct !== undefined && t.facesOcct !== t.faces) why.push(`faces ${t.faces}/${t.facesOcct}`);
  if (m.bodies.length !== 1) why.push(`bodies ${m.bodies.length}`);
  row.oracle = ref ? 'occt' : (row.an != null ? 'closed-form' : 'none');
  row.good = why.length === 0;
  row.why = why.join('; ');
  return row;
}
