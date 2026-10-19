#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 4. Fuzz of the TAPER ON HOLES / SEVERAL SHAPES guard (outline-guard.mjs taperFoldLoops, used by translate-ep.mjs).
//
// Random sketches made of several polygons: (A) a star or rectangle with 1-2 holes, (B) 2-3 disjoint polygons, (C) a frame with a block standing in its hole (3 nested),
// random taper -25..25 degrees and heights. For each one:
//   guard = does the contract translator build pull(sketch, h, {taper}) or refuse it?
//   truth = decided by live OCCT, NOT by the guard. Every loop is offset by d(t) = t * tan(taper) (outer loops outwards, holes inwards) at 64 heights:
//           (1) per loop: the area of OCCT's own 2-D offset (BRepOffsetAPI_MakeOffset, mitre joins, handles splits and collapses) equals the area of the plain
//               vertex-moved polygon (what a ruled sweep, i.e. truck, builds) = that loop has no event;
//           (2) between loops: OCCT's boolean COMMON of the offset faces equals what it was at the start (a loop inside another stays entirely inside, loops
//               apart stay apart: common area 0), so no loop has run into another or swallowed it.
//           Event-free at all 64 heights = the true tapered solid is the ruled sweep.
//   volume = the Simpson integral of the OCCT material areas (outer minus holes) over the height, compared with SolidCraft for the ones the guard builds.
// Counts: built+eventFree+volume right (right), refused+event (right), built+event (WRONG SOLID, must be 0), built+volume off (WRONG), refused+eventFree (over-refusal, safe).
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-taper-soup-fuzz.mjs [--n=120] [--seed=1] [--out=<file>]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const N = +arg('n', 120); let seed = +arg('seed', 1); const OUT = arg('out', path.join(HERE, 'extrude-pocket-taper-soup-fuzz-results.json'));
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
const inside = (poly, p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]; const b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const r3 = (x) => +x.toFixed(3);

function star(cx, cy, s, k = 5 + Math.floor(rnd() * 4)) {
  const angs = Array.from({ length: k }, (_, i) => ((i + rnd() * 0.6) / k) * Math.PI * 2);
  return angs.map((a) => { const r = s * (0.55 + rnd() * 0.45); return [r3(cx + r * Math.cos(a)), r3(cy + r * Math.sin(a))]; });
}
function box(cx, cy, w, h) { return [[r3(cx - w / 2), r3(cy - h / 2)], [r3(cx + w / 2), r3(cy - h / 2)], [r3(cx + w / 2), r3(cy + h / 2)], [r3(cx - w / 2), r3(cy + h / 2)]]; }
function scaleAbout(P, c, k) { return P.map((p) => [r3(c[0] + (p[0] - c[0]) * k), r3(c[1] + (p[1] - c[1]) * k)]); }

/** random sketch: loops [{pts, depth}] */
function randomSketch() {
  const kind = pick(['holes', 'holes', 'disjoint', 'disjoint', 'frame']);
  if (kind === 'disjoint') {
    const k = pick([2, 2, 3]); const loops = []; let x = 0;
    for (let i = 0; i < k; i++) {
      const w = 6 + rnd() * 18; const h = 5 + rnd() * 16;
      const shape = pick(['box', 'box', 'star']);
      const pts = shape === 'box' ? box(x + w / 2, 0, w, h) : star(x + w / 2, 0, Math.max(w, h) / 2, 6);
      loops.push({ pts, depth: 0 });
      x += w + 0.3 + rnd() * rnd() * 9;
    }
    return { kind, loops };
  }
  const outerBox = rnd() < 0.5; const R0 = 14 + rnd() * 18;
  const outer = outerBox ? box(0, 0, 2 * R0, (1.2 + rnd() * 0.8) * R0) : star(0, 0, R0, 7);
  const loops = [{ pts: outer, depth: 0 }];
  if (kind === 'holes') {
    const k = pick([1, 1, 2]);
    const placed = [];
    for (let t = 0; t < 40 && placed.length < k; t++) {
      const hw = 1.5 + rnd() * 6; const hh = 1.5 + rnd() * 5;
      const c = [r3((rnd() - 0.5) * R0), r3((rnd() - 0.5) * R0 * 0.6)];
      const hole = rnd() < 0.5 ? box(c[0], c[1], 2 * hw, 2 * hh) : star(c[0], c[1], Math.max(hw, hh), 6);
      if (!hole.every((p) => inside(outer, p))) continue;
      if (placed.some((q) => hole.some((p) => inside(q, p)) || q.some((p) => inside(hole, p)))) continue;
      placed.push(hole);
    }
    for (const h of placed) loops.push({ pts: h, depth: 1 });
    return { kind, loops };
  }
  // frame with a block in its hole
  const holeK = 0.45 + rnd() * 0.35; const hole = scaleAbout(outer, [0, 0], holeK); const isl = scaleAbout(outer, [0, 0], holeK * (0.3 + rnd() * 0.6));
  loops.push({ pts: hole, depth: 1 }, { pts: isl, depth: 2 });
  return { kind, loops };
}
const valid = (loops) => {
  for (const L of loops) if (!(area(L.pts) > 1)) return false;
  for (let i = 0; i < loops.length; i++) for (let j = 0; j < loops.length; j++) {
    if (i === j) continue;
    const a = loops[i].pts; const b = loops[j].pts;
    // crossing/touching: a vertex of one inside the other in a way the depths do not say
    const ai = a.some((p) => inside(b, p)); const aAll = a.every((p) => inside(b, p));
    if (ai && !aAll) return false;
  }
  return true;
};

function occtFace(pts) {
  const w = new oc.BRepBuilderAPI_MakeWire();
  for (let i = 0; i < pts.length; i++) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; w.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Pnt(p[0], p[1], 0), new oc.gp_Pnt(q[0], q[1], 0)).Edge()); }
  return new oc.BRepBuilderAPI_MakeFace(w.Wire(), false).Face();
}
const areaOfShape = (f) => { const g = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, g, false, false); return Math.abs(g.Mass()); };
function occtAreaAt(face, d, A0) {
  try {
    if (d === 0) return areaOfShape(face);
    const op = new oc.BRepOffsetAPI_MakeOffset(oc.TopoDS.Face(face), oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    op.Perform(d, 0);
    const shape = op.Shape();
    let total = 0; let wires = 0;
    const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (ex.More()) { total += areaOfShape(new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(ex.Current()), false).Face()); wires++; ex.Next(); }
    return wires ? total : 0;
  } catch { return 0; }
}
function commonArea(fa, fb) {
  try { const op = new oc.BRepAlgoAPI_Common(fa, fb); op.Build(new oc.Message_ProgressRange()); return areaOfShape(op.Shape()); } catch { return NaN; }
}

const rows = [];
const c = { builtRight: 0, builtWrong: 0, refusedRight: 0, refusedOver: 0, other: 0, skipped: 0 };
const byKind = {};
for (let it = 0; it < N; it++) {
  const sk = randomSketch();
  if (!valid(sk.loops)) { it--; continue; }
  const taper = +(((rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 23))).toFixed(1);
  const h = +(3 + rnd() * 18).toFixed(1);
  const d = h * Math.tan((taper * Math.PI) / 180);
  const script = `const sk = sketch('top'); ${sk.loops.map((L) => `sk.polygon(${JSON.stringify(L.pts)});`).join(' ')} const part = pull(sk, ${h}, { taper: ${taper} });`;
  const r = runScript(script);
  if (r.errors.length) { it--; continue; }
  const doc = solveDoc(r.doc);
  // ---- truth by OCCT
  const K = 64; const sign = sk.loops.map((L) => (L.depth % 2 === 0 ? 1 : -1));
  const faces0 = sk.loops.map((L) => occtFace(L.pts));
  const A0 = sk.loops.map((L) => area(L.pts));
  const nest = sk.loops.map((L, i) => sk.loops.map((M, j) => (i !== j && inside(M.pts, L.pts[0]))));
  let eventFree = true; let why = ''; const matArea = [];
  for (let k = 0; k <= K && eventFree; k++) {
    const dk = (d * k) / K;
    const moved = sk.loops.map((L, i) => offsetLoop(L.pts, sign[i] * dk));
    const aOcct = sk.loops.map((L, i) => occtAreaAt(faces0[i], sign[i] * dk, A0[i]));
    for (let i = 0; i < moved.length; i++) {
      if (Math.abs(aOcct[i] - area(moved[i])) > 1e-7 * Math.max(A0[i], 1)) { eventFree = false; why = `loop ${i} event at step ${k}`; break; }
    }
    if (!eventFree) break;
    const mf = moved.map(occtFace);
    for (let i = 0; i < moved.length && eventFree; i++) for (let j = i + 1; j < moved.length; j++) {
      const ca = commonArea(mf[i], mf[j]);
      const want = nest[i][j] ? area(moved[i]) : nest[j][i] ? area(moved[j]) : 0;
      if (!(Math.abs(ca - want) <= 1e-7 * Math.max(A0[i], A0[j], 1))) { eventFree = false; why = `loops ${i}/${j} meet at step ${k} (common ${ca.toFixed(6)} want ${want.toFixed(6)})`; break; }
    }
    matArea.push(aOcct.reduce((s, a, i) => s + (sk.loops[i].depth % 2 === 0 ? a : -a), 0));
  }
  let vOcct = null;
  if (eventFree) { vOcct = 0; for (let k = 0; k < K; k += 2) vOcct += (matArea[k] + 4 * matArea[k + 1] + matArea[k + 2]) * (h / K) / 3; }
  // ---- the contract mapping
  const tr = await contract.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  const row = { it, kind: sk.kind, loops: sk.loops.length, taper, h, d: r3(d), eventFree, why: eventFree ? '' : why, status: last?.status };
  byKind[sk.kind] ??= { built: 0, refused: 0 };
  if (last?.status === 'built') {
    byKind[sk.kind].built++;
    const all = await runSC(tr.commands);
    const V = all.ok ? all.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) : NaN;
    row.volume = V; row.vOcct = vOcct; row.dVol = vOcct ? Math.abs(V - vOcct) / vOcct : null;
    if (eventFree && row.dVol < 1e-9) { c.builtRight++; row.verdict = 'built, event-free, volume matches OCCT'; }
    else { c.builtWrong++; row.verdict = eventFree ? 'WRONG: event-free but volume differs' : 'WRONG: built through an event the guard missed'; row.script = script; }
  } else {
    byKind[sk.kind].refused++;
    row.refusal = last?.refusal;
    if (!eventFree) { c.refusedRight++; row.verdict = 'refused, and the taper does hit an event'; }
    else if (/fold over itself|run into each other|cannot be built from the sketch|cross each other|touch each other/.test(last?.refusal ?? '')) { c.refusedOver++; row.verdict = 'refused though event-free (over-refusal, safe; the guard keeps 0.001 mm clear)'; row.script = script; }
    else { c.other++; row.verdict = 'refused for another reason'; row.script = script; }
  }
  rows.push(row);
}
const summary = { n: N, seed: +arg('seed', 1), ...c, byKind };
console.log(JSON.stringify(summary));
for (const r of rows.filter((x) => /WRONG/.test(x.verdict ?? ''))) console.log('WRONG', JSON.stringify(r));
for (const r of rows.filter((x) => /over-refusal|another reason/.test(x.verdict ?? '')).slice(0, 8)) console.log('OVER', r.kind, r.taper, r.h, r.d, r.refusal?.slice(0, 100));
writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
console.log('wrote', OUT);
