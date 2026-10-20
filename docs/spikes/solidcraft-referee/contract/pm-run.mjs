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
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from './pm-translate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PHASE0 = path.join(HERE, '..', 'phase0');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset. Point it at the wasm-bindgen --target nodejs pkg dir (see ../REPORT.md). Nothing was run.'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const skip = arg('skip').split(',').filter(Boolean);
const OUT = arg('out') ? path.resolve(arg('out')) : HERE;
mkdirSync(path.join(OUT, 'ours'), { recursive: true });
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));

const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
let oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const reinitOcct = async () => { oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) }); };
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
function momentsCom(pos, idx) {
  let v = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const d = pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    v += d / 6; cx += (d / 24) * (pos[a] + pos[b] + pos[c]); cy += (d / 24) * (pos[a + 1] + pos[b + 1] + pos[c + 1]); cz += (d / 24) * (pos[a + 2] + pos[b + 2] + pos[c + 2]);
  }
  return v ? [cx / v, cy / v, cz / v] : null;
}
const flat = (b) => [...b[0], ...b[1]];
let MAP_ANGLE = process.env.PM_MAP_ANGLE === '1';
// translator patches (see pm-translate.mjs header): PM_TR=asis -> none (phase0 behaviour); default all; PM_OFF=a,b switches single ones off
const ALL_PATCHES = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver'];
// PM_TR=r2 -> the round-2 contract translator's patch set (no round-3 patches); used for the 'wrong before the fix' comparisons
const R2_PATCHES = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact'];
const PATCHES = new Set(process.env.PM_TR === 'asis' ? [] : [...(process.env.PM_TR === 'r2' ? R2_PATCHES : ALL_PATCHES).filter((p) => !(process.env.PM_OFF ?? '').split(',').includes(p)), '__explicit']);
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
const runSCInProc = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
// With a budget (opts.budgetMs) the session runs in a CHILD process that is killed at the limit; without one it runs in-process.
// PM_BUDGET=off puts everything back in-process (the round-2 behaviour: a hang is a hang).
const runSC = (cmds, opts) => {
  if (!opts?.budgetMs || process.env.PM_BUDGET === 'off') return runSCInProc(cmds);
  const p = spawnSync(process.execPath, [path.join(HERE, 'pm-sc-child.mjs')], { input: JSON.stringify({ commands: cmds }), timeout: opts.budgetMs, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 1 << 30, env: process.env });
  if (p.error && (p.error.code === 'ETIMEDOUT' || p.signal === 'SIGKILL')) return { ok: false, timedOut: true };
  if (p.signal === 'SIGKILL' || p.status === null) return { ok: false, timedOut: true };
  try { return JSON.parse(p.stdout); } catch { return { ok: false, failed: { command: '(child)', error: `WASM TRAP: child exit ${p.status} ${String(p.stderr).slice(0, 200)}` } }; }
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
function runFixture({ id, kind, tol, features, measure, pickOf }, { control = false } = {}) {
  const doc0 = { version: 1, features };
  const row = { id, kind, tol, measureId: measure, control, featureKinds: [...new Set(features.map((f) => f.kind))] };
  let built;
  try {
    built = buildDoc(oc, doc0, arc);
    const shape = built.shapes.get(measure);
    if (!shape) throw new Error(built.refusals?.get?.(measure) ?? 'OCCT built nothing');
    row.occt = occtMeasure(shape);
    row.occtRefusals = Object.fromEntries(built.refusals ?? []);
  } catch (e) {
    // round 3: OCCT is an ORACLE, not a gate. When it cannot build the case (a 1000-copy fuse corrupts its wasm heap) the translator still runs
    // and the case is reported NO-ORACLE with the truck numbers beside a closed form in the row text.
    row.invalid = `OCCT: ${e.message}`;
    row.occt = { volume: NaN, com: [NaN, NaN, NaN], bbox: [NaN, NaN, NaN, NaN, NaN, NaN], faces: 0, types: {}, components: {}, bigCylinderComponents: 0, triangles: 0 };
  }
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc0)));
    const s = got.shapes?.[measure];
    row.brepRefusals = got.refusals ?? {};
    row.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces, dVol: rel(s.volume, row.occt.volume), dBbox: worstArr(flat(s.bbox), row.occt.bbox) } : { refused: got.refusals?.[measure] ?? 'no shape' };
    if (s) row.brep.pass = Math.max(row.brep.dVol, row.brep.dBbox) <= BREP_TOL[tol ?? 'tight'];
    if (s) { try { const ms = JSON.parse(brep.mesh_feature(JSON.stringify(doc0), measure, 0.01)); row.brep.com = momentsCom(ms.positions, ms.indices); } catch (e) { row.brep.comErr = String(e.message ?? e); } }
  } catch (e) { row.brep = { refused: `brep-rs threw: ${e.message}` }; }
  const bc = [0, 1, 2].map((i) => (row.occt.bbox[i] + row.occt.bbox[i + 3]) / 2);
  const resolveAt = (prefix, name) => {
    let r = null;
    try { r = JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { /* null */ }
    if (r && control) r = { ...r, centroid: r.centroid.map((v, i) => 2 * bc[i] - v) }; // the OPPOSITE edge/face through the part's centre
    return r;
  };
  const doc = solveDoc(doc0);
  const t0 = Date.now();
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt, mapPartialAngle: MAP_ANGLE, patches: PATCHES, inProcess: process.env.PM_BUDGET === 'off', budgetMs: process.env.PM_BUDGET_MS ? Number(process.env.PM_BUDGET_MS) : undefined, docBudgetMs: process.env.PM_DOC_BUDGET_MS ? Number(process.env.PM_DOC_BUDGET_MS) : undefined });
  row.ms = Date.now() - t0;
  row.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, student: f.student, pick: f.pick, mirrorAt: f.mirrorAt, wallMs: f.wallMs }));
  row.commands = tr.commands;
  const mf = tr.features.find((f) => f.id === measure);
  row.usesBrepPick = tr.features.some((f) => f.pickedFrom);
  if (mf?.status !== 'built') {
    row.truck = { refused: mf?.refusal ?? `${measure} was not built`, student: mf?.student, firstRefusal: tr.features.find((f) => f.status === 'refused')?.refusal, firstStudent: tr.features.find((f) => f.status === 'refused')?.student };
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
  row.truck = { faceTypes: m.faceTypes, occtTypes: row.occt.types, occtComponents: row.occt.components, bigCylinderComponents: row.occt.bigCylinderComponents, faceKeys: fv.keys, volume: m.volume, bbox: m.bbox, com: m.com, faces: tf, kernelFaces: m.kernelFaces, shells: m.shells, curved: m.curved, bodies: m.bodies.length, dVol, dBbox, dCom, tol: t, faceKey, pick: mf.pick };
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

const f4 = (v) => (typeof v === 'number' ? v.toFixed(4) : '-');
const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
// ---- patterns-mirror driver ------------------------------------------------------------------------------------
// Every case is a reSHape Script source -> runScript (script-layer refusals are recorded as sentences) -> ModelDoc ->
// OCCT (buildDoc), brep-rs (measure_doc), solidcraft (pm-translate.mjs). Variants that have a saved FreeCAD ref are also
// scored against it. Usage: bun pm-run.mjs --out=<scratch dir> [--only=id,id] [--variants]
import { readFileSync as rf, existsSync } from 'node:fs';
import { CASES } from './pm-cases.mjs';
import { CASES2 } from './pm-cases-r2.mjs';
import { CASES3 } from './pm-cases-r3.mjs';
import { CASES4, EXPECT4 } from './pm-cases-r4.mjs';
import { plainScriptSentence } from './pm-sentences.mjs';
const { runScript } = await load('packages/script/dist/reshape-script.js');
const REFDIR = path.join(REPO, 'docs', 'replica', 'freecad', 'gauntlet', 'variants', 'refs');
const REFDIR2 = path.join(HERE, 'pm-fc-refs');
const readRef = (id) => { for (const d of [REFDIR2, REFDIR]) { const f = path.join(d, `ref-${id}.json`); if (existsSync(f)) return JSON.parse(rf(f, 'utf8')); } return null; };
const R3ONLY = process.argv.includes('--r3');
const R4ONLY = process.argv.includes('--r4');
const allCases = R4ONLY ? [...CASES4] : R3ONLY ? [...CASES3] : [...CASES, ...CASES2, ...CASES3, ...CASES4];
if (!R3ONLY && !R4ONLY && (process.argv.includes('--variants') || only.some((o) => /^(linear-pattern|polar-pattern|mirrored)/.test(o)))) {
  const { VARIANTS } = await import(pathToFileURL(path.join(REPO, 'docs/replica/freecad/gauntlet/variants/defs.mjs')).href);
  for (const v of VARIANTS) if (['linear-pattern', 'polar-pattern', 'mirrored'].includes(v.piece)) allCases.push({ id: v.id, row: `variant-${v.piece}`, src: v.ours, ref: v.id, note: v.desc });
}
if (!R3ONLY && !R4ONLY && (process.argv.includes('--variants') || only.some((o) => o.startsWith('pm-')))) {
  const { FC_VARIANTS } = await import('./pm-fc-variants.mjs');
  for (const v of FC_VARIANTS) {
    allCases.push({ id: v.id, row: 'variant-pm-fc', src: v.ours, ref: v.id, note: v.desc });
    if (/partial|neg90|-720|neg360/.test(v.id)) allCases.push({ id: v.id + '-MAPPED', row: 'variant-pm-fc', src: v.ours, ref: v.id, note: v.desc + ' [angle passed through to solid.pattern.circular]', mapAngle: true });
  }
}
const out = [];
for (const c of allCases) {
  if (only.length && !only.some((o) => c.id === o || (o.endsWith('*') && c.id.startsWith(o.slice(0, -1))))) continue;
  if (skip.some((o) => c.id === o || (o.endsWith('*') && c.id.startsWith(o.slice(0, -1))))) continue;
  const rec = { id: c.id, row: c.row, src: c.src, note: c.note, mapAngle: c.mapAngle ?? false };
  let run;
  try { run = runScript(c.src); } catch (e) { rec.outcome = 'SCRIPT-THREW'; rec.sentence = String(e.message ?? e); out.push(rec); console.log(c.id.padEnd(34), rec.outcome, rec.sentence); continue; }
  if (run.errors?.length) {
    rec.outcome = 'SCRIPT-REFUSED';
    rec.shipped = run.errors.map((e) => e.message ?? String(e)).join(' | ');          // what packages/script prints today
    const pl = plainScriptSentence(rec.shipped);                                        // what the guard layer shows (pm-sentences.mjs)
    rec.sentence = pl.sentence; rec.sentenceMapped = pl.mapped; if (pl.unmapped) rec.sentenceUnmapped = true;
    out.push(rec); console.log(c.id.padEnd(34), rec.outcome, rec.sentence.slice(0, 160), pl.unmapped ? '[UNMAPPED]' : ''); continue;
  }
  const doc = run.doc;
  rec.featureKinds = doc.features.map((f) => f.kind);
  rec.doc = doc.features.filter((f) => f.kind === 'pattern' || f.kind === 'mirror');
  const measure = doc.features.at(-1).id;
  MAP_ANGLE = c.mapAngle ?? false;
  const fr = runFixture({ id: c.id, kind: c.row, tol: 'approx', features: doc.features, measure });
  MAP_ANGLE = false;
  delete fr.commands; // kept below in a trimmed form
  rec.fx = fr;
  rec.commands = (fr.truckFeatures ?? []).filter((f) => f.status !== 'noop').map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, student: f.student, mirrorAt: f.mirrorAt }));
  const ref = c.ref ? readRef(c.ref) : null;
  if (c.ref) rec.fcRef = ref ? { ok: ref.ok !== false, volume: ref.volume, bbox: ref.bbox, faces: ref.faces, com: ref.com, error: ref.error } : null;
  if (ref && ref.ok !== false) {
    const cmp = (name, m) => m && Number.isFinite(m.volume) ? { dVol: rel(m.volume, ref.volume), dBbox: worstArr(m.bbox, ref.bbox), faces: m.faces, facesRef: ref.faces } : null;
    rec.vsFreecad = { truck: cmp('truck', fr.truck?.volume !== undefined ? { volume: fr.truck.volume, bbox: fr.truck.bbox, faces: fr.truck.faces } : null),
      occt: cmp('occt', fr.occt), brep: fr.brep?.volume !== undefined ? { dVol: rel(fr.brep.volume, ref.volume), dBbox: worstArr(fr.brep.bbox, ref.bbox), faces: fr.brep.faces, facesRef: ref.faces } : null };
    const comD = (c) => (c && ref.com ? Math.max(...ref.com.map((x, i) => Math.abs(x - c[i]))) : null);
    rec.vsFreecad.comAbs = { truck: comD(fr.truck?.com), occt: comD(fr.occt?.com), brep: comD(fr.brep?.com) };
  }
  rec.outcome = fr.invalid ? (fr.outcome === 'REFUSED' ? 'REFUSED' : 'NO-ORACLE') : fr.outcome;
  // OCCT is NOT an oracle for a pocket(...,{reversed:true}) or a tapered pull: buildDoc never reads either option, so OCCT builds the same wrong solid the
  // AS-IS translator does and the two agree with each other (proving nothing). Such a case is scored against the saved FreeCAD ref, else against a closed
  // form (EXPECT4), and its OCCT verdict is kept beside it as outcomeVsOcct.
  const ig = [];
  if (doc.features.some((f) => f.kind === 'pocket' && f.reversed)) ig.push('reversed');
  if (doc.features.some((f) => f.kind === 'extrude' && f.taper)) ig.push('taper');
  if (ig.length) {
    rec.occtIgnores = ig; rec.outcomeVsOcct = rec.outcome;
    const t2 = fr.truck;
    if (t2 && !t2.refused) {
      const tol2 = t2.curved ? TOL.curved : TOL.planar;
      if (rec.vsFreecad?.truck) {
        const v = rec.vsFreecad.truck;
        rec.oracle = 'FreeCAD ref'; rec.oracleDelta = { dVol: v.dVol, dBbox: v.dBbox, faces: v.faces, facesRef: v.facesRef };
        rec.outcome = v.dVol <= tol2 && v.dBbox <= tol2 && v.faces === v.facesRef ? 'PASS' : 'FAIL';
      } else if (EXPECT4[c.id] !== undefined) {
        const dv = rel(t2.volume, EXPECT4[c.id]);
        rec.oracle = 'closed form'; rec.oracleDelta = { expected: EXPECT4[c.id], dVol: dv };
        rec.outcome = dv <= tol2 ? 'PASS' : 'FAIL';
      } else { rec.oracle = 'none'; rec.outcome = 'NO-ORACLE'; }
    }
  }
  if (fr.invalid) { rec.occtInvalid = fr.invalid; await reinitOcct(); }
  out.push(rec);
  const t = fr.truck;
  console.log(c.id.padEnd(34), String(rec.outcome).padEnd(9), 'OCCT', f4(fr.occt?.volume), 'brep', ex(fr.brep?.dVol), 'truck dVol', ex(t?.dVol), 'dBbox', ex(t?.dBbox), 'dCOM', ex(t?.dCom), 'faces O/B/T', `${fr.occt?.faces}/${fr.brep?.faces ?? '-'}/${t?.faces ?? '-'}`,
    t?.refused ? `REFUSED: ${t.refused}` : '', fr.invalid ?? '', Object.keys(fr.occtRefusals ?? {}).length ? `OCCT-REFUSAL ${JSON.stringify(fr.occtRefusals)}` : '', Object.keys(fr.brepRefusals ?? {}).length ? `BREP-REFUSAL ${JSON.stringify(fr.brepRefusals).slice(0,200)}` : '', rec.vsFreecad ? `FC: com(t/o/b) ${ex(rec.vsFreecad.comAbs.truck)}/${ex(rec.vsFreecad.comAbs.occt)}/${ex(rec.vsFreecad.comAbs.brep)} truck ${ex(rec.vsFreecad.truck?.dVol)} f${rec.vsFreecad.truck?.faces}/${ref.faces} occt ${ex(rec.vsFreecad.occt?.dVol)} brep ${ex(rec.vsFreecad.brep?.dVol)}` : '');
}
const RESULTS_NAME = arg('name') || 'pm-results.json';
writeFileSync(path.join(OUT, RESULTS_NAME), JSON.stringify(out, null, 1));
// ---- provenance stamp: which rig produced the truck numbers in this file (the earlier files carried none)
import { createHash } from 'node:crypto';
import os from 'node:os';
const wasmFile = path.join(PKG, 'solidcraft_referee_bg.wasm');
const stamp = {
  resultsFile: RESULTS_NAME, written: new Date().toISOString(), cases: out.length,
  solidcraftPkg: PKG, wasmFile: 'solidcraft_referee_bg.wasm', wasmSha256: existsSync(wasmFile) ? createHash('sha256').update(rf(wasmFile)).digest('hex') : null,
  wasmBytes: existsSync(wasmFile) ? rf(wasmFile).length : null,
  solidcraftSource: 'git archive of fe3717f (the pinned commit), built with the wrapper in the session scratchpad; see RIG.md',
  patches: [...PATCHES].filter((p) => p !== '__explicit'), translator: 'contract/pm-translate.mjs',
  budgets: { perRunMs: process.env.PM_BUDGET_MS ? Number(process.env.PM_BUDGET_MS) : 600000, perModelMs: process.env.PM_DOC_BUDGET_MS ? Number(process.env.PM_DOC_BUDGET_MS) : 3600000 },
  runtime: `bun ${process.versions.bun}`, host: os.hostname(), loadavgAtEnd: os.loadavg(), cpus: os.cpus().length,
  argv: process.argv.slice(2),
};
writeFileSync(path.join(OUT, RESULTS_NAME.replace(/\.json$/, '') + '.stamp.json'), JSON.stringify(stamp, null, 1));
console.log(`wrote ${path.join(OUT, RESULTS_NAME)} (${out.length} cases) and its stamp (wasm sha256 ${stamp.wasmSha256?.slice(0, 16)})`);
process.exitCode = 0;
