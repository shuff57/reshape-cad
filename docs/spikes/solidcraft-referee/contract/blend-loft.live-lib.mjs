// Shared live rig for the blend-loft round-4 scripts (calibration sweeps, live gate, option probes). Runs from the repo, no shadow root:
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.<script>.mjs
// Everything here is MEASURED live: truck (SolidCraft wasm through the spike translator), OCCT (replicad-opencascadejs ThruSections ruled) and
// brep-rs (archive/brep-rs/pkg, read only). Nothing is replayed from a saved file.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
export const CONTRACT = `${REPO}/docs/spikes/solidcraft-referee/contract`;
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) throw new Error('set SOLIDCRAFT_REFEREE_PKG to the wasm-bindgen --target nodejs pkg dir');
export const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
export const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
export const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
export const arc = await load('packages/sketch/dist/sketch-arc.js');
export const mt = await load('packages/script/dist/model-types.js');
export const { solveDoc } = await load('packages/script/dist/model-codegen.js');
export const { runScript } = await load('packages/script/dist/reshape-script.js');
export const { toScript } = await load('packages/script/dist/reshape-script-gen.js');
export const { translateDoc } = await load('docs/spikes/solidcraft-referee/phase0/translate.mjs');
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
export const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
export const G = await import(pathToFileURL(path.join(CONTRACT, 'blend-loft.guard.mjs')).href);
export const GR = await import(pathToFileURL(path.join(CONTRACT, 'blend-loft.guarded-run.mjs')).href);

export const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
export const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
export const flat = (b) => [...b[0], ...b[1]];

export function occtMeasure(doc, id = 'bl1') {
  try {
    const built = buildDoc(oc, doc, arc);
    const shape = built.shapes.get(id);
    if (!shape) return { refused: built.refusals?.get?.(id) ?? 'OCCT built nothing' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(); const hi = bx.CornerMax();
    return { volume: g.Mass(), bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: facesOf(oc, shape).length };
  } catch (e) { return { refused: 'OCCT threw: ' + (e?.message ?? String(e)) }; }
}
export function brepMeasure(doc, id = 'bl1') {
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const s = got.shapes?.[id];
    return s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } : { refused: got.refusals?.[id] ?? 'no shape' };
  } catch (e) { return { refused: 'brep threw: ' + e.message }; }
}
export function truckMeasure(doc, id = 'bl1') {
  const d = solveDoc(doc);
  const tr = translateDoc(d, { arc, mt, runSC, resolveAt: () => null });
  const mf = tr.features.find((f) => f.id === id);
  if (!mf || mf.status !== 'built') return { refused: mf?.refusal ?? tr.features.find((f) => f.status === 'refused')?.refusal ?? 'not built' };
  const m = mf.measure;
  return { volume: m.volume, bbox: m.bbox, faces: m.faces, kernelFaces: m.kernelFaces };
}

export const sk = (id, plane, offset, points, extra = {}) => ({ id, kind: 'sketch', plane, offset, points, ...extra });
export const circ = (id, cx, cy, r, plane = 'xy', off = 0) => ({ id, kind: 'sketch', plane, offset: off, points: [[cx - r, cy], [cx + r, cy]], shape: 'circle' });
export const bl = (...t) => ({ id: 'bl1', kind: 'blend', targets: t });
export const rectPts = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
export const regPts = (n, r, rot = 0, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(rot + 2 * Math.PI * i / n), cy + r * Math.sin(rot + 2 * Math.PI * i / n)]);
export const roundedRectDoc = (id, plane, off, w, h, r) => sk(id, plane, off, rectPts(0, 0, w, h), { rounds: { 0: r, 1: r, 2: r, 3: r } });

/** the verdict of the CURRENT guard for the single blend of a doc (null = pass) */
export function guardOf(doc, ctx = {}) {
  const solved = solveDoc(doc);
  const m = G.guardDoc(solved, { outlineOf: arc.outlineOf, ...ctx });
  return [...m.values()][0] ?? null;
}
export const isCurved = (doc) => doc.features.some((f) => f.kind === 'sketch' && (f.shape === 'circle' || (f.rounds && Object.keys(f.rounds).length)));
export const barOf = (doc) => (isCurved(doc) ? 3e-4 : 1e-9);

/** one case through all three kernels + the guard. d = truck vs OCCT, exact analytic volume of circle<->circle in `an` when it applies. */
export function full(doc, ctx = {}) {
  const o = occtMeasure(doc); const t = truckMeasure(doc); const g = guardOf(doc, ctx);
  const r = { occt: o, truck: t, guard: g, curved: isCurved(doc), bar: barOf(doc) };
  if (o.volume !== undefined && t.volume !== undefined) { r.d = rel(t.volume, o.volume); r.faceMismatch = o.faces !== t.faces; r.signed = (t.volume - o.volume) / Math.max(Math.abs(o.volume), 1); }
  return r;
}
/** closed-form volume of a ruled loft between two circles on parallel planes (any lateral offset): h/3 (A1 + A2 + sqrt(A1 A2)) */
export const frustumVolume = (r1, r2, h) => { const A1 = Math.PI * r1 * r1; const A2 = Math.PI * r2 * r2; return Math.abs(h) / 3 * (A1 + A2 + Math.sqrt(A1 * A2)); };

export function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
