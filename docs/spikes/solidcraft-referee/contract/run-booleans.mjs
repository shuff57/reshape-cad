#!/usr/bin/env node
// SPIKE, referee only (contract/booleans group). Measures the three booleans (join/union, cut/subtract, keep/intersect)
// through the whole student path:  reSHape Script -> runScript() -> ModelDoc -> phase0 translateDoc -> SolidCraft (truck) wasm,
// scored against live OCCT (replicad-opencascadejs) and live brep-rs (archive/brep-rs/pkg).
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/run-booleans.mjs --all   [--out=<dir>]   (one child process per case, timeout)
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/run-booleans.mjs --case=<id>              (one case, prints one JSON line)
//
// READ-ONLY on archive/, packages/*, scripts/. Writes only under --out (default: this directory).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES } from './boolean-cases.mjs';
await import('./boolean-cases-r2.mjs');   // round 2: pushes its cases onto CASES
await import('./boolean-cases-r3.mjs');   // round 3: pushes its cases onto CASES
await import('./boolean-cases-r4.mjs');   // round 4 (critic round 2): pushes its cases onto CASES
await import('./boolean-cases-r5.mjs');   // fix round 1 (critic round 3): thin curved keeps with closed forms
await import('./boolean-cases-r6.mjs');   // fix round 2 (critic round 4)
// BOOL_TR=guarded runs the cases through bool-translate.mjs + booleans.guard.mjs (the contract); default = the pristine phase0 translator ("as shipped")
// BOOL_TR=r3raw runs bool-translate-r3.mjs (pieces + n-ary keep executor) with NO guard
const MODE = process.env.BOOL_TR ?? 'phase0';
const GUARDED = MODE === 'guarded';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const OUT = arg('out') ? path.resolve(arg('out')) : HERE;

if (process.argv.includes('--all')) {
  mkdirSync(path.join(OUT, 'cases'), { recursive: true });
  const only = arg('only').split(',').filter(Boolean);
  const timeout = Number(arg('timeout') || 60) * 1000;
  const resume = process.argv.includes('--resume');
  const results = [];
  for (const c of CASES) {
    if (only.length && !only.includes(c.id)) continue;
    const file = path.join(OUT, 'cases', `${c.id}.json`);
    if (resume) { try { const prev = JSON.parse(readFileSync(file, 'utf8')); results.push(prev); console.log(`${prev.id.padEnd(40)} ${String(prev.outcome).padEnd(10)} (resumed)`); continue; } catch { /* run it */ } }
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--case=${c.id}`], { encoding: 'utf8', timeout, maxBuffer: 64 << 20, env: process.env });
    const out = (r.stdout ?? '').split('\n');
    const line = out.filter((l) => l.startsWith('@@RESULT@@')).pop();
    const stage = out.filter((l) => l.startsWith('@@STAGE@@')).pop()?.slice(9);
    const cmdLine = out.filter((l) => l.startsWith('@@COMMANDS@@')).pop();   // round 4: the command list the guarded translator accepted, kept even when the case later hangs, so the survivor can be timed alone
    let row;
    if (line) row = JSON.parse(line.slice(10));
    else row = { id: c.id, feature: c.feature, source: c.script ?? null, features: c.script === undefined ? c.features : undefined, ...(cmdLine ? { commands: JSON.parse(cmdLine.slice(12)) } : {}), outcome: r.error?.code === 'ETIMEDOUT' || r.signal ? 'HANG' : 'CRASH', lastStage: stage, detail: ((r.stderr ?? '').slice(-600) || String(r.error ?? '')), signal: r.signal, timeoutMs: timeout };
    row.wallMs = Date.now() - t0;
    writeFileSync(file, JSON.stringify(row));
    results.push(row);
    console.log(`${row.id.padEnd(40)} ${String(row.outcome).padEnd(10)} ${row.summary ?? (row.lastStage ? 'last stage: ' + row.lastStage : row.detail ?? '')}`);
  }
  writeFileSync(path.join(OUT, 'booleans-results.json'), JSON.stringify(results, null, 1));
  console.log(`wrote ${path.join(OUT, 'booleans-results.json')}`);
  process.exit(0);
}

const id = arg('case');
const C = CASES.find((c) => c.id === id);
if (!C) { console.error('unknown case', id); process.exit(2); }
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }

const TRANSLATOR = { phase0: path.join(HERE, '..', 'phase0', 'translate.mjs'), guarded: path.join(HERE, 'bool-translate-r3.mjs'), r3raw: path.join(HERE, 'bool-translate-r3.mjs') }[MODE];
if (!TRANSLATOR) { console.error('unknown BOOL_TR', MODE); process.exit(2); }
const { translateDoc } = await import(pathToFileURL(TRANSLATOR).href);
const G = GUARDED ? await import(pathToFileURL(path.join(HERE, 'booleans.guard.mjs')).href) : null;
const SL = await import(pathToFileURL(path.join(HERE, 'booleans.slow.mjs')).href);
const PG = GUARDED ? await import(pathToFileURL(path.join(HERE, 'primitives.guard.mjs')).href) : null;
const RG = GUARDED ? await import(pathToFileURL(path.join(HERE, 'revolve-groove.guard.mjs')).href) : null;
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const worstArr = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));
const flat = (b) => [...b[0], ...b[1]];
const TOL = { planar: 1e-9, curved: 3e-4 };

// ---- OCCT (copied from phase0/run-phase0.mjs, plus area, solid count, validity) -----------------------------------------
const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0;
function surfaceKey(face) {
  const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
  const t = a.GetType(); const T = oc.GeomAbs_SurfaceType;
  const canon = (d) => { const s = d.find((v) => Math.abs(v) > 1e-9) < 0 ? -1 : 1; return d.map((v) => r6(v * s)); };
  try {
    if (t === T.GeomAbs_Plane) { const ax = a.Plane().Axis(); const d = [ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()]; const l = ax.Location(); const n = canon(d); return `P ${n} ${r6(n[0] * l.X() + n[1] * l.Y() + n[2] * l.Z())}`; }
    if (t === T.GeomAbs_Cylinder) { const c = a.Cylinder(); const ax = c.Axis(); const d = canon([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()]); const l = ax.Location(); const dot = d[0] * l.X() + d[1] * l.Y() + d[2] * l.Z(); const perp = [l.X() - dot * d[0], l.Y() - dot * d[1], l.Z() - dot * d[2]].map(r6); return `C ${d} ${perp} ${r6(c.Radius())}`; }
    if (t === T.GeomAbs_Cone) return 'K';
    if (t === T.GeomAbs_Sphere) { const s = a.Sphere(); const l = s.Location(); return `S ${[l.X(), l.Y(), l.Z()].map(r6)} ${r6(s.Radius())}`; }
    if (t === T.GeomAbs_Torus) { const s = a.Torus(); const l = s.Location(); return `T ${[l.X(), l.Y(), l.Z()].map(r6)} ${r6(s.MajorRadius())} ${r6(s.MinorRadius())}`; }
  } catch { /* fall through */ }
  return `U ${Math.random()}`;
}
const TYPE_OF = { P: 'plane', C: 'cylinder', K: 'cone', S: 'sphere', T: 'torus', U: 'other' };
function surfaceClasses(fs) {
  const info = fs.map((f) => {
    const k = surfaceKey(f); const t = TYPE_OF[k[0]]; let span = 0;
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
  for (const c of comp.values()) { components[c.t] = (components[c.t] ?? 0) + 1; if (c.t === 'cylinder' && c.span > Math.PI + 1e-6) bigCylinderComponents++; }
  return { types, components, bigCylinderComponents };
}
function faceVerdict(truckTypes, o) {
  const keys = {}; let ok = true; const tr = (T) => truckTypes?.[T] ?? 0;
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
function count(shape, kind) { let n = 0; const e = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[kind], oc.TopAbs_ShapeEnum.TopAbs_SHAPE); while (e.More()) { n++; e.Next(); } return n; }
function occtMeasure(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const c = g.CentreOfMass();
  const ga = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(shape, ga, false, false);
  const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(); const hi = bx.CornerMax();
  const fs = facesOf(oc, shape);
  let valid = null; try { valid = new oc.BRepCheck_Analyzer(shape, true, false).IsValid(); } catch { /* not bound */ }
  return { volume: g.Mass(), area: ga.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: fs.length, solids: count(shape, 'TopAbs_SOLID'), shells: count(shape, 'TopAbs_SHELL'), valid, ...surfaceClasses(fs) };
}
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };

// ---- the case --------------------------------------------------------------------------------------------------------
const row = { id: C.id, feature: C.feature, note: C.note ?? null, source: C.script ?? null };
const done = (outcome, summary) => { row.outcome = outcome; row.summary = summary; console.log('@@RESULT@@' + JSON.stringify(row)); process.exit(0); };

let features;
if (C.script !== undefined) {
  const r = runScript(C.script);
  row.frontEndErrors = r.errors.map((e) => e.message);
  if (r.errors.length) {
    // the interpreter (front end) refused: a plain sentence, no kernel involved
    const raw = r.errors[0].message; const better = GUARDED ? (G.explainCombineArgs(raw, C.script, r.errors[0].line) ?? G.explainFront(raw)) : null;   // G15: name the argument that is not a shape
    row.refusalSentence = better ?? raw; if (better) row.interpreterRaw = raw;
    done('REFUSED-FRONT', `interpreter: ${better ?? raw}`);
  }
  features = r.doc.features;
} else features = C.features;
row.featureKinds = features.map((f) => `${f.id}:${f.kind}${f.op ? '/' + f.op : ''}`);
const measureId = C.measure ?? features[features.length - 1].id;
const doc0 = { version: 1, features };

const stage = (n) => console.log('@@STAGE@@' + n);

let TR = null;
function translateAll() {
  if (TR) return TR;
// SolidCraft via the phase0 translator
let doc;
try { doc = solveDoc(doc0); } catch (e) { row.solveError = e.message; doc = doc0; }
const featById = Object.fromEntries(doc.features.map((f) => [f.id, f]));
// a revolve whose profile stays off its axis is a RING (tube) tool: the descriptor carries {angle}
const ringOf = (feat) => { if (feat?.kind !== 'revolve') return null; const sk = featById[feat.target]; if (!sk) return null; const p = RG.profileInfo(sk, arc); if (!p.ok) return null; const tol = RG.AXIS_TOL * Math.max(1, p.scale); return (p.umin > tol || p.umax < -tol) ? { angle: feat.angle } : null; };
if (GUARDED) G.setInnerSentence((id) => { const f = featById[id]; return f ? (PG.guardFeature(f)?.sentence ?? null) : null; });
// round 4: the world frame of a sketch and the directions of its straight edges, for the slant predictor (booleans.slow.mjs)
const sketchInfo = (skId) => {
  const sk = featById[skId]; if (!sk || sk.kind !== 'sketch') return null;
  try {
    const fr = mt.sketchFrameOf(sk); const o = arc.outlineOf(sk);
    if (sk.shape === 'circle') return { n: fr.n, edgeNormals: [], arcs: true };
    const pts = o.points ?? sk.points; const bul = o.bulges ?? sk.bulges ?? {};
    const edgeNormals = []; let arcs = false;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length; const dx = pts[j][0] - pts[i][0]; const dy = pts[j][1] - pts[i][1]; const L = Math.hypot(dx, dy); if (L < 1e-12) continue;
      if (Math.abs(bul[i] ?? 0) > 1e-12) { arcs = true; continue; }
      const nx = dy / L; const ny = -dx / L;   // in-plane normal of the edge
      edgeNormals.push([0, 1, 2].map((k) => fr.u[k] * nx + fr.v[k] * ny));
    }
    return { n: fr.n, edgeNormals, arcs, axis: fr.v };
  } catch { return null; }
};
const affects = {}; for (const g of doc.features) if (['hole', 'pocket', 'groove', 'shell', 'fillet', 'draft'].includes(g.kind)) { const t = g.kind === 'pocket' || g.kind === 'groove' ? g.into : g.target; if (t) (affects[t] ??= []).push(g.id); }
const gctx = GUARDED ? { guard: (f, ops) => G.guardCombine(f, ops.map((o) => ({ id: o.id, d: G.describe(o.measure, o.feat, { ring: ringOf(o.feat), pieces: o.pieces, info: SL.orient(o.id, featById, sketchInfo, affects) }) }))), reusedTools: (f) => G.reusedTools(f, doc.features), plain: (t, f) => G.plainSentence(t, f), plainPieces: (t) => G.plainPieces(t), after: (f, m, before, boxes) => G.afterCombine(f, m, before, boxes), featById } : {};
const t0sc = Date.now();
// round 4: edge / face names (bevel of one edge, hollow with an open face) are resolved by brep-rs exactly as the fillet-chamfer group does
const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
const tr = translateDoc(doc, { arc, mt, runSC, resolveAt, ...gctx });
row.translateMs = Date.now() - t0sc; row.translator = MODE;
row.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal }));
row.commands = tr.commands;
const mf = tr.features.find((f) => f.id === measureId);
const firstRef = tr.features.find((f) => f.status === 'refused');
  TR = { doc, featById, tr, mf, firstRef };
  return TR;
}
// BOOL_FAST=1: translate FIRST; a case the translator or the guard refuses needs no oracle (the fuzz runs refuse more than half of their cases before any kernel call)
if (process.env.BOOL_FAST === '1') {
  const { tr: tr0, mf: mf0, firstRef: fr0 } = translateAll();
  console.log('@@COMMANDS@@' + JSON.stringify(tr0.commands));
  if (!mf0 || mf0.status !== 'built') { row.truck = { refused: mf0?.refusal ?? fr0?.refusal ?? `${measureId} was not built` }; row.refusalSentence = row.truck.refused; row.occt = null; row.brep = null; row.fast = true; done('REFUSED', row.truck.refused); }
}
stage('occt');
// OCCT oracle
let occt = null; let occtNote = null;
try {
  const built = buildDoc(oc, doc0, arc);
  const shape = built.shapes.get(measureId);
  if (!shape) occtNote = `OCCT built nothing: ${built.refusals?.get?.(measureId) ?? 'no shape'}`;
  else if (shape.IsNull()) occtNote = 'OCCT shape is null';
  else { occt = occtMeasure(shape); if (!(occt.volume > 1e-9)) occtNote = `OCCT result is empty (volume ${occt.volume})`; }
} catch (e) { occtNote = `OCCT threw: ${e.message}`; }
row.occt = occt; row.occtNote = occtNote;

stage('brep-rs');
// brep-rs oracle
try {
  const got = JSON.parse(brep.measure_doc(JSON.stringify(doc0)));
  const s = got.shapes?.[measureId];
  row.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } : { refused: got.refusals?.[measureId] ?? 'no shape' };
  if (s && occt) { row.brep.dVol = rel(s.volume, occt.volume); row.brep.dBbox = worstArr(flat(s.bbox), occt.bbox); }
} catch (e) { row.brep = { refused: `brep-rs threw: ${e.message}` }; }

// independent closed-form volume
if (typeof C.analytic === 'number') { row.analytic = C.analytic; if (occt) row.occtVsAnalytic = rel(occt.volume, C.analytic); }

stage('solidcraft');
const { doc, featById, tr, mf, firstRef } = translateAll();
if (!mf || mf.status !== 'built') {
  row.truck = { refused: mf?.refusal ?? firstRef?.refusal ?? `${measureId} was not built` };
  row.refusalSentence = row.truck.refused;
  done('REFUSED', row.truck.refused);
}
const m = mf.measure;
const kernelBodies = (() => { const c0 = process.cpuUsage(); const w0 = Date.now(); const r = runSC(tr.commands); const c1 = process.cpuUsage(c0); row.finalRun = { wallMs: Date.now() - w0, cpuMs: Math.round((c1.user + c1.system) / 1000), load1: +os.loadavg()[0].toFixed(1) }; return r.ok ? r.measure : null; })();
row.truckAll = kernelBodies ? { body_count: kernelBodies.body_count, total: kernelBodies.total, bodies: kernelBodies.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, area: b.area_mm2, faces: b.faces, kernel: b.kernel })) } : null;
const nonOperandBodies = kernelBodies ? kernelBodies.bodies.map((b) => b.name) : [];
row.truckBodiesInSession = nonOperandBodies;
const truck = { volume: m.volume, area: null, bbox: m.bbox, com: m.com, faces: m.faces, kernelFaces: m.kernelFaces, faceTypes: m.faceTypes, curved: m.curved, bodies: m.bodies.length, bodyNames: m.bodies };
// area of the measured bodies
if (kernelBodies) truck.area = kernelBodies.bodies.filter((b) => m.bodies.includes(b.name)).reduce((s, b) => s + b.area_mm2, 0);
// kernel topology of the measured bodies: Euler characteristic V-E+F = 2*(shells) - 2*genus-sum
if (kernelBodies) { const ks = kernelBodies.bodies.filter((b) => m.bodies.includes(b.name)).map((b) => b.kernel); truck.euler = ks.map((k) => k.vertices - k.edges + k.faces); truck.shells = ks.map((k) => k.shells); }
row.truck = truck;

if (!occt) {
  // oracle says empty / failed. SolidCraft built something => it must be (near) empty or this is a disagreement.
  row.truck.vsOracle = occtNote;
  if (truck.volume > 1e-6) done('WRONG', `OCCT oracle: ${occtNote}; but SolidCraft built a solid of volume ${truck.volume}`);
  done('EMPTY-BUILT', `OCCT: ${occtNote}; SolidCraft built volume ${truck.volume} (empty)`);
}
const diag = Math.max(Math.hypot(occt.bbox[3] - occt.bbox[0], occt.bbox[4] - occt.bbox[1], occt.bbox[5] - occt.bbox[2]), 1);
const t = truck.curved ? TOL.curved : TOL.planar;
truck.tol = t;
truck.dVol = rel(truck.volume, occt.volume);
truck.dBbox = worstArr(truck.bbox, occt.bbox);
// Round 5 (fix round 1): the round-4 curved scale (volume over max(V, A*Rc/3), bbox over Rc) is REMOVED. It loosened the bar for thin curved keeps (a ball 3 mm into a box read dVol 3.7e-5 for a true error 6.6e-4). The bar is the plain relative one again: 1e-9 planar, 3e-4 curved on volume and bbox.
truck.dCom = Math.max(...truck.com.map((v, i) => Math.abs(v - occt.com[i]))) / diag;
truck.dArea = truck.area == null ? null : rel(truck.area, occt.area);
const fv = faceVerdict(truck.faceTypes, occt);
truck.faceKeys = fv.keys; truck.faceOk = fv.ok;
truck.facesOcct = occt.faces; truck.solidsOcct = occt.solids;
if (typeof C.analytic === 'number') truck.dAnalytic = rel(truck.volume, C.analytic);
if (Array.isArray(C.bboxAnalytic)) { truck.dBboxAnalytic = worstArr(truck.bbox, C.bboxAnalytic); row.occtBboxVsAnalytic = worstArr(occt.bbox, C.bboxAnalytic); }   // fix round 2: closed-form bounding box (second measure for a bbox disagreement)
const comTol = truck.curved ? 3e-5 : 1e-6;
const areaTol = truck.curved ? 3e-4 : 1e-9;
const geomOk = Math.max(truck.dVol, truck.dBbox) <= t && truck.dCom <= comTol && (truck.dArea == null || truck.dArea <= areaTol);
truck.geomOk = geomOk;
const bodiesOk = truck.bodies === occt.solids || (C.allowBodyDiff === true);
truck.bodiesOk = bodiesOk;
const ok = geomOk && fv.ok && bodiesOk;
row.outcome = ok ? 'PASS' : 'FAIL';
const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
row.summary = `${row.outcome} vol O=${occt.volume.toFixed(4)} T=${truck.volume.toFixed(4)} dVol ${ex(truck.dVol)} dBbox ${ex(truck.dBbox)} dCom ${ex(truck.dCom)} dArea ${ex(truck.dArea)} faces O/B/T ${occt.faces}/${row.brep?.faces ?? '-'}/${truck.faces} solids O/T ${occt.solids}/${truck.bodies}${fv.ok ? '' : ' FACE-UNEXPLAINED'}`;
done(row.outcome, row.summary);
