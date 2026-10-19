#!/usr/bin/env node
// SPIKE (phase 4), referee only. Scores the BROWSER-side name resolution (resolve-names.mjs, run inside the real page
// against the real solidcraft bridge build) against live OCCT and live brep-rs, for every named-reference fixture:
//   1. PICKS: the point the page picked for a name vs brep-rs `resolve` and OCCT `resolveName`. The point must lie on the
//      OCCT edge / face the name means (BRepExtrema distance); brep-rs's centroid is compared too (it is the centre for a
//      closed circle, which is not a point on the edge).
//   2. SOLIDS: what solidcraft built from the browser's pick vs the live OCCT solid: volume, bbox, centre of mass,
//      per-type face counts, at the phase 0 bars. Asymmetric fixtures also run a NEGATIVE CONTROL (the opposite edge /
//      face), which must produce a different solid that the same score rejects.
//   node docs/spikes/solidcraft-referee/phase4/verify-picks.mjs [--url=http://127.0.0.1:8796/] [--only=id,id]
// Needs run.sh serving, `npm run build`, packages/brep-rs/pkg, and a playwright-cli session `spike` (run from any cwd
// outside the repo: playwright-cli drops .playwright-cli/ into its cwd). Not a gate, not in npm test.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { asymFixtures } from '../phase0/asym-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const URL_ = arg('url', 'http://127.0.0.1:8796/');
const only = arg('only', '').split(',').filter(Boolean);
const S = '-s=spike';
const pw = (...a) => execFileSync('playwright-cli', [S, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: process.env.PW_CWD ?? process.cwd() });
const evalJson = (fn) => {
  const out = pw('eval', fn);
  const m = out.match(/### Result\n([\s\S]*?)\n### /);
  if (!m) throw new Error('no result: ' + out.slice(0, 400));
  const v = JSON.parse(m[1]);
  return typeof v === 'string' ? JSON.parse(v) : v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf, resolveName } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { fixtures } = await load('scripts/brep-parity-fixtures.mjs');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const TOL = { planar: 1e-9, curved: 3e-4 };
const COM_TOL = 1e-6; // x bbox diagonal (phase 0)
const COM_TOL_TESS = 3e-5;
const PICK_TOL = 1e-6; // mm
const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const worstArr = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));

// ---- OCCT ----------------------------------------------------------------------------------------------------
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
  return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: fs.length, ...surfaceClasses(fs) };
}
/** distance from a point to an OCCT face / edge */
function distTo(part, p) {
  const v = new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt(p[0], p[1], p[2])).Vertex();
  const d = new oc.BRepExtrema_DistShapeShape();
  d.LoadS1(v);
  d.LoadS2(part);
  d.Perform(new oc.Message_ProgressRange());
  return d.IsDone() ? d.Value() : Infinity;
}
function occtCentroid(part, isEdge) {
  const g = new oc.GProp_GProps();
  if (isEdge) oc.BRepGProp.LinearProperties(part, g, false, false); else oc.BRepGProp.SurfaceProperties(part, g, false, false);
  const c = g.CentreOfMass();
  return [c.X(), c.Y(), c.Z()];
}

// ---- the fixtures with a named reference -----------------------------------------------------------------------
const nameOf = (f) => (f.kind === 'fillet' ? f.edge : f.kind === 'shell' ? f.open : f.kind === 'draft' ? f.face : null);
const wantOf = (f) => (f.kind === 'fillet' ? 'edge' : 'face');
const all = [];
for (const fx of fixtures()) {
  const d = fx.doc(mt);
  const named = d.features.filter((f) => nameOf(f));
  const hasResolve = !!fx.resolve;
  if (!named.length && !hasResolve) continue;
  all.push({ id: fx.id, kind: fx.kind, tol: fx.tol, features: d.features, measure: fx.measure ?? d.measure, names: [...named.map((f) => ({ by: f.id, name: nameOf(f), want: wantOf(f), prefixLen: d.features.indexOf(f) })), ...(hasResolve ? [{ by: '(resolve)', name: fx.resolve, want: fx.resolve.kind === 'edge' ? 'edge' : 'face', prefixLen: d.features.length }] : [])] });
}
for (const fx of asymFixtures()) {
  if (!fx.pickOf) continue;
  const f = fx.features.find((x) => x.id === fx.pickOf);
  all.push({ id: fx.id, kind: fx.kind, tol: fx.tol, features: fx.features, measure: fx.measure, pickOf: fx.pickOf, asym: true, names: [{ by: f.id, name: nameOf(f), want: wantOf(f), prefixLen: fx.features.indexOf(f) }] });
}
// pick-bearing extras the parity file has no resolve for (the pocket-wall and carried-through-cut names the script API writes)
const OPPOSITE = { '+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y', '+z': '-z', '-z': '+z' };
const flipName = (n) => JSON.parse(JSON.stringify(n), (k, v) => v);
function oppositeOf(n) {
  const c = flipName(n);
  const go = (x) => { if (x.cause === 'primitive' && OPPOSITE[x.part]) x.part = OPPOSITE[x.part]; if (x.of) (Array.isArray(x.of) ? x.of : [x.of]).forEach(go); };
  go(c);
  return c;
}

// ---- drive the page --------------------------------------------------------------------------------------------
try { pw('open', URL_); } catch { pw('goto', URL_); }
pw('resize', '1400', '1000');
await sleep(4000);
const inPage = (doc, names) => evalJson(`async () => JSON.stringify(await window.__host.translateRaw(${JSON.stringify(doc)}, ${JSON.stringify(names)}))`);

const rows = [];
for (const fx of all) {
  if (only.length && !only.includes(fx.id)) continue;
  const doc = { version: 1, features: fx.features };
  let built = null; let occt = null;
  try { built = buildDoc(oc, doc, arc); const sh = built.shapes.get(fx.measure); if (sh) occt = occtMeasure(sh); } catch (e) { /* recorded below */ }
  // OCCT can silently no-op a shell/fillet (returns the un-hollowed body). Detect it: then there is NO reference, not a match.
  let occtNoOp = null;
  const mfeat = fx.features.find((x) => x.id === fx.measure);
  if (occt && mfeat?.target && built?.shapes.get(mfeat.target)) {
    const tv = occtMeasure(built.shapes.get(mfeat.target)).volume;
    if (Math.abs(tv - occt.volume) <= 1e-9 * Math.max(1, tv)) occtNoOp = { targetVolume: tv };
  }
  let brepM = null;
  try { const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))); brepM = m.shapes?.[fx.measure] ?? { refused: m.refusals?.[fx.measure] }; } catch (e) { brepM = { refused: e.message }; }
  let page;
  try { page = inPage(doc, fx.names.map((n) => ({ name: n.name, want: n.want, target: n.by !== '(resolve)' ? (fx.features.find((x) => x.id === n.by)?.target ?? null) : null, before: n.by !== '(resolve)' ? n.by : null }))); } catch (e) { rows.push({ id: fx.id, error: String(e.message).slice(0, 300) }); console.log(fx.id.padEnd(28), 'ERROR', String(e.message).slice(0, 160)); continue; }
  const row = { id: fx.id, asym: !!fx.asym, names: [], solid: null };
  fx.names.forEach((n, i) => {
    const prefix = fx.features.slice(0, n.prefixLen);
    const pr = page.resolved[i];
    const nameRow = { by: n.by, name: n.name, browser: pr.ok ? { kind: pr.kind, point: pr.point, evidence: pr.evidence } : { refused: pr.sentence } };
    // OCCT
    let part = null; let o = null;
    try {
      const bt = buildDoc(oc, { version: 1, features: prefix }, arc);
      part = resolveName(oc, n.name, bt);
    } catch (e) { nameRow.occtError = e.message; }
    if (part) o = { centroid: occtCentroid(part, n.want === 'edge') };
    // brep-rs
    let b = null;
    try { b = JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(n.name))); } catch { /* null */ }
    nameRow.occt = o ? { centroid: o.centroid } : null;
    nameRow.brep = b ? { kind: b.kind, centroid: b.centroid } : null;
    if (pr.ok && part) {
      nameRow.distBrowserToOcct = distTo(part, pr.point);
      nameRow.onSameOcctEntity = nameRow.distBrowserToOcct <= PICK_TOL;
    }
    if (b && part) {
      nameRow.distBrepToOcct = distTo(part, b.centroid);
      nameRow.brepCentroidIsOcctCentroid = Math.max(...b.centroid.map((v, k) => Math.abs(v - o.centroid[k]))) <= 1e-6;
    }
    if (pr.ok && b) nameRow.browserEqualsBrepCentroid = Math.max(...b.centroid.map((v, k) => Math.abs(v - pr.point[k]))) <= 1e-6;
    row.names.push(nameRow);
  });
  // the solid solidcraft built from the browser's picks
  const mf = page.features.find((f) => f.id === fx.measure);
  if (mf && mf.status === 'built' && occt && occtNoOp) {
    row.solid = { noReference: `OCCT returned the un-modified target volume ${occtNoOp.targetVolume} for ${fx.measure}: a no-op, so there is no reference to score against`, volume: mf.measure.volume };
  } else if (mf && mf.status === 'built' && occt) {
    const m = mf.measure;
    const diag = Math.max(Math.hypot(occt.bbox[3] - occt.bbox[0], occt.bbox[4] - occt.bbox[1], occt.bbox[5] - occt.bbox[2]), 1);
    const t = m.curved ? TOL.curved : TOL.planar;
    const dVol = rel(m.volume, occt.volume);
    const dBbox = worstArr(m.bbox, occt.bbox);
    const dCom = Math.max(...m.com.map((v, i) => Math.abs(v - occt.com[i]))) / diag;
    const fv = faceVerdict(m.faceTypes, occt);
    const comTol = m.curved && !fx.asym ? COM_TOL_TESS : COM_TOL;
    row.solid = { volume: m.volume, occtVolume: occt.volume, faces: m.faces, occtFaces: occt.faces, faceTypes: m.faceTypes, occtTypes: occt.types, faceKeys: fv.keys, faceOk: fv.ok, dVol, dBbox, dCom, tol: t, comTol, brepVolume: brepM?.volume ?? null, pass: Math.max(dVol, dBbox) <= t && dCom <= comTol && fv.ok };
  } else row.solid = { notBuilt: mf?.refusal ?? `${fx.measure} not built (${mf?.status ?? 'absent'})`, occtBuilt: !!occt };
  // negative control: the OPPOSITE name must give a solid the same score rejects
  if (fx.asym) {
    const ctlFeatures = fx.features.map((f) => (f.id === fx.pickOf ? { ...f, ...(f.edge ? { edge: oppositeOf(f.edge) } : f.open ? { open: oppositeOf(f.open) } : { face: oppositeOf(f.face) }) } : f));
    const cp = inPage({ version: 1, features: ctlFeatures }, []);
    const cf = cp.features.find((f) => f.id === fx.measure);
    if (cf?.status === 'built' && occt) {
      const m = cf.measure;
      const diag = Math.max(Math.hypot(occt.bbox[3] - occt.bbox[0], occt.bbox[4] - occt.bbox[1], occt.bbox[5] - occt.bbox[2]), 1);
      const t = m.curved ? TOL.curved : TOL.planar;
      const dVol = rel(m.volume, occt.volume);
      const dBbox = worstArr(m.bbox, occt.bbox);
      const dCom = Math.max(...m.com.map((v, i) => Math.abs(v - occt.com[i]))) / diag;
      const pass = Math.max(dVol, dBbox) <= t && dCom <= COM_TOL;
      row.control = { name: ctlFeatures.find((f) => f.id === fx.pickOf).edge ?? ctlFeatures.find((f) => f.id === fx.pickOf).open ?? ctlFeatures.find((f) => f.id === fx.pickOf).face, dVol, dBbox, dCom, scorePasses: pass, rejected: !pass && dCom >= 10 * COM_TOL };
    } else row.control = { refused: cf?.refusal ?? 'not built', rejected: true };
  }
  rows.push(row);
  const pickBits = row.names.map((n) => (n.browser.refused ? 'REFUSED' : `${n.onSameOcctEntity ? 'on-OCCT' : 'OFF-OCCT'}${n.browserEqualsBrepCentroid ? '=brep' : '~brep'}`)).join(',');
  const s = row.solid;
  console.log(fx.id.padEnd(28), pickBits.padEnd(22), s?.notBuilt ? `no solid: ${s.notBuilt}`.slice(0, 120) : `dVol ${s?.dVol?.toExponential(1)} dBbox ${s?.dBbox?.toExponential(1)} dCom ${s?.dCom?.toExponential(1)} faces ${s?.faces}/${s?.occtFaces} ${s?.pass ? 'PASS' : 'FAIL'}`, row.control ? ` | control ${row.control.rejected ? 'REJECTED' : 'NOT REJECTED'} (dCom ${row.control.dCom?.toExponential(1) ?? '-'})` : '');
}
writeFileSync(path.join(HERE, 'picks-results.json'), JSON.stringify({ url: URL_, generatedAt: new Date().toISOString(), rows }, null, 1) + '\n');
const named = rows.flatMap((r) => (r.names ?? []).map((n) => ({ id: r.id, ...n })));
const resolved = named.filter((n) => !n.browser.refused);
console.log(`\nnames: ${named.length}, resolved in the browser ${resolved.length}, refused ${named.length - resolved.length}`);
console.log(`on the OCCT entity (<= ${PICK_TOL} mm): ${resolved.filter((n) => n.onSameOcctEntity).length}/${resolved.length}; equals brep-rs centroid: ${resolved.filter((n) => n.browserEqualsBrepCentroid).length}/${resolved.length}`);
