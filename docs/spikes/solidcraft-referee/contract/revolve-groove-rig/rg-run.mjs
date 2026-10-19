#!/usr/bin/env node
// SPIKE, referee only. revolve-groove group runner (round 2). ModelDoc/script -> solveDoc -> { live OCCT, live brep-rs, solidcraft via a
// translator } per case. Derived from phase0/run-phase0.mjs (runFixture, scorer, face verdict); self-locating, so it runs from the repo
// (no shadow root): REPO is found from this file's location, brep-rs from packages/brep-rs/pkg or archive/brep-rs/pkg.
//
//   SOLIDCRAFT_REFEREE_PKG=<wasm-bindgen --target nodejs pkg dir> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
//     bun docs/spikes/solidcraft-referee/contract/revolve-groove-rig/rg-run.mjs --translator=g0 --only=<id,id> --out=<dir> --res=<file.json>
//
//   --translator  g0 = guarded phase0 translator (default; the product path with the guard), g4 = guarded phase7 pane translator,
//                 raw0 = phase0 translate.mjs as shipped, raw4 = translate-p4.mjs as shipped (the "before" of the guard)
//   --only        comma list of case ids (exact match); no --only = every case. --list prints the ids and exits.
//   --out         directory for the result file (default: ./rg-out under the current directory); --res = file name (default rg-results.json)
// Needs `npm run build` (reads packages/*/dist). Not part of npm test. Results are written after every case.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..', '..');   // docs/spikes/solidcraft-referee/contract/revolve-groove-rig -> repo root
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset. Point it at the wasm-bindgen --target nodejs pkg dir (see ../REPORT.md). Nothing was run.'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const OUT = path.resolve(arg('out') || 'rg-out');
const TRN = arg('translator') || 'g0';
const TRN_FILE = { g0: 'rg-translate-p0.mjs', g4: 'rg-translate-p4.mjs', raw0: '../../phase0/translate.mjs', raw4: '../../phase7/pane/lib/translate-p4.mjs' }[TRN];
if (!TRN_FILE) { console.error(`FATAL: --translator=${TRN} is not one of g0 g4 raw0 raw4`); process.exit(2); }
const { translateDoc: translateDocRaw } = await import(pathToFileURL(path.join(HERE, TRN_FILE)).href);
const translateDoc = async (...a) => translateDocRaw(...a);   // phase0 is synchronous, the phase 7 pane's is async
if (!process.argv.includes('--list')) mkdirSync(path.join(OUT, 'ours'), { recursive: true });
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
const brepDir = [path.join(REPO, 'packages', 'brep-rs', 'pkg'), path.join(REPO, 'archive', 'brep-rs', 'pkg')].find((d) => existsSync(path.join(d, 'brep_rs.js')));
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
function faceVerdict(truckTypes, o, dArea) {
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
    else if (t > comps && t < n && Number.isFinite(dArea) && dArea <= 3e-4) keys[T] = 'truck-merges-some-edge-connected-same-surface-faces';   // round 3: fewer faces than OCCT but more than its edge-connected same-surface components (a partial merge); total surface area equals OCCT's
    else if (T === 'cylinder' && t > n && Number.isFinite(dArea) && dArea <= 3e-4) keys[T] = 'truck-splits-cylinder-wall-same-surface-area';   // round 3: more cylinder faces than OCCT, every other type equal (checked below), total surface area equal to OCCT's
    else { keys[T] = 'UNEXPLAINED'; ok = false; }
  }
  // the area-backed keys are only valid when every OTHER surface type matched exactly or by a plain merge (an area-backed explanation must not hide a missing or extra face of another type)
  const areaKeys = ['truck-splits-cylinder-wall-same-surface-area', 'truck-merges-some-edge-connected-same-surface-faces'];
  const nOther = Object.entries(keys).filter(([T, k]) => areaKeys.includes(k)).length;
  if (nOther > 1 || (keys.cylinder === 'truck-splits-cylinder-wall-same-surface-area' && Object.entries(keys).some(([T, k]) => T !== 'cylinder' && k !== 'equal'))) { for (const T of Object.keys(keys)) if (areaKeys.includes(keys[T])) keys[T] = 'UNEXPLAINED'; ok = false; }
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
    faces: fs.length, area: (() => { const a = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(shape, a, false, false); return a.Mass(); })(), ...surfaceClasses(fs),
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
const runSC = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
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
async function runFixture({ id, kind, tol, features, measure, pickOf, ampl }, { control = false } = {}) {
  const doc0 = { version: 1, features };
  const row = { id, kind, tol, measureId: measure, control, featureKinds: [...new Set(features.map((f) => f.kind))] };
  let built;
  try {
    built = buildDoc(oc, doc0, arc);
    const shape = built.shapes.get(measure);
    if (!shape) throw new Error(built.refusals?.get?.(measure) ?? 'OCCT built nothing');
    row.occt = occtMeasure(shape);
  } catch (e) { row.invalid = `OCCT: ${e.message}`; return row; }
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc0)));
    const s = got.shapes?.[measure];
    row.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces, dVol: rel(s.volume, row.occt.volume), dBbox: worstArr(flat(s.bbox), row.occt.bbox) } : { refused: got.refusals?.[measure] ?? 'no shape' };
    if (s) row.brep.pass = Math.max(row.brep.dVol, row.brep.dBbox) <= BREP_TOL[tol ?? 'tight'];
  } catch (e) { row.brep = { refused: `brep-rs threw: ${e.message}` }; }
  const bc = [0, 1, 2].map((i) => (row.occt.bbox[i] + row.occt.bbox[i + 3]) / 2);
  const resolveAt = (prefix, name) => {
    let r = null;
    try { r = JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { /* null */ }
    if (r && control) r = { ...r, centroid: r.centroid.map((v, i) => 2 * bc[i] - v) }; // the OPPOSITE edge/face through the part's centre
    return r;
  };
  const doc = solveDoc(doc0);
  const t0 = Date.now(); const c0 = process.cpuUsage(); const l0 = os.loadavg()[0];
  const tr = await translateDoc(doc, { arc, mt, runSC, resolveAt });
  row.ms = Date.now() - t0; row.load = [+l0.toFixed(1), +os.loadavg()[0].toFixed(1)];   // 1-minute load average before / after the translated run
  { const c1 = process.cpuUsage(c0); row.cpuMs = Math.round((c1.user + c1.system) / 1000); }   // CPU time of the translated run: the wall clock is inflated when the box is loaded
  row.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, pick: f.pick, guard: f.guard }));
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
  // round 3: the tessellation error of a curved volume grows with the volume of the outer envelope relative to the part (a thin ring): bar = max(3e-4, 1.5e-4 x amplification), amplification given by the case (cases-r3-spinfuzz.mjs)
  const t = m.curved ? Math.max(TOL.curved, ampl ? 1.5e-4 * ampl : 0) : TOL.planar;
  const dVol = rel(m.volume, row.occt.volume);
  const dBbox = worstArr(m.bbox, row.occt.bbox);
  const dCom = Math.max(...m.com.map((v, i) => Math.abs(v - row.occt.com[i]))) / diag;
  const o = row.occt.faces; const tf = m.faces;
  const dArea = typeof m.area === 'number' && m.area > 0 ? rel(m.area, row.occt.area) : NaN;
  const fv = faceVerdict(m.faceTypes, row.occt, dArea);
  if (!fv.ok && Number.isFinite(dArea) && dArea <= 3e-4) {
    // round 3, whole-shape fallback (live evidence: OCCT's face list and total surface area): truck types or splits a curved wall differently while every plane and the surface area agree
    const tp = m.faceTypes?.plane ?? 0; const op = row.occt.types.plane ?? 0; const tc = tf - tp; const oc2 = row.occt.faces - op;
    let k = null;
    if (tf === row.occt.faces) k = 'truck-types-a-face-differently-same-count-same-area';
    else if (tp === op && tc > oc2) k = 'truck-splits-curved-wall-same-surface-area';
    else if (tp === op && tc < oc2) k = 'truck-merges-some-curved-faces-same-surface-area';
    if (k) { fv.ok = true; fv.whole = k; }
  }
  const faceKey = fv.ok ? (fv.whole ?? ([...new Set(Object.values(fv.keys))].filter((k) => k !== 'equal').join('+') || 'equal')) : null;
  row.truck = { dArea, area: m.area, faceTypes: m.faceTypes, occtTypes: row.occt.types, occtComponents: row.occt.components, bigCylinderComponents: row.occt.bigCylinderComponents, faceKeys: fv.keys, volume: m.volume, bbox: m.bbox, com: m.com, faces: tf, kernelFaces: m.kernelFaces, curved: m.curved, bodies: m.bodies.length, dVol, dBbox, dCom, tol: t, faceKey, pick: mf.pick };
  // strict (1e-6): fixtures that carry a negative control, and every all-planar result. Other curved results: tessellation tier.
  const strict = !!pickOf;
  const comTol = m.curved && !strict ? Math.max(COM_TOL_TESS, ampl ? 1.5e-5 * ampl : 0) : COM_TOL;   // round 3: the COM bar scales with the thin-ring amplification like the volume bar (one tenth of it)
  row.truck.comTol = comTol;
  const tBb = m.curved ? Math.max(t, 1e-3) : t;   // round 3: a curved result's bounding box is mesh-derived too (cone-cut corners reach 3.7e-4 of the box); bar 1e-3 for curved results, 1e-9 for planar
  const geomOk = dVol <= t && dBbox <= tBb && dCom <= comTol;
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



// ================= revolve-groove group driver =================
const { runScript } = await load('packages/script/dist/reshape-script.js');
const RG = path.join(REPO, 'docs', 'replica', 'freecad', 'gauntlet');   // 218 saved FreeCAD results, read-only
const { VARIANTS } = await import(pathToFileURL(path.join(RG, 'variants/defs.mjs')).href);
const readRef = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const { allCases } = await import('./rg-cases.mjs');
const RGG = await import('../revolve-groove.guard.mjs');
// --cases=<module> (relative to this directory or absolute): a module exporting `cases` (array of {id, src, expectVol?, ref?}) or `cases3(RG)`; replaces the built-in list
const casesArg = arg('cases');
let cases;
if (casesArg) { const mod = await import(pathToFileURL(path.resolve(HERE, casesArg)).href); cases = mod.cases ?? mod.allCases(RG, VARIANTS); } else cases = allCases(RG, VARIANTS);
if (process.argv.includes('--list')) { for (const c of cases) console.log(c.id); process.exit(0); }
const onlyIds = (arg('only') || '').split(',').filter(Boolean);
const resFile = path.join(OUT, arg('res') || 'rg-results.json');
const results = [];
const E = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
for (const c of cases) {
  if (onlyIds.length && !onlyIds.some((o) => (o.endsWith('*') ? c.id.startsWith(o.slice(0, -1)) : o === c.id))) continue;   // exact id, or prefix*
  const r = { id: c.id, src: c.src, translator: TRN, amp: c.tag?.amp ?? null };
  const t00 = Date.now();
  let run;
  try { run = runScript(c.src); } catch (e) { r.scriptThrew = String(e.message); results.push(r); console.log(c.id.padEnd(40), 'SCRIPT-THREW', r.scriptThrew); continue; }
  if (run.errors?.length) { r.scriptRefusal = run.errors.map((e) => e.message ?? String(e)).join(' | '); r.scriptSentence = run.errors.map((e) => RGG.scriptSentence(e.message ?? String(e)) ?? (e.message ?? String(e))).join(' | '); results.push(r); console.log(c.id.padEnd(40), 'SCRIPT-REFUSAL:', r.scriptRefusal); continue; }
  if (c.patch) { run.doc = JSON.parse(JSON.stringify(run.doc)); const pf = run.doc.features.find((x) => x.kind === c.patch.kind); Object.assign(pf, c.patch.set); }
  const features = run.doc.features;
  const measureId = features.at(-1).id;
  r.kinds = features.map((f) => f.kind); r.measureId = measureId;
  const _doc0 = { version: 1, features };
  r.fixture = await runFixture({ id: c.id, kind: features.at(-1).kind, tol: 'approx', features, measure: measureId, ampl: c.tag?.amp });
  if (r.fixture.invalid) {
    // OCCT referee cannot build it: still run brep-rs and the translation, scored against the analytic expectation only
    const o = {};
    try { const got = JSON.parse(brep.measure_doc(JSON.stringify(_doc0))); const sh = got.shapes?.[measureId]; o.brep = sh ? { volume: sh.volume, bbox: flat(sh.bbox), faces: sh.faces } : { refused: got.refusals?.[measureId] ?? 'no shape' }; } catch (e) { o.brep = { refused: 'threw ' + e.message }; }
    const t0 = Date.now(); const c0 = process.cpuUsage(); const l0 = os.loadavg()[0];
    const tr = await translateDoc(solveDoc(_doc0), { arc, mt, runSC, resolveAt: () => null });
    const mf = tr.features.find((x) => x.id === measureId);
    o.ms = Date.now() - t0; o.load = [+l0.toFixed(1), +os.loadavg()[0].toFixed(1)]; { const c1 = process.cpuUsage(c0); o.cpuMs = Math.round((c1.user + c1.system) / 1000); }
    o.truck = mf?.status === 'built' ? { volume: mf.measure.volume, bbox: mf.measure.bbox, faces: mf.measure.faces, faceTypes: mf.measure.faceTypes, com: mf.measure.com, bodies: mf.measure.bodies.length } : { refused: mf?.refusal ?? tr.features.find((x) => x.status === 'refused')?.refusal };
    r.noOcct = o;
    if (c.expectVol !== undefined) r.analytic = { volume: c.expectVol, dTruck: o.truck.volume !== undefined ? rel(o.truck.volume, c.expectVol) : null, dBrep: o.brep.volume !== undefined ? rel(o.brep.volume, c.expectVol) : null };
  } else if (c.expectVol !== undefined && r.fixture.truck?.volume !== undefined) r.analytic = { volume: c.expectVol, dTruck: rel(r.fixture.truck.volume, c.expectVol), dOcct: rel(r.fixture.occt?.volume, c.expectVol), dBrep: r.fixture.brep?.volume != null ? rel(r.fixture.brep.volume, c.expectVol) : null };
  else if (c.expectVol !== undefined && r.fixture.occt) r.analytic = { volume: c.expectVol, dOcct: rel(r.fixture.occt.volume, c.expectVol), dBrep: r.fixture.brep?.volume != null ? rel(r.fixture.brep.volume, c.expectVol) : null, truckRefused: true };
  const ref = c.ref ? readRef(c.ref) : null;
  if (ref && c.fcCom) ref.com = c.fcCom;
  if (r.fixture.invalid) { r.fcNote = 'fixture invalid: ' + r.fixture.invalid; } else if (ref && ref.ok !== false) {
    const fx = r.fixture; r.fc = { volume: ref.volume, bbox: ref.bbox, faces: ref.faces, com: ref.com };
    const bd = (b) => Math.max(...ref.bbox.map((x, i) => Math.abs(x - b[i])));
    const cd = (c2) => (ref.com && c2 ? Math.max(...ref.com.map((x, i) => Math.abs(x - c2[i]))) : null);
    r.vsFc = {
      occt: { dVol: rel(fx.occt.volume, ref.volume), dBbox: bd(fx.occt.bbox), faces: fx.occt.faces, dCom: cd(fx.occt.com) },
      brep: fx.brep?.volume != null ? { dVol: rel(fx.brep.volume, ref.volume), dBbox: bd(fx.brep.bbox), faces: fx.brep.faces } : { refused: fx.brep?.refused },
      truck: fx.truck?.volume != null ? { dVol: rel(fx.truck.volume, ref.volume), dBbox: bd(fx.truck.bbox), faces: fx.truck.faces, dCom: cd(fx.truck.com) } : { refused: fx.truck?.refused },
    };
  } else if (c.ref) r.fcNote = ref ? `FreeCAD ref not ok: ${ref.error ?? JSON.stringify(ref.bad)}` : 'ref missing';
  r.caseMs = Date.now() - t00;
  results.push(r);
  writeFileSync(resFile, JSON.stringify(results, null, 1));
  const f = r.fixture; const t = f.truck;
  if (f.invalid) { const n = r.noOcct; console.log(c.id.padEnd(40), 'NO-OCCT', f.invalid, '| truck', n.truck.volume !== undefined ? `V ${n.truck.volume.toFixed(4)} F ${n.truck.faces} bbox ${n.truck.bbox.map((x) => +x.toFixed(4))} types ${JSON.stringify(n.truck.faceTypes)} bodies ${n.truck.bodies}` : 'REFUSED ' + n.truck.refused, '| brep', n.brep.volume !== undefined ? `V ${n.brep.volume.toFixed(4)} F ${n.brep.faces} bbox ${n.brep.bbox.map((x) => +x.toFixed(4))}` : 'REFUSED ' + n.brep.refused, r.analytic ? `| ANALYTIC ${r.analytic.volume.toFixed(4)} dTruck ${E(r.analytic.dTruck)} dBrep ${E(r.analytic.dBrep)}` : '', `| ms ${n.ms} cpu ${n.cpuMs}`); continue; }
  const fc = r.vsFc;
  console.log(c.id.padEnd(40), f.outcome.padEnd(8),
    'occtV', f.occt.volume.toFixed(4), '| tr-occt dV', E(t?.dVol), 'dBb', E(t?.dBbox), 'dCom', E(t?.dCom), `F o/b/t ${f.occt.faces}/${f.brep?.faces ?? '-'}/${t?.faces ?? '-'}`,
    '| brep-occt dV', E(f.brep?.dVol),
    fc ? `| FC: occt ${E(fc.occt.dVol)} brep ${E(fc.brep.dVol)} truck ${E(fc.truck.dVol)} dCom ${E(fc.truck.dCom)} F ${r.fc.faces}` : (r.fcNote ? '| ' + r.fcNote : ''),
    r.analytic ? `| ANALYTIC ${r.analytic.volume.toFixed(4)} dTruck ${E(r.analytic.dTruck)} dOcct ${E(r.analytic.dOcct)} dBrep ${E(r.analytic.dBrep)}` : '',
    t?.bodies > 1 ? `| ${t.bodies} BODIES` : '',
    t?.refused ? '| TRUCK REFUSED: ' + t.refused : '', f.brep?.refused ? '| BREP REFUSED: ' + f.brep.refused : '', `| ms ${f.ms} cpu ${f.cpuMs}`);
}
writeFileSync(resFile, JSON.stringify(results, null, 1));
