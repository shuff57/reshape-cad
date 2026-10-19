#!/usr/bin/env node
// SPIKE, referee only. Phase 0: ModelDoc -> solidcraft (truck, wasm) per feature, scored against live OCCT and live brep-rs.
//
//   SOLIDCRAFT_REFEREE_PKG=<dir with solidcraft_referee.js, wasm-bindgen --target nodejs> \
//     node docs/spikes/solidcraft-referee/phase0/run-phase0.mjs [--only=id,id] [--out=<dir>]
//
// Needs `npm run build` (reads packages/*/dist) and packages/brep-rs/pkg. Not part of npm test. Writes results.json,
// last-run.txt and ours/ours-<id>.json under --out (default: this directory; the path is printed).
// Exit 0 only when no fixture FAILs, no face-count mismatch is unexplained and every negative control is rejected.
//
// compare.mjs scores gauntlet variants against FreeCAD refs and reads refs only from its own baseline/ dir, so it cannot
// score parity fixtures: this file carries its own scorer (relative delta with a scale floor of 1, as worst() in the gate).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/phase0/translate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset. Point it at the wasm-bindgen --target nodejs pkg dir (see ../REPORT.md). Nothing was run.'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const OUT = arg('out') ? path.resolve(arg('out')) : path.join(HERE,'out');
mkdirSync(path.join(OUT, 'ours'), { recursive: true });
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));

const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf, resolveName } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const COM_TOL = 1e-6; // x bbox diagonal. Pick-bearing fixtures and all planar results: true picks measure ~4e-8.
const COM_TOL_TESS = 3e-5; // x bbox diagonal. Curved results that have no negative control (parity fixtures, revolves): one tenth of the 3e-4 curved volume bar, because truck's
// tessellated sweeps (revolve 90 deg: 1.4e-5, 200 deg: 7.6e-6) cannot meet 1e-6. A wrong sweep direction misses by ~1e-1.
const TOL = { planar: 1e-9, curved: 3e-4 }; // curved: truck volume/bbox/COM are tessellation-derived
const BREP_TOL = { tight: 1e-6, approx: 1e-4 }; // the parity gate's own
const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const worstArr = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));
const flat = (b) => [...b[0], ...b[1]];
const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); console.log(s); };

// ---- OCCT --------------------------------------------------------------------------------------------------------
const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0;
function surfaceKey(face) {
  const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
  const t = a.GetType();
  const T = oc.GeomAbs_SurfaceType;
  const canon = (d) => { const s = d.find((v) => Math.abs(v) > 1e-9) < 0 ? -1 : 1; return d.map((v) => r6(v * s)); };
  try {
    if (t === T.GeomAbs_Plane) {
      const ax = a.Plane().Axis(); const d = [ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()];
      const l = ax.Location(); const n = canon(d);
      return `P ${n} ${r6(n[0] * l.X() + n[1] * l.Y() + n[2] * l.Z())}`;
    }
    if (t === T.GeomAbs_Cylinder) {
      const c = a.Cylinder();
      const ax = c.Axis(); const d = canon([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()]);
      const l = ax.Location(); const dot = d[0] * l.X() + d[1] * l.Y() + d[2] * l.Z();
      const perp = [l.X() - dot * d[0], l.Y() - dot * d[1], l.Z() - dot * d[2]].map(r6);
      return `C ${d} ${perp} ${r6(c.Radius())}`;
    }
    // gp_Cone is not bound in this OCCT build (measured): every cone in a shape shares one key, so two distinct
    // cones would count as one surface. No fixture here has two.
    if (t === T.GeomAbs_Cone) return 'K';
    if (t === T.GeomAbs_Sphere) { const s = a.Sphere(); const l = s.Location(); return `S ${[l.X(), l.Y(), l.Z()].map(r6)} ${r6(s.Radius())}`; }
    if (t === T.GeomAbs_Torus) { const s = a.Torus(); const l = s.Location(); return `T ${[l.X(), l.Y(), l.Z()].map(r6)} ${r6(s.MajorRadius())} ${r6(s.MinorRadius())}`; }
  } catch { /* fall through */ }
  return `U ${Math.random()}`; // a surface type we cannot key: never merges
}
const TYPE_OF = { P: 'plane', C: 'cylinder', K: 'cone', S: 'sphere', T: 'torus', U: 'other' };
/**
 * Per surface class on the live OCCT shape: face count; edge-connected components of same-surface faces (truck merges a
 * coplanar / co-cylindrical set only when it is edge-connected); components whose total angular span exceeds 180 degrees
 * (cylinders: truck splits such a merged patch in two); planar triangles (corner faces).
 */
function surfaceClasses(fs) {
  const info = fs.map((f) => {
    const k = surfaceKey(f); const t = TYPE_OF[k[0]];
    let span = 0;
    if (t === 'cylinder') { const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true); span = a.LastUParameter() - a.FirstUParameter(); }
    const edges = []; let n = 0;
    const e = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (e.More()) { edges.push(e.Current()); n++; e.Next(); }
    return { k, t, span, edges, n };
  });
  const parent = info.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
    if (info[i].k !== info[j].k) continue;
    if (info[i].edges.some((a) => info[j].edges.some((b) => a.IsSame(b)))) parent[find(i)] = find(j);
  }
  const comp = new Map();
  info.forEach((x, i) => { const r = find(i); const c = comp.get(r) ?? { t: x.t, span: 0 }; c.span += x.span; comp.set(r, c); });
  const types = {}; const components = {}; let bigCylinderComponents = 0;
  for (const x of info) types[x.t] = (types[x.t] ?? 0) + 1;
  for (const c of comp.values()) {
    components[c.t] = (components[c.t] ?? 0) + 1;
    if (c.t === 'cylinder' && c.span > Math.PI + 1e-6) bigCylinderComponents++;
  }
  return { types, components, bigCylinderComponents, triangles: info.filter((x) => x.t === 'plane' && x.n === 3).length };
}
/** Per-type face verdict. Every mismatch needs a key whose evidence is measured on the live OCCT shape. */
function faceVerdict(truckTypes, o) {
  const keys = {}; let ok = true;
  const tr = (T) => truckTypes?.[T] ?? 0;
  // OCCT keeps a ruled loft face as a spline-class surface where truck has a plane: compare the pair together
  const otherToPlane = Math.max(0, (o.types.other ?? 0) - tr('other'));
  for (const T of new Set([...Object.keys(truckTypes ?? {}), ...Object.keys(o.types)])) {
    const t = tr(T); const n = o.types[T] ?? 0; const comps = o.components[T] ?? 0;
    if (T === 'cylinder' && o.bigCylinderComponents > 0 && t !== comps && t === comps + o.bigCylinderComponents) keys[T] = 'truck-splits-cylinder-patch-over-180deg';
    else if (t === n) keys[T] = 'equal';
    else if (t === comps) keys[T] = 'truck-merges-edge-connected-same-surface-faces';
    else if (T === 'cylinder' && t === comps + o.bigCylinderComponents) keys[T] = 'truck-splits-cylinder-patch-over-180deg';
    else if (otherToPlane > 0 && T === 'other' && t === n - otherToPlane) keys[T] = 'occt-other-surface-is-truck-plane';
    else if (otherToPlane > 0 && T === 'plane' && t === n + otherToPlane) keys[T] = 'occt-other-surface-is-truck-plane';
    else { keys[T] = 'UNEXPLAINED'; ok = false; }
  }
  return { ok, keys };
}
function occtMeasure(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const c = g.CentreOfMass();
  const bx = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(); const hi = bx.CornerMax();
  const fs = facesOf(oc, shape);
  return {
    volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()],
    faces: fs.length, ...surfaceClasses(fs),
  };
}
function occtResolve(name, built) {
  const part = resolveName(oc, name, built);
  if (!part) return null;
  const g = new oc.GProp_GProps();
  const isEdge = name.kind === 'edge';
  if (isEdge) oc.BRepGProp.LinearProperties(part, g, false, false); else oc.BRepGProp.SurfaceProperties(part, g, false, false);
  const c = g.CentreOfMass();
  return { kind: name.kind, size: g.Mass(), centroid: [c.X(), c.Y(), c.Z()] };
}
const STAGEFILE = process.env.STAGEFILE;
export const stage = (x) => { if (STAGEFILE) writeFileSync(STAGEFILE, x); };
const runSC = (cmds) => {
  stage('solidcraft run: ' + JSON.stringify(cmds).slice(0, 600));
  try { const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); if (!r.ok) (globalThis.__scErr ??= []).push(r.failed ? `${r.failed.command}: ${r.failed.error}` : String(r.error)); return r; } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};

// ---- evidence for the two reclassified fixtures --------------------------------------------------------------------
/** Truck's own chamfer of all 12 box edges vs the exact union of 12 separately cut wedge prisms (no corner triangles). */
function wedgeUnion(f) {
  const [sx, sy, sz] = f.size; const L = [sx, sy, sz]; const c = f.center; const d = f.round;
  const cmds = [{ command: 'solid.box', params: { length: sx, width: sy, height: sz, center: c, body_name: 'W' } }];
  const E = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let a = 0; a < 3; a++) {
    const p = (a + 1) % 3; const q = (a + 2) % 3;
    for (const sp of [-1, 1]) for (const sq of [-1, 1]) {
      const hp = L[p] / 2; const hq = L[q] / 2;
      const origin = c.map((v, i) => v - E[a][i] * L[a] / 2);
      cmds.push(
        { command: 'sketch.create', params: { plane: { origin, x_dir: E[p], y_dir: E[q] } } },
        { command: 'sketch.line', params: { points: [[sp * hp, sq * hq], [sp * (hp - d), sq * hq], [sp * hp, sq * (hq - d)]], closed: true } },
        { command: 'sketch.finish', params: {} },
        { command: 'solid.extrude', params: { distance: L[a], operation: 'cut', targets: ['W'] } },
      );
    }
  }
  const r = runSC(cmds);
  return r.ok ? { volume: r.measure.bodies[0].volume_mm3, faces: r.measure.bodies[0].faces } : { error: r.failed?.error };
}
/** World bbox of the profile sketches a blend lofts between (exact; derived from the doc, not measured). */
function blendBbox(doc, blend) {
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of blend.targets) {
    const s = doc.features.find((x) => x.id === t);
    const fr = mt.sketchFrameOf(s);
    for (const p of s.points) for (let i = 0; i < 3; i++) {
      const w = fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1];
      lo[i] = Math.min(lo[i], w); hi[i] = Math.max(hi[i], w);
    }
  }
  return [...lo, ...hi];
}

// ---- one fixture -------------------------------------------------------------------------------------------------
/** wrongPick(prefixFeatures,name,resolved,refBboxCentre) -> resolved' : negative control hook. */
export function runFixture({ id, kind, tol, features, measure, pickOf }, { control = false } = {}) {
  const doc0 = { version: 1, features };
  const row = { id, kind, tol, measureId: measure, control, featureKinds: [...new Set(features.map((f) => f.kind))] };
  let built;
  try {
    stage('occt buildDoc'); built = buildDoc(oc, doc0, arc);
    row.occtRefusals = built.refusals ? Object.fromEntries(built.refusals) : {};
    const shape = built.shapes.get(measure);
    if (!shape) throw new Error(built.refusals?.get?.(measure) ?? 'OCCT built nothing');
    row.occt = occtMeasure(shape);
  } catch (e) { row.invalid = `OCCT: ${e.message}`; return row; }
  try {
    stage('brep measure_doc'); const got = JSON.parse(brep.measure_doc(JSON.stringify(doc0)));
    const s = got.shapes?.[measure];
    row.brepRefusals = got.refusals ?? {};
    row.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces, dVol: rel(s.volume, row.occt.volume), dBbox: worstArr(flat(s.bbox), row.occt.bbox) } : { refused: got.refusals?.[measure] ?? 'no shape' };
    if (s) row.brep.pass = Math.max(row.brep.dVol, row.brep.dBbox) <= BREP_TOL[tol ?? 'tight'];
  } catch (e) { row.brep = { refused: `brep-rs threw: ${e.message}` }; }
  const bc = [0, 1, 2].map((i) => (row.occt.bbox[i] + row.occt.bbox[i + 3]) / 2);
  const resolveAt = (prefix, name) => {
    let r = null;
    try { stage('brep resolve'); r = JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { /* null */ }
    if (r && control) r = { ...r, centroid: r.centroid.map((v, i) => 2 * bc[i] - v) }; // the OPPOSITE edge/face through the part's centre
    return r;
  };
  const doc = solveDoc(doc0);
  const t0 = Date.now();
  globalThis.__scErr = [];
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt });
  row.scErrors = globalThis.__scErr;
  row.ms = Date.now() - t0;
  row.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, pick: f.pick, variantsTried: f.variantsTried }));
  row.commands = tr.commands;
  const mf = tr.features.find((f) => f.id === measure);
  row.usesBrepPick = tr.features.some((f) => f.pickedFrom);
  if (mf?.status !== 'built') {
    row.truck = { refused: mf?.refusal ?? `${measure} was not built`, firstRefusal: tr.features.find((f) => f.status === 'refused')?.refusal };
    row.outcome = 'REFUSED';
    return row;
  }
  const m = mf.measure;
  const diag = Math.max(Math.hypot(row.occt.bbox[3] - row.occt.bbox[0], row.occt.bbox[4] - row.occt.bbox[1], row.occt.bbox[5] - row.occt.bbox[2]), 1);
  const t = m.curved ? TOL.curved : TOL.planar;
  const dVol = rel(m.volume, row.occt.volume);
  const dBbox = worstArr(m.bbox, row.occt.bbox);
  const dCom = Math.max(...m.com.map((v, i) => Math.abs(v - row.occt.com[i]))) / diag;
  const o = row.occt.faces; const tf = m.faces;
  const fv = faceVerdict(m.faceTypes, row.occt);
  const faceKey = fv.ok ? ([...new Set(Object.values(fv.keys))].filter((k) => k !== 'equal').join('+') || 'equal') : null;
  row.truck = { faceTypes: m.faceTypes, occtTypes: row.occt.types, occtComponents: row.occt.components, bigCylinderComponents: row.occt.bigCylinderComponents, faceKeys: fv.keys, volume: m.volume, bbox: m.bbox, com: m.com, faces: tf, kernelFaces: m.kernelFaces, curved: m.curved, bodies: m.bodies.length, dVol, dBbox, dCom, tol: t, faceKey, pick: mf.pick };
  // strict (1e-6): fixtures that carry a negative control, and every all-planar result. Other curved results: tessellation tier.
  const strict = !!pickOf;
  const comTol = m.curved && !strict ? COM_TOL_TESS : COM_TOL;
  row.truck.comTol = comTol;
  const geomOk = Math.max(dVol, dBbox) <= t && dCom <= comTol;
  row.truck.geomOk = geomOk;
  row.outcome = geomOk && faceKey ? 'PASS' : 'FAIL';
  // reclassification needs live evidence, never a name list
  if (row.outcome === 'FAIL' && features.length === 1 && features[0].kind === 'box' && features[0].round && features[0].roundStyle === 'chamfer') {
    const w = wedgeUnion(features[0]);
    const agree = !w.error && rel(m.volume, w.volume) <= 1e-9;
    row.evidence = { wedgeUnionVolume: w.volume, wedgeUnionFaces: w.faces, truckVsWedgeUnion: agree ? rel(m.volume, w.volume) : null, occtTriangles: row.occt.triangles, occtFaces: row.occt.faces, truckFaces: tf };
    const tri = row.occt.triangles; // corner triangles counted on the live OCCT shape
    if (agree && tri > 0 && row.occt.faces - tf === tri) {
      // CONVENTION only if geometry (volume, bbox, COM) passes live OCCT at the applicable bar. Otherwise it stays FAIL and
      // the wedge-union observation is a DIAGNOSIS only: two independent kernels (OCCT, brep-rs) agree and truck does not.
      if (geomOk) row.outcome = 'CONVENTION';
      row.explain = `${geomOk ? '' : `DIAGNOSIS, outcome stays FAIL (volume delta ${dVol.toExponential(2)} vs live OCCT, bar ${t}): `}truck is the exact union of 12 wedge prisms (matches an independent 12-cut build to ${rel(m.volume, w.volume).toExponential(1)}); OCCT and brep-rs add 8 corner triangles (live: ${tri} triangular planar faces = ${row.occt.faces} - ${tf})`;
      if (geomOk) row.truck.faceKey = 'corner-convention';
    }
  }
  const bl = features.find((f) => f.id === measure && f.kind === 'blend');
  if (row.outcome === 'FAIL' && bl && faceKey && dVol <= t && dCom <= row.truck.comTol) {
    const ex = blendBbox(doc, bl);
    const dT = worstArr(m.bbox, ex); const dO = worstArr(row.occt.bbox, ex);
    row.evidence = { analyticBbox: ex, truckVsAnalytic: dT, occtVsAnalytic: dO };
    if (dT <= TOL.planar && dO > TOL.planar) {
      row.outcome = 'REFEREE-ARTIFACT';
      row.explain = `truck bbox equals the bbox of the lofted sketches (${dT.toExponential(1)}); OCCT AddOptimal is ${dO.toExponential(1)} off it`;
    }
  }
  if (!faceKey && row.outcome === 'FAIL' && !row.evidence) row.truck.faceNote = 'unexplained face-count mismatch';
  writeFileSync(path.join(OUT, 'ours', `ours-${id}${control ? '-CONTROL' : ''}.json`), JSON.stringify({
    id, outcome: row.outcome === 'PASS' ? 'built' : row.outcome.toLowerCase(), volume: m.volume, faces: tf, bbox: m.bbox, meshTriangles: null,
    featureKinds: row.featureKinds, scriptSource: JSON.stringify(row.commands), engine: 'solidcraft (truck) wasm referee, phase 0',
  }, null, 1));
  return row;
}


export { translateDoc, oc, brep, arc, mt, solveDoc, buildDoc, runSC, occtMeasure, occtResolve, rel, TOL };
