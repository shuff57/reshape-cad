// SPIKE, referee only (GUARD-DRAFT-PULL, 2026-11-08). Every draft doc of every host-route corpus (dumped by dump-drafts.mjs) re-scored against a
// CORRECTED OCCT referee and an exact polyhedron. The referee files (occt-build.ts, topo-history.ts) are NOT edited.
//
//   WT=<tree> SOLIDCRAFT_REFEREE_PKG=<pkg> node dp-oracle.mjs <dump dir> <sweep root> > dp-raw.json
//
// The referee's two draft defects (GUARD-SD-WHOLEBODY.md section 3):
//   (1) the Body Draft (`whole`) drafts face by face with face handles of the UNDRAFTED shape; a neighbour of a drafted face is skipped silently;
//   (2) drafted() puts the neutral plane through (0, 0, neutral) for every pull, so a pull along x or y drafts about x = 0 or y = 0.
// References, per row:
//   occtBug    the referee as it is (buildDoc on the plain OCCT instance): what the live probe and the stored runs used;
//   occtFixed  the SAME buildDoc, handed a proxy of the OCCT instance whose BRepOffsetAPI_DraftAngle (a) puts the neutral plane through
//              neutral * pull (the right point for the pull), and (b) finds a face of the undrafted shape again in the current one by its surface.
//              Every feature after the draft (hollow, hole...) is then built by the referee on the corrected draft;
//   occtOne    when the draft is the measured feature: the prefix through the referee, then ONE DraftAngle with every face the draft tilts (whole: every
//              face parallel to the pull, planes and cylinders; face draft: the referee's own single call, i.e. occtFixed);
//   poly       exact geometry, no kernel solve: the undrafted solid's planes (read off the referee's PREFIX build, which no draft touches; checked convex
//              and complete by re-measuring them), drafted by turning each tilted plane about its line on the neutral plane, a hollow as the planes
//              moved in by the wall (open face kept), measured by vertex enumeration + the divergence theorem; a non-convex top-plane outline pulled along z
//              by the mitre polyhedron (sd-wholebody-evidence/sdw-oracle.mjs); a cylinder by the frustum's closed form (volume, COM, box);
//   brep       brep-rs live (it drafts an axis-aligned box only).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WT = process.env.WT; if (!WT) { console.error('FATAL: WT unset'); process.exit(2); }
const [DUMP, SWEEPS] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(p).href);
const CONTRACT = path.join(WT, 'docs/spikes/solidcraft-referee/contract');
const C = await imp(path.join(CONTRACT, 'sketch-geometry-harness/sg-core.mjs'));
const { buildDoc } = await imp(path.join(WT, 'packages/brep-adapter/dist/occt-build.js'));
const { facesOf } = await imp(path.join(WT, 'packages/brep-adapter/dist/topo-resolve.js'));
const oc = C.oc;
const SIGMA = -1;
const AXV = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);

// ---- surfaces ---------------------------------------------------------------------------------------------------------------------------------------------
function surf(face) {
  const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true); const T = oc.GeomAbs_SurfaceType; const t = a.GetType();
  if (t === T.GeomAbs_Plane) { const ax = a.Plane().Axis(); const d = ax.Direction(); const l = ax.Location(); const n = [d.X(), d.Y(), d.Z()]; return { kind: 'plane', n, d: dot(n, [l.X(), l.Y(), l.Z()]) }; }
  if (t === T.GeomAbs_Cylinder) { const c = a.Cylinder(); const ax = c.Axis(); const d = ax.Direction(); const l = ax.Location(); return { kind: 'cyl', dir: [d.X(), d.Y(), d.Z()], loc: [l.X(), l.Y(), l.Z()], r: c.Radius() }; }
  return { kind: 'other' };
}
const sameSurf = (p, q) => {
  if (p.kind !== q.kind) return false;
  if (p.kind === 'plane') return [1, -1].some((s) => Math.abs(s * p.d - q.d) < 1e-7 && p.n.every((v, i) => Math.abs(s * v - q.n[i]) < 1e-9));
  if (p.kind === 'cyl') { const par = Math.abs(Math.abs(dot(p.dir, q.dir)) - 1) < 1e-9; const off = sub(p.loc, q.loc); const perp = crs(off, p.dir); return par && Math.abs(p.r - q.r) < 1e-7 && Math.hypot(...perp) < 1e-7; }
  return false;
};

// ---- the corrected referee: a proxy of the OCCT instance -----------------------------------------------------------------------------------------------------
const stat = { neutralMoved: 0, faceReFound: 0, faceNotFound: 0 };
class DraftAngleFixed {
  constructor(shape) { this.shape = shape; this.adds = []; }
  Add(face, dir, angle, plane, ...rest) { this.adds.push({ face, dir, angle, plane, rest }); }
  Build(pr) {
    const real = new oc.BRepOffsetAPI_DraftAngle(this.shape);
    const cur = facesOf(oc, this.shape);
    for (const a of this.adds) {
      let f = a.face;
      if (!cur.some((g) => g.IsSame(f))) {
        const s = surf(f); const g = cur.find((h) => sameSurf(surf(h), s));
        if (g) { f = g; stat.faceReFound++; } else stat.faceNotFound++;
      }
      // the referee's plane is gp_Pln(gp_Pnt(0, 0, neutral), pull): move it to neutral * pull
      const p = [a.dir.X(), a.dir.Y(), a.dir.Z()]; const L = a.plane.Location(); const neutral = L.Z();
      let pl = a.plane;
      if (Math.abs(p[2]) < 1 - 1e-12) { pl = new oc.gp_Pln(new oc.gp_Pnt(p[0] * neutral, p[1] * neutral, p[2] * neutral), a.dir); stat.neutralMoved++; }
      real.Add(oc.TopoDS.Face(f), a.dir, a.angle, pl, ...a.rest);
    }
    real.Build(pr); this.real = real;
  }
  IsDone() { return this.real.IsDone(); }
  Shape() { return this.real.Shape(); }
}
const ocFixed = new Proxy(oc, { get: (t, k) => (k === 'BRepOffsetAPI_DraftAngle' ? DraftAngleFixed : t[k]) });

function solidsCom(shape) {
  const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); let V = 0; const c = [0, 0, 0];
  for (; ex.More(); ex.Next()) { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(ex.Current(), g, 1e-7, false, false); const m = g.Mass(); const p = g.CentreOfMass(); V += m; c[0] += m * p.X(); c[1] += m * p.Y(); c[2] += m * p.Z(); }
  return V > 0 ? c.map((x) => x / V) : null;
}
const meas = (shape) => { const m = C.occtMeasure(shape); return { volume: m.volume, bbox: m.bbox, com: solidsCom(shape) ?? m.com, faces: m.faces, solids: m.solids }; };
function occtRun(o, doc, id) {
  try {
    const b = buildDoc(o, doc, C.arc); const rf = b.refusals?.get?.(id) ?? b.refusals?.[id];
    if (rf) return { refused: String(rf).slice(0, 300) };
    const s = b.shapes.get(id); return s ? meas(s) : { refused: 'OCCT built nothing' };
  } catch (e) { return { refused: 'OCCT threw: ' + String(e?.message ?? e).slice(0, 200) }; }
}
function prefixShape(doc, draft) {
  const i = doc.features.findIndex((f) => f.id === draft.id);
  const b = buildDoc(oc, { ...doc, features: doc.features.slice(0, i) }, C.arc);
  return b.shapes.get(draft.target) ?? null;
}
const oneShape = {};
function occtOne(doc, draft) {
  try {
    const src = prefixShape(doc, draft); if (!src) return { refused: 'no prefix shape' };
    const p = AXV[draft.pull ?? 'z'];
    const fs = facesOf(oc, src).filter((f) => { const s = surf(f); return (s.kind === 'plane' && Math.abs(dot(s.n, p)) < 1e-9) || (s.kind === 'cyl' && Math.abs(Math.abs(dot(s.dir, p)) - 1) < 1e-9); });
    const dr = new oc.BRepOffsetAPI_DraftAngle(src);
    const pl = new oc.gp_Pln(new oc.gp_Pnt(p[0] * draft.neutral, p[1] * draft.neutral, p[2] * draft.neutral), new oc.gp_Dir(...p));
    for (const f of fs) dr.Add(oc.TopoDS.Face(f), new oc.gp_Dir(...p), draft.angle * Math.PI / 180, pl);
    dr.Build(new oc.Message_ProgressRange());
    if (!dr.IsDone()) return { refused: 'DraftAngle not done' };
    const shape = dr.Shape(); Object.defineProperty(oneShape, 'last', { value: shape, configurable: true, writable: true });
    return { ...meas(shape), tilted: fs.length };
  } catch (e) { return { refused: 'threw ' + String(e?.message ?? e).slice(0, 200) }; }
}

// occtChain: a hollow (open face by its word) right after a draft (whole or face), built directly: the one-call drafted solid, then MakeThickSolidByJoin with the
// face whose outward normal is the word's (the referee's own call, GeomAbs_Arc, Skin), so its name resolution on a drafted part is not used
const WORDN = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
function occtChain(doc, draft, measureId) {
  const fs = doc.features; const i = fs.findIndex((f) => f.id === draft.id); const later = fs.slice(i + 1);
  if (!(later.length === 1 && later[0].kind === 'shell' && later[0].id === measureId && later[0].open?.cause === 'primitive' && WORDN[later[0].open.part])) return null;
  try {
    // the drafted solid: one DraftAngle for a whole draft; for a face draft, the corrected referee's own single call (the doc cut after the draft)
    let D;
    if (draft.whole) { const d = occtOne(doc, draft); if (d.refused) return { refused: 'draft: ' + d.refused }; D = oneShape.last; }
    else { const b = buildDoc(ocFixed, { ...doc, features: fs.slice(0, i + 1) }, C.arc); const rf = b.refusals?.get?.(draft.id) ?? b.refusals?.[draft.id]; if (rf) return { refused: 'draft: ' + rf }; D = b.shapes.get(draft.id); if (!D) return { refused: 'no draft shape' }; } const com = meas(D).com; const w = WORDN[later[0].open.part];
    let best = null, bv = -2;
    for (const f of facesOf(oc, D)) { const q = surf(f); if (q.kind !== 'plane') continue; let n = q.n; if (dot(n, com) > q.d) n = n.map((v) => -v); const v = dot(n, w); if (v > bv) { bv = v; best = f; } }
    if (!best || bv < 0.5) return { refused: 'no face for the open word' };
    const op = new oc.BRepOffsetAPI_MakeThickSolid(); const L = new oc.NCollection_List_TopoDS_Shape(); L.Append(best);
    op.MakeThickSolidByJoin(D, L, -later[0].thickness, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false);
    op.Build(new oc.Message_ProgressRange()); if (!op.IsDone()) return { refused: 'MakeThickSolid not done' };
    return meas(op.Shape());
  } catch (e) { return { refused: 'threw ' + String(e?.message ?? e).slice(0, 200) }; }
}

// ---- exact polyhedra ------------------------------------------------------------------------------------------------------------------------------------------
function polytope(planes) {
  const sc = Math.max(1, ...planes.map((p) => Math.abs(p.d))); const tol = 1e-9 * sc; const V = [];
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) for (let k = j + 1; k < planes.length; k++) {
    const [a, b, c] = [planes[i], planes[j], planes[k]]; const bc = crs(b.n, c.n); const det = dot(a.n, bc); if (Math.abs(det) < 1e-12) continue;
    const x = [0, 1, 2].map((q) => (a.d * bc[q] + b.d * crs(c.n, a.n)[q] + c.d * crs(a.n, b.n)[q]) / det);
    if (planes.every((p) => dot(p.n, x) <= p.d + tol) && !V.some((v) => Math.hypot(...sub(v, x)) < 1e-9 * sc)) V.push(x);
  }
  if (V.length < 4) return null;
  const mn = [0, 1, 2].map((q) => Math.min(...V.map((v) => v[q]))); const mx = [0, 1, 2].map((q) => Math.max(...V.map((v) => v[q])));
  const o = mn.map((v, q) => (v + mx[q]) / 2); let vol = 0; const c = [0, 0, 0]; let faces = 0;
  for (const p of planes) {
    const on = V.filter((v) => Math.abs(dot(p.n, v) - p.d) < tol); if (on.length < 3) continue; faces++;
    const g = on.reduce((s, v) => s.map((w, q) => w + v[q] / on.length), [0, 0, 0]);
    const u = nrm(sub(on[0], g)); const w = crs(p.n, u);
    on.sort((A, B) => Math.atan2(dot(sub(A, g), w), dot(sub(A, g), u)) - Math.atan2(dot(sub(B, g), w), dot(sub(B, g), u)));
    for (let t = 1; t < on.length - 1; t++) {
      const [A, B, D] = [on[0], on[t], on[t + 1]].map((v) => sub(v, o));
      const v6 = dot(A, crs(B, D)) / 6; vol += v6; for (let q = 0; q < 3; q++) c[q] += v6 * (A[q] + B[q] + D[q]) / 4;
    }
  }
  return { volume: vol, com: c.map((v, q) => v / vol + o[q]), bbox: [...mn, ...mx], faces };
}
// a drafted plane: turned about its line {on the face, pull coordinate = neutral}; n' = n cos a - sigma p sin a (shell-draft convention, sigma = -1)
const draftPl = (pl, p, neutral, deg) => { const a = deg * Math.PI / 180; const n = nrm(pl.n.map((v, q) => v * Math.cos(a) - SIGMA * p[q] * Math.sin(a))); const x0 = pl.n.map((v, q) => v * pl.d + p[q] * neutral); return { n, d: dot(n, x0) }; };
const WORDV = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
function prefixPlanes(src) {
  const m = meas(src); const ins = m.com; const out = [];
  for (const f of facesOf(oc, src)) {
    const s = surf(f); if (s.kind !== 'plane') return { why: 'curved face in the undrafted solid' };
    let { n, d } = s; if (dot(n, ins) > d) { n = n.map((v) => -v); d = -d; }
    if (!out.some((q) => Math.abs(q.d - d) < 1e-9 && q.n.every((v, i) => Math.abs(v - n[i]) < 1e-12))) out.push({ n, d });
  }
  const P = polytope(out);
  if (!P || rel(P.volume, m.volume) > 1e-9) return { why: `the undrafted solid is not the convex polytope of its planes (polytope ${P?.volume} vs ${m.volume})` };
  return { planes: out, base: P };
}
function mitre(poly, dOut) {
  const n = poly.length; const sg = Math.sign(poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0)) || 1;
  const L = poly.map((p, i) => { const q = poly[(i + 1) % n]; const e = [q[0] - p[0], q[1] - p[1]]; const l = Math.hypot(...e); const nn = [sg * e[1] / l, -sg * e[0] / l]; return { n: nn, c: nn[0] * p[0] + nn[1] * p[1] + dOut, dir: [e[0] / l, e[1] / l] }; });
  const vs = poly.map((_, i) => { const a = L[(i + n - 1) % n], b = L[i]; const det = a.n[0] * b.n[1] - a.n[1] * b.n[0]; return [(a.c * b.n[1] - b.c * a.n[1]) / det, (a.n[0] * b.c - b.n[0] * a.c) / det]; });
  let ok = true; for (let i = 0; i < n; i++) { const p = vs[i], q = vs[(i + 1) % n]; if ((q[0] - p[0]) * L[i].dir[0] + (q[1] - p[1]) * L[i].dir[1] <= 1e-9) ok = false; }
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const X = (p1, p2, p3, p4) => cr(p3, p4, p1) * cr(p3, p4, p2) < 0 && cr(p1, p2, p3) * cr(p1, p2, p4) < 0;
  for (let i = 0; i < n && ok; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (X(vs[i], vs[(i + 1) % n], vs[j], vs[(j + 1) % n])) { ok = false; break; } }
  return { vs, ok, sg };
}
function mitrePoly(pts, z0, z1, neutral, deg) {
  const t = SIGMA * Math.tan(deg * Math.PI / 180);
  for (let k = 0; k <= 64; k++) { const z = z0 + (z1 - z0) * k / 64; if (!mitre(pts, t * (z - neutral)).ok) return { vanish: true }; }
  const B = mitre(pts, t * (z0 - neutral)); const T = mitre(pts, t * (z1 - neutral));
  const b3 = B.vs.map(([x, y]) => [x, y, z0]); const t3 = T.vs.map(([x, y]) => [x, y, z1]); const all = [...b3, ...t3];
  const mn = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]))); const mx = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k]))); const o = mn.map((v, k) => (v + mx[k]) / 2);
  const n = pts.length; const tris = []; const T3 = (a, b, c) => tris.push(B.sg > 0 ? [a, b, c] : [a, c, b]);
  for (let i = 1; i < n - 1; i++) { T3(b3[0], b3[i + 1], b3[i]); T3(t3[0], t3[i], t3[i + 1]); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T3(b3[i], b3[j], t3[j]); T3(b3[i], t3[j], t3[i]); }
  let V = 0; const c = [0, 0, 0];
  for (const tr of tris) { const [a, b, d] = tr.map((p) => sub(p, o)); const v = dot(a, crs(b, d)) / 6; V += v; for (let k = 0; k < 3; k++) c[k] += v * (a[k] + b[k] + d[k]) / 4; }
  return { volume: V, com: c.map((v, k) => v / V + o[k]), bbox: [...mn, ...mx], faces: n + 2 };
}
function frustum(src, draft) {
  const m = meas(src); const [x0, y0, z0, x1, y1, z1] = m.bbox; const R = (x1 - x0) / 2; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (Math.abs((y1 - y0) / 2 - R) > 1e-7 || rel(m.volume, Math.PI * R * R * (z1 - z0)) > 1e-6) return { why: 'not an upright cylinder' };
  const t = SIGMA * Math.tan(draft.angle * Math.PI / 180); const r = (z) => R + t * (z - draft.neutral);
  if (r(z0) <= 0 || r(z1) <= 0) return { vanish: true };
  // integrals of pi r(z)^2 and z pi r(z)^2 by 5-point Gauss-Legendre (exact for these polynomials of degree <= 3)
  const G = [[0, 128 / 225], [Math.sqrt(5 - 2 * Math.sqrt(10 / 7)) / 3, (322 + 13 * Math.sqrt(70)) / 900], [Math.sqrt(5 + 2 * Math.sqrt(10 / 7)) / 3, (322 - 13 * Math.sqrt(70)) / 900]];
  let V = 0, Mz = 0; const h = (z1 - z0) / 2, mid = (z0 + z1) / 2;
  for (const [x, w] of G) for (const s of x ? [-1, 1] : [1]) { const z = mid + s * x * h; const a = Math.PI * r(z) ** 2; V += w * h * a; Mz += w * h * a * z; }
  const rm = Math.max(r(z0), r(z1));
  return { volume: V, com: [cx, cy, Mz / V], bbox: [cx - rm, cy - rm, z0, cx + rm, cy + rm, z1], faces: 3, axis: [cx, cy], rMax: rm, r0: R };
}
function polyOf(doc, draft, measureId) {
  const fs = doc.features; const i = fs.findIndex((f) => f.id === draft.id); const later = fs.slice(i + 1);
  if (fs.filter((f) => f.kind === 'draft').length > 1) return { why: 'more than one draft' };
  const src = prefixShape(doc, draft); if (!src) return { why: 'no prefix shape' };
  const p = AXV[draft.pull ?? 'z'];
  // a cylinder chain (moves only before the draft), optionally a hole after it that misses the part
  const circleExtrude = fs[0].kind === 'sketch' && fs[0].shape === 'circle' && fs[1]?.kind === 'extrude' && fs.slice(2, i).every((f) => f.kind === 'move');
  if ((fs.slice(0, i).every((f) => ['cylinder', 'move'].includes(f.kind)) && fs[0].kind === 'cylinder') || circleExtrude) {
    if (!draft.whole || draft.pull !== 'z') return { why: 'cylinder face draft' };
    const F = frustum(src, draft); if (F.why || F.vanish) return F;
    for (const f of later) {
      if (f.kind !== 'hole' || f.axis !== 'z') return { why: `${f.kind} after a cylinder draft` };
      if (f.corners || f.counterbore || f.countersink || later.length > 1) return { why: 'hole kind not modelled' };
      // the referee's and the host's placement: the hole's centre is an offset from the TARGET's bounding-box centre (F.bbox: the drafted part)
      const hc = [0, 1, 2].map((q) => (F.bbox[q] + F.bbox[q + 3]) / 2 + f.center[q]); const z0 = F.bbox[2], z1 = F.bbox[5];
      if (hc[2] - f.depth / 2 > z0 || hc[2] + f.depth / 2 < z1) return { why: 'blind hole not modelled' };
      // removed = the bore's disk times the height inside the cone at each point: r(z) >= rho  <=>  z on one side of neutral + (R - rho) / t
      const t = SIGMA * Math.tan(draft.angle * Math.PI / 180); const R = F.r0; const a = f.diameter / 2;
      const NR = 600, NA = 1200; let Vr = 0; const Mr = [0, 0, 0];
      for (let ir = 0; ir < NR; ir++) {
        const rr = a * (ir + 0.5) / NR; const dA = (a / NR) * rr * (2 * Math.PI / NA);
        for (let ia = 0; ia < NA; ia++) {
          const th = 2 * Math.PI * (ia + 0.5) / NA; const x = hc[0] + rr * Math.cos(th), y = hc[1] + rr * Math.sin(th);
          const rho = Math.hypot(x - F.axis[0], y - F.axis[1]);
          // inside: R + t (z - n) >= rho
          let lo = z0, hi = z1; const zc = draft.neutral + (rho - R) / t;
          if (t < 0) hi = Math.min(z1, zc); else if (t > 0) lo = Math.max(z0, zc); else if (rho > R) hi = lo;
          if (hi <= lo) continue;
          const v = dA * (hi - lo); Vr += v; Mr[0] += v * x; Mr[1] += v * y; Mr[2] += v * (hi + lo) / 2;
        }
      }
      const V = F.volume - Vr; const com = F.com.map((c, q) => (F.volume * c - Mr[q]) / V);
      return { volume: V, com, bbox: F.bbox, faces: null, removedByHole: Vr, note: 'frustum minus the bore, integrated (600 x 1200 midpoint, polar)' };
    }
    return F;
  }
  const pp = prefixPlanes(src);
  if (pp.why) {
    const sk = fs[0].kind === 'sketch' ? fs[0] : null; const ex = fs[1]?.kind === 'extrude' ? fs[1] : null;
    if (sk && ex && sk.plane === 'xy' && !sk.offset && draft.whole && draft.pull === 'z' && !later.length && i === 2 && ex.height > 0 && !ex.reversed && !ex.midplane) return mitrePoly(sk.points, 0, ex.height, draft.neutral, draft.angle);
    return pp;
  }
  let planes;
  if (draft.whole) planes = pp.planes.map((q) => (Math.abs(dot(q.n, p)) > 1e-9 ? q : draftPl(q, p, draft.neutral, draft.angle)));
  else {
    const prim = fs.find((f) => f.id === draft.face?.feature);
    if (draft.face?.cause !== 'primitive' || !WORDV[draft.face.part] || (prim?.rotate ?? []).some(Boolean) || fs.slice(0, i).some((f) => ['move', 'rotate', 'mirror'].includes(f.kind))) return { why: 'face draft of a turned, moved or non-primitive face' };
    const w = WORDV[draft.face.part]; const k = pp.planes.reduce((b, q, j) => (dot(q.n, w) > dot(pp.planes[b].n, w) ? j : b), 0);
    if (Math.abs(dot(pp.planes[k].n, w) - 1) > 1e-12) return { why: 'no plane faces the word' };
    if (Math.abs(dot(pp.planes[k].n, p)) > 1e-9) return { why: 'the named face is not parallel to the pull, so it cannot be tilted' };
    planes = pp.planes.map((q, j) => (j === k ? draftPl(q, p, draft.neutral, draft.angle) : q));
  }
  const D = polytope(planes); if (!D) return { vanish: true };
  if (D.faces !== pp.base.faces) return { vanish: true, faces: D.faces };
  if (!later.length) return D;
  if (later.length === 1 && later[0].kind === 'shell' && later[0].id === measureId && later[0].open?.cause === 'primitive' && WORDV[later[0].open.part]) {
    const w = WORDV[later[0].open.part]; const k = planes.reduce((b, q, j) => (dot(q.n, w) > dot(planes[b].n, w) ? j : b), 0); const t = later[0].thickness;
    const inner = planes.map((q, j) => (j === k ? q : { n: q.n, d: q.d - t }));
    const I = polytope(inner); if (!I || I.faces !== planes.length) return { why: 'hollow inner collapses', vanish: true };
    const V = D.volume - I.volume; return { volume: V, com: D.com.map((c, q) => (D.volume * c - I.volume * I.com[q]) / V), bbox: D.bbox, faces: D.faces + I.faces - 1, hollow: true };
  }
  return { why: `${later.map((f) => f.kind).join('+')} after the draft` };
}

// ---- scoring: host-route-com.mjs's bars ---------------------------------------------------------------------------------------------------------------------
function cmp(m, r, { occt, curved }) {
  if (!m || !r || r.volume == null || !r.bbox || m.volume == null || !m.bbox) return null;
  const tv = curved ? 3e-4 : occt ? 1e-8 : 1e-9; const tb = curved ? 3e-4 : occt ? 2e-7 : 1e-9; const tc = curved ? 2e-4 : 1e-6;
  const diag = Math.max(Math.hypot(r.bbox[3] - r.bbox[0], r.bbox[4] - r.bbox[1], r.bbox[5] - r.bbox[2]), 1);
  const dVol = rel(m.volume, r.volume); const dBox = Math.max(...r.bbox.map((v, i) => rel(m.bbox[i], v))); const dCom = m.com && r.com ? Math.max(...m.com.map((v, i) => Math.abs(v - r.com[i]))) / diag : null;
  return { dVol, dBox, dCom, ok: dVol <= tv && dBox <= tb && (dCom === null || dCom <= tc), comChecked: dCom !== null };
}
const sweepOf = (c, k) => { const f = path.join(SWEEPS, `sweep-${k}`, `hr-${c}.jsonl`); const m = new Map(); if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (!m.has(r.id)) m.set(r.id, r); } return m; };

const out = [];
for (const file of readdirSync(DUMP).filter((f) => f.endsWith('.jsonl')).sort()) {
  const corpus = file.slice(0, -6); const S = { '021c': sweepOf(corpus, '021c'), '030': sweepOf(corpus, '030') };
  for (const l of readFileSync(path.join(DUMP, file), 'utf8').split('\n').filter(Boolean)) {
    const it = JSON.parse(l); const doc = it.doc; const drafts = doc.features.filter((f) => f.kind === 'draft');
    // in scope: a draft pulled along x or y, a whole/Body Draft, or a hollow right after a draft (the referee's hollow on a drafted part ignores the open face)
    const di = doc.features.findIndex((f) => f.kind === 'draft');
    const hollowAfter = di >= 0 && doc.features.slice(di + 1).some((f) => f.kind === 'shell');
    const affected = drafts.some((d) => d.whole || (d.pull ?? 'z') !== 'z') || hollowAfter;
    const row = { corpus, id: it.id, measureId: it.measureId, affected, hollowAfter, drafts: drafts.map((d) => ({ id: d.id, pull: d.pull ?? 'z', neutral: d.neutral, angle: d.angle, whole: !!d.whole, face: d.face?.part ?? d.face?.end ?? null })), probeRef: null, host: {} };
    for (const k of ['021c', '030']) { const r = S[k].get(it.id); row.host[k] = r ? { verdict: r.final?.verdict ?? (r.hang ? 'HANG' : null), m: r.final?.m ?? null, ref: r.final?.ref ?? null, okO: r.final?.okO ?? null } : null; }
    row.probeRef = row.host['030']?.ref ?? (corpus === 'sd' ? null : 'live OCCT (the referee as it is) + live brep-rs');
    if (!affected) { out.push(row); continue; }
    const before = { ...stat };
    row.occtBug = occtRun(oc, doc, it.measureId);
    row.occtFixed = occtRun(ocFixed, doc, it.measureId);
    row.fix = { neutralMoved: stat.neutralMoved - before.neutralMoved, faceReFound: stat.faceReFound - before.faceReFound, faceNotFound: stat.faceNotFound - before.faceNotFound };
    const d = drafts[0];
    if (drafts.length === 1 && d.id === it.measureId) row.occtOne = d.whole ? occtOne(doc, d) : row.occtFixed;
    if (drafts.length === 1) { const ch = occtChain(doc, d, it.measureId); if (ch) row.occtChain = ch; }
    try { row.poly = polyOf(doc, d, it.measureId); } catch (e) { row.poly = { why: 'poly threw ' + e.message }; }
    try { const g = JSON.parse(C.brep.measure_doc(JSON.stringify(doc))); const rf = g.refusals?.[it.measureId]; const s = g.shapes?.[it.measureId]; row.brep = rf ? { refused: String(rf).slice(0, 200) } : s ? { volume: s.volume, bbox: [...s.bbox[0], ...s.bbox[1]] } : { refused: 'no shape' }; } catch (e) { row.brep = { refused: 'threw ' + e.message }; }
    const curved = !!(row.host['030']?.m?.curved ?? row.host['021c']?.m?.curved);
    row.curved = curved;
    for (const k of ['021c', '030']) {
      const m = row.host[k]?.m; if (!m) continue;
      row[`vs_${k}`] = { occtFixed: cmp(m, row.occtFixed, { occt: true, curved }), occtOne: cmp(m, row.occtOne, { occt: true, curved }), occtChain: cmp(m, row.occtChain, { occt: true, curved }), poly: cmp(m, row.poly, { occt: false, curved }), brep: cmp({ ...m, com: null }, row.brep, { occt: true, curved }), occtBug: cmp(m, row.occtBug, { occt: true, curved }) };
    }
    row.refsAgree = { occtFixedPoly: cmp(row.occtFixed, row.poly, { occt: false, curved }), occtOnePoly: cmp(row.occtOne, row.poly, { occt: false, curved }), occtFixedOne: cmp(row.occtFixed, row.occtOne, { occt: true, curved }), occtChainPoly: cmp(row.occtChain, row.poly, { occt: false, curved }) };
    out.push(row);
    const v = row.vs_030 ?? {};
    console.error(`${corpus.padEnd(10)} ${it.id.slice(0, 34).padEnd(34)} host ${row.host['030']?.verdict ?? '-'} ${m6(row.host['030']?.m?.volume)} | fixed ${m6(row.occtFixed.volume) ?? row.occtFixed.refused?.slice(0, 40)} ${ok(v.occtFixed)} | one ${m6(row.occtOne?.volume)} ${ok(v.occtOne)} | poly ${m6(row.poly?.volume) ?? (row.poly?.vanish ? 'vanish' : row.poly?.why)} ${ok(v.poly)} | bug ${m6(row.occtBug.volume) ?? 'refused'} ${ok(v.occtBug)}`);
  }
}
function m6(v) { return typeof v === 'number' ? v.toFixed(4) : null; }
function ok(c) { return c == null ? '-' : c.ok ? 'OK' : 'DIFF'; }
process.stdout.write(JSON.stringify(out));
