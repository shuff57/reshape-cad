// Sketch-geometry measuring harness (scratch, not committed). Built on phase0 run-phase0.mjs (OCCT measuring code copied
// verbatim) and phase7 translate-p4 + phase2 sketch-map (read from the repo, unmodified).
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as G from '../sketch-geometry.guard.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
// REPO: walk up from this file to the first directory that has node_modules/replicad-opencascadejs. Works from
// contract/sketch-geometry-harness/ in the real repo (no shadow root needed) and from the old shadow copy alike.
export const REPO = (() => { let d = HERE; for (let i = 0; i < 8; i++) { if (existsSync(path.join(d, 'node_modules', 'replicad-opencascadejs'))) return d; d = path.dirname(d); } throw new Error('repo root (node_modules/replicad-opencascadejs) not found above ' + HERE); })();
const REAL = REPO;
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
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
export const { toScript } = await load('packages/script/dist/reshape-script-gen.js');
const { SketchSession2D } = await load('packages/brep-adapter/dist/sketch-session.js');
// brep-rs moved to archive/ (run-phase0.mjs still hardcodes packages/brep-rs/pkg): use whichever exists.
const brepDir = [path.join(REPO, 'packages', 'brep-rs', 'pkg'), path.join(REPO, 'archive', 'brep-rs', 'pkg')].find((d) => existsSync(path.join(d, 'brep_rs.js')));
export const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
export { SketchSession2D };
export const { translateDoc } = await import(pathToFileURL(path.join(REAL, 'docs/spikes/solidcraft-referee/phase7/pane/lib/translate-p4.mjs')).href);
export const smap = await import(pathToFileURL(path.join(REAL, 'docs/spikes/solidcraft-referee/phase7/pane/lib/sketch-map.mjs')).href);
export const friendly = await import(pathToFileURL(path.join(REAL, 'docs/spikes/solidcraft-referee/phase5/friendly-sketch.mjs')).href);
friendly.install();
export const TOL = { planar: 1e-9, curved: 3e-4 };
export const COM_TOL = { planar: 1e-6, curved: 3e-5 };
export const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
export const worstArr = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));
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
export { occtMeasure, faceVerdict };
// timing: wall time spent inside the SolidCraft wasm (sc.run), and the number of command lists sent
export const timing = { ms: 0, calls: 0, commands: 0 };
export const runSC = async (cmds) => {
  const t0 = performance.now(); timing.calls++; timing.commands += cmds.length;
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
  finally { timing.ms += performance.now() - t0; }
};
export const buildOCCT = (doc, id) => {
  try {
    const built = buildDoc(oc, doc, arc);
    const shape = built.shapes.get(id);
    if (!shape) { const rf = built.refusals ? [...(built.refusals.entries?.() ?? Object.entries(built.refusals))].map(([k, v]) => `${k}: ${v}`).join(' | ') : ''; return { refused: rf || 'OCCT built nothing' }; }
    return { m: occtMeasure(shape) };
  } catch (e) { return { refused: `OCCT threw: ${e.message}` }; }
};
const flat = (b) => [...b[0], ...b[1]];
export const buildBrep = (doc, id) => {
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const s = got.shapes?.[id];
    if (!s) return { refused: got.refusals?.[id] ?? 'no shape' };
    return { m: { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } };
  } catch (e) { return { refused: `brep-rs threw: ${e.message}` }; }
};

// ---- solid regions of a soup by even-odd (independent of both kernels) -----------------------------------------------
export function solidPoints(geoms) {
  const live = geoms.filter((g) => !g.construction && g.k !== 'point');
  const parent = live.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = (g) => (g.k === 'line' || g.k === 'arc' ? [g.a, g.b] : []);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) if (ends(live[i]).some((p) => ends(live[j]).some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6))) parent[find(i)] = find(j);
  const TAU = Math.PI * 2;
  const arcPts = (g, n = 96) => {
    const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]); const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
    let sw = (((a1 - a0) % TAU) + TAU) % TAU; if (g.sense === 'cw') sw = sw === 0 ? -TAU : sw - TAU;
    const r = Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]);
    return Array.from({ length: n + 1 }, (_, k) => [g.c[0] + r * Math.cos(a0 + (sw * k) / n), g.c[1] + r * Math.sin(a0 + (sw * k) / n)]);
  };
  const segs = [];
  live.forEach((g, i) => {
    const key = find(i);
    const pts = g.k === 'line' ? [g.a, g.b] : g.k === 'arc' ? arcPts(g) : Array.from({ length: 97 }, (_, k) => [g.c[0] + g.r * Math.cos((TAU * k) / 96), g.c[1] + g.r * Math.sin((TAU * k) / 96)]);
    for (let k = 0; k + 1 < pts.length; k++) segs.push([key, pts[k], pts[k + 1], g.k !== 'line' ? k : -1]);
  });
  const keys = [...new Set(segs.map((s) => s[0]))];
  const depth = (pt) => keys.filter((key) => { let c = false; for (const [k, p, q] of segs) { if (k !== key) continue; if ((p[1] > pt[1]) !== (q[1] > pt[1]) && pt[0] < ((q[0] - p[0]) * (pt[1] - p[1])) / (q[1] - p[1]) + p[0]) c = !c; } return c; }).length;
  const xs = segs.flatMap((s) => [s[1][0], s[2][0]]), ys = segs.flatMap((s) => [s[1][1], s[2][1]]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const d = Math.max(1e-3 * diag, 1e-4);
  // candidates: both sides of every straight segment's midpoint, and of ~6 samples per curve (96 sub-segments each)
  const cands = [];
  const byCurve = new Map();
  for (const sg of segs) { const k = sg[1].join(); if (!byCurve.has(sg[0])) byCurve.set(sg[0], []); byCurve.get(sg[0]).push(sg); }
  const pickIdx = (n) => (n <= 4 ? [...Array(n).keys()] : [0, 1, 2, 3, 4, 5].map((i) => Math.floor((i * n) / 6)));
  for (const [, p, q, ck] of segs) {
    if (ck >= 0 && ck % 8 !== 4) continue; // curves: 12 samples per 96 sub-segments
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1e-9) continue;
    const nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L;
    for (const t of ck >= 0 ? [0.5] : [0.1, 0.3, 0.5, 0.7, 0.9]) for (const sd of [-1, 1]) cands.push([p[0] + t * (q[0] - p[0]) + sd * d * nx, p[1] + t * (q[1] - p[1]) + sd * d * ny]);
  }
  const vec = (pt) => keys.map((key) => { let c = false; for (const [k, p, q] of segs) { if (k !== key) continue; if ((p[1] > pt[1]) !== (q[1] > pt[1]) && pt[0] < ((q[0] - p[0]) * (pt[1] - p[1])) / (q[1] - p[1]) + p[0]) c = !c; } return c ? 1 : 0; }).join('');
  const crosses = (p, q) => segs.some(([, a, b]) => { const o = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]); const d1 = o(p, q, a), d2 = o(p, q, b), d3 = o(a, b, p), d4 = o(a, b, q); return d1 * d2 < 0 && d3 * d4 < 0; });
  const groups = new Map();
  for (const c of cands) { const v = vec(c); if ((v.split('1').length - 1) % 2 !== 1) continue; if (!groups.has(v)) groups.set(v, []); groups.get(v).push(c); }
  const out = [];
  for (const g of groups.values()) {
    const par = g.map((_, i) => i); const fd = (i) => (par[i] === i ? i : (par[i] = fd(par[i])));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (fd(i) !== fd(j) && !crosses(g[i], g[j])) par[fd(i)] = fd(j);
    const seenRoot = new Set();
    g.forEach((c, i) => { const r = fd(i); if (!seenRoot.has(r)) { seenRoot.add(r); out.push(c); } });
  }
  return out;
}

// brep-rs' sketch session solves the soup (the reSHape stack's own solver); its solved rows pick the profiles. Raw rows if it cannot.
export function solvedGeoms(soup) {
  if (process.env.SG_SOLVER !== 'brep') { // default: the guard's own independent solver (contract/sketch-geometry.solve.mjs); no brep-rs
    try { const s = G.solveSoup({ geoms: JSON.parse(JSON.stringify(soup.geoms)), rules: JSON.parse(JSON.stringify(soup.rules ?? [])) }); return s.unsupported ? soup.geoms : s.solved; } catch { return soup.geoms; }
  }
  try {
    const s = new SketchSession2D(); s.loadFromBytes(brep);
    const err = s.open(JSON.parse(JSON.stringify(soup.geoms)), JSON.parse(JSON.stringify(soup.rules ?? [])));
    let out = null;
    if (!err && s.solve()) { try { out = s.solvedGeoms(); } catch { /* none */ } }
    s.close();
    if (out) return out;
  } catch { /* fall through */ }
  return soup.geoms;
}
// ---- SolidCraft path: translate-p4 on the SOLVED doc; a soup extrude gets its even-odd `profiles` by point --------------
async function truckBuildRaw(doc0, id) {
  let doc;
  try { doc = solveDoc(doc0); } catch (e) { return { refused: `solveDoc threw: ${e.message}` }; }
  const soups = {};
  let lastOk = null;
  const ctx = { arc, mt, soups, runSC: async (cmds) => {
    // the host (phase7 pane.js:296) sets profiles for a soup extrude; here by interior points of the doc's own even-odd fill
    for (const c of cmds) {
      if (process.env.SG_NO_PROFILES || c.command !== 'solid.extrude' || c.params.profiles !== undefined || !soups[c.params.sketch]) continue;
      const pts = solidPoints(solvedGeoms(soups[c.params.sketch]));
      if (pts.length) c.params.profiles = pts.map((p) => ({ point: p }));
    }
    const r = await runSC(cmds); if (r.ok) lastOk = r; return r;
  } };
  let tr;
  try { tr = await translateDoc(doc, ctx); } catch (e) { return { refused: `translator threw: ${e.message}` }; }
  const f = tr.features.find((x) => x.id === id);
  if (!f) return { refused: `no feature ${id}` };
  if (f.status !== 'built') return { refused: f.refusal ?? `${id} not built`, commands: tr.commands };
  // translate-p4 aggregate() keeps only bodies NAMED b_<id>; solidcraft names a second piece 'b_<id> (2)'. Measure them all.
  const re = new RegExp('^b_' + id + '( \\(\\d+\\))?$');
  const bs = (lastOk?.measure?.bodies ?? []).filter((b) => re.test(b.name));
  let m = f.measure; const translatorBodies = f.measure.bodies.length;
  if (bs.length > translatorBodies) {
    const lo = [0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i]))), hi = [0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])));
    const vol = bs.reduce((a, b) => a + b.volume_mm3, 0);
    m = { ...m, volume: vol, faces: bs.reduce((a, b) => a + b.faces, 0), kernelFaces: bs.reduce((a, b) => a + b.kernel.faces, 0), bbox: [...lo, ...hi], bodies: bs.map((b) => b.name),
      faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
      com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / vol), translatorUnderReported: { translatorBodies, bodies: bs.length, translatorVolume: f.measure.volume } };
  }
  return { m, translatorReported: { volume: f.measure.volume, bodies: translatorBodies, faces: f.measure.faces }, commands: f.commands, soups, lastBodies: (lastOk?.measure?.bodies ?? []).map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces, bbox: [...b.bbox.min, ...b.bbox.max] })), all: tr.features.map((x) => ({ id: x.id, status: x.status, refusal: x.refusal })) };
}


// SG_GUARD=1 runs the GUARDED path (sg-guarded.mjs: translate-p4 + contract/sketch-geometry.guard.mjs); without it, the raw translator path
// that the committed results/ were measured on (the "before" side of every row).
export const GUARDED = !!process.env.SG_GUARD;
export async function truckBuild(doc0, id, opts) {
  if (!GUARDED) return truckBuildRaw(doc0, id);
  return (await import('./sg-guarded.mjs')).guardedTruckBuild(doc0, id, opts);
}

// ---- one case ------------------------------------------------------------------------------------------------------
const ex = (v) => (typeof v === 'number' ? Number(v.toExponential(2)) : v);
export async function measureCase(c) {
  const rec = { id: c.id, feature: c.feature, what: c.what, fc: c.fc };
  let run = null;
  if (c.script !== undefined) {
    const src0 = c.preamble ? friendly.withPreamble(c.script) : c.script;
    if (GUARDED) globalThis.__SGPROBE__ = [];
    run = runScript(GUARDED ? G.withProbe(src0) : src0, c.values ? { values: c.values } : undefined);
    if (GUARDED) { rec.probe = G.scriptProbeVerdict(globalThis.__SGPROBE__); rec.scriptErrorsPlain = run.errors.map((e) => `line ${e.line}: ${G.studentSentence(e.message, { scriptText: c.script })}`); }
    rec.scriptErrors = run.errors.map((e) => `line ${e.line}: ${e.message}`);
    rec.warnings = run.warnings ?? [];
    if (c.expectContains) rec.expectContains = c.expectContains;
    if (run.errors.length) { rec.outcome = 'SCRIPT-REFUSED'; if (c.expectContains) rec.expectOk = run.errors[0].message.includes(c.expectContains); return rec; }
  }
  const doc = c.doc ?? (c.edit ? c.edit(JSON.parse(JSON.stringify(run.doc))) : run.doc);
  rec.doc = doc;
  const ext = c.measure ?? [...doc.features].reverse().find((f) => f.kind === 'extrude' || f.kind === 'pocket' || f.kind === 'revolve')?.id;
  rec.measureId = ext;
  const vv = GUARDED && c.values ? G.valuesVerdicts(c.values) : null; if (vv?.size) rec.valueVerdicts = [...vv].map(([k, v]) => ({ sketch: k, code: v.code, sentence: v.sentence }));
  const o = c.noOcct ? { refused: 'OCCT not run: it does not return on this input (see cases-hazards)' } : buildOCCT(doc, ext), b = buildBrep(doc, ext), t = await truckBuild(doc, ext, GUARDED ? { ...(rec.probe ? { scriptVerdict: rec.probe } : {}), ...(vv?.size ? { valueVerdicts: vv } : {}) } : undefined);
  rec.occt = o.m ? { volume: o.m.volume, bbox: o.m.bbox, com: o.m.com, faces: o.m.faces, types: o.m.types } : { refused: o.refused };
  rec.brep = b.m ?? { refused: b.refused };
  if (c.exact) rec.exact = c.exact;
  const curved = c.curved ?? (t.m ? Object.keys(t.m.faceTypes ?? {}).some((k) => k !== 'plane') : false);
  rec.curved = curved;
  if (GUARDED) { rec.guarded = true; rec.notices = t.notices ?? []; rec.guardVerdicts = t.verdicts ?? []; rec.pieceNote = t.pieceNote ?? null; rec.guardCode = t.guard ?? null; }
  if (t.refused) { rec.truck = { refused: t.refused, guard: t.guard ?? null }; rec.outcome = o.m || b.m ? 'TRUCK-REFUSED' : 'ALL-REFUSED'; return rec; }
  const m = t.m;
  const tol = curved ? TOL.curved : TOL.planar;
  const row = { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, kernelFaces: m.kernelFaces, faceTypes: m.faceTypes, bodies: m.bodies.length, tol };
  if (o.m) {
    const diag = Math.max(Math.hypot(o.m.bbox[3] - o.m.bbox[0], o.m.bbox[4] - o.m.bbox[1], o.m.bbox[5] - o.m.bbox[2]), 1);
    row.dVolOcct = rel(m.volume, o.m.volume); row.dBboxOcct = worstArr(m.bbox, o.m.bbox);
    // round 6: for a CURVED build the bounding box comes from the mesh, so it misses the bow of a nearly flat arc by up to the bow itself (measured <= 6e-3 mm on 50 to 200 mm parts); the curved bar is
    // therefore also scored against the part's own diagonal (the same denominator the centre-of-mass score uses). dBboxOcct (floor 1 mm) is kept and still printed.
    row.dBboxDiagOcct = Math.max(...m.bbox.map((v, i) => Math.abs(v - o.m.bbox[i]))) / diag;
    row.dComOcct = Math.max(...m.com.map((v, i) => Math.abs(v - o.m.com[i]))) / diag;
    row.comTol = curved ? COM_TOL.curved : COM_TOL.planar;
    const fv = faceVerdict(m.faceTypes, o.m); row.faceKeys = fv.keys; row.faceOk = fv.ok;
  }
  if (GUARDED && !doc.features.some((x) => x.kind === 'sketch' && Array.isArray(x.geoms) && x.geoms.length)) { // independent face count of a prism: edges of the outline the build gets + 2 caps
    const ef = doc.features.find((x) => x.id === ext);
    const sk = ef && doc.features.find((x) => x.id === (ef.target ?? ef.sketch));
    if (sk && ef.kind === 'extrude') { const out = G.repairOutline(arc.outlineOf(sk), sk); row.outlineFaces = sk.shape === 'circle' ? 3 : out.points.length + 2; row.outlineFacesOk = row.outlineFaces === m.faces; }
  }
  if (b.m) { row.dVolBrep = rel(m.volume, b.m.volume); row.dBboxBrep = worstArr(m.bbox, b.m.bbox); }
  if (c.exact?.volume != null) row.dVolExact = rel(m.volume, c.exact.volume);
  if (c.exact?.bbox) { row.dBboxExact = worstArr(m.bbox, c.exact.bbox); if (o.m) row.occtBboxExact = worstArr(o.m.bbox, c.exact.bbox); if (b.m) row.brepBboxExact = worstArr(b.m.bbox, c.exact.bbox); }
  if (c.exact?.volume != null) { if (o.m) row.occtVolExact = rel(o.m.volume, c.exact.volume); if (b.m) row.brepVolExact = rel(b.m.volume, c.exact.volume); }
  rec.truck = row;
  if (t.translatorReported) rec.translatorReported = t.translatorReported; // what translate-p4's own aggregate() reports (counts only the body named b_<id>)
  rec.truckCommands = t.commands;
  const geomOk = o.m ? Math.max(row.dVolOcct, curved ? Math.min(row.dBboxOcct, row.dBboxDiagOcct) : row.dBboxOcct) <= tol && row.dComOcct <= row.comTol : (b.m ? Math.max(row.dVolBrep, row.dBboxBrep) <= tol : null);
  const exactOk = (c.exact?.volume != null || c.exact?.bbox) ? ((c.exact?.volume == null || row.dVolExact <= tol) && (!c.exact?.bbox || row.dBboxExact <= tol)) : null;
  rec.refBasis = [o.m ? 'OCCT' : null, b.m ? 'brep-rs' : null, c.exact ? 'closed form' : null].filter(Boolean).join('+');
  rec.geomOk = geomOk === null ? exactOk : geomOk; rec.exactOk = exactOk;
  rec.outcome = rec.geomOk === null ? 'NO-ORACLE' : (rec.geomOk && exactOk !== false && (row.faceOk ?? true)) ? 'PASS' : (rec.geomOk && exactOk !== false) ? 'PASS-FACES-DIFFER' : 'FAIL';
  return rec;
}
export const brief = (r) => {
  const t = r.truck;
  const f = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  return `${r.id.padEnd(34)} ${String(r.outcome).padEnd(18)} ` + (t?.volume !== undefined ? `vol ${t.volume.toFixed(6)} occt ${r.occt.volume?.toFixed?.(6)} brep ${r.brep.volume?.toFixed?.(6)} exact ${r.exact?.volume ?? '-'} dOcct ${f(t.dVolOcct)} dBbox ${f(t.dBboxOcct)} dCom ${f(t.dComOcct)} dExact ${f(t.dVolExact)} dBbxEx ${f(t.dBboxExact)} faces o/b/t ${r.occt.faces}/${r.brep.faces}/${t.faces} ${t.faceOk === false ? 'FACEDIFF ' + JSON.stringify(t.faceKeys) : ''} bodies ${t.bodies}` : `${t?.refused ?? ''} ${r.scriptErrors ?? ''} | occt ${r.occt?.volume ?? r.occt?.refused} brep ${r.brep?.volume ?? r.brep?.refused}`);
};
