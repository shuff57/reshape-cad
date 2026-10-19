// Round-2 blend/loft measurements: non-planar ruled skins, planar-sides guard, tilted frames, 3/1-target docs, L->rect, bowtie validity, script sentences.
// COPY of the scratch harness; run from the shadow repo root (see RIG.md):
//   cd <shadow> && cp <this file> blend-r2.mjs && SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun blend-r2.mjs --out=<file.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from './docs/spikes/solidcraft-referee/phase0/translate.mjs';
import { guardDoc } from '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs';
import { guardedRun } from '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/blend-loft.guarded-run.mjs';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
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
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const flat = (b) => [...b[0], ...b[1]];
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const bboxD = (a, b) => Math.max(...b.map((w, i) => rel(a[i], w)));

function occtMeasure(doc, id) {
  try {
    const built = buildDoc(oc, doc, arc);
    const shape = built.shapes.get(id);
    if (!shape) return { refused: built.refusals?.get?.(id) ?? 'OCCT built nothing' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const c = g.CentreOfMass();
    const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(); const hi = bx.CornerMax();
    const fs = facesOf(oc, shape);
    let valid = null; try { valid = new oc.BRepCheck_Analyzer(shape, true, false).IsValid(); } catch { /* */ }
    return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: fs.length, valid };
  } catch (e) { return { refused: 'OCCT threw: ' + (e?.message ?? String(e)) }; }
}
function brepMeasure(doc, id) {
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const s = got.shapes?.[id];
    return s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } : { refused: got.refusals?.[id] ?? 'no shape' };
  } catch (e) { return { refused: 'brep threw: ' + e.message }; }
}
function truckMeasure(doc, id) {
  const d = solveDoc(doc);
  const tr = translateDoc(d, { arc, mt, runSC, resolveAt: () => null });
  const mf = tr.features.find((f) => f.id === id);
  if (!mf || mf.status !== 'built') return { refused: mf?.refusal ?? tr.features.find((f) => f.status === 'refused')?.refusal ?? 'not built' };
  const m = mf.measure;
  return { volume: m.volume, bbox: m.bbox, faces: m.faces, kernelFaces: m.kernelFaces, faceTypes: m.faceTypes, com: m.com };
}
const sk = (id, plane, offset, points, extra = {}) => ({ id, kind: 'sketch', plane, offset, points, ...extra });
const bl = (...t) => ({ id: 'bl1', kind: 'blend', targets: t });

// ---- independent closed form: ANY ruled loft of corresponding straight 3D polygons (divergence theorem, Gauss 3x3 per side patch) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const GP = [[0.5 - Math.sqrt(0.15), 5 / 18], [0.5, 8 / 18], [0.5 + Math.sqrt(0.15), 5 / 18]];
function ruledVolume3D(P, Q) {
  const n = P.length; let side = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const [s, ws] of GP) for (const [t, wt] of GP) {
      const r = lerp3(lerp3(P[i], P[j], s), lerp3(Q[i], Q[j], s), t);
      const rs = lerp3(sub(P[j], P[i]), sub(Q[j], Q[i]), t);
      const rt = sub(lerp3(Q[i], Q[j], s), lerp3(P[i], P[j], s));
      side += ws * wt * dot(r, cross(rs, rt));
    }
  }
  const cap = (R) => { let a = 0; for (let k = 1; k < R.length - 1; k++) a += dot(R[0], cross(sub(R[k], R[0]), sub(R[k + 1], R[0]))) / 2; return a; };
  return Math.abs((side + cap(Q) - cap(P)) / 3);
}
const to3 = (pts, z) => pts.map(([x, y]) => [x, y, z]);
const tiltTo3 = (pts, origin, u, v) => pts.map(([x, y]) => [origin[0] + u[0] * x + v[0] * y, origin[1] + u[1] * x + v[1] * y, origin[2] + u[2] * x + v[2] * y]);

// ---- planarity of the side faces of a ruled loft (corners P_i, P_i+1, Q_i, Q_i+1 coplanar?) ----
function sidePlanarity(P, Q) {
  const out = [];
  const scale = Math.max(...P.concat(Q).flat().map(Math.abs), 1);
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    const a = sub(P[j], P[i]); const b = sub(Q[i], P[i]); const c = sub(Q[j], P[i]);
    const det = Math.abs(dot(a, cross(b, c)));
    out.push(det / (scale * scale * scale));
  }
  return { maxDet: Math.max(...out), planar: Math.max(...out) < 1e-9 };
}

const ALL = [];
function kindOfDoc(doc) { const f = doc.features.find((x) => x.kind === 'blend'); if (!f) return 'none'; let k = 'polygon'; for (const t of f.targets ?? []) { const s = doc.features.find((x) => x.id === t); if (!s) continue; if (s.shape === 'circle') k = 'curved'; else { try { const o = arc.outlineOf(s); if (o?.bulges && Object.values(o.bulges).some((g) => g)) k = 'curved'; } catch { /* */ } } } return k; }
function guardOf(doc, neutral = null) { try { const m = guardDoc(doc, { outlineOf: arc.outlineOf, neutral }); const v = [...m.values()][0]; return v ?? null; } catch (e) { return { code: 'GUARD-THREW', sentence: String(e.message) }; } }
function fullCase(label, doc, extra = {}) {
  const o = occtMeasure(doc, 'bl1'); const b = brepMeasure(doc, 'bl1'); let t; try { t = truckMeasure(doc, 'bl1'); } catch (e) { t = { refused: 'harness threw ' + e.message }; }
  const r = { label, occt: o, brep: b, truck: t, ...extra };
  r.guard = extra.guardOverride !== undefined ? extra.guardOverride : guardOf(doc); r.kind = kindOfDoc(doc);
  if (o.volume !== undefined && t.volume !== undefined) { r.dVolTruckOcct = rel(t.volume, o.volume); r.signedTruckMinusOcct = (t.volume - o.volume) / Math.max(Math.abs(o.volume), 1); r.dBboxTruckOcct = bboxD(t.bbox, o.bbox); }
  if (extra.analytic !== undefined) { if (t.volume !== undefined) r.dVolTruckAnalytic = rel(t.volume, extra.analytic); if (o.volume !== undefined) r.dVolOcctAnalytic = rel(o.volume, extra.analytic); if (b.volume !== undefined) r.dVolBrepAnalytic = rel(b.volume, extra.analytic); }
  ALL.push(r);
  return r;
}
const fmt = (x) => (typeof x === 'number' ? x.toExponential(1) : '-');
const line = (r) => `${r.label.padEnd(44)} planarSides=${String(r.planar ?? '-').padEnd(5)} OCCT ${r.occt.volume !== undefined ? r.occt.volume.toFixed(4) : 'REF[' + r.occt.refused + ']'} | truck ${r.truck.volume !== undefined ? r.truck.volume.toFixed(4) : 'REF[' + r.truck.refused + ']'} | an ${r.analytic !== undefined ? r.analytic.toFixed(4) : '-'} | dT/O ${fmt(r.dVolTruckOcct)} dT/An ${fmt(r.dVolTruckAnalytic)} dO/An ${fmt(r.dVolOcctAnalytic)} | faces O/T ${r.occt.faces}/${r.truck.faces} types ${JSON.stringify(r.truck.faceTypes ?? {})}`;
const OUT = {};
const log = (s) => console.log(s);

function polyPair(label, p, q, h = 20, extra = {}) {
  const P3 = to3(p, 0); const Q3 = to3(q, h);
  const planar = sidePlanarity(P3, Q3);
  const doc = { version: 1, features: [sk('a', 'xy', 0, p), sk('b', 'xy', h, q), bl('a', 'b')] };
  return fullCase(label, doc, { analytic: ruledVolume3D(P3, Q3), planar: planar.planar, maxDet: planar.maxDet, ...extra });
}
const scalePts = (p, k) => p.map(([x, y]) => [x * k, y * k]);

// =====================================================================================================================
// E1: the critic's 120 random same-count convex-ish pairs (identical generator + seed), with planarity flag
// =====================================================================================================================
{
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const poly = (n, r, jit) => { const a0 = rnd() * 0.3; return Array.from({ length: n }, (_, i) => { const a = a0 + 2 * Math.PI * i / n + (rnd() - .5) * jit; const rr = r * (0.7 + 0.6 * rnd()); return [rr * Math.cos(a) + (rnd() - .5) * 4, rr * Math.sin(a) + (rnd() - .5) * 4]; }); };
  const res = [];
  for (const n of [3, 4, 5, 6]) for (let k = 0; k < 30; k++) {
    const p = poly(n, 20, 0.3); const q = poly(n, 10, 0.3);
    const r = polyPair(`fuzz n=${n} k=${k}`, p, q, 20, { n, k });
    r.points = { p, q };
    if (r.dVolTruckOcct > 3e-4) { // scale probe: same shape at 0.1x and 10x
      for (const sc2 of [0.1, 10]) {
        const rr = polyPair(`fuzz n=${n} k=${k} x${sc2}`, scalePts(p, sc2), scalePts(q, sc2), 20 * sc2);
        r['scale_' + String(sc2).replace('.', 'p')] = { dVolTruckOcct: rr.dVolTruckOcct, dVolTruckAnalytic: rr.dVolTruckAnalytic };
      }
    }
    res.push(r);
  }
  OUT.E1 = res;
  const rows = [];
  for (const n of [3, 4, 5, 6]) {
    const r = res.filter((x) => x.n === n && x.dVolTruckOcct !== undefined);
    const nonplanar = r.filter((x) => !x.planar); const planar = r.filter((x) => x.planar);
    const bad = r.filter((x) => x.dVolTruckOcct > 3e-4);
    const sorted = r.map((x) => x.dVolTruckOcct).sort((a, b) => a - b);
    rows.push({ n, cases: r.length, planarSided: planar.length, nonPlanarSided: nonplanar.length, overBar: bad.length, overBarAndPlanar: bad.filter((x) => x.planar).length, maxDVol: Math.max(...sorted), medianDVol: sorted[sorted.length >> 1], truckOver: r.filter((x) => x.signedTruckMinusOcct > 3e-4).length, truckUnder: r.filter((x) => x.signedTruckMinusOcct < -3e-4).length, occtVsAnalyticMax: Math.max(...r.map((x) => x.dVolOcctAnalytic)), faceCountMismatch: r.filter((x) => x.occt.faces !== x.truck.faces).length, scale0p1Probed: r.filter((x) => x.scale_0p1).length, scale0p1Exact: r.filter((x) => x.scale_0p1 && x.scale_0p1.dVolTruckAnalytic < 1e-9).length, scale0p1OverBar: r.filter((x) => x.scale_0p1 && x.scale_0p1.dVolTruckAnalytic > 3e-4).length, scale10Exact: r.filter((x) => x.scale_10 && x.scale_10.dVolTruckAnalytic < 1e-9).length, scale10OverBar: r.filter((x) => x.scale_10 && x.scale_10.dVolTruckAnalytic > 3e-4).length });
  }
  OUT.E1summary = rows;
  log('E1 summary ' + JSON.stringify(rows));
  const worst = [...res].sort((a, b) => b.dVolTruckOcct - a.dVolTruckOcct).slice(0, 5).map((x) => `${x.label}: ${fmt(x.dVolTruckOcct)} (planar=${x.planar})`);
  log('E1 worst: ' + worst.join('; '));
}

// =====================================================================================================================
// E2: planar-sided population (every corresponding edge pair parallel) - the class the guard would let through
// =====================================================================================================================
{
  let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const convex = (n, r) => { const angs = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b); return angs.map((a) => { const rr = r * (0.8 + 0.4 * rnd()); return [rr * Math.cos(a), rr * Math.sin(a)]; }); };
  const res = [];
  for (const n of [3, 4, 5, 6]) for (let k = 0; k < 30; k++) {
    let p = convex(n, 20);
    // q edge i = lambda_i * edge i of p, with sum lambda_i e_i = 0: start from lambda=0.5, then correct inside the null space by least squares
    const e = p.map((a, i) => { const b = p[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; });
    let lam = Array.from({ length: n }, () => 0.35 + 0.5 * rnd());
    if (n > 3) { // project lam onto { sum lam_i e_i = 0 } (2 equations)
      for (let it = 0; it < 3; it++) {
        const sx = lam.reduce((s, l, i) => s + l * e[i][0], 0); const sy = lam.reduce((s, l, i) => s + l * e[i][1], 0);
        const M = [[0, 0], [0, 0]]; e.forEach((v) => { M[0][0] += v[0] * v[0]; M[0][1] += v[0] * v[1]; M[1][1] += v[1] * v[1]; }); M[1][0] = M[0][1];
        const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
        const mu = [(M[1][1] * sx - M[0][1] * sy) / det, (-M[1][0] * sx + M[0][0] * sy) / det];
        lam = lam.map((l, i) => l - (e[i][0] * mu[0] + e[i][1] * mu[1]));
      }
    } else lam = [lam[0], lam[0], lam[0]];
    if (lam.some((l) => l < 0.05)) { k--; continue; }
    const c = [rnd() * 6 - 3, rnd() * 6 - 3];
    const q = [[c[0], c[1]]]; for (let i = 0; i < n - 1; i++) q.push([q[i][0] + lam[i] * e[i][0], q[i][1] + lam[i] * e[i][1]]);
    const r = polyPair(`planar-sided n=${n} k=${k}`, p, q, 20, { n, k });
    r.points = { p, q };
    res.push(r);
  }
  OUT.E2 = res;
  const rows = [3, 4, 5, 6].map((n) => { const r = res.filter((x) => x.n === n && x.dVolTruckOcct !== undefined); return { n, cases: r.length, allPlanarFlag: r.every((x) => x.planar), maxDVolTruckOcct: Math.max(...r.map((x) => x.dVolTruckOcct)), maxDVolTruckAnalytic: Math.max(...r.map((x) => x.dVolTruckAnalytic)), maxDVolOcctAnalytic: Math.max(...r.map((x) => x.dVolOcctAnalytic)), faceMismatch: r.filter((x) => x.occt.faces !== x.truck.faces).length, maxDBbox: Math.max(...r.map((x) => x.dBboxTruckOcct)), brepBuilt: r.filter((x) => x.brep.volume !== undefined).length, maxBrepVsAnalytic: Math.max(...r.filter((x) => x.brep.volume !== undefined).map((x) => x.dVolBrepAnalytic)) }; });
  OUT.E2summary = rows;
  log('E2 summary ' + JSON.stringify(rows));
}

// =====================================================================================================================
// E3: named student shapes
// =====================================================================================================================
{
  const rect = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const rotate = (pts, deg) => { const c = Math.cos(deg * Math.PI / 180); const s = Math.sin(deg * Math.PI / 180); return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]); };
  const hex = (r) => [0, 1, 2, 3, 4, 5].map((i) => [r * Math.cos(Math.PI * i / 3), r * Math.sin(Math.PI * i / 3)]);
  const trap = (bw, tw, h) => [[-bw / 2, -h / 2], [bw / 2, -h / 2], [tw / 2, h / 2], [-tw / 2, h / 2]];
  const rhombus = (dx, dy) => [[0, -dy / 2], [dx / 2, 0], [0, dy / 2], [-dx / 2, 0]];
  const cases = [
    ['rhombus 40x20 -> rect 20x10', rhombus(40, 20), rect(20, 10), 20],
    ['rhombus 40x20 -> rhombus 20x10 (similar)', rhombus(40, 20), rhombus(20, 10), 20],
    ['rect 20x20 -> dart (concave kite)', rect(20, 20), [[-12, -10], [0, -2], [12, -10], [0, 14]], 20],
    ['trapezoid 40/20x20 -> rect 20x10', trap(40, 20, 20), rect(20, 10), 20],
    ['trapezoid 40/20x20 -> same trapezoid half size', trap(40, 20, 20), trap(20, 10, 10), 20],
    ['trapezoid 40/20x20 -> trapezoid 20/20x10', trap(40, 20, 20), trap(20, 20, 10), 20],
    ['rect 40x20 -> trapezoid 20/10x10', rect(40, 20), trap(20, 10, 10), 20],
    ['triangle [[0,0],[40,0],[0,30]] -> [[5,5],[15,5],[5,12]] (gap20)', [[0, 0], [40, 0], [0, 30]], [[5, 5], [15, 5], [5, 12]], 20],
    ['triangle right 40x30 -> similar half size', [[0, 0], [40, 0], [0, 30]], [[0, 0], [20, 0], [0, 15]], 20],
    ['triangle isosceles -> other triangle', [[-20, 0], [20, 0], [0, 30]], [[-5, 0], [10, 0], [2, 8]], 20],
    ['hexagon r20 -> hexagon r8 (homothetic)', hex(20), hex(8), 25],
    ['hexagon r20 -> hexagon r8 rotated 30', hex(20), rotate(hex(8), 30), 25],
    ...[2, 5, 10, 15, 20, 30, 45, 60, 90].map((d) => [`rect 20x20 -> same rect rotated ${d} deg`, rect(20, 20), rotate(rect(20, 20), d), 20]),
    ...[2, 5, 20].map((d) => [`rect 30x20 -> same rect rotated ${d} deg`, rect(30, 20), rotate(rect(30, 20), d), 20]),
  ];
  OUT.E3 = cases.map(([label, p, q, h]) => { const r = polyPair(label, p, q, h); r.points = { p, q, h }; log(line(r)); return r; });
}

// =====================================================================================================================
// E4: non-parallel frame planes: tilt sweep (script text path, sketch({origin,u,v}) on both)
// =====================================================================================================================
{
  OUT.E4 = [];
  for (const deg of [1, 5, 10, 15, 22.5, 30, 36.8699, 45, 60, 75, 90]) {
    const c = Math.cos(deg * Math.PI / 180); const s = Math.sin(deg * Math.PI / 180);
    const src = `const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,30], u: [1,0,0], v: [0,${c},${s}] }); b.rect(10, 10); blend(a, b, 30);`;
    const run = runScript(src);
    const doc = solveDoc({ version: 1, features: run.doc.features });
    const P3 = tiltTo3(rectPts(40), [0, 0, 0], [1, 0, 0], [0, 1, 0]); const Q3 = tiltTo3(rectPts(10), [0, 0, 30], [1, 0, 0], [0, c, s]);
    const pl = sidePlanarity(P3, Q3);
    const r = fullCase(`tilt ${deg} deg`, doc, { analytic: ruledVolume3D(P3, Q3), planar: pl.planar, maxDet: pl.maxDet, scriptErrors: run.errors.map((e) => e.message ?? String(e)), deg });
    OUT.E4.push(r); log(line(r));
  }
}
function rectPts(w) { return [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]]; }

// =====================================================================================================================
// E5: ModelDoc-level target counts; L(6) -> rect(4); bowtie validity
// =====================================================================================================================
{
  const R = (w) => rectPts(w);
  OUT.E5 = {};
  const three = fullCase('3 targets 40@0, 20@20, 10@40', { version: 1, features: [sk('a', 'xy', 0, R(40)), sk('b', 'xy', 20, R(20)), sk('c', 'xy', 40, R(10)), bl('a', 'b', 'c')] });
  three.piecewiseAnalytic = ruledVolume3D(to3(R(40), 0), to3(R(20), 20)) + ruledVolume3D(to3(R(20), 20), to3(R(10), 40));
  three.firstLastAnalytic = ruledVolume3D(to3(R(40), 0), to3(R(10), 40));
  OUT.E5.three = three; log(line(three) + ` piecewise=${three.piecewiseAnalytic.toFixed(4)} firstLast=${three.firstLastAnalytic.toFixed(4)}`);
  const three2 = fullCase('3 targets 40@0, 40@20, 10@40 (middle off the straight line)', { version: 1, features: [sk('a', 'xy', 0, R(40)), sk('b', 'xy', 20, R(40)), sk('c', 'xy', 40, R(10)), bl('a', 'b', 'c')] });
  three2.piecewiseAnalytic = ruledVolume3D(to3(R(40), 0), to3(R(40), 20)) + ruledVolume3D(to3(R(40), 20), to3(R(10), 40));
  three2.firstLastAnalytic = ruledVolume3D(to3(R(40), 0), to3(R(10), 40));
  OUT.E5.three2 = three2; log(line(three2) + ` piecewise=${three2.piecewiseAnalytic.toFixed(4)} firstLast=${three2.firstLastAnalytic.toFixed(4)}`);
  const one = fullCase('1 target', { version: 1, features: [sk('a', 'xy', 0, R(40)), bl('a')] });
  OUT.E5.one = one; log(line(one));
  const zero = fullCase('0 targets', { version: 1, features: [sk('a', 'xy', 0, R(40)), bl()] });
  OUT.E5.zero = zero; log(line(zero));
  const Lsh = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]];
  const Lr = fullCase('L (6 corners) -> rect 20x15 (4 corners)', { version: 1, features: [sk('a', 'xy', 0, Lsh), sk('b', 'xy', 20, [[0, 0], [20, 0], [20, 15], [0, 15]]), bl('a', 'b')] });
  OUT.E5.L = Lr; log(line(Lr));
  const bow = fullCase('bowtie section b', { version: 1, features: [sk('a', 'xy', 0, R(20)), sk('b', 'xy', 20, [[-5, -5], [5, 5], [5, -5], [-5, 5]]), bl('a', 'b')] });
  OUT.E5.bowtie = bow; log(line(bow) + ` OCCT valid=${bow.occt.valid}`);
  const col = fullCase('collinear section b', { version: 1, features: [sk('a', 'xy', 0, R(20)), sk('b', 'xy', 20, [[0, 0], [10, 0], [20, 0]]), bl('a', 'b')] });
  OUT.E5.collinear = col; log(line(col));
}

// =====================================================================================================================
// E6: exact sentences a student sees from the script layer (blend and loft spellings), what the script does after the error
// =====================================================================================================================
{
  const pre = `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); `;
  const calls = [
    'blend(a, b, 30, 5);', "blend(a, b, 30, 'zzz');", 'blend(a, b, 30, { height: 30 });', 'blend(a, b, 30, 5, 6);',
    'loft(a, b, 30, 5);', 'loft(a, b);', 'blend(a, b);', 'loft(a);', 'blend(a);', 'loft(a, b, "tall");', 'loft(a, 7, 30);',
    'const c = sketch("top"); c.rect(5, 5); blend(a, b, c, 30);', 'const c = sketch("top"); c.rect(5, 5); loft(a, b, c, 30);',
    'blend(a, a, 30);', 'blend(a, b, 0);', 'blend(a, b, 30); const k = cuboid(5,5,5);',
  ];
  OUT.E6 = calls.map((c) => {
    const run = runScript(pre + c);
    return { call: c, errors: run.errors.map((e) => e.message ?? String(e)), featureKinds: run.doc.features.map((f) => f.kind), hasBlend: run.doc.features.some((f) => f.kind === 'blend') };
  });
  const after = runScript(pre + 'blend(a, b, 30, 5); const k = cuboid(5, 5, 5);');
  OUT.E6.push({ call: '(statement AFTER a refused blend: cuboid)', errors: after.errors.map((e) => e.message ?? String(e)), featureKinds: after.doc.features.map((f) => f.kind), hasBlend: false });
  for (const r of OUT.E6) log(`E6 ${r.call.slice(0, 70).padEnd(70)} -> errors=${JSON.stringify(r.errors)} kinds=${r.featureKinds.join(',')}`);
}

// =====================================================================================================================
// E7: the critic's L (6 corners, concave) -> small rect (4 corners) where OCCT throws
// =====================================================================================================================
{
  const L = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  const r = fullCase('critic L (6) -> rect 10x10 at (10,10) (4 corners)', { version: 1, features: [sk('a', 'xy', 0, L), sk('b', 'xy', 20, [[5, 5], [15, 5], [15, 15], [5, 15]]), bl('a', 'b')] });
  OUT.E7 = r; log(line(r));
}

// =====================================================================================================================
// E8: polygon <-> circle sweep, the lesson-text example, and concentric circle -> circle on all three engines
// =====================================================================================================================
{
  OUT.E8 = [];
  const reg = (n, r, ph) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n + ph), r * Math.sin(2 * Math.PI * i / n + ph)]);
  for (const n of [3, 5, 6, 8]) for (const ph of [0, 0.3]) {
    for (const dir of ['poly->circle', 'circle->poly']) {
      const polySk = (id, off) => sk(id, 'xy', off, reg(n, 20, ph));
      const circSk = (id, off) => sk(id, 'xy', off, [[-10, 0], [10, 0]], { shape: 'circle' });
      const feats = dir === 'poly->circle' ? [polySk('a', 0), circSk('b', 25), bl('a', 'b')] : [circSk('a', 0), polySk('b', 25), bl('a', 'b')];
      const r = fullCase(`${dir} n=${n} phase=${ph}rad`, { version: 1, features: feats }); r.n = n; r.phase = ph; r.dir = dir;
      OUT.E8.push(r); log(line(r));
    }
  }
  const lesson = runScript(`const sk1 = sketch('top')\nsk1.rect(40, 40)\nconst sk2 = sketch('top', 30)\nsk2.rect(20, 20)\nconst shape = loft(sk1, sk2, 30)`);
  const lr = fullCase('lesson example 40x40 -> 20x20 gap 30', solveDoc({ version: 1, features: lesson.doc.features }), { analytic: 10 * (1600 + 400 + 800), scriptErrors: lesson.errors.map((e) => e.message ?? String(e)) });
  OUT.E8lesson = lr; log(line(lr));
  const cc = runScript(`const sk1 = sketch('top')\nsk1.circle(20)\nconst sk2 = sketch('top', 30)\nsk2.circle(10)\nconst shape = loft(sk1, sk2, 30)`);
  const cr = fullCase('lesson-text claim: loft between two circles', solveDoc({ version: 1, features: cc.doc.features }), { analytic: Math.PI * 30 / 3 * (100 + 50 + 25), scriptErrors: cc.errors.map((e) => e.message ?? String(e)) });
  OUT.E8circles = cr; log(line(cr));
}

// =====================================================================================================================
// E9: geometry-free check of the non-planar-skin error: a mirror image has exactly the same volume, so truck(solid) must equal truck(mirror) if its number were geometric
// =====================================================================================================================
{
  OUT.E9 = [];
  const mirror = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
  const rotate = (pts, deg) => { const c = Math.cos(deg * Math.PI / 180); const s2 = Math.sin(deg * Math.PI / 180); return pts.map(([x, y]) => [x * c - y * s2, x * s2 + y * c]); };
  const sq = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const pairs = [...[2, 5, 20, 30].map((d) => [`square twist +${d} deg`, sq, rotate(sq, d)])];
  const e1 = OUT.E1.filter((x) => x.dVolTruckOcct > 3e-4).slice(0, 12);
  for (const x of e1) pairs.push([`${x.label} (random non-planar)`, x.points.p, x.points.q]);
  for (const [label, p, q] of pairs) {
    const o = polyPair(label, p, q, 20); const m = polyPair(label + ' MIRRORED', mirror(p), mirror(q), 20);
    const row = { label, truckVol: o.truck.volume, truckVolMirror: m.truck.volume, occtVol: o.occt.volume, occtVolMirror: m.occt.volume, analytic: o.analytic, analyticMirror: m.analytic, dTruckVsMirror: rel(o.truck.volume, m.truck.volume), dOcctVsMirror: rel(o.occt.volume, m.occt.volume), dTruckOcct: o.dVolTruckOcct, dTruckOcctMirror: m.dVolTruckOcct };
    OUT.E9.push(row); log(`E9 ${label.padEnd(46)} truck ${row.truckVol.toFixed(4)} vs mirror ${row.truckVolMirror.toFixed(4)} (d ${fmt(row.dTruckVsMirror)}); OCCT ${row.occtVol.toFixed(4)} vs mirror ${row.occtVolMirror.toFixed(4)} (d ${fmt(row.dOcctVsMirror)}); dT/O ${fmt(row.dTruckOcct)} / mirror ${fmt(row.dTruckOcctMirror)}`);
  }
  log('E9 summary: truck differs from its own mirror image (>1e-6) in ' + OUT.E9.filter((r) => r.dTruckVsMirror > 1e-6).length + ' of ' + OUT.E9.length + '; OCCT differs from its mirror in ' + OUT.E9.filter((r) => r.dOcctVsMirror > 1e-9).length);
}



// ---- N1 poly/circle matrix ----
{
const reg = (n, r, ph, c=[0,0]) => Array.from({ length: n }, (_, i) => [c[0]+r * Math.cos(2 * Math.PI * i / n + ph), c[1]+r * Math.sin(2 * Math.PI * i / n + ph)]);
const circ = (id, off, d=20, c=[0,0]) => sk(id, 'xy', off, [[c[0]-d/2, c[1]], [c[0]+d/2, c[1]]], { shape: 'circle' });
const row = (label, polyPts, dir, extra={}) => {
  const P = sk(dir==='p->c'?'a':'b','xy',dir==='p->c'?0:25,polyPts); const C = circ(dir==='p->c'?'b':'a', dir==='p->c'?25:0, extra.d??20, extra.c??[0,0]);
  const feats = dir==='p->c' ? [P,C,bl('a','b')] : [C,P,bl('a','b')];
  const r = fullCase(label+' '+dir, { version:1, features: feats });
  console.log(`${r.label.padEnd(58)} O ${r.occt.volume?.toFixed(3) ?? 'REF'} T ${r.truck.volume?.toFixed(3) ?? 'REF'} dT/O ${fmt(r.dVolTruckOcct)} signed ${fmt(r.signedTruckMinusOcct)} faces ${r.occt.faces}/${r.truck.faces}`);
  return r;
};
const R = [];
for (const n of [3,4,5,6,8]) for (const ph of [0, Math.PI/n, 0.3, 1.0]) for (const dir of ['p->c','c->p']) R.push(row(`reg n=${n} ph=${ph.toFixed(3)}`, reg(n,20,ph), dir));
for (const [w,h] of [[40,40],[40,30],[40,20],[40,10],[30,40]]) for (const dir of ['p->c','c->p']) R.push(row(`rect ${w}x${h}`, [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]], dir));
for (const dir of ['p->c','c->p']) {
  R.push(row('irr tri [[12,0],[-4,9],[-6,-5]] vs d60', [[12,0],[-4,9],[-6,-5]], dir, {d:60}));
  R.push(row('irr quad [[12,0],[0,6],[-8,0],[0,-10]] vs d60', [[12,0],[0,6],[-8,0],[0,-10]], dir, {d:60}));
  R.push(row('irr tri [[20,0],[-8,14],[-12,-9]] vs d20', [[20,0],[-8,14],[-12,-9]], dir, {d:20}));
  R.push(row('L [[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]] vs d20 c(10,10)', [[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]], dir, {d:20,c:[10,10]}));
  R.push(row('L centered vertex0 at(20,0)', [[20,0],[20,10],[-10,10],[-10,-10],[0,-10],[0,0]], dir, {d:20}));
}
for (const deg of [0,10,15,30,45,60,75,90]) for (const dir of ['p->c','c->p']) { const a=deg*Math.PI/180; R.push(row(`square r28.28 rot ${deg}`, reg(4,Math.SQRT2*20,Math.PI/4+a), dir)); }
for (const c of [[5,3],[15,-8]]) for (const dir of ['p->c','c->p']) R.push(row(`reg hex ph0 circle off-centre ${c}`, reg(6,20,0), dir, {c}));
OUT.E10 = R.map(r => ({label:r.label, occt:r.occt.volume, truck:r.truck.volume, brep:r.brep.volume, d:r.dVolTruckOcct, signed:r.signedTruckMinusOcct, faces:[r.occt.faces,r.truck.faces]}));

}
// ---- N2 rect-circle grid, circle-circle ----
{
const circ = (id, off, d=20, c=[0,0]) => sk(id, 'xy', off, [[c[0]-d/2, c[1]], [c[0]+d/2, c[1]]], { shape: 'circle' });
const rectc = (w,h,c=[0,0]) => [[c[0]-w/2,c[1]-h/2],[c[0]+w/2,c[1]-h/2],[c[0]+w/2,c[1]+h/2],[c[0]-w/2,c[1]+h/2]];
const pr = (r) => `O ${r.occt.volume?.toFixed(3) ?? 'REF['+r.occt.refused+']'} T ${r.truck.volume?.toFixed(3) ?? 'REF['+r.truck.refused+']'} B ${r.brep.volume?.toFixed(3) ?? 'REF'} dT/O ${fmt(r.dVolTruckOcct)} faces ${r.occt.faces}/${r.truck.faces}`;
OUT.XA = {};
// X1 rect aspect/size grid vs circle
OUT.XA.rc = [];
for (const [w,h] of [[40,40],[40,26.7],[40,20],[40,16],[40,13.3],[40,10],[60,20],[20,40]]) for (const d of [10,20,30,50]) for (const dir of ['p->c','c->p']) {
  const P = sk(dir==='p->c'?'a':'b','xy',dir==='p->c'?0:25,rectc(w,h)); const C = circ(dir==='p->c'?'b':'a', dir==='p->c'?25:0, d);
  const r = fullCase(`rect ${w}x${h} d${d} ${dir}`, {version:1, features: dir==='p->c'?[P,C,bl('a','b')]:[C,P,bl('a','b')]});
  OUT.XA.rc.push({label:r.label, d:r.dVolTruckOcct, o:r.occt.volume, t:r.truck.volume});
  if (r.dVolTruckOcct>1e-4 || r.dVolTruckOcct===undefined) console.log(r.label.padEnd(34), pr(r));
}
console.log('rect-circle grid', OUT.XA.rc.length, 'max', fmt(Math.max(...OUT.XA.rc.map(x=>x.d))), 'over 3e-4:', OUT.XA.rc.filter(x=>x.d>3e-4).length);
// X2 off-centre rect vs circle
for (const c of [[5,3],[12,-7],[0,20]]) for (const dir of ['p->c','c->p']) {
  const P = sk(dir==='p->c'?'a':'b','xy',dir==='p->c'?0:25,rectc(30,20,c)); const C = circ(dir==='p->c'?'b':'a', dir==='p->c'?25:0, 20);
  const r = fullCase(`rect 30x20 at ${c} vs d20@0 ${dir}`, {version:1, features: dir==='p->c'?[P,C,bl('a','b')]:[C,P,bl('a','b')]}); console.log(r.label.padEnd(44), pr(r));
}
// X4 circle-circle
console.log('--- circle circle');
for (const [d1,d2,c1,c2] of [[20,10,[0,0],[0,0]],[20,30,[0,0],[0,0]],[20,10,[0,0],[8,5]],[40,5,[0,0],[0,0]],[20,20,[0,0],[10,0]]]) {
  const r = fullCase(`circle d${d1}@${c1} -> d${d2}@${c2}`, {version:1, features:[circ('a',0,d1,c1),circ('b',30,d2,c2),bl('a','b')]}); console.log(r.label.padEnd(40), pr(r)); OUT.XA.cc = (OUT.XA.cc||[]).concat({label:r.label,d:r.dVolTruckOcct});
}

}
// ---- N3 rounded ----
{
const pr = (r) => `O ${r.occt.volume?.toFixed(3) ?? 'REF['+r.occt.refused+']'} T ${r.truck.volume?.toFixed(3) ?? 'REF['+r.truck.refused+']'} B ${r.brep.volume?.toFixed(3) ?? 'REF'} dT/O ${fmt(r.dVolTruckOcct)} faces ${r.occt.faces}/${r.truck.faces}`;
const rd = (v, rad) => [1,2,3,4].map(k=>`${v}.round(${k}, ${rad}); `).join('');
const rs = (lab, src) => { const run = runScript(src); if (run.errors.length) { console.log(lab,'ERR',run.errors.map(e=>e.message)); return; } const r = fullCase(lab, solveDoc({version:1,features:run.doc.features})); console.log(lab.padEnd(44), pr(r)); return r; };
OUT.XB = { rr: [] };
for (const [w,h,rad,d] of [[40,40,6,20],[40,40,3,20],[40,40,10,20],[40,30,5,20],[40,20,5,20],[40,40,19,20]]) for (const dir of ['p->c','c->p']) {
  const A = dir==='p->c' ? `const a = sketch('top'); a.rect(${w},${h}); ${rd('a',rad)}` : `const a = sketch('top'); a.circle(${d}); `;
  const B = dir==='p->c' ? `const b = sketch('top'); b.circle(${d}); ` : `const b = sketch('top'); b.rect(${w},${h}); ${rd('b',rad)}`;
  const r = rs(`rounded ${w}x${h} r${rad} d${d} ${dir}`, A+B+'loft(a,b,30);'); if (r) OUT.XB.rr.push({label:r.label,d:r.dVolTruckOcct,o:r.occt.volume,t:r.truck.volume});
}
rs('rounded40 r6 -> rounded20 r3', `const a=sketch('top'); a.rect(40,40); ${rd('a',6)} const b=sketch('top'); b.rect(20,20); ${rd('b',3)} loft(a,b,30);`);
rs('rounded40 r6 -> rounded20 r6', `const a=sketch('top'); a.rect(40,40); ${rd('a',6)} const b=sketch('top'); b.rect(20,20); ${rd('b',6)} loft(a,b,30);`);
rs('rounded40 r6 -> rounded20 r3 (1.5 ratio)', `const a=sketch('top'); a.rect(40,40); ${rd('a',6)} const b=sketch('top'); b.rect(20,20); ${rd('b',3)} loft(a,b,30);`);
rs('rounded40 r6 -> rect20', `const a=sketch('top'); a.rect(40,40); ${rd('a',6)} const b=sketch('top'); b.rect(20,20); loft(a,b,30);`);
rs('only 1 corner rounded r6 -> circle', `const a=sketch('top'); a.rect(40,40); a.round(1,6); const b=sketch('top'); b.circle(20); loft(a,b,30);`);
rs('rounded40x30 r5 -> circle d20 off', `const a=sketch('top'); a.rect(40,30); ${rd('a',5)} const b=sketch('top'); b.circle(20); loft(a,b,30);`);

}
// ---- N4 shifts, triangles, twists, ties ----
{
const pr = (r) => `O ${r.occt.volume?.toFixed(4) ?? 'REF['+r.occt.refused+']'} T ${r.truck.volume?.toFixed(4) ?? 'REF['+r.truck.refused+']'} B ${r.brep.volume?.toFixed(4) ?? 'REF['+(r.brep.refused??'').slice(0,40)+']'} dT/O ${fmt(r.dVolTruckOcct)} faces ${r.occt.faces}/${r.truck.faces}/${r.brep.faces}`;
const area2 = (p) => p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0);
const ccw = (p) => area2(p)>0 ? p : [...p].reverse();
const shiftL = (p,s) => p.map((_,i)=>p[(i+s)%p.length]);
// geometric (positive-parallel) shift s*, among CCW-normalised polygons
const parShifts = (p,q) => { const P=ccw(p),Q=ccw(q),n=P.length; if (Q.length!==n) return []; const e=(X,i)=>{const a=X[i],b=X[(i+1)%n];return [b[0]-a[0],b[1]-a[1]];}; const out=[]; for (let s=0;s<n;s++){ let ok=true; for(let i=0;i<n&&ok;i++){const u=e(P,i),v=e(Q,(i+s)%n); const cr=u[0]*v[1]-u[1]*v[0]; const d=u[0]*v[0]+u[1]*v[1]; if(Math.abs(cr)>1e-9*Math.hypot(...u)*Math.hypot(...v)||d<=0) ok=false;} if(ok) out.push(s);} return out; };
OUT.X4 = [];
const trial = (label, p, q, h=20) => {
  const P3 = to3(p,0), Q3 = to3(q,h);
  const doc = { version:1, features:[sk('a','xy',0,p), sk('b','xy',h,q), bl('a','b')] };
  const r = fullCase(label, doc, { analytic: ruledVolume3D(P3,Q3) });
  const ps = parShifts(p,q); const Pc=ccw(p), Qc=ccw(q);
  const geo = ps.length===1 ? ruledVolume3D(to3(Pc,0), to3(shiftL(Qc,ps[0]),h)) : undefined;
  const idxV = ruledVolume3D(to3(Pc,0), to3(Qc,h));
  r.parShifts = ps; r.geoVol = geo; r.indexVol = idxV;
  console.log(label.padEnd(46), pr(r), `| parShifts ${JSON.stringify(ps)} geo ${geo?.toFixed(4)} idx ${idxV.toFixed(4)} brep-vs-geo ${r.brep.volume!==undefined&&geo!==undefined?fmt(rel(r.brep.volume,geo)):'-'}`);
  OUT.X4.push({label, p, q, h, occt:r.occt.volume, truck:r.truck.volume, brep:r.brep.volume, brepRefused:r.brep.refused, dTO:r.dVolTruckOcct, parShifts:ps, geoVol:geo, indexVol:idxV, faces:[r.occt.faces,r.truck.faces,r.brep.faces]});
  return r;
};
const R40x30 = [[0,0],[40,0],[40,30],[0,30]], R20x15 = [[10,7.5],[30,7.5],[30,22.5],[10,22.5]];
console.log('--- start-shifted rect (b listed from each corner), CCW and CW');
for (let s=0;s<4;s++) trial(`rect40x30 -> rect20x15 CCW start+${s}`, R40x30, shiftL(R20x15,s));
for (let s=0;s<4;s++) trial(`rect40x30 -> rect20x15 CW start+${s}`, R40x30, shiftL([...R20x15].reverse(),s));
trial('critic: 40x30 -> b=[[20,15],[0,15],[0,0],[20,0]]', R40x30, [[20,15],[0,15],[0,0],[20,0]]);
const L = [[0,0],[40,0],[40,10],[10,10],[10,30],[0,30]]; const Lh = L.map(([x,y])=>[x/2+5,y/2+5]);
console.log('--- L');
for (let s=0;s<6;s++) trial(`L -> half L start+${s}`, L, shiftL(Lh,s));
const Lm = L.map(([x,y])=>[-x,y]).reverse(); const Lmh = Lh.map(([x,y])=>[-x+50,y]).reverse();
for (let s=0;s<6;s+=2) trial(`L -> mirrored half L start+${s}`, L, shiftL(Lmh,s));
trial('mirrored L -> mirrored half L', Lm, Lmh);
console.log('--- triangles');
const T = [[0,0],[40,0],[20,30]], Th=[[10,5],[30,5],[20,20]];
for (let s=0;s<3;s++) trial(`tri -> half tri start+${s}`, T, shiftL(Th,s));
trial('tri -> tri rotated 180 (flip)', T, Th.map(([x,y])=>[40-x,30-y]));
trial('tri -> tri rotated 60', T, (()=>{const c=[20,10];const a=Math.PI/3;return Th.map(([x,y])=>[c[0]+(x-20)*Math.cos(a)-(y-10)*Math.sin(a), c[1]+(x-20)*Math.sin(a)+(y-10)*Math.cos(a)]);})());
console.log('--- twist table 40x40 -> rotated 20x20 and same-size squares');
const sqp = (w,ang)=>{const a=ang*Math.PI/180;return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[w/2*(x*Math.cos(a)-y*Math.sin(a)), w/2*(x*Math.sin(a)+y*Math.cos(a))]);};
for (const ang of [0,5,10,20,30,40,44,45,46,50,60,70,80,90]) trial(`square40 -> square20 rot ${ang}`, sqp(40,0), sqp(20,ang));
for (const ang of [10,44,45,60,70]) trial(`square20 -> square20 rot ${ang}`, sqp(20,0), sqp(20,ang));
console.log('--- tie cases');
const regP = (n,r,ph)=>Array.from({length:n},(_,i)=>[r*Math.cos(2*Math.PI*i/n+ph), r*Math.sin(2*Math.PI*i/n+ph)]);
trial('tri r20 -> tri r10 rot 60 (tie)', regP(3,20,0), regP(3,10,Math.PI/3));
trial('tri r20 -> tri r10 rot 180 (tie)', regP(3,20,0), regP(3,10,Math.PI));
trial('pentagon r20 -> pentagon r10 rot 36 (tie)', regP(5,20,0), regP(5,10,Math.PI/5));
trial('square r20 -> square r10 rot 45 (tie)', regP(4,20,Math.PI/4), regP(4,10,Math.PI/2));
trial('hexagon r20 -> hexagon r10 rot 30 (tie)', regP(6,20,0), regP(6,10,Math.PI/6));
trial('hexagon r20 -> hexagon r10 rot 29', regP(6,20,0), regP(6,10,29*Math.PI/180));
trial('hexagon r20 -> hexagon r10 rot 31', regP(6,20,0), regP(6,10,31*Math.PI/180));

}
// ---- N5 collinear + twist constructions ----
{
const pr = (r) => `O ${r.occt.volume?.toFixed(4) ?? 'REF['+(r.occt.refused??'').slice(0,50)+']'} T ${r.truck.volume?.toFixed(4) ?? 'REF['+(r.truck.refused??'').slice(0,60)+']'} B ${r.brep.volume?.toFixed(4) ?? 'REF['+(r.brep.refused??'').slice(0,40)+']'} dT/O ${fmt(r.dVolTruckOcct)} faces ${r.occt.faces}/${r.truck.faces}/${r.brep.faces}`;
function rectPts(w) { return [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]]; }
OUT.X5 = {};
const t5 = (label, p, q, h=20, ref=null) => { const doc={version:1,features:[sk('a','xy',0,p),sk('b','xy',h,q),bl('a','b')]}; const an = ref ? ruledVolume3D(to3(ref[0],0),to3(ref[1],h)) : (p.length===q.length ? ruledVolume3D(to3(p,0),to3(q,h)) : undefined); const r=fullCase(label,doc,{analytic:an}); console.log(label.padEnd(50), pr(r), 'closed', r.analytic?.toFixed(4)); return r; };
console.log('--- redundant collinear vertex');
const mid5 = [[-20,-20],[0,-20],[20,-20],[20,20],[-20,20]];
OUT.X5.coll = [];
const R4=[rectPts(40),rectPts(20)];
for (const [lab,p,q,ref] of [
 ['rect40 + midpoint (5) -> rect20 (4)', mid5, rectPts(20), R4],
 ['rect20 (4) -> rect40 + midpoint (5)', rectPts(20), mid5, [rectPts(20),rectPts(40)]],
 ['rect40 mid (5) -> rect20 mid (5) same side', mid5, [[-10,-10],[0,-10],[10,-10],[10,10],[-10,10]], R4],
 ['rect40 mid (5) -> rect20 mid (5) other side', mid5, [[-10,-10],[10,-10],[10,0],[10,10],[-10,10]], R4],
 ['rect40 mid (5) -> rect20 mid (5) other side, start shifted', mid5, [[10,0],[10,10],[-10,10],[-10,-10],[10,-10]], R4],
]) { const r = t5(lab,p,q,30,ref); OUT.X5.coll.push({label:lab, occt:r.occt.volume, truck:r.truck.volume, brep:r.brep.volume, brepRefused:r.brep.refused, closed:r.analytic, d:r.dVolTruckOcct, faces:[r.occt.faces,r.truck.faces]}); }
console.log('--- twist constructions: 40x40 -> 20x20 rotated; variants of centring/start');
const rotAbout = (pts,deg,c) => { const a=deg*Math.PI/180; return pts.map(([x,y])=>[c[0]+(x-c[0])*Math.cos(a)-(y-c[1])*Math.sin(a), c[1]+(x-c[0])*Math.sin(a)+(y-c[1])*Math.cos(a)]); };
OUT.X5.twist = [];
for (const ang of [10,20,40,44,46]) {
  for (const [vname, p, q] of [
    ['centred, both from (-,-)', rectPts(40), rotAbout(rectPts(20),ang,[0,0])],
    ['a corner at origin [0,40], b centre (20,20)', [[0,0],[40,0],[40,40],[0,40]], rotAbout([[10,10],[30,10],[30,30],[10,30]],ang,[20,20])],
    ['a centred, b rotated about its first corner', rectPts(40), rotAbout(rectPts(20),ang,[-10,-10])],
    ['a centred, b rotated about origin of a CW listed', rectPts(40), rotAbout(rectPts(20),ang,[0,0]).reverse()],
    ['a centred, b = rotated 20x20 list started at 3rd vertex', rectPts(40), (()=>{const b=rotAbout(rectPts(20),ang,[0,0]);return [b[2],b[3],b[0],b[1]];})()],
  ]) { const r = t5(`twist ${ang} deg: ${vname}`, p, q); OUT.X5.twist.push({ang, vname, d:r.dVolTruckOcct, dOc: r.dVolOcctAnalytic, occt:r.occt.volume, truck:r.truck.volume, closed:r.analytic}); }
}

}
// ---- N6 gap series, undrawn, reuse, datum ----
{
const f4 = (x) => (typeof x === 'number' ? x.toFixed(4) : String(x));
OUT.X6 = {};
const meas = (doc, id) => ({ o: occtMeasure(doc,id), b: brepMeasure(doc,id), t: (() => { try { return truckMeasure(doc,id); } catch (e) { return { refused: 'threw ' + e.message }; } })() });
const show = (lab, m) => console.log(lab.padEnd(52), `O ${m.o.volume!==undefined?f4(m.o.volume):'REF['+(m.o.refused??'').slice(0,40)+']'} B ${m.b.volume!==undefined?f4(m.b.volume):'REF['+(m.b.refused??'').slice(0,50)+']'} T ${m.t.volume!==undefined?f4(m.t.volume):'REF['+(m.t.refused??'').slice(0,60)+']'}`);
const scr = (src) => { const run = runScript(src); return { run, doc: solveDoc({ version: 1, features: run.doc.features }) }; };
console.log('--- gap series');
OUT.X6.gap = [];
for (const g of [0, 1e-12, 1e-9, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) {
  const gsrc = `const a = sketch('top'); a.rect(40,40); const b = sketch('top'); b.rect(10,10); loft(a, b, ${g});`; const { doc, run } = scr(gsrc); const gg = guardedRun(gsrc, { runScript, solveDoc, arc }); const gcode = [...gg.verdicts.values()][0]?.code ?? 'PASS';
  const m = meas(doc, 'bl1'); show(`gap ${g} guard=${gcode}`, m);
  const exact = (40*40+40*10+10*10)/3*g; // frustum 1/3 h (A1 + sqrt(A1A2) + A2)
  OUT.X6.gap.push({ g, guard: gcode, errs: run.errors.map(e=>e.message), occt: m.o.volume, brep: m.b.volume, brepRef: m.b.refused, truck: m.t.volume, truckRef: m.t.refused, truckFaces: m.t.faces, occtFaces: m.o.faces, exact });
}
console.log('--- undrawn second sketch');
{
  const s1 = scr(`const a = sketch('top'); a.rect(40,40); const b = sketch('top'); loft(a, b, 30);`);
  const m = meas(s1.doc,'bl1'); show('undrawn b (default starter outline)', m); console.log('  errors', s1.run.errors.map(e=>e.message), 'b points', JSON.stringify(s1.doc.features.find(f=>f.id==='sk2').points));
  OUT.X6.undrawn = { errs: s1.run.errors.map(e=>e.message), pts: s1.doc.features.find(f=>f.id==='sk2').points, occt:m.o.volume, brep:m.b.volume, brepRef:m.b.refused, truck:m.t.volume, expectedIfStarter: undefined };
  const s2 = scr(`const a = sketch('top'); a.rect(40,25); const b = sketch('top'); b.rect(40,25); loft(a, b, 30);`);
  console.log('  rect(40,25) points', JSON.stringify(s2.doc.features.find(f=>f.id==='sk1').points));
  const s3 = scr(`const a = sketch('top'); const b = sketch('top'); b.rect(10,10); loft(a, b, 30);`);
  const m3 = meas(s3.doc,'bl1'); show('undrawn FIRST sketch', m3); OUT.X6.undrawnFirst = { occt:m3.o.volume, brep:m3.b.volume, brepRef:m3.b.refused, truck:m3.t.volume };
  const s4 = scr(`const a = sketch('top'); a.polygon([[0,0],[40,0],[40,25],[0,25]]); const b = sketch('top'); b.rect(10,10); loft(a, b, 30);`);
  console.log('  polygon starter-lookalike errors', s4.run.errors.map(e=>e.message), JSON.stringify(s4.doc.features.find(f=>f.id==='sk1')?.points));
}
console.log('--- sketch reuse');
OUT.X6.reuse = {};
{
  const A = scr(`const a = sketch('top'); a.rect(40,40); const b = sketch('top'); b.rect(20,20); const l1 = loft(a, b, 30); const l2 = loft(a, b, 10); move(l1, [100,0,0]);`);
  console.log('  errs', A.run.errors.map(e=>e.message), 'kinds', A.doc.features.map(f=>f.id+':'+f.kind+(f.offset!==undefined?'@'+f.offset:'')).join(' '));
  const m1 = meas(A.doc,'bl1'); show('l1 after l2 rewrites b (expect 28000)', m1); const m2 = meas(A.doc,'bl2'); show('l2 (expect 9333.33)', m2);
  OUT.X6.reuse.twoLofts = { features: A.doc.features.map(f=>f.id+':'+f.kind+(f.offset!==undefined?'@'+f.offset:'')), l1: { o:m1.o.volume,b:m1.b.volume,t:m1.t.volume }, l2: { o:m2.o.volume,b:m2.b.volume,t:m2.t.volume } };
  const B = scr(`const a = sketch('top'); a.rect(40,40); const b = sketch('top'); b.rect(20,20); const p = pull(b, 10); const l = loft(a, b, 30); const j = join(p, l);`);
  console.log('  errs', B.run.errors.map(e=>e.message), 'kinds', B.doc.features.map(f=>f.id+':'+f.kind+(f.offset!==undefined?'@'+f.offset:'')).join(' '));
  const ids = B.doc.features.filter(f=>['extrude','blend','combine'].includes(f.kind)).map(f=>f.id);
  for (const id of ids) { const m = meas(B.doc,id); show(`pull(b,10)->loft(a,b,30) feature ${id}`, m); OUT.X6.reuse['pull_'+id] = { o:m.o.volume,b:m.b.volume,t:m.t.volume, bref:m.b.refused, bbox: m.o.bbox, tbbox: m.t.bbox }; }
  const Bx = scr(`const b = sketch('top'); b.rect(20,20); const p = pull(b, 10);`); const mb = meas(Bx.doc, 'pull1'); show('pull(b,10) alone (expected 4000, z 0..10)', mb); OUT.X6.reuse.pullAlone = { o:mb.o.volume, bbox: mb.o.bbox, tbbox: mb.t.bbox };
  // safe reuse: a is first arg (not moved)
  const C = scr(`const a = sketch('top'); a.rect(40,40); const p = pull(a, 10); const b = sketch('top'); b.rect(20,20); const l = loft(a, b, 30);`);
  console.log('  errs', C.run.errors.map(e=>e.message), 'kinds', C.doc.features.map(f=>f.id+':'+f.kind+(f.offset!==undefined?'@'+f.offset:'')).join(' '));
  for (const id of C.doc.features.filter(f=>['extrude','blend'].includes(f.kind)).map(f=>f.id)) { const m = meas(C.doc,id); show(`pull(a,10) then loft(a,b,30) (a not moved) ${id}`, m); OUT.X6.reuse['safe_'+id] = { o:m.o.volume,b:m.b.volume,t:m.t.volume }; }
  const D = scr(`const a = sketch('top'); a.rect(40,40); const b = sketch('top'); b.rect(20,20); const c = sketch('top'); c.rect(10,10); const l1 = loft(a, b, 30); const l2 = loft(a, c, 10);`);
  for (const id of ['bl1','bl2']) { const m = meas(D.doc,id); show(`two lofts from a (a shared, not moved) ${id}`, m); OUT.X6.reuse['twoFromA_'+id] = { o:m.o.volume,b:m.b.volume,t:m.t.volume }; }
}
console.log('--- datum vs gap');
OUT.X6.datum = [];
for (const [lab, src] of [
  ['plane(top,0), plane(top,30), gap 10 (contradiction)', `const a = sketch(plane('top', 0)); a.rect(40,40); const b = sketch(plane('top', 30)); b.rect(20,20); loft(a, b, 10);`],
  ['plane(top,0), plane(top,30), gap 30 (consistent)', `const a = sketch(plane('top', 0)); a.rect(40,40); const b = sketch(plane('top', 30)); b.rect(20,20); loft(a, b, 30);`],
  ["sketch('top'), sketch('top',30), gap 10 (contradiction)", `const a = sketch('top'); a.rect(40,40); const b = sketch('top', 30); b.rect(20,20); loft(a, b, 10);`],
  ["sketch('top',5), sketch('top',35), gap 30 (consistent)", `const a = sketch('top', 5); a.rect(40,40); const b = sketch('top', 35); b.rect(20,20); loft(a, b, 30);`],
  ["sketch('top',5), sketch('top',20), gap 30 (contradiction)", `const a = sketch('top', 5); a.rect(40,40); const b = sketch('top', 20); b.rect(20,20); loft(a, b, 30);`],
]) { const s = scr(src); const m = meas(s.doc,'bl1'); show(lab, m); console.log('   errs', s.run.errors.map(e=>e.message), 'offsets', s.doc.features.filter(f=>f.kind==='sketch').map(f=>f.id+'@'+f.offset+(f.onDatum?'(datum '+f.onDatum+')':'')).join(' '), 'expected if gap ignored vs honoured:', 'see numbers');
  OUT.X6.datum.push({ lab, src, errs: s.run.errors.map(e=>e.message), offsets: s.doc.features.filter(f=>f.kind==='sketch').map(f=>f.offset), o:m.o.volume, b:m.b.volume, t:m.t.volume }); }

}
// =====================================================================================================================
// N7: fuzz of planar-sided pairs with random start vertex, winding, centre offset and gap (what "shift 0" got wrong), plus perturbed pairs
// =====================================================================================================================
{
  const ccw = (p) => { let a = 0; p.forEach((x, i) => { const y = p[(i + 1) % p.length]; a += x[0] * y[1] - y[0] * x[1]; }); return a >= 0 ? p : [p[0], ...p.slice(1).reverse()]; };
  const shiftL = (p, s) => p.map((_, i) => p[(i + s) % p.length]);
  const { parallelShifts } = await import('/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs');
  let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const convex = (n, r) => { const angs = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b); return angs.map((a) => { const rr = r * (0.8 + 0.4 * rnd()); return [rr * Math.cos(a), rr * Math.sin(a)]; }); };
  const mkPair = (n) => {
    for (;;) {
      const p = convex(n, 20);
      const e = p.map((a, i) => { const b = p[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; });
      let lam = Array.from({ length: n }, () => 0.35 + 0.5 * rnd());
      if (n > 3) for (let it = 0; it < 3; it++) {
        const sx = lam.reduce((s, l, i) => s + l * e[i][0], 0); const sy = lam.reduce((s, l, i) => s + l * e[i][1], 0);
        const M = [[0, 0], [0, 0]]; e.forEach((v) => { M[0][0] += v[0] * v[0]; M[0][1] += v[0] * v[1]; M[1][1] += v[1] * v[1]; }); M[1][0] = M[0][1];
        const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
        const mu = [(M[1][1] * sx - M[0][1] * sy) / det, (-M[1][0] * sx + M[0][0] * sy) / det];
        lam = lam.map((l, i) => l - (e[i][0] * mu[0] + e[i][1] * mu[1]));
      } else lam = [lam[0], lam[0], lam[0]];
      if (lam.some((l) => l < 0.05)) continue;
      const c = [rnd() * 30 - 15, rnd() * 30 - 15];
      const q = [[c[0], c[1]]]; for (let i = 0; i < n - 1; i++) q.push([q[i][0] + lam[i] * e[i][0], q[i][1] + lam[i] * e[i][1]]);
      return [p, q];
    }
  };
  OUT.N7 = [];
  for (const n of [3, 4, 5, 6]) for (let k = 0; k < 60; k++) {
    let [p, q] = mkPair(n);
    const s = Math.floor(rnd() * n); const revQ = rnd() < 0.5; const revP = rnd() < 0.3; const h = [5, 20, 60][k % 3];
    const q2 = shiftL(revQ ? [...q].reverse() : q, s); const p2 = revP ? shiftL([...p].reverse(), Math.floor(rnd() * n)) : p;
    const Pc = ccw(p2), Qc = ccw(q2); const ps = parallelShifts(Pc, Qc);
    const geo = ps.length === 1 ? ruledVolume3D(to3(Pc, 0), to3(shiftL(Qc, ps[0]), h)) : undefined;
    const doc = { version: 1, features: [sk('a', 'xy', 0, p2), sk('b', 'xy', h, q2), bl('a', 'b')] };
    const r = fullCase(`fuzz7 n=${n} k=${k} startShift=${s} revQ=${revQ} revP=${revP} h=${h}`, doc, { analytic: geo });
    r.fuzz7 = { n, k, s, revQ, revP, h, parShifts: ps };
    OUT.N7.push({ p: p2, q: q2, label: r.label, n, ps, h, guard: r.guard?.code ?? null, occt: r.occt.volume, truck: r.truck.volume, brep: r.brep.volume, brepRef: r.brep.refused, geo, dTO: r.dVolTruckOcct, dTG: r.dVolTruckAnalytic, dOG: r.dVolOcctAnalytic, dBG: r.dVolBrepAnalytic });
  }
  const pass = OUT.N7.filter((x) => x.guard === null); const ref = OUT.N7.filter((x) => x.guard !== null);
  const by = {}; for (const x of ref) by[x.guard] = (by[x.guard] ?? 0) + 1;
  log(`N7 fuzz: ${OUT.N7.length} planar-sided pairs with random start/winding/centre; guard PASS ${pass.length} (max truck-vs-closed ${fmt(Math.max(...pass.map((x) => x.dTG)))}, max OCCT-vs-closed ${fmt(Math.max(...pass.map((x) => x.dOG)))}, max truck-vs-OCCT ${fmt(Math.max(...pass.map((x) => x.dTO)))}); guard REFUSED ${ref.length} by code ${JSON.stringify(by)}`);
  const refBad = ref.filter((x) => x.dTG > 1e-9 || x.dOG > 1e-9);
  log(`N7 of the refused: ${refBad.length} would have built a wrong solid (truck or OCCT off the closed form by >1e-9); ${ref.length - refBad.length} were exact anyway (over-refusal)`);
  log(`N7 brep-rs vs closed form: built ${OUT.N7.filter((x) => x.brep !== undefined).length}, wrong(>1e-9) ${OUT.N7.filter((x) => x.brep !== undefined && x.dBG > 1e-9).length}, refused ${OUT.N7.filter((x) => x.brep === undefined).length}`);
  // perturbed: 1e-7 relative perturbation of one corner of q => sides no longer exactly parallel
  OUT.N7p = [];
  for (const n of [3, 4, 5, 6]) for (let k = 0; k < 10; k++) {
    const [p, q] = mkPair(n); const q2 = q.map((v, i) => (i === 1 ? [v[0] + 1e-7 * (1 + k), v[1]] : v));
    const h = 20; const P3 = to3(p, 0); const Q3 = to3(q2, h);
    const r = fullCase(`fuzz7p n=${n} k=${k} (corner nudged ${(1e-7 * (1 + k)).toExponential(0)})`, { version: 1, features: [sk('a', 'xy', 0, p), sk('b', 'xy', h, q2), bl('a', 'b')] }, { analytic: ruledVolume3D(P3, Q3) });
    OUT.N7p.push({ n, k, guard: r.guard?.code ?? null, dTG: r.dVolTruckAnalytic, dTO: r.dVolTruckOcct });
  }
  log(`N7p nudged pairs: ${OUT.N7p.length}; guard refuses ${OUT.N7p.filter((x) => x.guard).length}; max truck-vs-closed ${fmt(Math.max(...OUT.N7p.map((x) => x.dTG)))} (so the 1e-9 parallel test over-refuses nudged pairs that are exact to <1e-6)`);
}

// =====================================================================================================================
// N7: fuzz of planar-sided pairs with random start vertex, winding, centre offset and gap (what "shift 0" got wrong), plus perturbed pairs
// =====================================================================================================================
{
  const ccw = (p) => { let a = 0; p.forEach((x, i) => { const y = p[(i + 1) % p.length]; a += x[0] * y[1] - y[0] * x[1]; }); return a >= 0 ? p : [p[0], ...p.slice(1).reverse()]; };
  const shiftL = (p, s) => p.map((_, i) => p[(i + s) % p.length]);
  const { parallelShifts } = await import('/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs');
  let seed = 99991; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const convex = (n, r) => { const angs = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b); return angs.map((a) => { const rr = r * (0.8 + 0.4 * rnd()); return [rr * Math.cos(a), rr * Math.sin(a)]; }); };
  const mkPair = (n) => {
    for (;;) {
      const p = convex(n, 20);
      const e = p.map((a, i) => { const b = p[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; });
      let lam = Array.from({ length: n }, () => 0.35 + 0.5 * rnd());
      if (n > 3) for (let it = 0; it < 3; it++) {
        const sx = lam.reduce((s, l, i) => s + l * e[i][0], 0); const sy = lam.reduce((s, l, i) => s + l * e[i][1], 0);
        const M = [[0, 0], [0, 0]]; e.forEach((v) => { M[0][0] += v[0] * v[0]; M[0][1] += v[0] * v[1]; M[1][1] += v[1] * v[1]; }); M[1][0] = M[0][1];
        const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
        const mu = [(M[1][1] * sx - M[0][1] * sy) / det, (-M[1][0] * sx + M[0][0] * sy) / det];
        lam = lam.map((l, i) => l - (e[i][0] * mu[0] + e[i][1] * mu[1]));
      } else lam = [lam[0], lam[0], lam[0]];
      if (lam.some((l) => l < 0.05)) continue;
      const c = [rnd() * 30 - 15, rnd() * 30 - 15];
      const q = [[c[0], c[1]]]; for (let i = 0; i < n - 1; i++) q.push([q[i][0] + lam[i] * e[i][0], q[i][1] + lam[i] * e[i][1]]);
      return [p, q];
    }
  };
  OUT.N7h = [];
  for (const n of [3, 4, 5, 6]) for (let k = 0; k < 50; k++) {
    let [p, q] = mkPair(n);
    const s = Math.floor(rnd() * n); const revQ = rnd() < 0.5; const revP = rnd() < 0.3; const h = [5, 20, 60][k % 3];
    const q2 = shiftL(revQ ? [...q].reverse() : q, s); const p2 = revP ? shiftL([...p].reverse(), Math.floor(rnd() * n)) : p;
    const Pc = ccw(p2), Qc = ccw(q2); const ps = parallelShifts(Pc, Qc);
    const geo = ps.length === 1 ? ruledVolume3D(to3(Pc, 0), to3(shiftL(Qc, ps[0]), h)) : undefined;
    const doc = { version: 1, features: [sk('a', 'xy', 0, p2), sk('b', 'xy', h, q2), bl('a', 'b')] };
    const r = fullCase(`fuzz7h n=${n} k=${k} startShift=${s} revQ=${revQ} revP=${revP} h=${h}`, doc, { analytic: geo });
    r.fuzz7h = { n, k, s, revQ, revP, h, parShifts: ps };
    OUT.N7h.push({ p: p2, q: q2, label: r.label, n, ps, h, guard: r.guard?.code ?? null, occt: r.occt.volume, truck: r.truck.volume, brep: r.brep.volume, brepRef: r.brep.refused, geo, dTO: r.dVolTruckOcct, dTG: r.dVolTruckAnalytic, dOG: r.dVolOcctAnalytic, dBG: r.dVolBrepAnalytic });
  }
  const pass = OUT.N7h.filter((x) => x.guard === null); const ref = OUT.N7h.filter((x) => x.guard !== null);
  const by = {}; for (const x of ref) by[x.guard] = (by[x.guard] ?? 0) + 1;
  log(`N7h fuzz: ${OUT.N7h.length} planar-sided pairs with random start/winding/centre; guard PASS ${pass.length} (max truck-vs-closed ${fmt(Math.max(...pass.map((x) => x.dTG)))}, max OCCT-vs-closed ${fmt(Math.max(...pass.map((x) => x.dOG)))}, max truck-vs-OCCT ${fmt(Math.max(...pass.map((x) => x.dTO)))}); guard REFUSED ${ref.length} by code ${JSON.stringify(by)}`);
  const refBad = ref.filter((x) => x.dTG > 1e-9 || x.dOG > 1e-9);
  log(`N7h of the refused: ${refBad.length} would have built a wrong solid (truck or OCCT off the closed form by >1e-9); ${ref.length - refBad.length} were exact anyway (over-refusal)`);
  log(`N7h brep-rs vs closed form: built ${OUT.N7h.filter((x) => x.brep !== undefined).length}, wrong(>1e-9) ${OUT.N7h.filter((x) => x.brep !== undefined && x.dBG > 1e-9).length}, refused ${OUT.N7h.filter((x) => x.brep === undefined).length}`);
}

// =====================================================================================================================
// N7: fuzz of planar-sided pairs with random start vertex, winding, centre offset and gap (what "shift 0" got wrong), plus perturbed pairs
// =====================================================================================================================
{
  const ccw = (p) => { let a = 0; p.forEach((x, i) => { const y = p[(i + 1) % p.length]; a += x[0] * y[1] - y[0] * x[1]; }); return a >= 0 ? p : [p[0], ...p.slice(1).reverse()]; };
  const shiftL = (p, s) => p.map((_, i) => p[(i + s) % p.length]);
  const { parallelShifts } = await import('/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs');
  let seed = 31337; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const convex = (n, r) => { const angs = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b); return angs.map((a) => { const rr = r * (0.8 + 0.4 * rnd()); return [rr * Math.cos(a), rr * Math.sin(a)]; }); };
  const mkPair = (n) => {
    for (;;) {
      const p = convex(n, 20);
      const e = p.map((a, i) => { const b = p[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; });
      let lam = Array.from({ length: n }, () => 0.35 + 0.5 * rnd());
      if (n > 3) for (let it = 0; it < 3; it++) {
        const sx = lam.reduce((s, l, i) => s + l * e[i][0], 0); const sy = lam.reduce((s, l, i) => s + l * e[i][1], 0);
        const M = [[0, 0], [0, 0]]; e.forEach((v) => { M[0][0] += v[0] * v[0]; M[0][1] += v[0] * v[1]; M[1][1] += v[1] * v[1]; }); M[1][0] = M[0][1];
        const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
        const mu = [(M[1][1] * sx - M[0][1] * sy) / det, (-M[1][0] * sx + M[0][0] * sy) / det];
        lam = lam.map((l, i) => l - (e[i][0] * mu[0] + e[i][1] * mu[1]));
      } else lam = [lam[0], lam[0], lam[0]];
      if (lam.some((l) => l < 0.05)) continue;
      const c = [rnd() * 30 - 15, rnd() * 30 - 15];
      const q = [[c[0], c[1]]]; for (let i = 0; i < n - 1; i++) q.push([q[i][0] + lam[i] * e[i][0], q[i][1] + lam[i] * e[i][1]]);
      return [p, q];
    }
  };
  OUT.N7p2 = [];
  for (const n of [3, 4, 5, 6]) for (let k = 0; k < 40; k++) {
    let [p, q] = mkPair(n);
    const s = Math.floor(rnd() * n); const revQ = rnd() < 0.5; const revP = rnd() < 0.3; const h = [5, 20, 60][k % 3];
    const q2 = shiftL(revQ ? [...q].reverse() : q, s); const p2 = revP ? shiftL([...p].reverse(), Math.floor(rnd() * n)) : p;
    const Pc = ccw(p2), Qc = ccw(q2); const ps = parallelShifts(Pc, Qc);
    const geo = ps.length === 1 ? ruledVolume3D(to3(Pc, 0), to3(shiftL(Qc, ps[0]), h)) : undefined;
    const PL = k % 2 === 0 ? 'xz' : 'yz'; const doc = { version: 1, features: [sk('a', PL, 0, p2), sk('b', PL, h, q2), bl('a', 'b')] };
    const r = fullCase(`fuzz7p2 ${k % 2 === 0 ? 'xz' : 'yz'} n=${n} k=${k} startShift=${s} revQ=${revQ} revP=${revP} h=${h}`, doc, { analytic: geo });
    r.fuzz7p2 = { n, k, s, revQ, revP, h, parShifts: ps };
    OUT.N7p2.push({ plane: PL, p: p2, q: q2, label: r.label, n, ps, h, guard: r.guard?.code ?? null, occt: r.occt.volume, truck: r.truck.volume, brep: r.brep.volume, brepRef: r.brep.refused, geo, dTO: r.dVolTruckOcct, dTG: r.dVolTruckAnalytic, dOG: r.dVolOcctAnalytic, dBG: r.dVolBrepAnalytic });
  }
  const pass = OUT.N7p2.filter((x) => x.guard === null); const ref = OUT.N7p2.filter((x) => x.guard !== null);
  const by = {}; for (const x of ref) by[x.guard] = (by[x.guard] ?? 0) + 1;
  log(`N7p2 fuzz: ${OUT.N7p2.length} planar-sided pairs with random start/winding/centre; guard PASS ${pass.length} (max truck-vs-closed ${fmt(Math.max(...pass.map((x) => x.dTG)))}, max OCCT-vs-closed ${fmt(Math.max(...pass.map((x) => x.dOG)))}, max truck-vs-OCCT ${fmt(Math.max(...pass.map((x) => x.dTO)))}); guard REFUSED ${ref.length} by code ${JSON.stringify(by)}`);
  const refBad = ref.filter((x) => x.dTG > 1e-9 || x.dOG > 1e-9);
  log(`N7p2 of the refused: ${refBad.length} would have built a wrong solid (truck or OCCT off the closed form by >1e-9); ${ref.length - refBad.length} were exact anyway (over-refusal)`);
  log(`N7p2 brep-rs vs closed form: built ${OUT.N7p2.filter((x) => x.brep !== undefined).length}, wrong(>1e-9) ${OUT.N7p2.filter((x) => x.brep !== undefined && x.dBG > 1e-9).length}, refused ${OUT.N7p2.filter((x) => x.brep === undefined).length}`);
}

// =====================================================================================================================
// N10: the sentences a student sees from the script layer, both spellings (runScript halts at the first error; nothing is built)
// =====================================================================================================================
{
  OUT.N10 = [];
  const pre = `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); `;
  for (const name of ['blend', 'loft']) {
    const calls = [`${name}(a, b);`, `${name}(a);`, `${name}();`, `${name}(a, b, "tall");`, `${name}(a, 7, 30);`, `${name}(a, b, 30, 5);`, `${name}(a, b, 30, 'zzz');`, `${name}(a, b, 30, { height: 30 });`, `${name}(a, b, 30, 5, 6);`, `const c = sketch("top"); c.rect(5, 5); ${name}(a, b, c, 30);`, `${name}(a, b, 30); const k = cuboid(5, 5, 5);`];
    for (const call of calls) {
      const run = runScript(pre + call);
      OUT.N10.push({ name, call, errors: run.errors.map((e) => e.message ?? String(e)), kinds: run.doc.features.map((f) => f.kind), hasBlend: run.doc.features.some((f) => f.kind === 'blend') });
    }
  }
  for (const r of OUT.N10) log(`N10 ${r.call.slice(0, 72).padEnd(72)} -> errors=${JSON.stringify(r.errors)} kinds=${r.kinds.join(',')}`);
}

// =====================================================================================================================
// N9: the critic's irregular polygons against circle(30)/circle(10), L shapes, and start-vertex / winding variants of whitelisted polygon<->circle pairs
// =====================================================================================================================
{
  OUT.N9 = [];
  const circle = (id, off, d, c = [0, 0]) => sk(id, 'xy', off, [[c[0] - d / 2, c[1]], [c[0] + d / 2, c[1]]], { shape: 'circle' });
  const pc = (label, pts, d, dir, h = 25, c = [0, 0]) => {
    const P = sk(dir === 'p->c' ? 'a' : 'b', 'xy', dir === 'p->c' ? 0 : h, pts); const C = circle(dir === 'p->c' ? 'b' : 'a', dir === 'p->c' ? h : 0, d, c);
    const r = fullCase(`${label} ${dir}`, { version: 1, features: dir === 'p->c' ? [P, C, bl('a', 'b')] : [C, P, bl('a', 'b')] });
    OUT.N9.push({ label: r.label, dir, guard: r.guard?.code ?? null, occt: r.occt.volume, occtRefused: r.occt.refused, truck: r.truck.volume, d: r.dVolTruckOcct });
    log(`N9 ${r.label.padEnd(66)} guard=${(r.guard?.code ?? 'PASS').padEnd(11)} O ${r.occt.volume?.toFixed(3) ?? 'REF[' + (r.occt.refused ?? '').slice(0, 30) + ']'} T ${r.truck.volume?.toFixed(3) ?? 'REF'} dT/O ${fmt(r.dVolTruckOcct)}`);
    return r;
  };
  const rot = (pts, deg, c = [0, 0]) => { const a = deg * Math.PI / 180; return pts.map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]); };
  for (const dir of ['c->p', 'p->c']) {
    pc('circle(30) irregular tri [[12,0],[-4,9],[-6,-5]]', [[12, 0], [-4, 9], [-6, -5]], 30, dir);
    pc('circle(30) irregular quad [[12,0],[0,6],[-8,0],[0,-10]]', [[12, 0], [0, 6], [-8, 0], [0, -10]], 30, dir);
    pc('circle(10) irregular tri [[20,0],[-8,14],[-12,-9]]', [[20, 0], [-8, 14], [-12, -9]], 10, dir);
    pc('circle(30) irregular tri [[20,0],[-8,14],[-12,-9]]', [[20, 0], [-8, 14], [-12, -9]], 30, dir);
    const L0 = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]].map(([x, y]) => [x - 12, y - 12]);
    pc('circle(30) L (corner at origin side)', L0, 30, dir);
    pc('circle(30) L rotated 37 deg (corner away from seam)', rot(L0, 37), 30, dir);
    pc('circle(30) L rotated 90 deg', rot(L0, 90), 30, dir);
  }
  const rectP = [[-20, -15], [20, -15], [20, 15], [-20, 15]];
  const shiftL = (p, s) => p.map((_, i) => p[(i + s) % p.length]);
  for (const dir of ['p->c', 'c->p']) for (let s = 0; s < 4; s++) for (const cw of [false, true]) pc(`rect 40x30 start+${s} ${cw ? 'CW' : 'CCW'} vs d20`, shiftL(cw ? [...rectP].reverse() : rectP, s), 20, dir);
  const hexP = Array.from({ length: 6 }, (_, i) => [20 * Math.cos(Math.PI * i / 3), 20 * Math.sin(Math.PI * i / 3)]);
  for (const dir of ['p->c', 'c->p']) for (const [s, cw] of [[0, false], [2, false], [4, false], [0, true], [3, true]]) pc(`hex phase0 start+${s} ${cw ? 'CW' : 'CCW'} vs d20`, shiftL(cw ? [...hexP].reverse() : hexP, s), 20, dir);
  const ok = OUT.N9.filter((x) => !x.guard);
  log(`N9 guard PASS ${ok.length} of ${OUT.N9.length}; max dT/O among PASS ${fmt(Math.max(...ok.map((x) => x.d)))}; refused-but-within-3e-4 ${OUT.N9.filter((x) => x.guard && x.d <= 3e-4).length}`);
}

// =====================================================================================================================
// N8: the guarded pipeline on reSHape Script text: every outcome is either an exact build or a plain sentence (never a wrong build)
// =====================================================================================================================
{
  OUT.N8 = [];
  const pre = (a, b) => `const a = sketch('top'); ${a} const b = sketch('top'); ${b} `;
  const hexs = (r, ph = 0) => JSON.stringify(Array.from({ length: 6 }, (_, i) => [+(r * Math.cos(Math.PI * i / 3 + ph)).toFixed(10), +(r * Math.sin(Math.PI * i / 3 + ph)).toFixed(10)]));
  const regS = (n, r, ph) => JSON.stringify(Array.from({ length: n }, (_, i) => [+(r * Math.cos(2 * Math.PI * i / n + ph)).toFixed(10), +(r * Math.sin(2 * Math.PI * i / n + ph)).toFixed(10)]));
  const rd = (v, rad) => [1, 2, 3, 4].map((k) => `${v}.round(${k}, ${rad}); `).join('');
  const cases = [
    ['ordinary 40->10 gap 30', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 30);', 'built'],
    ['40x30 -> 20x15 off-centre', pre('a.rect(40, 30);', 'b.rect(20, 15, { at: [5, -3] });') + 'loft(a, b, 25);', 'built'],
    ['aspect swap 40x10 -> 10x40 (not parallel)', pre('a.rect(40, 10);', 'b.rect(10, 40);') + 'loft(a, b, 20);', 'refused'],
    ['negative gap', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, -30);', 'built'],
    ['rect -> circle', pre('a.rect(40, 40);', 'b.circle(20);') + 'loft(a, b, 30);', 'built'],
    ['circle -> rect 40x20', pre('a.circle(20);', 'b.rect(40, 20);') + 'loft(a, b, 30);', 'built'],
    ['circle -> rect 40x10 (4:1)', pre('a.circle(20);', 'b.rect(40, 10);') + 'loft(a, b, 30);', 'refused'],
    ['circle -> circle', pre('a.circle(40);', 'b.circle(20);') + 'loft(a, b, 30);', 'built'],
    ['hexagon phase 0 -> circle', pre(`a.polygon(${hexs(20)});`, 'b.circle(20);') + 'loft(a, b, 25);', 'built'],
    ['hexagon phase 0.3 -> circle', pre(`a.polygon(${hexs(20, 0.3)});`, 'b.circle(20);') + 'loft(a, b, 25);', 'refused'],
    ['pentagon phase 0 -> circle', pre(`a.polygon(${regS(5, 20, 0)});`, 'b.circle(20);') + 'loft(a, b, 25);', 'built'],
    ['irregular triangle -> circle d60', pre('a.polygon([[12,0],[-4,9],[-6,-5]]);', 'b.circle(60);') + 'loft(a, b, 25);', 'refused'],
    ['circle -> irregular triangle', pre('a.circle(60);', 'b.polygon([[12,0],[-4,9],[-6,-5]]);') + 'loft(a, b, 25);', 'refused'],
    ['circle -> L', pre('a.circle(20);', 'b.polygon([[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]]);') + 'loft(a, b, 25);', 'refused'],
    ['rounded square r6 -> circle', pre('a.rect(40, 40); ' + rd('a', 6), 'b.circle(20);') + 'loft(a, b, 30);', 'built'],
    ['rounded 40x20 r5 -> circle', pre('a.rect(40, 20); ' + rd('a', 5), 'b.circle(20);') + 'loft(a, b, 30);', 'refused'],
    ['rounded square -> rect (unequal count)', pre('a.rect(40, 40); ' + rd('a', 6), 'b.rect(20, 20);') + 'loft(a, b, 30);', 'refused'],
    ['triangle -> square (unequal count)', pre('a.polygon([[0,0],[40,0],[20,30]]);', 'b.rect(10, 10);') + 'loft(a, b, 20);', 'refused'],
    ['rect + midpoint (5) -> rect (4)', pre('a.polygon([[-20,-20],[0,-20],[20,-20],[20,20],[-20,20]]);', 'b.rect(20, 20);') + 'loft(a, b, 30);', 'refused'],
    ['rect + midpoint (5) -> rect + midpoint (5), same side', pre('a.polygon([[-20,-20],[0,-20],[20,-20],[20,20],[-20,20]]);', 'b.polygon([[-10,-10],[0,-10],[10,-10],[10,10],[-10,10]]);') + 'loft(a, b, 30);', 'built'],
    ['critic start-shifted b=[[20,15],[0,15],[0,0],[20,0]] vs 40x30', pre('a.polygon([[0,0],[40,0],[40,30],[0,30]]);', 'b.polygon([[20,15],[0,15],[0,0],[20,0]]);') + 'loft(a, b, 20);', 'built'],
    ['L -> half L started at corner 3', pre('a.polygon([[0,0],[40,0],[40,10],[10,10],[10,30],[0,30]]);', 'b.polygon([[15,10],[15,20],[10,20],[10,10],[25,10],[25,15]].map(() => [0,0]));') + 'loft(a, b, 20);', 'skip'],
    ['rhombus -> rect', pre('a.polygon([[0,-20],[40,0],[0,20],[-40,0]]);', 'b.rect(20, 10);') + 'loft(a, b, 20);', 'refused'],
    ['square 40 -> square 20 rotated 20 deg', pre('a.rect(40, 40);', 'b.polygon([[-10,-10],[10,-10],[10,10],[-10,10]].map(([x,y]) => [x*Math.cos(0.349066)-y*Math.sin(0.349066), x*Math.sin(0.349066)+y*Math.cos(0.349066)]));') + 'loft(a, b, 30);', 'refused'],
    ['square 40 -> square 20 rotated 90 deg (prism-like)', pre('a.rect(40, 40);', 'b.polygon([[10,-10],[10,10],[-10,10],[-10,-10]]);') + 'loft(a, b, 30);', 'built'],
    ['triangle r20 -> triangle r10 rot 60 (tie)', pre(`a.polygon(${regS(3, 20, 0)});`, `b.polygon(${regS(3, 10, Math.PI / 3)});`) + 'loft(a, b, 20);', 'refused'],
    ['pentagon r20 -> pentagon r10 rot 36 (tie)', pre(`a.polygon(${regS(5, 20, 0)});`, `b.polygon(${regS(5, 10, Math.PI / 5)});`) + 'loft(a, b, 20);', 'refused'],
    ['gap 0', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 0);', 'refused'],
    ['gap 1e-12', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 1e-12);', 'refused'],
    ['gap 1e-6', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 1e-6);', 'built'],
    ['loft(a, a, 30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, a, 30);', 'refused'],
    ['different planes top vs front', "const a = sketch('top'); a.rect(40, 40); const b = sketch('front'); b.rect(10, 10); loft(a, b, 30);", 'refused'],
    ['frame-placed sketches', "const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,5], u: [1,0,0], v: [0,1,0] }); b.rect(10, 10); loft(a, b, 30);", 'refused'],
    ['tilted frame 22.5 deg', "const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,30], u: [1,0,0], v: [0,0.9238795,0.3826834] }); b.rect(10, 10); loft(a, b, 30);", 'refused'],
    ['datum contradiction plane(top,0)/plane(top,30) gap 10', "const a = sketch(plane('top', 0)); a.rect(40, 40); const b = sketch(plane('top', 30)); b.rect(20, 20); loft(a, b, 10);", 'refused'],
    ['datum consistent plane(top,0)/plane(top,30) gap 30', "const a = sketch(plane('top', 0)); a.rect(40, 40); const b = sketch(plane('top', 30)); b.rect(20, 20); loft(a, b, 30);", 'built'],
    ["sketch('top',5)/sketch('top',20) gap 30", "const a = sketch('top', 5); a.rect(40, 40); const b = sketch('top', 20); b.rect(20, 20); loft(a, b, 30);", 'refused'],
    ["sketch('top',5)/sketch('top',35) gap 30 (consistent)", "const a = sketch('top', 5); a.rect(40, 40); const b = sketch('top', 35); b.rect(20, 20); loft(a, b, 30);", 'built'],
    ['sketch reuse: two lofts of the same pair', pre('a.rect(40, 40);', 'b.rect(20, 20);') + 'const l1 = loft(a, b, 30); const l2 = loft(a, b, 10); move(l1, [100, 0, 0]);', 'refused'],
    ['sketch reuse: pull(b,10) then loft(a,b,30)', pre('a.rect(40, 40);', 'b.rect(20, 20);') + 'const p = pull(b, 10); const l = loft(a, b, 30); join(p, l);', 'refused'],
    ['sketch reuse: pull(a,10) then loft(a,b,30) (a is not moved)', pre('a.rect(40, 40);', 'b.rect(20, 20);') + 'const p = pull(a, 10); const l = loft(a, b, 30);', 'built'],
    ['two lofts from the same first sketch', "const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(20, 20); const c = sketch('top'); c.rect(10, 10); const l1 = loft(a, b, 30); const l2 = loft(a, c, 10);", 'built'],
    ['undrawn second sketch', "const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); loft(a, b, 30);", 'refused'],
    ['undrawn first sketch', "const a = sketch('top'); const b = sketch('top'); b.rect(10, 10); loft(a, b, 30);", 'refused'],
    ['polygon that equals the starter outline (drawn on purpose)', "const a = sketch('top'); a.rect(40, 25); const b = sketch('top'); b.polygon([[0,0],[40,0],[40,25],[0,25]]); loft(a, b, 30);", 'built-or-refused'],
    ['bowtie second sketch', pre('a.rect(20, 20);', 'b.polygon([[-5,-5],[5,5],[5,-5],[-5,5]]);') + 'loft(a, b, 20);', 'refused'],
    ['collinear second sketch', pre('a.rect(20, 20);', 'b.polygon([[0,0],[10,0],[20,0]]);') + 'loft(a, b, 20);', 'refused'],
    ['rows and rules sketch (slot)', pre('a.rect(40, 40);', 'b.slot([0,0],[20,0],5);') + 'loft(a, b, 20);', 'refused'],
    ['rect with a length rule', pre('a.rect(40, 30); a.length(1, 36);', 'b.rect(10, 10);') + 'loft(a, b, 30);', 'built'],
    ['concave L -> small rect (OCCT throws)', pre('a.polygon([[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]]);', 'b.polygon([[5,5],[15,5],[15,15],[5,15]]);') + 'loft(a, b, 20);', 'refused'],
    ['concave L -> half L (parallel sides)', pre('a.polygon([[0,0],[40,0],[40,10],[10,10],[10,30],[0,30]]);', 'b.polygon([[5,5],[25,5],[25,10],[10,10],[10,20],[5,20]]);') + 'loft(a, b, 20);', 'built'],
  ].filter((c) => c[2] !== 'skip');
  let wrongBuilt = 0;
  for (const [name, src, expect] of cases) {
    const g = guardedRun(src, { runScript, solveDoc, arc });
    const entry = { name, expect, scriptErrors: g.scriptErrors, blends: [] };
    for (const [id, v] of g.verdicts) {
      const e = { id, guard: v?.code ?? null, sentence: v?.sentence ?? null };
      if (!v) { // guard let it through: measure and check it is exact
        const o = occtMeasure(g.doc, id); let t; try { t = truckMeasure(g.doc, id); } catch (er) { t = { refused: er.message }; }
        const kind = kindOfDoc({ features: g.doc.features.map((f) => f), }) ;
        e.occt = o.volume; e.truck = t.volume; e.truckRefused = t.refused; e.occtRefused = o.refused;
        e.d = o.volume !== undefined && t.volume !== undefined ? rel(t.volume, o.volume) : undefined;
        const curved = g.doc.features.filter((f) => f.kind === 'sketch').some((s) => s.shape === 'circle' || (() => { try { return Object.values(arc.outlineOf(s).bulges ?? {}).some(Boolean); } catch { return false; } })());
        e.curved = curved; e.bar = curved ? 3e-4 : 1e-9;
        e.exact = e.d !== undefined && e.d <= e.bar;
        if (!e.exact) wrongBuilt++;
      }
      entry.blends.push(e);
    }
    OUT.N8.push(entry);
    const desc = entry.blends.map((b) => (b.guard ? `REFUSED[${b.guard}]` : `BUILT O ${b.occt?.toFixed?.(4)} T ${b.truck?.toFixed?.(4)} d ${fmt(b.d)} ${b.exact ? 'exact' : '*** NOT EXACT ***'}`)).join(' | ') || `no blend (script errors: ${g.scriptErrors.join(' / ').slice(0, 90)})`;
    log(`N8 ${name.padEnd(62)} ${desc}`);
  }
  log(`N8 summary: ${OUT.N8.length} scripts; guard let through ${OUT.N8.reduce((s, e) => s + e.blends.filter((b) => !b.guard).length, 0)} blends, of which NOT exact vs OCCT: ${wrongBuilt}`);
  OUT.N8wrongBuilt = wrongBuilt;
}

OUT.ALL = ALL.map((r) => ({ label: r.label, kind: r.kind, guard: r.guard ? { code: r.guard.code, sentence: r.guard.sentence } : null, occt: r.occt.volume, occtRefused: r.occt.refused, truck: r.truck.volume, truckRefused: r.truck.refused, brep: r.brep.volume, brepRefused: r.brep.refused, analytic: r.analytic, dTO: r.dVolTruckOcct, dTA: r.dVolTruckAnalytic, dOA: r.dVolOcctAnalytic, dBbox: r.dBboxTruckOcct, faces: [r.occt.faces, r.truck.faces, r.brep.faces] }));
writeFileSync(arg('out'), JSON.stringify(OUT, null, 1));
log('wrote ' + arg('out'));
process.exit(0);
