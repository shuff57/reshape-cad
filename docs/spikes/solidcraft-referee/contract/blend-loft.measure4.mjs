// ROUND 4 copy of blend-loft.measure.mjs (the 71 round-1 script cases), re-run LIVE: runs from the repo (no shadow root), brep-rs from archive/, TRUE relative volume error.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.measure4.mjs [--only=id,..] --out=contract/blend-loft.r4-measure-results.json
// Blend/loft measurement harness (scratch). Script text -> runScript -> ModelDoc -> {OCCT, brep-rs, truck via translateDoc}.
// Run from the shadow root:  SOLIDCRAFT_REFEREE_PKG=... bun blend-measure.mjs [--only=id,id] [--out=file]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/phase0/translate.mjs';

const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
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
const { toScript } = await load('packages/script/dist/reshape-script-gen.js');
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? (b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / Math.abs(b)) : Infinity); // true relative (round 4)
const relc = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity); // coordinates: floor at 1
const worstArr = (a, b) => Math.max(...b.map((w, i) => relc(a?.[i], w)));
const flat = (b) => [...b[0], ...b[1]];
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };

function occtMeasure(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const c = g.CentreOfMass();
  const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(); const hi = bx.CornerMax();
  const fs = facesOf(oc, shape);
  const types = {};
  const T = oc.GeomAbs_SurfaceType; const nameOf = (t) => Object.keys(T).find((k) => T[k] === t || (T[k] && t && T[k].value === t.value && typeof T[k] === 'object')) ?? String(t?.value);
  const faceList = [];
  for (const f of fs) { const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true); const t = nameOf(a.GetType()); types[t] = (types[t] ?? 0) + 1; const gp = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, gp, false, false); faceList.push([t, +gp.Mass().toFixed(4)]); }
  // second bbox: plain Add (includes shape tolerance gap), for the 1e-7 artifact diagnosis
  const b2 = new oc.Bnd_Box(); oc.BRepBndLib.Add(shape, b2, false);
  const l2 = b2.CornerMin(); const h2 = b2.CornerMax();
  // validity
  let valid = null; try { valid = new oc.BRepCheck_Analyzer(shape, true, false).IsValid(); } catch { /* */ }
  return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], bboxPlainAdd: [l2.X(), l2.Y(), l2.Z(), h2.X(), h2.Y(), h2.Z()], faces: fs.length, surfaceTypeEnums: types, faceList, valid };
}

// ---- analytic oracles (independent of every kernel) ------------------------------------------------------------
const areaOf = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i]; const [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };
/** ruled loft between index-corresponding straight polygons: cross-section at t is the lerped polygon, A(t) quadratic => Simpson is exact */
const ruledVolume = (p0, p1, h) => {
  const mid = p0.map((a, i) => [(a[0] + p1[i][0]) / 2, (a[1] + p1[i][1]) / 2]);
  return h / 6 * (areaOf(p0) + 4 * areaOf(mid) + areaOf(p1));
};
const frustumVolume = (r0, r1, h) => Math.PI * h / 3 * (r0 * r0 + r0 * r1 + r1 * r1);
const bboxOfSketches = (doc, blend) => {
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of blend.targets) {
    const s = doc.features.find((x) => x.id === t); const fr = mt.sketchFrameOf(s);
    const pts = s.shape === 'circle' ? (() => { const [a, b] = s.points; const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2; return [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r], [c[0] + r, c[1] - r]]; })() : s.points;
    for (const p of pts) for (let i = 0; i < 3; i++) { const w = fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1]; lo[i] = Math.min(lo[i], w); hi[i] = Math.max(hi[i], w); }
  }
  return [...lo, ...hi];
};

// ---- cases -------------------------------------------------------------------------------------------------------
const P = (s) => s; // readability
const cases = [
  { id: 'rect-rect-parity', group: 'rect->rect', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30);`,
    analytic: (d) => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 30) }) },
  { id: 'rect-rect-other-size-offcentre', group: 'rect->rect', src: `const a = sketch('top'); a.rect(40, 30); const b = sketch('top'); b.rect(10, 20, { at: [8, -5] }); blend(a, b, 25);`,
    analytic: () => ({ volume: ruledVolume([[-20, -15], [20, -15], [20, 15], [-20, 15]], [[3, -15], [13, -15], [13, 5], [3, 5]], 25) }) },
  { id: 'rect-rect-aspect-swap', group: 'rect->rect', src: `const a = sketch('top'); a.rect(40, 10); const b = sketch('top'); b.rect(10, 40); blend(a, b, 20);`,
    analytic: () => ({ volume: ruledVolume([[-20, -5], [20, -5], [20, 5], [-20, 5]], [[-5, -20], [5, -20], [5, 20], [-5, 20]], 20) }) },
  { id: 'rect-rect-grow', group: 'rect->rect', src: `const a = sketch('top'); a.rect(10, 10); const b = sketch('top'); b.rect(40, 40); blend(a, b, 30);`,
    analytic: () => ({ volume: ruledVolume([[-5, -5], [5, -5], [5, 5], [-5, 5]], [[-20, -20], [20, -20], [20, 20], [-20, 20]], 30) }) },
  { id: 'rect-rect-same-size-prism', group: 'rect->rect', src: `const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.rect(20, 20); blend(a, b, 15);`,
    analytic: () => ({ volume: 20 * 20 * 15 }) },
  { id: 'rect-to-circle', group: 'rect->circle', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.circle(20); blend(a, b, 30);` },
  { id: 'circle-to-rect', group: 'rect->circle', src: `const a = sketch('top'); a.circle(20); const b = sketch('top'); b.rect(40, 40); blend(a, b, 30);` },
  { id: 'circle-to-circle-concentric', group: 'circle->circle', src: `const a = sketch('top'); a.circle(40); const b = sketch('top'); b.circle(20); blend(a, b, 30);`,
    analytic: () => ({ volume: frustumVolume(20, 10, 30) }) },
  { id: 'circle-to-circle-offcentre', group: 'circle->circle', src: `const a = sketch('top'); a.circle(40); const b = sketch('top'); b.circle(20, { at: [8, 0] }); blend(a, b, 30);`,
    analytic: () => ({ volume: frustumVolume(20, 10, 30) }) },
  { id: 'triangle-triangle', group: 'polygon', src: `const a = sketch('top'); a.polygon([[0,0],[40,0],[0,30]]); const b = sketch('top'); b.polygon([[5,5],[15,5],[5,12]]); blend(a, b, 20);`,
    analytic: () => ({ volume: ruledVolume([[0,0],[40,0],[0,30]], [[5,5],[15,5],[5,12]], 20) }) },
  { id: 'hexagon-hexagon', group: 'polygon', src: `const hex = (r) => [0,1,2,3,4,5].map(i => [r*Math.cos(Math.PI*i/3), r*Math.sin(Math.PI*i/3)]); const a = sketch('top'); a.polygon(hex(20)); const b = sketch('top'); b.polygon(hex(8)); blend(a, b, 25);`,
    analytic: () => { const hex = (r) => [0,1,2,3,4,5].map(i => [r*Math.cos(Math.PI*i/3), r*Math.sin(Math.PI*i/3)]); return { volume: ruledVolume(hex(20), hex(8), 25) }; } },
  { id: 'L-shape-L-shape-concave', group: 'polygon', src: `const L = (k) => [[0,0],[40*k,0],[40*k,10*k],[10*k,10*k],[10*k,30*k],[0,30*k]]; const a = sketch('top'); a.polygon(L(1)); const b = sketch('top'); b.polygon(L(0.5)); blend(a, b, 20);`,
    analytic: () => { const L = (k) => [[0,0],[40*k,0],[40*k,10*k],[10*k,10*k],[10*k,30*k],[0,30*k]]; return { volume: ruledVolume(L(1), L(0.5), 20) }; } },
  { id: 'triangle-to-square-differing-corner-count', group: 'polygon', src: `const a = sketch('top'); a.polygon([[0,0],[40,0],[20,30]]); const b = sketch('top'); b.rect(10, 10); blend(a, b, 20);` },
  { id: 'rect-to-hexagon-differing-corner-count', group: 'polygon', src: `const hex = (r) => [0,1,2,3,4,5].map(i => [r*Math.cos(Math.PI*i/3), r*Math.sin(Math.PI*i/3)]); const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.polygon(hex(10)); blend(a, b, 20);` },
  { id: 'rect-to-diamond-45deg-twist', group: 'polygon', src: `const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.polygon([[0,-14.142135623730951],[14.142135623730951,0],[0,14.142135623730951],[-14.142135623730951,0]]); blend(a, b, 20);` },
  { id: 'rect-to-rect-rotated-20deg-nonplanar-sides', group: 'polygon', src: `const c=Math.cos(20*Math.PI/180), s=Math.sin(20*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); const a = sketch('top'); a.rect(30, 20); const b = sketch('top'); b.polygon(R(30,20)); blend(a, b, 20);`,
    analytic: () => { const c=Math.cos(20*Math.PI/180), s=Math.sin(20*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); return { volume: ruledVolume([[-15,-10],[15,-10],[15,10],[-15,10]], R(30,20), 20) }; } },
  { id: 'rounded-rect-to-circle-arc-outline', group: 'arcs', src: `const a = sketch('top'); a.rect(40, 40); a.round(1, 6); a.round(2, 6); a.round(3, 6); a.round(4, 6); const b = sketch('top'); b.circle(20); blend(a, b, 30);` },
  { id: 'rounded-rect-to-rect', group: 'arcs', src: `const a = sketch('top'); a.rect(40, 40); a.round(1, 6); a.round(2, 6); a.round(3, 6); a.round(4, 6); const b = sketch('top'); b.rect(20, 20); blend(a, b, 30);` },
  { id: 'chamfered-rect-to-rect', group: 'arcs', src: `const a = sketch('top'); a.rect(40, 40); a.chamfer(1, 5); const b = sketch('top'); b.rect(20, 20); blend(a, b, 30);` },
  { id: 'nonzero-start-offset', group: 'gap', src: `const a = sketch('top', 5); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 30) }) },
  { id: 'negative-gap', group: 'gap', src: `const a = sketch('top', 40); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, -30);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 30) }) },
  { id: 'gap-zero', group: 'gap', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 0);` },
  { id: 'gap-tiny-0.001', group: 'gap', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 0.001);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 0.001) }) },
  { id: 'gap-large-1000', group: 'gap', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 1000);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 1000) }) },
  { id: 'extreme-scale-ratio-100-to-0.5', group: 'gap', src: `const a = sketch('top'); a.rect(100, 100); const b = sketch('top'); b.rect(0.5, 0.5); blend(a, b, 40);`,
    analytic: () => ({ volume: ruledVolume([[-50, -50], [50, -50], [50, 50], [-50, 50]], [[-.25, -.25], [.25, -.25], [.25, .25], [-.25, .25]], 40) }) },
  { id: 'front-plane', group: 'plane', src: `const a = sketch('front'); a.rect(40, 40); const b = sketch('front'); b.rect(10, 10); blend(a, b, 30);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 30) }) },
  { id: 'side-plane', group: 'plane', src: `const a = sketch('side'); a.rect(40, 40); const b = sketch('side'); b.rect(10, 10); blend(a, b, 30);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 30) }) },
  { id: 'front-plane-offcentre-circle', group: 'plane', src: `const a = sketch('front'); a.circle(30); const b = sketch('front'); b.rect(10, 10, { at: [4, 3] }); blend(a, b, 22);` },
  { id: 'different-planes', group: 'plane', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('front'); b.rect(10, 10); blend(a, b, 30);` },
  { id: 'rows-sketch-soup', group: 'soup', src: `const a = sketch('top'); a.geom([{k:'rect',id:1,c:[0,0],w:40,h:40}]); const b = sketch('top'); b.rect(10,10); blend(a, b, 30);` },
  { id: 'slot-sketch', group: 'soup', src: `const a = sketch('top'); a.slot([-10,0],[10,0],5); const b = sketch('top'); b.rect(10,10); blend(a, b, 30);` },
  { id: 'square-to-square-start-vertex-shifted-90deg', group: 'correspondence', src: `const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.polygon([[10,-10],[10,10],[-10,10],[-10,-10]]); blend(a, b, 20);`,
    analytic: () => ({ volume: ruledVolume([[-10,-10],[10,-10],[10,10],[-10,10]], [[10,-10],[10,10],[-10,10],[-10,-10]], 20) }) },
  { id: 'triangle-to-triangle-start-vertex-shifted-120deg', group: 'correspondence', src: `const a = sketch('top'); a.polygon([[0,0],[40,0],[20,30]]); const b = sketch('top'); b.polygon([[40,0],[20,30],[0,0]]); blend(a, b, 20);`,
    analytic: () => ({ volume: ruledVolume([[0,0],[40,0],[20,30]], [[40,0],[20,30],[0,0]], 20) }) },
  { id: 'square-to-square-rotated-60deg', group: 'correspondence', src: `const c=Math.cos(60*Math.PI/180), s=Math.sin(60*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.polygon(R(20,20)); blend(a, b, 20);`,
    analytic: () => { const c=Math.cos(60*Math.PI/180), s=Math.sin(60*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); return { volume: ruledVolume([[-10,-10],[10,-10],[10,10],[-10,10]], R(20,20), 20) }; } },
  { id: 'rect-rotated-20deg-x10-scale', group: 'tess-scale', src: `const c=Math.cos(20*Math.PI/180), s=Math.sin(20*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); const a = sketch('top'); a.rect(300, 200); const b = sketch('top'); b.polygon(R(300,200)); blend(a, b, 200);`,
    analytic: () => { const c=Math.cos(20*Math.PI/180), s=Math.sin(20*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); return { volume: ruledVolume([[-150,-100],[150,-100],[150,100],[-150,100]], R(300,200), 200) }; } },
  { id: 'rect-rotated-20deg-x0.1-scale', group: 'tess-scale', src: `const c=Math.cos(20*Math.PI/180), s=Math.sin(20*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); const a = sketch('top'); a.rect(3, 2); const b = sketch('top'); b.polygon(R(3,2)); blend(a, b, 2);`,
    analytic: () => { const c=Math.cos(20*Math.PI/180), s=Math.sin(20*Math.PI/180); const R=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[x*c-y*s, x*s+y*c]); return { volume: ruledVolume([[-1.5,-1],[1.5,-1],[1.5,1],[-1.5,1]], R(3,2), 2) }; } },
  { id: 'triangle-triangle-x10-scale', group: 'tess-scale', src: `const a = sketch('top'); a.polygon([[0,0],[400,0],[0,300]]); const b = sketch('top'); b.polygon([[50,50],[150,50],[50,120]]); blend(a, b, 200);`,
    analytic: () => ({ volume: ruledVolume([[0,0],[400,0],[0,300]], [[50,50],[150,50],[50,120]], 200) }) },
  { id: 'rect-to-circle-x10-scale', group: 'tess-scale', src: `const a = sketch('top'); a.rect(400, 400); const b = sketch('top'); b.circle(200); blend(a, b, 300);` },
  { id: 'circle-to-circle-x10-scale', group: 'tess-scale', src: `const a = sketch('top'); a.circle(400); const b = sketch('top'); b.circle(200); blend(a, b, 300);`,
    analytic: () => ({ volume: frustumVolume(200, 100, 300) }) },
  { id: 'frame-sketches-gap-ignored', group: 'frame', src: `const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,5], u: [1,0,0], v: [0,1,0] }); b.rect(10, 10); blend(a, b, 30);` },
  { id: 'frame-sketches-same-origin', group: 'frame', src: `const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); b.rect(10, 10); blend(a, b, 30);` },
  { id: 'frame-sketches-tilted-nonparallel', group: 'frame', src: `const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,30], u: [1,0,0], v: [0,0.9238795325112867,0.3826834323650898] }); b.rect(10, 10); blend(a, b, 30);` },
  { id: 'plane-offset-datum-sketches', group: 'frame', src: `const a = sketch(plane('top', 10)); a.rect(40, 40); const b = sketch(plane('top', 0)); b.rect(10, 10); blend(a, b, 30);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 30) }) },
  { id: 'cw-vs-ccw-orientation', group: 'correspondence', src: `const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.polygon([[5,5],[5,-5],[-5,-5],[-5,5]]); blend(a, b, 20);`,
    analytic: () => ({ volume: ruledVolume([[-10,-10],[10,-10],[10,10],[-10,10]], [[-5,-5],[5,-5],[5,5],[-5,5]], 20) }) },
  { id: 'degenerate-collinear-section', group: 'degenerate', src: `const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.polygon([[0,0],[10,0],[20,0]]); blend(a, b, 20);` },
  { id: 'bowtie-self-intersecting-section', group: 'degenerate', src: `const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.polygon([[-5,-5],[5,5],[5,-5],[-5,5]]); blend(a, b, 20);` },
  { id: 'rows-circle-only-sketch', group: 'soup', src: `const a = sketch('top'); a.geom([{k:'circle',id:1,c:[0,0],r:10}]); const b = sketch('top'); b.rect(10,10); blend(a, b, 30);` },
  { id: 'rect-with-length-rule', group: 'soup', src: `const a = sketch('top'); a.rect(40, 30); a.length(1, 36); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30);` },
  // ---- script-layer refusals (no kernel) ----
  { id: 'extra-arg', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30, 5);` },
  { id: 'extra-arg-string', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30, 'zzz');` },
  { id: 'extra-arg-object', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30, { height: 30 });` },
  { id: 'loft-alias-extra-arg', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); loft(a, b, 30, 5);` },
  { id: 'loft-alias-ok', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); loft(a, b, 30);`,
    analytic: () => ({ volume: ruledVolume([[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], 30) }) },
  { id: 'missing-gap', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b);` },
  { id: 'one-sketch-only', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); blend(a);` },
  { id: 'three-sketches', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); const c = sketch('top'); c.rect(5,5); blend(a, b, c, 30);` },
  { id: 'non-sketch-arg', group: 'args', src: `const a = box(10,10,10); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30);` },
  { id: 'gap-not-number', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 'tall');` },
  { id: 'same-sketch-twice', group: 'args', src: `const a = sketch('top'); a.rect(40, 40); blend(a, a, 30);` },
  { id: 'empty-sketch-default', group: 'args', src: `const a = sketch('top'); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30);` },
];

for (const deg of [10, 20, 30, 40, 44, 45, 46, 50, 60, 70, 80]) {
  cases.push({ id: `twist-scan-square-${deg}deg`, group: 'twist-scan',
    src: `const c=Math.cos(${deg}*Math.PI/180), s=Math.sin(${deg}*Math.PI/180); const a = sketch('top'); a.rect(20, 20); const b = sketch('top'); b.polygon([[-10,-10],[10,-10],[10,10],[-10,10]].map(([x,y])=>[x*c-y*s, x*s+y*c])); blend(a, b, 20);`,
    analytic: () => { const c=Math.cos(deg*Math.PI/180), s=Math.sin(deg*Math.PI/180); const A=[[-10,-10],[10,-10],[10,10],[-10,10]]; const B=A.map(([x,y])=>[x*c-y*s, x*s+y*c]); const vols=[0,1,2,3].map(k=>ruledVolume(A,B.map((_,i)=>B[(i+k)%4]),20)); return { volume: vols[0], shifts: vols }; } });
}
const out = [];
for (const c of cases) {
  if (only.length && !only.includes(c.id)) continue;
  const row = { id: c.id, group: c.group, src: c.src };
  const run = runScript(c.src);
  row.scriptErrors = run.errors.map((e) => e.message ?? String(e));
  const bl = run.doc.features.find((f) => f.kind === 'blend');
  row.features = run.doc.features.map((f) => ({ id: f.id, kind: f.kind, plane: f.plane, offset: f.offset, shape: f.shape, targets: f.targets, npts: f.points?.length }));
  if (!bl) { row.noBlend = true; out.push(row); console.log(c.id, 'NO BLEND:', row.scriptErrors.join(' | ').slice(0, 160)); continue; }
  const doc0 = solveDoc({ version: 1, features: run.doc.features }); // SOLVED doc for every kernel (sketch rules applied)
  // round trip
  try { row.toScript = toScript(run.doc); const r2 = runScript(row.toScript); row.roundTripBlend = JSON.stringify(r2.doc.features.filter(f=>f.kind==='blend'||f.kind==='sketch').map(f=>[f.kind,f.plane,f.offset,f.targets,f.points])) === JSON.stringify(run.doc.features.filter(f=>f.kind==='blend'||f.kind==='sketch').map(f=>[f.kind,f.plane,f.offset,f.targets,f.points])); } catch (e) { row.toScriptError = e.message; }
  // OCCT
  try {
    const built = buildDoc(oc, doc0, arc);
    const shape = built.shapes.get(bl.id);
    row.occtRefusal = built.refusals?.get?.(bl.id) ?? null;
    if (shape) row.occt = occtMeasure(shape); else row.occtNoShape = true;
  } catch (e) { row.occtThrew = e.message; }
  // brep-rs
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc0)));
    const s = got.shapes?.[bl.id];
    row.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } : { refused: got.refusals?.[bl.id] ?? 'no shape', allRefusals: got.refusals };
  } catch (e) { row.brep = { threw: e.message }; }
  // truck
  const doc = doc0;
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  const mf = tr.features.find((f) => f.id === bl.id);
  row.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal }));
  row.commands = mf?.commands;
  if (mf?.status === 'built') row.truck = { volume: mf.measure.volume, bbox: mf.measure.bbox, faces: mf.measure.faces, kernelFaces: mf.measure.kernelFaces, faceTypes: mf.measure.faceTypes, com: mf.measure.com, bodies: mf.measure.bodies.length };
  else row.truck = { refused: mf?.refusal };
  // analytic
  row.analyticBbox = bboxOfSketches(doc0, bl);
  if (c.analytic) row.analytic = c.analytic(doc0);
  if (row.analytic?.shifts && row.truck.volume !== undefined) row.truckMatchesShift = row.analytic.shifts.map((v) => rel(row.truck.volume, v));
  if (row.analytic?.shifts && row.occt) row.occtMatchesShift = row.analytic.shifts.map((v) => rel(row.occt.volume, v));
  // deltas
  const D = {};
  if (row.occt && row.truck.volume !== undefined) {
    D.truckVsOcct = { vol: rel(row.truck.volume, row.occt.volume), bbox: worstArr(row.truck.bbox, row.occt.bbox), faces: [row.occt.faces, row.truck.faces] };
  }
  if (row.truck.volume !== undefined && row.analytic) D.truckVsAnalytic = rel(row.truck.volume, row.analytic.volume);
  if (row.occt && row.analytic) D.occtVsAnalytic = rel(row.occt.volume, row.analytic.volume);
  if (row.brep?.volume !== undefined && row.analytic) D.brepVsAnalytic = rel(row.brep.volume, row.analytic.volume);
  if (row.brep?.volume !== undefined && row.occt) D.brepVsOcct = { vol: rel(row.brep.volume, row.occt.volume), bbox: worstArr(row.brep.bbox, row.occt.bbox), faces: [row.occt.faces, row.brep.faces] };
  if (row.truck.bbox) { D.truckBboxVsAnalyticSketch = worstArr(row.truck.bbox, row.analyticBbox); }
  if (row.occt) { D.occtBboxVsAnalyticSketch = worstArr(row.occt.bbox, row.analyticBbox); D.occtPlainAddBboxVsAnalytic = worstArr(row.occt.bboxPlainAdd, row.analyticBbox); }
  if (row.brep?.bbox) D.brepBboxVsAnalyticSketch = worstArr(row.brep.bbox, row.analyticBbox);
  row.D = D;
  out.push(row);
  const f = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  console.log(c.id.padEnd(46), 'occt', row.occt ? row.occt.volume.toFixed(4) : (row.occtRefusal ?? 'none'), '| brep', row.brep?.volume !== undefined ? row.brep.volume.toFixed(4) : (row.brep?.refused ?? row.brep?.threw), '| truck', row.truck.volume !== undefined ? row.truck.volume.toFixed(4) : 'REFUSED ' + row.truck.refused,
    '| anVol', row.analytic ? row.analytic.volume.toFixed(4) : '-', '| dT/O', f(D.truckVsOcct?.vol), 'dT/An', f(D.truckVsAnalytic), 'dO/An', f(D.occtVsAnalytic), 'dB/An', f(D.brepVsAnalytic), '| bboxT/O', f(D.truckVsOcct?.bbox), 'faces O/B/T', row.occt?.faces, row.brep?.faces, row.truck.faces);
}
writeFileSync(arg('out') || path.join(REPO, 'docs/spikes/solidcraft-referee/contract/blend-loft.r4-measure-results.json'), JSON.stringify(out, null, 1));
console.log('wrote', arg('out') || path.join(REPO, 'docs/spikes/solidcraft-referee/contract/blend-loft.r4-measure-results.json'));
