// SPIKE, referee only (GUARD-SD-WHOLEBODY, 2026-11-08). Live references for the sd whole-body drafts of non-convex extrudes (dw2-{L,T,U,Lthin}-*,
// dw2-fuzz-poly-*): the 53 rows the host route scores RIGHT against the group's Simpson closed form (wholeExtrudeVolume, volume only) while the group's
// stored OCCT run (shell-draft-runs.json) disagrees on volume and brep-rs refuses ("can only Body Draft an axis-aligned box yet").
//
//   WT=<built tree> SOLIDCRAFT_REFEREE_PKG=<pkg> node sdw-oracle.mjs <host sweep hr-sd.jsonl> [<more hr-sd.jsonl>...] > out.json
//
// Per row, from the case's own script (runScript -> solveDoc, as host-route-com.mjs does):
//   occtOne   OCCT live, the extrude through the referee's buildDoc, then ONE BRepOffsetAPI_DraftAngle with every side face (normal square to the pull)
//             added, neutral plane {pull coordinate = neutral}. This is the convention the closed form describes.
//   occtSeq   OCCT live, the referee's own Body Draft (occt-build.ts, the `whole` branch), measured through buildDoc: it drafts one face at a time with
//             face handles taken from the UNDRAFTED shape, so a face next to one already drafted is no longer IsSame and is skipped silently. This
//             reproduces the stored run.
//   occtSeqRe OCCT live, one face at a time as the referee does, but each face re-found in the current shape by its plane: the sequential method done right.
//   poly      exact polyhedron: the mitre offset of the outline at the bottom and the top (each vertex = the two adjacent offset edge lines meeting),
//             side quads planar by construction, volume / COM / box by the divergence theorem about the box centre. A geometric identity: no kernel
//             and no Simpson rule; it also gives the COM the closed form lacks.
//   simpson   the group's closed form, recomputed (wholeExtrudeVolume).
//   brep      brep-rs live on the same doc (expected: refused).
// Host numbers are read from the sweep rows given (feature measure: volume, bbox, com).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WT = process.env.WT; if (!WT) { console.error('FATAL: WT unset'); process.exit(2); }
const CONTRACT = path.join(WT, 'docs/spikes/solidcraft-referee/contract');
const imp = (p) => import(pathToFileURL(p).href);
const C = await imp(path.join(CONTRACT, 'sketch-geometry-harness/sg-core.mjs'));
const P = await imp(path.join(CONTRACT, 'shell-draft-polytope.mjs'));
const R2 = await imp(path.join(CONTRACT, 'shell-draft-cases-r2.mjs'));
const { buildDoc } = await imp(path.join(WT, 'packages/brep-adapter/dist/occt-build.js'));
const { facesOf } = await imp(path.join(WT, 'packages/brep-adapter/dist/topo-resolve.js'));
const oc = C.oc;
const SIGMA = -1;
const cases = R2.R2_FN({ P, sigma: SIGMA, rel: C.rel });
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
// ALL=1: every dw2-* row (boxes, prisms, wedges, rectangles too: OCCT only, the polyhedron is for top-plane outlines pulled along z)
const WANT = (id) => (!ONLY.length || ONLY.includes(id)) && (process.env.ALL ? id.startsWith('dw2-') : (/^dw2-(L|T|U|Lthin)-/.test(id) || /^dw2-fuzz-poly-/.test(id)));

const host = new Map();
for (const f of process.argv.slice(2)) {
  const k = f.includes('021c') ? '021c' : f.includes('030') ? '030' : f;
  for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); if (!WANT(r.id)) continue;
    const e = host.get(r.id) ?? {}; e[k] = { verdict: r.final?.verdict, m: r.final?.m ?? null }; host.set(r.id, e);
  }
}

// ---- OCCT ------------------------------------------------------------------------------------------------------------------------------------------------
function planeOf(face) {
  const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
  if (a.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) return null;
  const pl = a.Plane(); const ax = pl.Axis(); const d = ax.Direction(); const l = ax.Location();
  const n = [d.X(), d.Y(), d.Z()]; // the surface normal (orientation not applied: used only to test square-to-pull and to re-find a face, up to sign)
  return { n, d: n[0] * l.X() + n[1] * l.Y() + n[2] * l.Z() };
}
const AXV = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const neutralPln = (pull, neutral) => { const p = AXV[pull]; return new oc.gp_Pln(new oc.gp_Pnt(p[0] * neutral, p[1] * neutral, p[2] * neutral), new oc.gp_Dir(...p)); };
const sides = (shape, pull) => facesOf(oc, shape).filter((f) => { const q = planeOf(f); return q && Math.abs(q.n['xyz'.indexOf(pull)]) < 1e-9; });
function draftOne(shape, faces, pull, deg, neutral) {
  const dr = new oc.BRepOffsetAPI_DraftAngle(shape);
  for (const f of faces) dr.Add(oc.TopoDS.Face(f), new oc.gp_Dir(...AXV[pull]), deg * Math.PI / 180, neutralPln(pull, neutral));
  dr.Build(new oc.Message_ProgressRange());
  if (!dr.IsDone()) return null;
  return dr.Shape();
}
function solidsCom(shape) {
  const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); let V = 0; const c = [0, 0, 0];
  for (; ex.More(); ex.Next()) { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(ex.Current(), g, 1e-7, false, false); const m = g.Mass(); const p = g.CentreOfMass(); V += m; c[0] += m * p.X(); c[1] += m * p.Y(); c[2] += m * p.Z(); }
  return V > 0 ? c.map((x) => x / V) : null;
}
const meas = (shape) => { const m = C.occtMeasure(shape); return { volume: m.volume, bbox: m.bbox, com: solidsCom(shape) ?? m.com, faces: m.faces, solids: m.solids }; };
function occtLive(doc, draft) {
  const out = {};
  const pre = { ...doc, features: doc.features.filter((f) => f.id !== draft.id) };
  let src;
  try { const b = buildDoc(oc, pre, C.arc); src = b.shapes.get(draft.target); } catch (e) { return { why: 'extrude threw ' + e.message }; }
  if (!src) return { why: 'no extrude shape' };
  const fs = sides(src, draft.pull);
  out.sideFaces = fs.length;
  try { const s = draftOne(src, fs, draft.pull, draft.angle, draft.neutral); out.occtOne = s ? meas(s) : { refused: 'DraftAngle not done' }; } catch (e) { out.occtOne = { refused: 'threw ' + String(e.message ?? e).slice(0, 200) }; }
  // sequential, faces re-found by plane in the current shape
  try {
    let cur = src; const planes = fs.map(planeOf); let skipped = 0;
    for (const q of planes) {
      const f = facesOf(oc, cur).find((g) => { const r = planeOf(g); return r && [1, -1].some((sg) => Math.abs(sg * r.d - q.d) < 1e-7 && r.n.every((v, i) => Math.abs(sg * v - q.n[i]) < 1e-9)); });
      const nx = f ? draftOne(cur, [f], draft.pull, draft.angle, draft.neutral) : null;
      if (nx) cur = nx; else skipped++;
    }
    out.occtSeqRe = { ...meas(cur), skipped };
  } catch (e) { out.occtSeqRe = { refused: 'threw ' + String(e.message ?? e).slice(0, 200) }; }
  // the referee's own Body Draft (occt-build.ts `whole` branch), as the stored run got it
  try { const b = buildDoc(oc, doc, C.arc); const rf = b.refusals?.get?.(draft.id) ?? b.refusals?.[draft.id]; const s = b.shapes.get(draft.id); out.occtSeq = rf ? { refused: String(rf) } : s ? meas(s) : { refused: 'nothing' }; } catch (e) { out.occtSeq = { refused: 'threw ' + e.message }; }
  return out;
}

// ---- exact polyhedron ------------------------------------------------------------------------------------------------------------------------------------
function mitre(poly, dOut) {
  const n = poly.length;
  const sg = Math.sign(poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0)) || 1;
  const L = poly.map((p, i) => { const q = poly[(i + 1) % n]; const e = [q[0] - p[0], q[1] - p[1]]; const l = Math.hypot(...e); const nn = [sg * e[1] / l, -sg * e[0] / l]; return { n: nn, c: nn[0] * p[0] + nn[1] * p[1] + dOut, dir: [e[0] / l, e[1] / l] }; });
  const vs = poly.map((_, i) => { const a = L[(i + n - 1) % n], b = L[i]; const det = a.n[0] * b.n[1] - a.n[1] * b.n[0]; return [(a.c * b.n[1] - b.c * a.n[1]) / det, (a.n[0] * b.c - b.n[0] * a.c) / det]; });
  let ok = true;
  for (let i = 0; i < n; i++) { const p = vs[i], q = vs[(i + 1) % n]; if ((q[0] - p[0]) * L[i].dir[0] + (q[1] - p[1]) * L[i].dir[1] <= 1e-9) ok = false; }
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const X = (p1, p2, p3, p4) => cr(p3, p4, p1) * cr(p3, p4, p2) < 0 && cr(p1, p2, p3) * cr(p1, p2, p4) < 0;
  for (let i = 0; i < n && ok; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (X(vs[i], vs[(i + 1) % n], vs[j], vs[(j + 1) % n])) { ok = false; break; } }
  return { vs, ok, sg };
}
function polyhedron(poly, z0, z1, neutral, deg) {
  const t = SIGMA * Math.tan(deg * Math.PI / 180);
  // a vanishing edge or a crossing can happen inside the height, not only at its ends: sample it
  for (let k = 0; k <= 64; k++) { const z = z0 + (z1 - z0) * k / 64; if (!mitre(poly, t * (z - neutral)).ok) return { vanish: true, at: z }; }
  const B = mitre(poly, t * (z0 - neutral)); const T = mitre(poly, t * (z1 - neutral));
  const b3 = B.vs.map(([x, y]) => [x, y, z0]); const t3 = T.vs.map(([x, y]) => [x, y, z1]);
  const all = [...b3, ...t3]; const mn = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]))); const mx = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));
  const o = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
  const n = poly.length; const tris = [];
  // outward orientation for a CCW outline (sg = +1): bottom reversed, top as is, side (b_i, b_i+1, t_i+1, t_i)
  const ccw = B.sg > 0;
  const T3 = (a, b, c) => tris.push(ccw ? [a, b, c] : [a, c, b]);
  for (let i = 1; i < n - 1; i++) { T3(b3[0], b3[i + 1], b3[i]); T3(t3[0], t3[i], t3[i + 1]); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T3(b3[i], b3[j], t3[j]); T3(b3[i], t3[j], t3[i]); }
  let V = 0; const c = [0, 0, 0]; let planar = 0;
  for (const tr of tris) {
    const [a, b, d] = tr.map((p) => p.map((v, k) => v - o[k]));
    const v = (a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0])) / 6;
    V += v; for (let k = 0; k < 3; k++) c[k] += v * (a[k] + b[k] + d[k]) / 4;
  }
  // side quads planar: the four corners of each side lie on one plane (the drafted face)
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; const [p, q, r, s] = [b3[i], b3[j], t3[j], t3[i]]; const u = q.map((v, k) => v - p[k]), w = r.map((v, k) => v - p[k]), x = s.map((v, k) => v - p[k]); const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; planar = Math.max(planar, Math.abs(nn[0] * x[0] + nn[1] * x[1] + nn[2] * x[2]) / (Math.hypot(...nn) || 1)); }
  return { volume: V, com: c.map((v, k) => v / V + o[k]), bbox: [...mn, ...mx], faces: n + 2, sideNonPlanarity: planar };
}

// ---- scoring (host-route-com.mjs's bars: planar volume 1e-9 rel, box 1e-9 rel (2e-7 against OCCT), COM 1e-6 of the diagonal) ------------------------------
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const cmp = (m, r, occt) => {
  if (!m || !r || r.volume == null) return null;
  const diag = Math.max(Math.hypot(r.bbox[3] - r.bbox[0], r.bbox[4] - r.bbox[1], r.bbox[5] - r.bbox[2]), 1);
  const dVol = rel(m.volume, r.volume); const dBox = Math.max(...r.bbox.map((v, i) => rel(m.bbox[i], v))); const dCom = m.com && r.com ? Math.max(...m.com.map((v, i) => Math.abs(v - r.com[i]))) / diag : null;
  const tv = occt ? 1e-8 : 1e-9; const tb = occt ? 2e-7 : 1e-9;
  return { dVol, dBox, dCom, ok: dVol <= tv && dBox <= tb && dCom !== null && dCom <= 1e-6 };
};

const rows = [];
for (const c of cases) {
  if (!WANT(c.id)) continue;
  const r = C.runScript(c.script); if (r.errors.length) { rows.push({ id: c.id, why: 'script error' }); continue; }
  const doc = C.solveDoc(structuredClone(r.doc));
  const draft = doc.features.find((f) => f.kind === 'draft');
  if (!draft || !draft.whole) { rows.push({ id: c.id, why: 'no whole draft in the doc' }); continue; }
  const ext = doc.features.find((f) => f.id === draft.target); const sk = ext?.kind === 'extrude' ? doc.features.find((f) => f.id === ext.target) : null;
  const pts = sk?.points ?? null;
  const exp = c.expect ? c.expect() : null;
  const row = { id: c.id, draft: { angle: draft.angle, pull: draft.pull, neutral: draft.neutral, whole: draft.whole }, target: ext?.kind ?? null, extrude: sk ? { height: ext.height, plane: sk.plane } : null, simpson: exp };
  if (!pts || sk.plane !== 'xy' || draft.pull !== 'z' || !(ext.height > 0)) row.polyWhy = 'not a top-plane outline pulled along z';
  else { const z0 = 0, z1 = ext.height; row.poly = polyhedron(pts, Math.min(z0, z1), Math.max(z0, z1), draft.neutral, draft.angle); }
  Object.assign(row, occtLive(doc, draft));
  try { const g = JSON.parse(C.brep.measure_doc(JSON.stringify(doc))); row.brep = g.refusals?.[draft.id] ? { refused: g.refusals[draft.id] } : g.shapes?.[draft.id] ? { volume: g.shapes[draft.id].volume } : { refused: 'no shape' }; } catch (e) { row.brep = { refused: 'threw ' + e.message }; }
  row.host = host.get(c.id) ?? null;
  // references agree with each other?
  row.closedVsOcctOne = exp?.volume != null && exp?.bbox && row.occtOne?.volume != null ? cmp(exp, row.occtOne, true) : null;
  row.polyVsOcctOne = row.poly?.volume != null && row.occtOne?.volume != null ? cmp(row.poly, row.occtOne, true) : null;
  row.simpsonVsPoly = exp?.volume != null && row.poly?.volume != null ? rel(exp.volume, row.poly.volume) : null;
  row.occtSeqVsStored = null;
  for (const [k, h] of Object.entries(row.host ?? {})) {
    row[`hostVsPoly_${k}`] = cmp(h.m, row.poly, false);
    row[`hostVsOcctOne_${k}`] = cmp(h.m, row.occtOne, true);
    row[`hostVsClosed_${k}`] = exp?.volume != null && exp?.bbox ? cmp(h.m, exp, false) : null;
  }
  rows.push(row);
  console.error(`${c.id.padEnd(24)} host ${row.host?.['030']?.m?.volume ?? row.host?.['030']?.verdict ?? '-'} poly ${row.poly?.volume ?? (row.poly?.vanish ? 'vanish' : row.polyWhy)} occtOne ${row.occtOne?.volume ?? row.occtOne?.refused} occtSeqRe ${row.occtSeqRe?.volume} occtSeq ${row.occtSeq?.volume ?? row.occtSeq?.refused} simpson ${exp?.volume ?? (exp?.vanish ? 'vanish' : '-')}`);
}
process.stdout.write(JSON.stringify(rows, null, 1));
