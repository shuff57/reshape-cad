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
import { translateDoc } from './translate.mjs';
import { asymFixtures } from './asym-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset. Point it at the wasm-bindgen --target nodejs pkg dir (see ../REPORT.md). Nothing was run.'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const OUT = arg('out') ? path.resolve(arg('out')) : HERE;
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
const { fixtures } = await load('scripts/brep-parity-fixtures.mjs');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
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
function runFixture({ id, kind, tol, features, measure, pickOf }, { control = false } = {}) {
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
  const t0 = Date.now();
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt });
  row.ms = Date.now() - t0;
  row.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, pick: f.pick }));
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

// ---- run ---------------------------------------------------------------------------------------------------------
const rows = [];
for (const fx of fixtures()) {
  if (only.length && !only.includes(fx.id)) continue;
  const d = fx.doc(mt);
  rows.push(runFixture({ id: fx.id, kind: fx.kind, tol: fx.tol, features: d.features, measure: fx.measure ?? d.measure }));
}
const asym = [];
for (const fx of asymFixtures()) {
  if (only.length && !only.includes(fx.id)) continue;
  const pos = runFixture(fx);
  if (!fx.pickOf) { asym.push({ id: fx.id, positive: pos, noPick: true }); continue; }
  const ctl = runFixture(fx, { control: true });
  // (a) both resolvers must give the same pick point for the same name
  const f = fx.features.find((x) => x.id === fx.pickOf);
  const name = f.edge ?? f.open ?? f.face;
  const prefix = fx.features.slice(0, fx.features.indexOf(f));
  const built = buildDoc(oc, { version: 1, features: prefix }, arc);
  const o = occtResolve(name, built);
  let b = null;
  try { b = JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { /* */ }
  const coincide = !!(o && b && o.kind === b.kind && Math.max(...o.centroid.map((v, i) => Math.abs(v - b.centroid[i]))) <= 1e-6);
  const ptOf = (r) => { const p = r.truck?.pick; return p ? (p.edges ?? p.faces)[0] : null; };
  const ctlDCom = ctl.truck?.dCom;
  // a control is REJECTED only when it fails the score AND its COM miss is >= 10x the tolerance (or truck refused it)
  const controlRejected = ctl.outcome !== 'PASS' && (ctl.truck?.refused !== undefined || (typeof ctlDCom === 'number' && ctlDCom >= 10 * COM_TOL));
  asym.push({ id: fx.id, positive: pos, control: ctl, resolve: { occt: o, brep: b, coincide }, usedPick: ptOf(pos), controlPick: ptOf(ctl), controlRejected });
}
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ rows, asym }, null, 1));

// ---- report ------------------------------------------------------------------------------------------------------
const f4 = (v) => (typeof v === 'number' ? v.toFixed(4) : '-');
const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
const AB = { plane: 'pl', cylinder: 'cy', sphere: 'sp', cone: 'co', torus: 'to', other: 'ot' };
const tstr = (t) => Object.entries(t ?? {}).map(([k, v]) => `${AB[k] ?? k}${v}`).join(' ');
log(`output dir: ${OUT}`);
log(`tolerances: truck volume/bbox planar ${TOL.planar}, curved ${TOL.curved}; centre of mass ${COM_TOL} x bbox diagonal (${COM_TOL_TESS} for non-pick curved results, tessellation-limited); brep-rs: gate tol`);
log('fixture'.padEnd(36), 'OCCT vol'.padStart(13), 'brep dVol'.padStart(10), 'truck dVol'.padStart(11), 'dBbox'.padStart(9), 'dCOM'.padStart(9), 'faces O/B/T(k)'.padStart(15), ' outcome');
const line = (r) => {
  const t = r.truck;
  log(r.id.padEnd(36), f4(r.occt.volume).padStart(13), ex(r.brep?.dVol).padStart(10), ex(t.dVol).padStart(11), ex(t.dBbox).padStart(9), ex(t.dCom).padStart(9),
    `${r.occt.faces}/${r.brep?.faces ?? '-'}/${t.faces}(${t.kernelFaces})`.padStart(15), ' ' + r.outcome + (t.bodies > 1 ? ` ${t.bodies} bodies` : '') + (r.outcome === 'FAIL' ? ` (${!t.geomOk ? `geometry, tol ${t.tol}/${t.comTol}` : ''}${t.faceKey ? '' : ' unexplained faces'})` : ''));
};
const refused = rows.filter((r) => r.outcome === 'REFUSED');
for (const r of rows) { if (r.invalid) log(r.id.padEnd(36), `INVALID ${r.invalid}`); else if (r.outcome !== 'REFUSED') line(r); }
log(`\nREFUSED by truck/translator (${refused.length}):`);
for (const r of refused) log(`  ${r.id}: ${r.truck.refused}`);

log('\nFACE-TYPE COMPARISON (every fixture whose per-type counts differ; pl plane, cy cylinder, sp sphere, co cone, to torus, ot other):');
log('fixture'.padEnd(36), 'OCCT types'.padEnd(20), 'truck types'.padEnd(20), 'OCCT components'.padEnd(18), ' explanation per type');
for (const r of rows) {
  if (!r.truck?.faceKeys) continue;
  const diff = Object.entries(r.truck.faceKeys).filter(([, k]) => k !== 'equal');
  if (!diff.length) continue;
  log(r.id.padEnd(36), tstr(r.truck.occtTypes).padEnd(20), tstr(r.truck.faceTypes).padEnd(20), tstr(r.truck.occtComponents).padEnd(18), ' ' + diff.map(([t, k]) => `${t}: ${k}`).join('; ') + (r.outcome === 'CONVENTION' ? ' [see CONVENTION]' : ''));
}
log('  truck-merges-edge-connected-same-surface-faces: truck count for that type == edge-connected components of same-surface faces in the live OCCT shape.');
log('  truck-splits-cylinder-patch-over-180deg: truck cylinder count == components + components whose summed angular span (face UV bounds) exceeds 180 degrees.\n  occt-other-surface-is-truck-plane: OCCT holds a face as a non-analytic surface where truck gives a plane; counts match once the two are paired.');
const reclass = rows.filter((r) => r.explain);
if (reclass.length) { log('\nCLASSIFICATION NOTES (live evidence; a diagnosis never downgrades a FAIL):'); for (const r of reclass) log(`  ${r.id}: ${r.outcome} -- ${r.explain}`); }
const wouldFail = rows.filter((r) => r.outcome === 'FAIL');

log(`\nASYMMETRIC FIXTURES. Pick controls = opposite edge/face through the part centre; REJECTED needs a failed score and control dCOM >= 10 x ${COM_TOL}.`);
log('fixture'.padEnd(30), 'OCCT==brep'.padStart(11), 'true dVol'.padStart(10), 'true dCOM'.padStart(10), 'pos'.padStart(5), 'ctl dVol'.padStart(10), 'ctl dCOM'.padStart(10), 'ctl/tol'.padStart(9), ' control');
let ctlBad = 0; let posBad = 0;
for (const a of asym) {
  const p = a.positive;
  if (p.outcome !== 'PASS') posBad++;
  if (a.noPick) { log(a.id.padEnd(30), '-'.padStart(11), ex(p.truck?.dVol).padStart(10), ex(p.truck?.dCom).padStart(10), String(p.outcome).padStart(5), ' (no pick: partial-revolve direction fixture)'); continue; }
  const c = a.control;
  if (!a.controlRejected) ctlBad++;
  log(a.id.padEnd(30), String(a.resolve.coincide).padStart(11), ex(p.truck?.dVol).padStart(10), ex(p.truck?.dCom).padStart(10), String(p.outcome).padStart(5),
    ex(c.truck?.dVol).padStart(10), ex(c.truck?.dCom).padStart(10), (typeof c.truck?.dCom === 'number' ? (c.truck.dCom / COM_TOL).toFixed(0) + 'x' : '-').padStart(9), ' ' + (a.controlRejected ? `REJECTED (${c.outcome})` : 'ACCEPTED/WEAK -- pick validation not discriminating here'));
}
const picks = asym.filter((a) => !a.noPick);
log(`  pick coincidence (OCCT resolve == brep-rs resolve): ${picks.filter((a) => a.resolve.coincide).length}/${picks.length}`);

const pass = rows.filter((r) => r.outcome === 'PASS').length;
const cnt = (k) => rows.filter((r) => r.outcome === k).length;
const unexplained = rows.filter((r) => r.truck?.faces && !r.truck.faceKey && r.outcome !== 'REFUSED').length;
log(`\nfixtures ${rows.length}: PASS ${pass}, FAIL ${cnt('FAIL')}, CONVENTION ${cnt('CONVENTION')}, REFEREE-ARTIFACT ${cnt('REFEREE-ARTIFACT')}, REFUSED ${cnt('REFUSED')}, unexplained face-type mismatches ${unexplained}`);
log(`brep-rs on the same fixtures: PASS ${rows.filter((r) => r.brep?.pass).length}, refused ${rows.filter((r) => r.brep?.refused).length}`);
log(`asymmetric: ${asym.length} fixtures, positive PASS ${asym.length - posBad}, pick controls rejected ${picks.length - ctlBad}/${picks.length}`);
log('Named picks (fillet / shell open / draft) take their point from brep-rs resolve; OCCT-vs-brep-rs coincidence is asserted above only for the asymmetric fixtures.');
writeFileSync(path.join(OUT, 'last-run.txt'), lines.join('\n') + '\n');
console.log(`wrote ${path.join(OUT, 'results.json')}, ${path.join(OUT, 'last-run.txt')}, ${path.join(OUT, 'ours')}/`);
process.exitCode = wouldFail.length || unexplained || ctlBad || posBad ? 1 : 0;
