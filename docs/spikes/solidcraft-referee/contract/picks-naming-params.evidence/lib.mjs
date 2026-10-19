// Harness for the picks-naming-params group. Read-only on the repo; writes only under the scratchpad.
// script/ModelDoc -> (interpreter, solveDoc) -> phase-7 translator (async, topology-resolved names) -> SolidCraft wasm rig
// vs live OCCT (occt-build) and live brep-rs (archive pkg). Topology (model.faces/edges) comes from the prebuilt native
// solidcraft-cli (same engine fe3717f), because the wasm rig's run() returns only inspect.measure.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
export const S = '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad';
export const PKG = process.env.SOLIDCRAFT_REFEREE_PKG || `${S}/sc-referee-pkg`;
export const CLI = `${process.env.HOME}/.cache/solidcraft-bridge/target-native/release/solidcraft-cli`;
export const SPIKE = `${REPO}/docs/spikes/solidcraft-referee`;
const load = (p) => import(pathToFileURL(path.isAbsolute(p) ? p : path.join(REPO, p)).href);

export const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
export const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
export const { facesOf, resolveName: occtResolveName } = await load('packages/brep-adapter/dist/topo-resolve.js');
export const arc = await load('packages/sketch/dist/sketch-arc.js');
export const mt = await load('packages/script/dist/model-types.js');
export const cg = await load('packages/script/dist/model-codegen.js');
export const rs = await load('packages/script/dist/reshape-script.js');
export const tn = await load('packages/script/dist/topo-name.js');
export const mc = await load('packages/script/dist/model-check.js');
export const mh = await load('packages/script/dist/model-handles.js');
export const md = await load('packages/script/dist/model-deps.js');
export const gen = await load('packages/script/dist/reshape-script-gen.js');
const T4 = await load('docs/spikes/solidcraft-referee/phase7/pane/lib/translate-p4.mjs');
export const translateDoc = T4.translateDoc;
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
export const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

// ---------------------------------------------------------------------------------------------------------------- engine
export const runSC = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
let cliN = 0;
function cliRun(cmds) {
  const f = `${S}/pnp/tmp/cli-${process.pid}-${cliN++}.json`;
  mkdirSync(`${S}/pnp/tmp`, { recursive: true });
  writeFileSync(f, JSON.stringify({ commands: cmds }));
  try {
    const out = execFileSync(CLI, ['run', f, '--results', '--quiet', '--allow-errors'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (e) { return { error: String(e.stderr || e.message).slice(0, 400) }; }
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm3 = (a) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a) => { const n = nrm3(a); return [a[0] / n, a[1] / n, a[2] / n]; };

/** Emulation of the phase-4 bridge's pick test (the bridge calls solidcraft_doc::appearance::nearest_face on the display mesh,
 *  which the native CLI does not expose). A face's boundary is rebuilt from the model.edges that name it; a point is "on" the
 *  face when it is inside that boundary (even-odd, so holes work). The interior point is the grid point with the largest
 *  clearance. Only planar faces get a pick (the resolver refuses curved ones before it asks). */
function faceLoops(face, edges) {
  const segs = [];
  for (const e of edges) {
    if (!e.name.split('|').map((x) => x.replace(/~[0-9]+$/, '')).includes(face.name)) continue;
    const m2 = [(e.start[0] + e.end[0]) / 2, (e.start[1] + e.end[1]) / 2, (e.start[2] + e.end[2]) / 2];
    const straight = nrm3(sub3(e.mid, m2)) < 1e-9 * Math.max(1, e.length);
    if (straight) { segs.push([e.start, e.end]); continue; }
    // circle through start, mid, end (open arc). A closed edge (start == end) cannot be sampled this way: not expected.
    const a = e.start, b = e.mid, c = e.end;
    const ab = sub3(b, a), ac = sub3(c, a); const n = cross3(ab, ac); const n2 = dot3(n, n);
    if (n2 < 1e-18) { segs.push([e.start, e.end]); continue; }
    const t1 = cross3(n, ab), t2 = cross3(ac, n);
    const cen = [0, 1, 2].map((i) => a[i] + (dot3(ac, ac) * t1[i] + dot3(ab, ab) * t2[i]) / (2 * n2));
    const u = unit3(sub3(a, cen)); const w = unit3(cross3(unit3(n), u)); const r = nrm3(sub3(a, cen));
    const ang = (p) => Math.atan2(dot3(sub3(p, cen), w), dot3(sub3(p, cen), u));
    let t0 = 0, tm = ang(b), te = ang(c);
    if (tm < 0) tm += 2 * Math.PI; if (te < 0) te += 2 * Math.PI;
    // the arc runs start -> mid -> end: if end is before mid in positive sense, go negative
    const pos = tm <= te; const total = pos ? te : te - 2 * Math.PI;
    const N = 48; let prev = a;
    for (let k = 1; k <= N; k++) { const th = (total * k) / N; const p = [0, 1, 2].map((i) => cen[i] + r * (Math.cos(th) * u[i] + Math.sin(th) * w[i])); segs.push([prev, p]); prev = p; }
  }
  return segs;
}
function pickEmu(face, edges, N) {
  if (!face.plane_normal) return {};
  const n = unit3(face.plane_normal);
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const U = unit3(cross3(n, ref)); const V = cross3(n, U);
  const o = face.centroid;
  const P2 = (p) => [dot3(sub3(p, o), U), dot3(sub3(p, o), V)];
  const segs = faceLoops(face, edges).map(([a, b]) => [P2(a), P2(b)]);
  if (!segs.length) return {};
  const inside = (q) => { let c = 0; for (const [a, b] of segs) { if ((a[1] > q[1]) !== (b[1] > q[1])) { const x = a[0] + ((q[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]); if (x > q[0]) c++; } } return c % 2 === 1; };
  const distSeg = (q, [a, b]) => { const d = [b[0] - a[0], b[1] - a[1]]; const l2 = d[0] * d[0] + d[1] * d[1]; const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2)) : 0; return Math.hypot(q[0] - a[0] - t * d[0], q[1] - a[1] - t * d[1]); };
  const clear = (q) => Math.min(...segs.map((s) => distSeg(q, s)));
  const xs = segs.flatMap((s) => [s[0][0], s[1][0]]), ys = segs.flatMap((s) => [s[0][1], s[1][1]]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out = {};
  const cin = inside([0, 0]);
  out.centroid_hit = cin ? { index: face.index, dist: 0 } : { index: -1, dist: 1 };
  let best = null;
  const G = 41;
  for (let i = 0; i <= G; i++) for (let j = 0; j <= G; j++) {
    const q = [x0 + ((x1 - x0) * i) / G, y0 + ((y1 - y0) * j) / G];
    if (!inside(q)) continue; const c = clear(q); if (!best || c > best.c) best = { q, c };
  }
  if (best) { out.inner_point = [0, 1, 2].map((k) => o[k] + best.q[0] * U[k] + best.q[1] * V[k]); out.inner_hit = { index: face.index, dist: 0 }; }
  return out;
}

/** bridge-shaped topology reply for translate-p4: {ok, topology:{bodies:[{name,faces,edges}],truncated}, results} */
export async function topologyOf(cmds) {
  const m = runSC(cmds);
  if (!m.ok) return { ok: false, failed: m.failed, error: m.error };
  const names = (m.measure?.bodies ?? []).map((b) => b.name);
  const probe = [...cmds, ...names.flatMap((n) => [{ command: 'model.faces', params: { body: n } }, { command: 'model.edges', params: { body: n } }])];
  const r = cliRun(probe);
  if (!Array.isArray(r)) return { ok: false, error: r.error };
  const bodies = names.map((n, i) => {
    const faces = r[cmds.length + 2 * i]?.faces ?? []; const edges = r[cmds.length + 2 * i + 1]?.edges ?? [];
    for (const f of faces) Object.assign(f, pickEmu(f, edges));
    return { name: n, faces, edges };
  });
  return { ok: true, topology: { bodies, truncated: false }, results: r.slice(0, cmds.length) };
}

// ---------------------------------------------------------------------------------------------------------------- OCCT
const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0;
function surfaceKey(face) {
  const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
  const t = a.GetType(); const T = oc.GeomAbs_SurfaceType;
  const canon = (d) => { const s = d.find((v) => Math.abs(v) > 1e-9) < 0 ? -1 : 1; return d.map((v) => r6(v * s)); };
  try {
    if (t === T.GeomAbs_Plane) { const ax = a.Plane().Axis(); const d = [ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()]; const l = ax.Location(); const n = canon(d); return `P ${n} ${r6(n[0] * l.X() + n[1] * l.Y() + n[2] * l.Z())}`; }
    if (t === T.GeomAbs_Cylinder) { const c = a.Cylinder(); const ax = c.Axis(); const d = canon([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()]); const l = ax.Location(); const dt = d[0] * l.X() + d[1] * l.Y() + d[2] * l.Z(); const perp = [l.X() - dt * d[0], l.Y() - dt * d[1], l.Z() - dt * d[2]].map(r6); return `C ${d} ${perp} ${r6(c.Radius())}`; }
    if (t === T.GeomAbs_Cone) return 'K';
    if (t === T.GeomAbs_Sphere) { const s = a.Sphere(); const l = s.Location(); return `S ${[l.X(), l.Y(), l.Z()].map(r6)} ${r6(s.Radius())}`; }
    if (t === T.GeomAbs_Torus) { const s = a.Torus(); const l = s.Location(); return `T ${[l.X(), l.Y(), l.Z()].map(r6)} ${r6(s.MajorRadius())} ${r6(s.MinorRadius())}`; }
  } catch { /* */ }
  return `U ${Math.random()}`;
}
const TYPE_OF = { P: 'plane', C: 'cylinder', K: 'cone', S: 'sphere', T: 'torus', U: 'other' };
function surfaceClasses(fs) {
  const info = fs.map((f) => {
    const k = surfaceKey(f); const t = TYPE_OF[k[0]]; let span = 0;
    if (t === 'cylinder') { const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true); span = a.LastUParameter() - a.FirstUParameter(); }
    const edges = []; const e = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (e.More()) { edges.push(e.Current()); e.Next(); }
    return { k, t, span, edges };
  });
  const parent = info.map((_, i) => i); const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) { if (info[i].k !== info[j].k) continue; if (info[i].edges.some((a) => info[j].edges.some((b) => a.IsSame(b)))) parent[find(i)] = find(j); }
  const comp = new Map(); info.forEach((x, i) => { const r = find(i); const c = comp.get(r) ?? { t: x.t, span: 0 }; c.span += x.span; comp.set(r, c); });
  const types = {}, components = {}; let big = 0;
  for (const x of info) types[x.t] = (types[x.t] ?? 0) + 1;
  for (const c of comp.values()) { components[c.t] = (components[c.t] ?? 0) + 1; if (c.t === 'cylinder' && c.span > Math.PI + 1e-6) big++; }
  return { types, components, bigCylinderComponents: big };
}
export function faceVerdict(truckTypes, o) {
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
export function occtMeasure(shape) {
  const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const c = g.CentreOfMass(); const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(), hi = bx.CornerMax(); const fs = facesOf(oc, shape);
  return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: fs.length, ...surfaceClasses(fs) };
}

// ---------------------------------------------------------------------------------------------------------------- pipeline
export const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
export const worstArr = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));
export const lastSolid = (doc) => doc.features.filter((f) => !['sketch', 'datum'].includes(f.kind)).at(-1)?.id;
const flat = (b) => [...b[0], ...b[1]];

/** script text -> {doc (solved), errors, params, namedParams, raw} using the real interpreter. */
export function fromScript(src, values) {
  const r = rs.runScript(src, values ? { values } : {});
  if (r.errors.length) return { errors: r.errors, raw: r };
  return { errors: [], raw: r, doc: cg.solveDoc(r.doc), params: r.params, namedParams: r.namedParams };
}

/** Reference solids for a doc: OCCT (full measure) and brep-rs (volume/bbox/faces). */
export function references(doc, id = lastSolid(doc)) {
  const ref = { id };
  try {
    const built = buildDoc(oc, doc, arc);
    const shape = built.shapes.get(id);
    ref.occtRefusals = Object.fromEntries(built.refusals ?? []);
    ref.occt = shape ? occtMeasure(shape) : { refused: ref.occtRefusals[id] ?? 'no shape' };
    ref._built = built;
  } catch (e) { ref.occt = { error: String(e.message).slice(0, 300) }; }
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const s = got.shapes?.[id];
    ref.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } : { refused: got.refusals?.[id] ?? 'no shape' };
    ref.brepRefusals = got.refusals ?? {};
  } catch (e) { ref.brep = { error: String(e.message).slice(0, 300) }; }
  return ref;
}

const TOL = { planar: 1e-9, curved: 3e-4 };
const COM = { planar: 1e-6, curved: 3e-5 };

/** Run the SolidCraft path for a doc and score the final solid against the references. */
export async function scored(doc, { id = lastSolid(doc), ref = references(doc, id) } = {}) {
  const t0 = Date.now();
  // Round 3: globalThis.__R3_TRANSLATE (set by r3-run-sec.mjs) swaps in the guarded + plain-sentence translator (r3-guard.mjs) for every script that scores through here.
  const tr = await (globalThis.__R3_TRANSLATE ?? translateDoc)(doc, { arc, mt, runSC, topologyOf, soups: {} });
  const row = { id, ms: Date.now() - t0, features: tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, raw: f.rawRefusal, pick: f.pick, evidence: f.evidence ? { name: f.evidence.name, rule: f.evidence.rule, engineFace: f.evidence.engineFace, engineEdges: f.evidence.engineEdges, target: f.evidence.target ? { candidates: f.evidence.target.candidates, face: f.evidence.target.face, edges: f.evidence.target.edges, pickSource: f.evidence.target.pickSource } : undefined, checks: f.evidence.checks } : undefined })), commands: tr.commands, ref: { occt: ref.occt, brep: ref.brep, occtRefusals: ref.occtRefusals, brepRefusals: ref.brepRefusals } };
  row.unmapped = tr.unmapped;
  row.refusals = Object.fromEntries(tr.features.filter((f) => f.status === 'refused').map((f) => [f.id, f.refusal]));
  const mf = tr.features.find((f) => f.id === id);
  row._tr = tr;
  if (!mf || mf.status !== 'built') { row.outcome = 'REFUSED'; row.sentence = mf?.refusal ?? `${id} was not built`; return row; }
  const m = mf.measure; const o = ref.occt;
  row.truck = { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, faceTypes: m.faceTypes, curved: m.curved, bodies: m.bodies.length };
  const nRef = (k) => Object.keys(ref[k] ?? {}).length;
  const occtOK = o && !o.refused && !o.error && nRef('occtRefusals') === 0;
  const brepOK = ref.brep && ref.brep.volume !== undefined && nRef('brepRefusals') === 0;
  row.refs = { occtOK: !!occtOK, brepOK: !!brepOK, occtRefusals: ref.occtRefusals, brepRefusals: ref.brepRefusals };
  if (!occtOK && !brepOK) { row.outcome = 'NO-REFERENCE'; row.note = `no valid independent reference (OCCT: ${o?.refused ?? o?.error ?? JSON.stringify(ref.occtRefusals)}; brep-rs: ${ref.brep?.refused ?? ref.brep?.error ?? JSON.stringify(ref.brepRefusals)})`; return row; }
  if (!occtOK) {
    const b = ref.brep; const k2 = m.curved ? 'curved' : 'planar';
    const dVol = rel(m.volume, b.volume); const dBbox = worstArr(m.bbox, b.bbox);
    row.score = { dVol, dBbox, dCom: null, tol: TOL[k2], faces: { occt: null, truck: m.faces, brep: b.faces }, reference: 'brep-rs (OCCT refused or no-opped a feature)' };
    row.outcome = Math.max(dVol, dBbox) <= TOL[k2] ? 'PASS' : 'FAIL';
    return row;
  }
  const diag = Math.max(Math.hypot(o.bbox[3] - o.bbox[0], o.bbox[4] - o.bbox[1], o.bbox[5] - o.bbox[2]), 1);
  const k = m.curved ? 'curved' : 'planar';
  const dVol = rel(m.volume, o.volume); const dBbox = worstArr(m.bbox, o.bbox);
  const dCom = Math.max(...m.com.map((v, i) => Math.abs(v - o.com[i]))) / diag;
  const fv = faceVerdict(m.faceTypes, o);
  row.score = { dVol, dBbox, dCom, tol: TOL[k], comTol: COM[k], faces: { occt: o.faces, truck: m.faces, brep: ref.brep?.faces ?? null, verdict: fv.ok ? 'explained' : 'UNEXPLAINED', keys: fv.keys }, reference: 'OCCT' };
  row.outcome = Math.max(dVol, dBbox) <= TOL[k] && dCom <= COM[k] && fv.ok ? 'PASS' : 'FAIL';
  if (brepOK) { row.score.brepVsOcct = rel(ref.brep.volume, o.volume); if (row.score.brepVsOcct > 1e-4) row.score.refsDisagree = true; }
  return row;
}

/** Negative control: re-run the accepted commands with the consumer's pick point mirrored through the part centre. */
export function mirrorControl(row, consumerId, ref) {
  const f = row._tr.features.find((x) => x.id === consumerId && x.status === 'built');
  if (!f) return { skipped: 'consumer not built' };
  const o = (ref.occt && !ref.occt.refused && Object.keys(ref.occtRefusals ?? {}).length === 0) ? ref.occt : (ref.brep?.bbox ? { bbox: ref.brep.bbox, volume: ref.brep.volume, com: null } : null); if (!o) return { skipped: 'no reference to score a control against' }; const bc = [0, 1, 2].map((i) => (o.bbox[i] + o.bbox[i + 3]) / 2);
  const cmds = JSON.parse(JSON.stringify(row.commands));
  const idx = cmds.findIndex((c) => JSON.stringify(c) === JSON.stringify(f.commands.find((x) => x.params?.edges || x.params?.faces)));
  if (idx < 0) return { skipped: 'pick command not found' };
  const p = cmds[idx].params; const key = p.edges ? 'edges' : 'faces';
  p[key] = p[key].map((q) => q.map((v, i) => 2 * bc[i] - v));
  const res = runSC(cmds);
  if (!res.ok) return { refused: `${res.failed?.command}: ${res.failed?.error}` };
  const b = res.measure.bodies.find((x) => f.measure.bodies.includes(x.name));
  if (!b) return { skipped: 'no body' };
  const diag = Math.max(Math.hypot(o.bbox[3] - o.bbox[0], o.bbox[4] - o.bbox[1], o.bbox[5] - o.bbox[2]), 1);
  const dCom = o.com ? Math.max(...b.center_of_mass.map((v, i) => Math.abs(v - o.com[i]))) / diag : null;
  return { dVol: rel(b.volume_mm3, o.volume), dCom, rejected: (dCom !== null && dCom >= 10 * COM.planar) || rel(b.volume_mm3, o.volume) > 1e-6, byCom: dCom !== null };
}

export const sci = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
export function brief(r) {
  if (r.outcome === 'REFUSED') return `REFUSED: ${r.sentence}`;
  if (!r.score) return `${r.outcome} ${r.note ?? ''}`;
  const s = r.score;
  return `${r.outcome}[${s.reference}] V=${r.truck.volume.toFixed(6)} (OCCT ${r.ref.occt?.volume?.toFixed(6)}${r.ref.brep?.volume !== undefined ? `, brep ${r.ref.brep.volume.toFixed(6)}` : ''}) dVol ${sci(s.dVol)} dBbox ${sci(s.dBbox)} dCOM ${sci(s.dCom)} faces occt/truck/brep ${s.faces.occt}/${s.faces.truck}/${s.faces.brep}${s.refsDisagree ? ' REFS-DISAGREE ' + sci(s.brepVsOcct) : ''}`;
}
export const strip = (r) => { const { _tr, ...rest } = r; return rest; };
