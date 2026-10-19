// Round-2 blend/loft measurements: non-planar ruled skins, planar-sides guard, tilted frames, 3/1-target docs, L->rect, bowtie validity, script sentences.
// COPY of the scratch harness; run from the shadow repo root (see RIG.md):
//   cd <shadow> && cp <this file> blend-r2.mjs && SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun blend-r2.mjs --out=<file.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from './docs/spikes/solidcraft-referee/phase0/translate.mjs';

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

function fullCase(label, doc, extra = {}) {
  const o = occtMeasure(doc, 'bl1'); const b = brepMeasure(doc, 'bl1'); let t; try { t = truckMeasure(doc, 'bl1'); } catch (e) { t = { refused: 'harness threw ' + e.message }; }
  const r = { label, occt: o, brep: b, truck: t, ...extra };
  if (o.volume !== undefined && t.volume !== undefined) { r.dVolTruckOcct = rel(t.volume, o.volume); r.signedTruckMinusOcct = (t.volume - o.volume) / Math.max(Math.abs(o.volume), 1); r.dBboxTruckOcct = bboxD(t.bbox, o.bbox); }
  if (extra.analytic !== undefined) { if (t.volume !== undefined) r.dVolTruckAnalytic = rel(t.volume, extra.analytic); if (o.volume !== undefined) r.dVolOcctAnalytic = rel(o.volume, extra.analytic); if (b.volume !== undefined) r.dVolBrepAnalytic = rel(b.volume, extra.analytic); }
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

writeFileSync(arg('out'), JSON.stringify(OUT, null, 1));
log('wrote ' + arg('out'));
process.exit(0);
