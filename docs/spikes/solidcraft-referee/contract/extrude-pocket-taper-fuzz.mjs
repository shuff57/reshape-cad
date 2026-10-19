#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group). Fuzz of the TAPER FOLD GUARD (outline-guard.mjs, used by translate-ep.mjs).
//
// For N random simple polygons (random star-shaped, random rectilinear L/U/T/C, random rectangles) and random tapers / heights it asks
//   guard  = does the contract translator build pull(sketch, h, {taper}) or refuse it (with the fold sentence)?
//   truth  = does the taper of this outline stay event-free for the whole height? Decided by live OCCT, NOT by the guard: the area of the
//            outline offset by d(t) = t*tan(taper), as OCCT's own 2-D offset (BRepOffsetAPI_MakeOffset, mitre joins, handles splits and
//            collapses) gives it, is compared with the area of the plain vertex-moved polygon (what a ruled loft, i.e. truck, builds) at 64 heights;
//            equal at every height (1e-9) = no event = truck's loft is the true tapered solid. Any difference = the walls met, split or
//            collapsed somewhere = the loft is NOT the true solid.
// and, for the ones the guard lets through, the SolidCraft volume against the OCCT integral  V = integral of area(t) dt  (Simpson over 64 steps).
// Counts: built+eventFree (right), refused+event (right), built+event (WRONG SOLID, must be 0), refused+eventFree (over-refusal, safe).
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-taper-fuzz.mjs [--n=300] [--seed=1] [--out=<file>]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const N = +arg('n', 300); let seed = +arg('seed', 1); const OUT = arg('out', path.join(HERE, 'extrude-pocket-taper-fuzz-results.json'));
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const contract = await load('docs/spikes/solidcraft-referee/contract/translate-ep.mjs');
const { offsetLoop } = await load('docs/spikes/solidcraft-referee/contract/outline-guard.mjs');
const runSC = async (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { error: `TRAP ${e.message}` } }; } };

const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i]; const q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

function randomPolygon() {
  const kind = pick(['star', 'star', 'star', 'rect', 'L', 'U', 'T', 'C']);
  const s = 5 + rnd() * 25;
  if (kind === 'rect') { const w = 4 + rnd() * 40; const h = 3 + rnd() * 30; return { kind, pts: [[0, 0], [w, 0], [w, h], [0, h]] }; }
  if (kind === 'L') { const a = 20 + rnd() * 20; const b = 15 + rnd() * 20; const t1 = 3 + rnd() * 12; const t2 = 3 + rnd() * 12; return { kind, pts: [[0, 0], [a, 0], [a, t1], [t2, t1], [t2, b], [0, b]] }; }
  if (kind === 'U') { const w = 20 + rnd() * 25; const h = 15 + rnd() * 15; const sw = 1 + rnd() * 8; const sd = 5 + rnd() * (h - 6); const x0 = (w - sw) / 2; return { kind, pts: [[0, 0], [w, 0], [w, h], [x0 + sw, h], [x0 + sw, h - sd], [x0, h - sd], [x0, h], [0, h]] }; }
  if (kind === 'T') { const w = 25 + rnd() * 20; const h = 6 + rnd() * 8; const stem = 3 + rnd() * 10; const sh = 8 + rnd() * 15; const x0 = (w - stem) / 2; return { kind, pts: [[0, 0], [w, 0], [w, h], [x0 + stem, h], [x0 + stem, h + sh], [x0, h + sh], [x0, h], [0, h]] }; }
  if (kind === 'C') { const w = 25 + rnd() * 15; const h = 20 + rnd() * 15; const gap = 2 + rnd() * 10; const dep = 8 + rnd() * (w - 12); const y0 = (h - gap) / 2; return { kind, pts: [[0, 0], [w, 0], [w, y0], [w - dep, y0], [w - dep, y0 + gap], [w, y0 + gap], [w, h], [0, h]] }; }
  const n = 5 + Math.floor(rnd() * 5);
  const angs = Array.from({ length: n }, () => rnd() * Math.PI * 2).sort((a, b) => a - b);
  const pts = angs.map((a) => { const r = s * (0.35 + rnd() * 0.65); return [+(r * Math.cos(a)).toFixed(3), +(r * Math.sin(a)).toFixed(3)]; });
  return { kind: 'star', pts };
}

function occtFace(pts) {
  const w = new oc.BRepBuilderAPI_MakeWire();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    w.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Pnt(p[0], p[1], 0), new oc.gp_Pnt(q[0], q[1], 0)).Edge());
  }
  return new oc.BRepBuilderAPI_MakeFace(w.Wire(), false).Face();
}
function areaOfFace(f) { const g = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, g, false, false); return Math.abs(g.Mass()); }
function occtAreaAt(face, d) {
  try {
    if (d === 0) return areaOfFace(face);
    const op = new oc.BRepOffsetAPI_MakeOffset(oc.TopoDS.Face(face), oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    op.Perform(d, 0);
    const shape = op.Shape();
    // the offset of a face is a set of closed wires (one per surviving piece): a face from each, areas added
    let total = 0;
    const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (ex.More()) { total += areaOfFace(new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(ex.Current()), false).Face()); ex.Next(); }
    return total;
  } catch { return 0; }
}

const rows = [];
let c = { builtRight: 0, builtWrong: 0, refusedRight: 0, refusedOver: 0, other: 0, oracleFailed: 0 };
for (let it = 0; it < N; it++) {
  const poly = randomPolygon();
  const A0 = area(poly.pts);
  if (!(A0 > 5)) { it--; continue; }
  // reject polygons that cross themselves (the star construction cannot, but the clamp / rounding could): use the bow-tie guard's own opposite, OCCT validity
  const taper = +(((rnd() < 0.5 ? -1 : 1) * (rnd() < 0.5 ? 2 + rnd() * 18 : 3 + rnd() * 62))).toFixed(1);
  const h = +(3 + rnd() * 25).toFixed(1);
  const d = h * Math.tan((taper * Math.PI) / 180);
  const script = `const sk = sketch('top'); sk.polygon(${JSON.stringify(poly.pts)}); const part = pull(sk, ${h}, { taper: ${taper} });`;
  const r = runScript(script);
  if (r.errors.length) { it--; continue; }
  const doc = solveDoc(r.doc);
  // truth, by OCCT
  const face = occtFace(poly.pts);
  const K = 64; const areaOcct = []; const areaVertex = [];
  let eventFree = true;
  for (let k = 0; k <= K; k++) {
    const dk = (d * k) / K;
    const ao = occtAreaAt(face, dk);
    const av = area(offsetLoop(poly.pts, dk));
    areaOcct.push(ao); areaVertex.push(av);
    if (Math.abs(ao - av) > 1e-7 * Math.max(A0, 1)) eventFree = false;
  }
  // OCCT's 2-D offset sometimes returns nothing even for a tiny first step (sharp reflex spikes): then there is no oracle for this outline, skip it
  if (areaOcct[1] === 0 && areaVertex[1] > 0.5 * A0) { c.oracleFailed = (c.oracleFailed ?? 0) + 1; rows.push({ it, kind: poly.kind, taper, h, verdict: 'skipped: OCCT offset gave nothing at the first step', script }); continue; }
  let vOcct = 0; for (let k = 0; k < K; k += 2) vOcct += (areaOcct[k] + 4 * areaOcct[k + 1] + areaOcct[k + 2]) * (h / K) / 3;
  // the contract mapping
  const tr = await contract.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  const row = { it, kind: poly.kind, n: poly.pts.length, taper, h, d: +d.toFixed(3), eventFree, status: last?.status };
  if (last?.status === 'built') {
    const all = await runSC(tr.commands);
    const V = all.ok ? all.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) : NaN;
    row.volume = V; row.vOcct = vOcct; row.dVol = Math.abs(V - vOcct) / vOcct;
    if (eventFree && row.dVol < 1e-9) { c.builtRight++; row.verdict = 'built, event-free, volume matches OCCT'; }
    else { c.builtWrong++; row.verdict = eventFree ? 'WRONG: event-free but volume differs' : 'WRONG: built through an event (a fold the guard missed)'; row.script = script; }
  } else {
    row.refusal = last?.refusal;
    if (!eventFree) { c.refusedRight++; row.verdict = 'refused, and the taper does hit an event'; }
    else if (/fold over itself|cannot be built from the sketch|cross each other|touch each other/.test(last?.refusal ?? '')) { c.refusedOver++; row.verdict = 'refused though event-free (over-refusal, safe)'; row.script = script; }
    else { c.other++; row.verdict = 'refused for another reason'; }
  }
  rows.push(row);
}
const summary = { n: N, seed: +arg('seed', 1), ...c };
console.log(JSON.stringify(summary));
for (const r of rows.filter((x) => /WRONG/.test(x.verdict ?? ''))) console.log('WRONG', JSON.stringify(r));
for (const r of rows.filter((x) => /over-refusal/.test(x.verdict ?? '')).slice(0, 8)) console.log('OVER', r.kind, r.taper, r.h, r.d, r.refusal?.slice(0, 80));
writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
console.log('wrote', OUT);
