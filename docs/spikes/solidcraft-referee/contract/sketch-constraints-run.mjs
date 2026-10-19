#!/usr/bin/env node
// SPIKE, referee only. Contract run for the feature group 'sketch-constraints' (2D sketch constraints and dimensions).
//
//   SOLIDCRAFT_REFEREE_PKG=<phase0-style pkg: exports run(commands_json)> \
//     systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/sketch-constraints-run.mjs [--out=<dir>] [--only=substr,..]
//
// Pipeline per case: reSHape Script text -> packages/script runScript -> solveDoc (what every host page does) ->
// phase4 translateDoc (the translator; soup sketches go through phase2 sketch-map.mjs -> SolidCraft's own sketch solver)
// -> SolidCraft extrude -> inspect.measure. Scored against: closed form (written as arithmetic next to each case), live
// brep-rs wasm (archive/brep-rs/pkg), live OCCT (replicad-opencascadejs) building the brep-rs-solved geometry, and the
// saved FreeCAD refs for gauntlet fixtures.
//
// LIMIT OF THIS RIG: the pkg exports only run(commands) -> final measure; it has no @sketch dump, so SolidCraft's own
// DoF / SolveReport / solved points are NOT observable here. Solved geometry is judged through the extruded solid (volume,
// bbox, centre of mass; planar results pin it to ~1e-9). DoF numbers quoted in evidence come from phase2/results.json
// (measured earlier with a different wrapper) and are labelled as prior, not re-measured.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const OUT = arg('out') ? path.resolve(arg('out')) : HERE;
mkdirSync(OUT, { recursive: true });
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const imp = (p) => import(pathToFileURL(p).href);
const { runScript } = await imp(path.join(REPO, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(REPO, 'packages/script/dist/model-codegen.js'));
const mt = await imp(path.join(REPO, 'packages/script/dist/model-types.js'));
const arc = await imp(path.join(REPO, 'packages/sketch/dist/sketch-arc.js'));
const { translateDoc } = await imp(path.join(REPO, 'docs/spikes/solidcraft-referee/phase4/host/translate-p4.mjs'));
const { mapSketch, extrudeCommands } = await imp(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/sketch-map.mjs'));
const { checkRules } = await imp(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/rule-check.mjs'));
const { gauntletFixtures } = await imp(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/fixtures-p2.mjs'));
const blib = await imp(path.join(HERE, 'brep-lib.mjs'));
const { SketchSession2D, brep } = await blib.load();
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await imp(path.join(OCCT_DIR, 'replicad_single.js'));
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await imp(path.join(REPO, 'packages/brep-adapter/dist/occt-build.js'));
const PHASE2 = (() => { try { return JSON.parse(readFileSync(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/results.json'), 'utf8')); } catch { return null; } })();
const GAUNTLET = path.join(REPO, 'docs/replica/freecad/gauntlet/variants');

const H = 10;
const TOL = { planar: 1e-9, curved: 3e-4 };
const COMTOL = { planar: 1e-6, curved: 3e-5 };
const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const clone = (o) => JSON.parse(JSON.stringify(o));
const f6 = (x) => (typeof x === 'number' ? +x.toPrecision(10) : Array.isArray(x) ? x.map(f6) : x);
const ex = (x) => (typeof x === 'number' ? x.toExponential(1) : String(x));
const runSC = async (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };

// ---- geometry / rule factories -------------------------------------------------------------------------------------
const L = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
const C = (id, c, r, extra = {}) => ({ k: 'circle', id, c, r, ...extra });
const A = (id, c, r, a, b, sense, extra = {}) => ({ k: 'arc', id, c, r, a, b, sense, ...extra });
const join = (i, j) => ({ k: 'coincident', a: i, aEnd: 'b', b: j, bEnd: 'a' });
const loopJoins = (n, first = 1) => Array.from({ length: n }, (_, i) => join(first + i, first + ((i + 1) % n)));
const len = (i, value) => ({ k: 'distance', a: i, aEnd: 'a', b: i, bEnd: 'b', ...(value !== undefined ? { value } : {}) });
const rectG = (x0, y0, x1, y1) => [L(1, [x0, y0], [x1, y0]), L(2, [x1, y0], [x1, y1]), L(3, [x1, y1], [x0, y1]), L(4, [x0, y1], [x0, y0])];
const rectShape = () => [...loopJoins(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const atOrigin = (id, end = 'a') => ({ k: 'coincident', a: id, aEnd: end, b: -1, bEnd: 'a' });
const dist = (a, ae, b, be, value) => ({ k: 'distance', a, aEnd: ae, b, bEnd: be, value });
const dX = (a, ae, b, be, value) => ({ k: 'distanceX', a, aEnd: ae, b, bEnd: be, value });
const dY = (a, ae, b, be, value) => ({ k: 'distanceY', a, aEnd: ae, b, bEnd: be, value });
const P = (name, v) => ({ __param: name, v }); // value written as a param() reference in the script text

// ---- script text -------------------------------------------------------------------------------------------------
const fmt = (v) => {
  if (v && typeof v === 'object' && v.__param) return v.__param;
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'number') return String(+v.toPrecision(12));
  return String(v);
};
const row = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')} }`;
const rowsTxt = (rs) => rs.map((r) => `  ${row(r)}`).join(',\n');
function soupScript(geoms, rules, { plane = 'top', tail = `const part = extrude(sk, ${H})` } = {}) {
  const params = new Map();
  for (const r of rules) if (r.value && r.value.__param) params.set(r.value.__param, r.value.v);
  const decl = [...params].map(([n, v]) => `const ${n} = param('${n}', ${v})`).join('\n');
  return `${decl}${decl ? '\n' : ''}const sk = sketch('${plane}')\nsk.geom([\n${rowsTxt(geoms)}\n])\nsk.rules([\n${rowsTxt(rules)}\n])\n${tail}`;
}
const plainRules = (rules) => rules.map((r) => (r.value && r.value.__param ? { ...r, value: r.value.v } : r));

// ---- deterministic rough start ---------------------------------------------------------------------------------
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
function geomBox(gs) {
  const pts = [];
  for (const g of gs) {
    if (g.k === 'point') pts.push(g.p);
    else if (g.k === 'line') pts.push(g.a, g.b);
    else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]);
    else pts.push(g.a, g.b);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
/** every coordinate off by up to `frac` of the sketch diagonal; points a `lock` row pins stay (brep-rs pins at the row's coordinate). */
function roughen(geoms, rules, seedKey, frac = 0.035) {
  const rnd = mulberry(seedOf(seedKey));
  const bb = geomBox(geoms);
  const amp = frac * Math.max(Math.hypot(bb[2] - bb[0], bb[3] - bb[1]), 1);
  const locked = new Set(rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const j = () => (rnd() * 2 - 1) * amp;
  const mv = (p) => [p[0] + j(), p[1] + j()];
  return geoms.map((g) => {
    if (g.noRough) return clone(g);
    const o = clone(g);
    const lk = (e) => locked.has(`${g.id}:${e}`) || (e === 'c' && (g.k === 'circle' || g.k === 'arc') && locked.has(`${g.id}:`)) || (e === 'a' && (g.k === 'line' || g.k === 'point') && locked.has(`${g.id}:`));
    if (g.k === 'point') { if (!lk('a')) o.p = mv(g.p); }
    if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); }
    if (g.k === 'circle') { if (!lk('c')) o.c = mv(g.c); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1) * (frac / 0.035 > 3 ? 3 : 1)); }
    if (g.k === 'arc') {
      // a hand-drawn arc: centre and radius off, both ends still ON the (new) circle, slid along it. (Rows whose ends are not on
      // the circle are a different, invalid input: see the 'arc rows inconsistent' case.)
      if (!lk('c')) o.c = mv(g.c);
      o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1));
      const slide = (p, locked) => { const th = Math.atan2(p[1] - g.c[1], p[0] - g.c[0]) + (locked ? 0 : (rnd() * 2 - 1) * Math.min(0.2, amp / g.r)); return [o.c[0] + o.r * Math.cos(th), o.c[1] + o.r * Math.sin(th)]; };
      o.a = slide(g.a, lk('a')); o.b = slide(g.b, lk('b'));
    }
    return o;
  });
}

// ---- closed-form helpers (independent arithmetic) -----------------------------------------------------------------
const slotArea = (Lx, R) => Lx * 2 * R + Math.PI * R * R;
/** area of a loop of arcs by Green's theorem: arcs given as {c, r, t0, t1} (radians, ccw if t1>t0). */
function arcLoopArea(arcs) {
  let a = 0;
  for (const { c, r, t0, t1 } of arcs) a += 0.5 * (r * r * (t1 - t0) + r * (c[0] * (Math.sin(t1) - Math.sin(t0)) - c[1] * (Math.cos(t1) - Math.cos(t0))));
  return a;
}

// ---- cases ------------------------------------------------------------------------------------------------------------
// case: { id, feats:[feature names], geoms, rules, area, bbox:[x0,y0,x1,y1], centroid?:[x,y], curved?, bodies?, script?, expect: 'build'|'refuse', note,
//         modes?: ['stored','rough'], refusePattern?: RegExp, selectPoint?, gauntlet? }
const CASES = [];
const add = (c) => CASES.push({ modes: ['stored', 'rough'], expect: 'build', ...c });

add({ id: 'rect-origin-dims', feats: ['rule:coincident', 'rule:horizontal', 'rule:vertical', 'rule:distance', 'point-ref:a/b/c ends', 'point-ref:origin -1', 'value:number', 'dimensioned rectangle'],
  geoms: rectG(0.3, 0.2, 28.4, 17.1), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20)],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
add({ id: 'rect-corner-dx-dy-positive', feats: ['rule:distanceX', 'rule:distanceY', 'dimensioned rectangle', 'rough start: signed distanceX/distanceY branch'],
  geoms: rectG(4.2, 2.1, 32.4, 19.1), rules: [...rectShape(), dX(-1, 'a', 1, 'a', 5), dY(-1, 'a', 1, 'a', 3), len(1, 30), len(2, 20)],
  area: 600, bbox: [5, 3, 35, 23], centroid: [20, 13] });
add({ id: 'rect-corner-dx-dy-negative', feats: ['rule:distanceX', 'rule:distanceY', 'rough start: signed distanceX/distanceY branch'],
  geoms: rectG(-9.2, -5.1, 18.4, 13.1), rules: [...rectShape(), dX(-1, 'a', 1, 'a', -8), dY(-1, 'a', 1, 'a', -4), len(1, 30), len(2, 20)],
  area: 600, bbox: [-8, -4, 22, 16], centroid: [7, 6], branchSensitive: true });
add({ id: 'rect-diagonal-two-point-distance', feats: ['rule:distance'],
  geoms: rectG(0.2, 0.3, 24.6, 9.4), rules: [...rectShape(), atOrigin(1), len(1, 24), dist(1, 'a', 3, 'a', 26)],
  area: 240, bbox: [0, 0, 24, 10], centroid: [12, 5] });
add({ id: 'circle-radius-dx-dy', feats: ['rule:radius', 'rule:distanceX', 'rule:distanceY', 'point-ref:a/b/c ends'],
  geoms: [C(1, [9, 6], 6.4)], rules: [{ k: 'radius', a: 1, value: 7 }, dX(-1, 'a', 1, 'c', 10), dY(-1, 'a', 1, 'c', 5)],
  area: Math.PI * 49, bbox: [3, -2, 17, 12], centroid: [10, 5], curved: true });
add({ id: 'circle-diameter-origin-c', feats: ['rule:diameter', 'rule:coincident', 'point-ref:a/b/c ends', 'point-ref:origin -1'],
  geoms: [C(1, [0.7, -0.5], 11)], rules: [{ k: 'diameter', a: 1, value: 24 }, { k: 'coincident', a: 1, aEnd: 'c', b: -1, bEnd: 'a' }],
  area: Math.PI * 144, bbox: [-12, -12, 12, 12], centroid: [0, 0], curved: true });
add({ id: 'rect-parallel-perpendicular-axes', feats: ['rule:parallel', 'rule:perpendicular', 'axis-ref:X/Y axes (-2,-3)'],
  geoms: rectG(0.2, 0.3, 28.4, 17.6), rules: [...loopJoins(4), { k: 'parallel', a: 1, b: -2 }, { k: 'perpendicular', a: 2, b: -2 }, { k: 'parallel', a: 3, b: -2 }, { k: 'perpendicular', a: 4, b: -2 }, atOrigin(1), len(1, 30), len(2, 20)],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
add({ id: 'right-trapezoid-par-perp-neg-dx', feats: ['rule:parallel', 'rule:perpendicular', 'rule:distanceX', 'right trapezoid', 'rough start: signed distanceX/distanceY branch'],
  geoms: [L(1, [0.3, 0.2], [30, 0.4]), L(2, [30, 0.4], [21, 16]), L(3, [21, 16], [0.5, 15.5]), L(4, [0.5, 15.5], [0.3, 0.2])],
  rules: [...loopJoins(4), { k: 'horizontal', a: 1 }, { k: 'perpendicular', a: 1, b: 4 }, { k: 'parallel', a: 1, b: 3 }, atOrigin(1), len(1, 30), len(4, 16), dX(2, 'a', 2, 'b', -8)],
  area: ((30 + 22) / 2) * 16, bbox: [0, 0, 30, 16], branchSensitive: true });
add({ id: 'square-by-equal-lines', feats: ['rule:equal'],
  geoms: rectG(0.3, 0.2, 21, 23.5), rules: [...rectShape(), atOrigin(1), len(1, 22), { k: 'equal', a: 1, b: 2 }],
  area: 484, bbox: [0, 0, 22, 22], centroid: [11, 11] });
add({ id: 'two-circles-equal', feats: ['rule:equal'],
  geoms: [C(1, [9, 6], 6.4), C(2, [31, 4.5], 5)], rules: [{ k: 'radius', a: 1, value: 6 }, { k: 'equal', a: 1, b: 2 }, dX(-1, 'a', 1, 'c', 10), dY(-1, 'a', 1, 'c', 5), dX(-1, 'a', 2, 'c', 30), dY(-1, 'a', 2, 'c', 5)],
  area: 2 * Math.PI * 36, bbox: [4, -1, 36, 11], bodies: 2, curved: true });
add({ id: 'triangle-apex-on-diagonal-line', feats: ['rule:pointOnObject', 'rule:lock', 'rule:coincident'],
  geoms: [L(1, [0.2, 0.1], [29.5, 0.3]), L(2, [29.5, 0.3], [30.4, 28.6]), L(3, [30.4, 28.6], [0.2, 0.1]), L(4, [0.3, 0.2], [50, 50], { construction: true })],
  rules: [join(1, 2), join(2, 3), { k: 'coincident', a: 3, aEnd: 'b', b: 1, bEnd: 'a' }, { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, atOrigin(1), len(1, 30),
    atOrigin(4), { k: 'lock', a: 4, aEnd: 'b' }, { k: 'pointOnObject', a: 2, aEnd: 'b', b: 4 }],
  area: 450, bbox: [0, 0, 30, 30], centroid: [20, 10] });
add({ id: 'hexagon-equal-pointOn-circle', feats: ['rule:pointOnObject', 'rule:equal', 'hexagon (equal + pointOnObject)', 'point-ref:a/b/c ends'],
  geoms: (() => { const hv = (r, k) => [r * Math.cos(((60 * k - 30) * Math.PI) / 180), r * Math.sin(((60 * k - 30) * Math.PI) / 180)]; return [...Array.from({ length: 6 }, (_, k) => L(k + 1, hv(20, k), hv(20, (k + 1) % 6))), C(7, [0.3, -0.2], 19.4, { construction: true })]; })(),
  rules: [...loopJoins(6), ...[1, 2, 3, 4, 5].map((i) => ({ k: 'equal', a: i, b: i + 1 })), ...[1, 2, 3, 4, 5, 6].map((i) => ({ k: 'pointOnObject', a: i, aEnd: 'a', b: 7 })), atOrigin(7, 'c'), { k: 'radius', a: 7, value: 20 }, { k: 'vertical', a: 1 }],
  area: ((3 * Math.sqrt(3)) / 2) * 400, bbox: [-20 * Math.cos(Math.PI / 6), -20, 20 * Math.cos(Math.PI / 6), 20], centroid: [0, 0] });
add({ id: 'symmetric-trapezoid-about-Y-axis', feats: ['rule:symmetric', 'symmetric:about axis', 'axis-ref:X/Y axes (-2,-3)', 'rule:pointOnObject', 'symmetric trapezoid'],
  geoms: [L(1, [-19, 0.5], [21, 0.3]), L(2, [21, 0.3], [9.5, 14]), L(3, [9.5, 14], [-10.5, 15]), L(4, [-10.5, 15], [-19, 0.5])],
  rules: [...loopJoins(4), { k: 'symmetric', a: 1, aEnd: 'a', b: 1, bEnd: 'b', c: -3 }, { k: 'symmetric', a: 3, aEnd: 'a', b: 3, bEnd: 'b', c: -3 }, len(1, 40), len(3, 20), dY(1, 'a', 3, 'a', 15), { k: 'pointOnObject', a: 1, aEnd: 'a', b: -2 }],
  area: ((40 + 20) / 2) * 15, bbox: [-20, 0, 20, 15], centroid: [0, (15 * (40 + 2 * 20)) / (3 * (40 + 20))] });
add({ id: 'symmetric-about-construction-line', feats: ['rule:symmetric', 'symmetric:about line', 'rule:lock'],
  geoms: [...rectG(0.5, 0.3, 19, 12.5), L(5, [10, -5], [10, 25], { construction: true, noRough: true })],
  rules: [...loopJoins(4), { k: 'symmetric', a: 1, aEnd: 'a', b: 1, bEnd: 'b', c: 5 }, { k: 'symmetric', a: 3, aEnd: 'a', b: 3, bEnd: 'b', c: 5 }, { k: 'lock', a: 5, aEnd: 'a' }, { k: 'lock', a: 5, aEnd: 'b' },
    { k: 'pointOnObject', a: 1, aEnd: 'a', b: -2 }, len(1, 20), len(2, 12), len(3, 20)],
  area: 240, bbox: [0, 0, 20, 12], centroid: [10, 6] });
add({ id: 'symmetric-3point-midpoint', feats: ['rule:symmetric', 'symmetric:3-point', 'point-ref:a/b/c ends'],
  geoms: [...rectG(-17, -13, 18.5, 12.5), { k: 'point', id: 5, p: [0.4, -0.3] }],
  rules: [...rectShape(), { k: 'symmetric', a: 1, aEnd: 'a', b: 3, bEnd: 'a', c: 5, cEnd: 'a' }, atOrigin(5), len(1, 36), len(2, 24)],
  area: 864, bbox: [-18, -12, 18, 12], centroid: [0, 0] });
add({ id: 'tangent-line-circle', feats: ['rule:tangent', 'tangent:line-circle', 'rule:lock'],
  geoms: [L(1, [-20, 0], [20, 0], { construction: true, noRough: true }), C(2, [8.3, 6.4], 5.7)],
  rules: [{ k: 'lock', a: 1, aEnd: 'a' }, { k: 'lock', a: 1, aEnd: 'b' }, { k: 'tangent', a: 1, b: 2 }, { k: 'radius', a: 2, value: 6 }, dX(-1, 'a', 2, 'c', 8)],
  area: Math.PI * 36, bbox: [2, 0, 14, 12], centroid: [8, 6], curved: true });
add({ id: 'tangent-line-circle-side-matching', feats: ['tangent:side option'],
  geoms: [L(1, [-20, 0], [20, 0], { construction: true, noRough: true }), C(2, [8.3, 6.4], 5.7)],
  rules: [{ k: 'lock', a: 1, aEnd: 'a' }, { k: 'lock', a: 1, aEnd: 'b' }, { k: 'tangent', a: 1, b: 2, side: 1 }, { k: 'radius', a: 2, value: 6 }, dX(-1, 'a', 2, 'c', 8)],
  area: Math.PI * 36, bbox: [2, 0, 14, 12], centroid: [8, 6], curved: true, modes: ['stored'] });
add({ id: 'tangent-line-circle-side-opposite', feats: ['tangent:side option'], expect: 'refuse',
  geoms: [L(1, [-20, 0], [20, 0], { construction: true, noRough: true }), C(2, [8.3, 6.4], 5.7)],
  rules: [{ k: 'lock', a: 1, aEnd: 'a' }, { k: 'lock', a: 1, aEnd: 'b' }, { k: 'tangent', a: 1, b: 2, side: -1 }, { k: 'radius', a: 2, value: 6 }, dX(-1, 'a', 2, 'c', 8)],
  area: Math.PI * 36, bbox: [2, 0, 14, 12], curved: true, modes: ['stored'], refusePattern: /side/ });
// circle-circle: two circles r 8 and 5, big one locked at (0,0); small centre on the X axis
const cc = (id, feats, d, mode, startC, extra = {}) => add({ id, feats, curved: true, ...extra,
  geoms: [C(1, [0, 0], 8, { noRough: true }), C(2, startC, 5)],
  rules: [{ k: 'lock', a: 1, aEnd: 'c' }, { k: 'radius', a: 1, value: 8 }, { k: 'radius', a: 2, value: 5 }, { k: 'pointOnObject', a: 2, aEnd: 'c', b: -2 }, { k: 'tangent', a: 1, b: 2, ...(mode ? { mode } : {}) }] });
cc('circle-circle-external-mode', ['rule:tangent', 'tangent:circle-circle external', 'tangent:mode option'], 13, 'external', [13.4, 0.2], { area: Math.PI * (64 + 25), bbox: [-8, -8, 18, 8], bodies: 2 });
cc('circle-circle-external-no-mode', ['tangent:circle-circle external'], 13, null, [13.4, 0.2], { area: Math.PI * (64 + 25), bbox: [-8, -8, 18, 8], bodies: 2 });
cc('circle-circle-internal-mode', ['tangent:circle-circle internal', 'tangent:mode option'], 3, 'internal', [3.3, 0.2], { area: Math.PI * (64 - 25), bbox: [-8, -8, 8, 8], bodies: 1, nested: true });
cc('circle-circle-internal-no-mode', ['tangent:circle-circle internal'], 3, null, [3.3, 0.2], { area: Math.PI * (64 - 25), bbox: [-8, -8, 8, 8], bodies: 1, nested: true });
cc('circle-circle-mode-request-external-start-internal', ['tangent:mode option', 'rough start: tangent external/internal branch'], 13, 'external', [3.3, 0.2], { expect: 'refuse', area: Math.PI * (64 + 25), bbox: [-8, -8, 18, 8], modes: ['stored'], refusePattern: /external tangency but the circles start internally/ });
cc('circle-circle-mode-request-internal-start-external', ['tangent:mode option', 'rough start: tangent external/internal branch'], 3, 'internal', [13.4, 0.2], { expect: 'refuse', area: Math.PI * (64 - 25), bbox: [-8, -8, 8, 8], modes: ['stored'], refusePattern: /internal tangency but the circles start externally/ });
// slots (hand rows), tangent joints
const tj = (l, le, a, ae) => [{ k: 'coincident', a: l, aEnd: le, b: a, bEnd: ae }, { k: 'tangent', a: l, aEnd: le, b: a, bEnd: ae }];
add({ id: 'slot-hand-rows-R10-L40', feats: ['rule:tangent', 'tangent:endpoint line-arc', 'rule:lock', 'rule:equal', 'rule:radius', 'slot with tangent joints', 'endpoint tangency curved accuracy', 'point-ref:a/b/c ends'],
  geoms: [A(1, [0, 10], 10, [0, 0], [0, 20], 'cw'), A(2, [40, 10], 10, [40, 20], [40, 0], 'cw'), L(3, [0, 20], [40.2, 19.9]), L(4, [40, 0.1], [0, 0])],
  rules: [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'), { k: 'radius', a: 1, value: 10 }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, 40), { k: 'lock', a: 1, aEnd: 'c' }],
  area: slotArea(40, 10), bbox: [-10, 0, 50, 20], centroid: [20, 10], curved: true });
add({ id: 'slot-sketch-sugar-R6-L30', feats: ['slot with tangent joints', 'rule:tangent', 'tangent:endpoint line-arc'], modes: ['stored'],
  script: `const sk = sketch('top')\nsk.slot([0, 0], [30, 0], 6)\nconst part = extrude(sk, ${H})`,
  geoms: null, rules: null, area: slotArea(30, 6), bbox: [-6, -6, 36, 6], centroid: [15, 0], curved: true });
add({ id: 'slot-dims-from-points', feats: ['tangent:endpoint line-arc', 'slot with tangent joints', 'endpoint tangency curved accuracy', 'rule:distanceX'],
  geoms: [L(1, [0.2, -5.1], [25.3, -4.9]), A(2, [25, 0.1], 5, [25.1, -5], [25.3, 4.8], 'ccw'), L(3, [25.3, 5.2], [-0.1, 4.9]), A(4, [0.1, 0], 5, [0, 5.1], [-0.2, -5], 'ccw')],
  rules: [{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'tangent', a: 3, aEnd: 'a', b: 2, bEnd: 'b' },
    { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'tangent', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }, { k: 'tangent', a: 1, aEnd: 'a', b: 4, bEnd: 'b' },
    { k: 'horizontal', a: 1 }, { k: 'radius', a: 2, value: 5 }, { k: 'equal', a: 2, b: 4 }, { k: 'coincident', a: 4, aEnd: 'c', b: -1, bEnd: 'a' }, dX(4, 'c', 2, 'c', 25)],
  area: 25 * 10 + Math.PI * 25, bbox: [-5, -5, 30, 5], centroid: [12.5, 0], curved: true });
// 4-arc oval: big arcs R 9 centred (0,+-4), small arcs r 4 centred (+-3,0); joints at (+-5.4, +-3.2)
const ovalArea = () => {
  const J = 5.4, K = 3.2;
  const tTop0 = Math.atan2(K + 4, J), tTop1 = Math.atan2(K + 4, -J); // top arc centre (0,-4): from (5.4,3.2) ccw to (-5.4,3.2)
  const tL0 = Math.atan2(K, -J + 3), tL1 = Math.atan2(-K, -J + 3); // left arc centre (-3,0): from (-5.4,3.2)... see below
  void tL0; void tL1;
  // go ccw: right small arc (centre (3,0)) from joint (5.4,-3.2) to (5.4,3.2); top big arc (centre (0,-4)) to (-5.4,3.2); left small arc (centre (-3,0)); bottom big arc (centre (0,4))
  const aR0 = Math.atan2(-K, J - 3), aR1 = Math.atan2(K, J - 3);
  const aT0 = Math.atan2(K + 4, J), aT1 = Math.atan2(K + 4, -J);
  const aL0 = Math.atan2(K, -J + 3), aL1 = Math.atan2(-K, -J + 3) + 2 * Math.PI;
  const aB0 = Math.atan2(-K - 4, -J) + 2 * Math.PI, aB1 = Math.atan2(-K - 4, J) + 2 * Math.PI;
  void tTop0; void tTop1;
  return arcLoopArea([
    { c: [3, 0], r: 4, t0: aR0, t1: aR1 },
    { c: [0, -4], r: 9, t0: aT0, t1: aT1 },
    { c: [-3, 0], r: 4, t0: aL0, t1: aL1 },
    { c: [0, 4], r: 9, t0: aB0, t1: aB1 },
  ]);
};
add({ id: 'oval-four-arcs-endpoint-tangent', feats: ['rule:tangent', 'tangent:endpoint arc-arc', 'point-ref:a/b/c ends', 'rule:equal', 'rule:radius', 'rule:lock'],
  geoms: [A(1, [3, 0], 4, [5.4, -3.2], [5.4, 3.2], 'ccw'), A(2, [0, -4], 9, [5.4, 3.2], [-5.4, 3.2], 'ccw'), A(3, [-3, 0], 4, [-5.4, 3.2], [-5.4, -3.2], 'ccw'), A(4, [0, 4], 9, [-5.4, -3.2], [5.4, -3.2], 'ccw')],
  rules: [...[[1, 'b', 2, 'a'], [2, 'b', 3, 'a'], [3, 'b', 4, 'a'], [4, 'b', 1, 'a']].flatMap(([a, ae, b, be]) => [{ k: 'coincident', a, aEnd: ae, b, bEnd: be }, { k: 'tangent', a, aEnd: ae, b, bEnd: be }]),
    { k: 'radius', a: 1, value: 4 }, { k: 'radius', a: 2, value: 9 }, { k: 'equal', a: 1, b: 3 }, { k: 'equal', a: 2, b: 4 }, { k: 'lock', a: 1, aEnd: 'c' }, { k: 'lock', a: 3, aEnd: 'c' }],
  area: ovalArea(), bbox: [-7, -5, 7, 5], curved: true });
add({ id: 'triangle-length-angle-120', feats: ['rule:angle'],
  geoms: [L(1, [0.5, 0.4], [39, 1]), L(2, [39, 1], [25, 26.5]), L(3, [25, 26.5], [0.5, 0.4])],
  rules: [...loopJoins(3), { k: 'horizontal', a: 1 }, atOrigin(1), len(1, 40), len(2, 30), { k: 'angle', a: 1, b: 2, value: 120 }],
  area: 0.5 * 40 * 30 * Math.sin(Math.PI / 3), bbox: [0, 0, 40, 30 * Math.sin(Math.PI / 3)], branchSensitive: true });
add({ id: 'triangle-angle-120-with-quadrant', feats: ['angle:quadrant option'], modes: ['stored'],
  geoms: [L(1, [0.5, 0.4], [39, 1]), L(2, [39, 1], [25, 26.5]), L(3, [25, 26.5], [0.5, 0.4])],
  rules: [...loopJoins(3), { k: 'horizontal', a: 1 }, atOrigin(1), len(1, 40), len(2, 30), { k: 'angle', a: 1, b: 2, value: 120, quadrant: 2 }],
  area: 0.5 * 40 * 30 * Math.sin(Math.PI / 3), bbox: [0, 0, 40, 30 * Math.sin(Math.PI / 3)] });
add({ id: 'triangle-angle-wrong-orientation-start', feats: ['rule:angle', 'rough start: angle orientation branch'], expect: 'refuse', modes: ['stored'],
  geoms: [L(1, [0, 0], [40, 0]), L(2, [40, 0], [25, -26]), L(3, [25, -26], [0, 0])], // drawn with the turn clockwise (-120 instead of +120)
  rules: [...loopJoins(3), { k: 'horizontal', a: 1 }, atOrigin(1), len(1, 40), len(2, 30), { k: 'angle', a: 1, b: 2, value: 120 }],
  area: 0.5 * 40 * 30 * Math.sin(Math.PI / 3), bbox: [0, 0, 40, 30 * Math.sin(Math.PI / 3)], refusePattern: /opposite orientation/ });
add({ id: 'rect-lock-offset-corner', feats: ['rule:lock', 'lock-hoisting order'],
  geoms: rectG(5, 3, 33, 21), rules: [...rectShape(), { k: 'lock', a: 1, aEnd: 'a' }, len(1, 30), len(2, 20)],
  area: 600, bbox: [5, 3, 35, 23], centroid: [20, 13] });
add({ id: 'rect-param-width', feats: ['value:param()'], modes: ['stored'],
  geoms: rectG(0, 0, 30, 20), rules: [...rectShape(), atOrigin(1), len(1, P('width', 30)), len(2, 20)],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10], paramRerun: { key: 'sk1_rule9-value', value: 45, area: 900, bbox: [0, 0, 45, 20] } });
add({ id: 'rect-reference-dim-correct', feats: ['driving:false reference dimension'], modes: ['stored', 'rough'],
  geoms: rectG(0.3, 0.2, 28.4, 17.1), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), { ...dist(1, 'a', 3, 'a', Math.hypot(30, 20)), driving: false }],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
add({ id: 'rect-reference-dim-wrong-value', feats: ['driving:false reference dimension'], modes: ['stored'],
  geoms: rectG(0.3, 0.2, 28.4, 17.1), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), { ...dist(1, 'a', 3, 'a', 99), driving: false }],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
add({ id: 'rect-reference-distanceX-zero', feats: ['driving:false reference dimension'], modes: ['stored'], expect: 'refuse',
  geoms: rectG(0, 0, 30, 20), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), { ...dX(1, 'a', 4, 'a', 0), driving: false }],
  area: 600, bbox: [0, 0, 30, 20], refusePattern: /reference/ });
add({ id: 'rect-inactive-conflicting-rule', feats: ['active:false suppressed rule'],
  geoms: rectG(0.3, 0.2, 28.4, 17.1), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), { ...len(1, 99), active: false }, { k: 'horizontal', a: 2, active: false }],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
add({ id: 'plate-with-hole-default-profiles', feats: ['nested loops (hole) profile selection', 'rule:diameter'], modes: ['stored'],
  geoms: [...rectG(0.3, 0.2, 39, 25.6), C(5, [19, 13.5], 4.4)],
  rules: [...rectShape(), atOrigin(1), len(1, 40), len(2, 25), { k: 'diameter', a: 5, value: 10 }, dX(1, 'a', 5, 'c', 20), dY(1, 'a', 5, 'c', 12.5)],
  area: 40 * 25 - Math.PI * 25, bbox: [0, 0, 40, 25], curved: true, holePlate: true });

add({ id: 'rect-underconstrained-height-free', feats: ['rough start: solution branch chosen by the drawn start state'], modes: ['stored'],
  geoms: rectG(0, 0, 30, 17), rules: [...rectShape(), atOrigin(1), len(1, 30)],
  area: 30 * 17, bbox: [0, 0, 30, 17], centroid: [15, 8.5] });
add({ id: 'rect-redundant-width-dimension', feats: ['rule:distance', 'redundant/conflicting dimensions'], modes: ['stored'], expect: 'refuse',
  geoms: rectG(0, 0, 30, 20), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), len(3, 30)],
  area: 600, bbox: [0, 0, 30, 20], refusePattern: /./ });
add({ id: 'rect-conflicting-width-dimension', feats: ['rule:distance', 'redundant/conflicting dimensions'], modes: ['stored'], expect: 'refuse',
  geoms: rectG(0, 0, 30, 20), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), len(3, 35)],
  area: 600, bbox: [0, 0, 30, 20], refusePattern: /./ });
add({ id: 'slot-arc-rows-inconsistent-with-lock-c', feats: ['rule:lock', 'point-ref:a/b/c ends'], modes: ['stored'],
  // arc ends are NOT on the circle the row's c and r describe (a hand-edited row); brep-rs pins c where the ROW says, SolidCraft builds the arc from its three points
  geoms: [A(1, [0.1, 10.2], 10, [0.2, 0], [-0.1, 20.1], 'cw'), A(2, [40, 10], 10, [40, 20], [40, 0], 'cw'), L(3, [0, 20], [40.2, 19.9]), L(4, [40, 0.1], [0, 0])],
  rules: [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'), { k: 'radius', a: 1, value: 10 }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, 40), { k: 'lock', a: 1, aEnd: 'c' }],
  area: slotArea(40, 10), bbox: [-9.9, 0.2, 50.1, 20.2], centroid: [20.1, 10.2], curved: true, inconsistentArc: true });

// ---- refusal-sentence probes: rows the mapper has no honest SolidCraft counterpart for -------------------------------------
const probeBase = () => ({ geoms: [...rectG(0, 0, 30, 20), C(5, [10, 10], 3), { k: 'point', id: 6, p: [5, 5] }], base: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20)] });
const probe = (id, feats, extraRules, pattern) => { const b = probeBase(); add({ id: `probe-${id}`, feats, expect: 'refuse', modes: ['stored'], geoms: b.geoms, rules: [...b.base, ...extraRules], area: 600, bbox: [0, 0, 30, 20], refusePattern: pattern, probe: true }); };
probe('coincident-circle-end-a', ['rule:coincident', 'point-ref:a/b/c ends'], [{ k: 'coincident', a: 5, aEnd: 'a', b: 1, bEnd: 'a' }], /no point 'a'/);
probe('equal-line-vs-circle', ['rule:equal'], [{ k: 'equal', a: 1, b: 5 }], /line and a circle/);
probe('distance-names-no-end', ['rule:distance'], [{ k: 'distance', a: 1, b: 2, value: 10 }], /names none/);
probe('radius-zero', ['rule:radius'], [{ k: 'radius', a: 5, value: 0 }], /must be positive/);
probe('tangent-endpoint-no-coincident-row', ['tangent:endpoint line-arc'], [{ k: 'tangent', a: 1, aEnd: 'b', b: 5, bEnd: 'c' }], /endpoint tangent form with no coincident/);
probe('lock-as-reference', ['rule:lock', 'driving:false reference dimension'], [{ k: 'lock', a: 1, aEnd: 'a', driving: false }], /reference measurement/);
probe('pointOn-target-is-point', ['rule:pointOnObject'], [{ k: 'pointOnObject', a: 1, aEnd: 'a', b: 6 }], /not a curve/);
probe('angle-line-vs-circle', ['rule:angle'], [{ k: 'angle', a: 1, b: 5, value: 30 }], /needs line/);
probe('distanceX-start-level', ['rule:distanceX', 'rough start: signed distanceX/distanceY branch'], [dX(1, 'a', 4, 'a', 5)], /start level/);
probe('tangent-line-vs-line', ['rule:tangent'], [{ k: 'tangent', a: 1, b: 2 }], /./);
add({ id: 'legacy-edge-number-9-of-4', feats: ['legacy edge/corner numbers are 1-based'], expect: 'refuse', modes: ['stored'], legacy: true, script: `const sk = sketch('top')\nsk.polygon([[0, 0], [30, 0], [30, 20], [0, 20]])\nsk.across(9)\nconst part = extrude(sk, ${H})`, area: 600, bbox: [0, 0, 30, 20], refusePattern: /./ });
add({ id: 'legacy-edge-number-0', feats: ['legacy edge/corner numbers are 1-based'], expect: 'refuse', modes: ['stored'], legacy: true, script: `const sk = sketch('top')\nsk.polygon([[0, 0], [30, 0], [30, 20], [0, 20]])\nsk.across(0)\nconst part = extrude(sk, ${H})`, area: 600, bbox: [0, 0, 30, 20], refusePattern: /./ });
// ---- legacy panel rules (solved by OUR TS solver inside solveDoc, SolidCraft only sees the solved polygon) -------------
const legacy = (id, feats, body, extra) => add({ id: `legacy-${id}`, feats, legacy: true, modes: ['stored'], script: `const sk = sketch('top')\n${body}\nconst part = extrude(sk, ${H})`, ...extra });
legacy('across-up-length-pin', ['legacy: across', 'legacy: up', 'legacy: length', 'legacy: pin', 'legacy edge/corner numbers are 1-based'],
  `sk.polygon([[0, 0], [28, 1], [29, 17], [1, 18]])\nsk.across(1); sk.up(2); sk.across(3); sk.up(4)\nsk.length(1, 30); sk.length(2, 20); sk.pin(1)`, { area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
legacy('pin-offset-corner', ['legacy: pin', 'legacy edge/corner numbers are 1-based'],
  `sk.polygon([[5, 3], [33, 4], [34, 21], [5.5, 22]])\nsk.across(1); sk.up(2); sk.across(3); sk.up(4)\nsk.length(1, 30); sk.length(2, 20); sk.pin(1)`, { area: 600, bbox: [5, 3, 35, 23], centroid: [20, 13] });
legacy('equal-edges-square', ['legacy: equal'],
  `sk.polygon([[0, 0], [20.5, 0.4], [21.5, 23], [0.2, 22]])\nsk.across(1); sk.up(2); sk.across(3); sk.up(4)\nsk.length(1, 22); sk.equal(1, 2); sk.pin(1)`, { area: 484, bbox: [0, 0, 22, 22], centroid: [11, 11] });
legacy('parallel-perpendicular-trapezoid', ['legacy: parallel', 'legacy: perpendicular', 'legacy: distX'],
  `sk.polygon([[0, 0], [30, 0.4], [21, 16], [0.5, 15.5]])\nsk.across(1); sk.perpendicular(1, 4); sk.parallel(1, 3); sk.pin(1)\nsk.length(1, 30); sk.length(4, 16); sk.distX(2, 3, -8)`, { area: ((30 + 22) / 2) * 16, bbox: [0, 0, 30, 16] });
legacy('distX-distY-rect', ['legacy: distX', 'legacy: distY'],
  `sk.polygon([[0, 0], [28, 0.5], [28.5, 19], [0.5, 18]])\nsk.across(1); sk.up(2); sk.across(3); sk.up(4); sk.pin(1)\nsk.distX(1, 2, 30); sk.distY(2, 3, 20)`, { area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
legacy('symmetric-midpoint-corner', ['legacy: symmetric'],
  `sk.polygon([[0, 0], [9.6, 0.2], [20, 0], [20.3, 15], [0.4, 15.2]])\nsk.across(1); sk.up(3); sk.across(4); sk.up(5); sk.pin(1)\nsk.length(3, 15); sk.distX(1, 3, 20); sk.symmetric(1, 3, 2)\nsk.distY(3, 4, 15)`, { area: 300, bbox: [0, 0, 20, 15], centroid: [10, 7.5] });
legacy('angle-triangle', ['legacy: angle'],
  `sk.polygon([[0, 0], [39, 1], [25, 26.5]])\nsk.across(1); sk.pin(1); sk.length(1, 40); sk.length(2, 30); sk.angle(1, 2, 120)`, { area: 0.5 * 40 * 30 * Math.sin(Math.PI / 3), bbox: [0, 0, 40, 30 * Math.sin(Math.PI / 3)] });
legacy('rect-helper-dimensions', ['legacy: length', 'legacy edge/corner numbers are 1-based', 'dimensioned rectangle'],
  `sk.rect(28, 17, { at: [0, 0] })\nsk.length(1, 30); sk.length(2, 20); sk.pin(1)`, { area: 600, bbox: [-14, -8.5, 16, 11.5], centroid: [1, 1.5] });

// ---- gauntlet fixtures (FreeCAD refs) ------------------------------------------------------------------------------
const GFEAT = {
  'sk-rect-dof__corner-origin-25x60': ['dimensioned rectangle', 'rule:distanceX', 'rule:distanceY'],
  'sk-rect-dof__offset-corner-30x18': ['dimensioned rectangle', 'rule:lock'],
  'sk-rect-dof__square-by-equal': ['rule:equal'],
  'sk-rect-dof__right-triangle': ['rule:perpendicular', 'rule:distance'],
  'sk-rect-dof__parallelogram': ['rule:parallel'],
  'sk-rect-dof__circle-pinned': ['rule:lock', 'rule:radius'],
  'sk-circle-arc-tangent__slot-r6-L30-anchored': ['slot with tangent joints', 'tangent:endpoint line-arc', 'endpoint tangency curved accuracy'],
  'sk-circle-arc-tangent__slot-r12-L18-anchored': ['slot with tangent joints', 'tangent:endpoint line-arc', 'endpoint tangency curved accuracy'],
  'sk-circle-arc-tangent__slot-arc-first-order': ['slot with tangent joints', 'tangent:endpoint line-arc'],
  'sk-circle-arc-tangent__circle-circle-external': ['tangent:circle-circle external'],
  'sk-circle-arc-tangent__circle-circle-no-mode': ['tangent:circle-circle external'],
  'sk-circle-arc-tangent__circle-circle-internal': ['tangent:circle-circle internal'],
};
function fcRef(id) {
  const f = path.join(GAUNTLET, 'refs', `ref-${id}.json`);
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  return { dof: r.dof, conflicting: r.conflicting ?? [], redundant: r.redundant ?? [], bbox: r.bbox };
}
for (const g of gauntletFixtures()) {
  if (!GFEAT[g.id] || g.closed == null) continue;
  const fc = fcRef(g.id);
  add({ id: `gauntlet:${g.id}`, feats: GFEAT[g.id], geoms: g.geoms, rules: g.rules, area: g.closed, bbox: fc?.bbox ? [fc.bbox[0], fc.bbox[1], fc.bbox[3], fc.bbox[4]] : null, curved: g.geoms.some((x) => x.k !== 'line'), fc, gauntlet: true,
    bodies: /circle-circle-(external|no-mode)/.test(g.id) ? 2 : 1, nested: /internal/.test(g.id) });
}

// ---- running one case ---------------------------------------------------------------------------------------------
function aggregateExtrude(tr) {
  const e = tr.features.filter((f) => f.kind === 'extrude').at(-1) ?? tr.features.at(-1);
  return e;
}
const bodyOfMeasure = (m) => (m ? { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, faceTypes: m.faceTypes, bodies: m.bodies?.length ?? 1, curved: m.curved } : null);

async function occtOf(doc, solvedGeoms) {
  try {
    const d = clone(doc);
    const sk = d.features.find((f) => f.kind === 'sketch');
    if (solvedGeoms && sk.geoms) { sk.geoms = clone(solvedGeoms); sk.rules = (sk.rules ?? []).filter((r) => ![r.a, r.b, r.c].some((x) => typeof x === 'number' && x < 0)); delete sk.geom; }
    const ex = d.features.filter((f) => f.kind === 'extrude').at(-1);
    const b = buildDoc(oc, d, arc);
    const shape = b.shapes.get(ex.id);
    if (!shape) return { refused: [...(b.refusals?.values?.() ?? [])].join(' | ') || 'no shape' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const c = g.CentreOfMass(); const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(), hi = bx.CornerMax();
    return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()] };
  } catch (e) { return { refused: String(e.message).slice(0, 200) }; }
}
function brepSolve(geoms, rules) {
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  const o = { open: s.open(clone(geoms), clone(rules)) };
  if (!o.open) { o.solved = s.solve(); if (o.solved) { try { o.geoms = s.solvedGeoms(); } catch { /* */ } } else o.lastError = s.lastError(); o.diag = s.diagnose(); }
  s.close();
  return o;
}
const mid3 = (b) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];

/** profile selection for nested loops: SolidCraft's extrude takes every profile by default (a hole gets filled), so the profile is chosen by an interior point, as the host page does with the sketch dump (not available in this rig). */
async function scDirectWithProfiles(startGeoms, rules, pts) {
  const mapped = mapSketch({ id: 'x', plane: 'xy', geoms: startGeoms, rules: plainRules(rules) }, { name: 'sk' });
  if (!mapped.ok) return { refused: mapped.refusals.map((r) => r.sentence).join(' | ') };
  const cmds = [...mapped.commands, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: H, sketch: 'sk', operation: 'new', body_name: 'B', profiles: pts.map((p) => ({ point: p })) } }];
  const r = await runSC(cmds);
  if (!r.ok) return { refused: `${r.failed?.command}: ${r.failed?.error}` };
  const bs = r.measure.bodies;
  const volume = bs.reduce((s, b) => s + b.volume_mm3, 0);
  return { volume, bodies: bs.length, faces: bs.reduce((s, b) => s + b.faces, 0), bbox: [...[0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i]))), ...[0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])))],
    com: [0, 1, 2].map((i) => bs.reduce((s, b) => s + b.volume_mm3 * b.center_of_mass[i], 0) / volume) };
}
/** an interior point of the even-odd region of a set of circles (grid search; nested-loop cases are circle-in-outline or circle-in-circle) */
function oddPoint(geoms) {
  const bb = geomBox(geoms);
  const loops = geoms.filter((g) => !g.construction && g.k === 'circle');
  const polys = geoms.filter((g) => !g.construction && g.k === 'line');
  const inPoly = (pt) => { let c = false; for (const g of polys) { const [p, q] = [g.a, g.b]; if ((p[1] > pt[1]) !== (q[1] > pt[1]) && pt[0] < ((q[0] - p[0]) * (pt[1] - p[1])) / (q[1] - p[1]) + p[0]) c = !c; } return c; };
  let best = null;
  for (let i = 1; i < 200; i++) for (let j = 1; j < 200; j++) {
    const pt = [bb[0] + ((bb[2] - bb[0]) * i) / 200, bb[1] + ((bb[3] - bb[1]) * j) / 200];
    const depth = loops.filter((g) => Math.hypot(pt[0] - g.c[0], pt[1] - g.c[1]) < g.r).length + (polys.length ? (inPoly(pt) ? 1 : 0) : 0);
    if (depth % 2 !== 1) continue;
    const clear = Math.min(...loops.map((g) => Math.abs(Math.hypot(pt[0] - g.c[0], pt[1] - g.c[1]) - g.r)), 1e9);
    if (!best || clear > best.clear) best = { pt, clear };
  }
  return best?.pt ?? null;
}

async function runCase(cs, mode, { frac = 0.035, seedKey = null, valuesOverride = null, scriptOverride = null } = {}) {
  const rec = { id: cs.id, mode };
  let start = cs.geoms ? (mode === 'rough' ? roughen(cs.geoms, cs.rules, seedKey ?? cs.id, frac) : clone(cs.geoms)) : null;
  const script = scriptOverride ?? cs.script ?? soupScript(start, cs.rules);
  rec.script = script;
  let run;
  try { run = runScript(script, valuesOverride ? { values: valuesOverride } : {}); } catch (e) { rec.verdict = cs.expect === 'refuse' ? 'REFUSED-EXPECTED-SCRIPT' : 'SCRIPT-ERROR'; rec.sentence = String(e.message).slice(0, 300); return rec; }
  if (run.errors?.length) { rec.verdict = cs.expect === 'refuse' ? 'REFUSED-EXPECTED-SCRIPT' : 'SCRIPT-ERROR'; rec.sentence = run.errors.map((e) => e.message ?? String(e)).join(' | ').slice(0, 400); return rec; }
  const doc0 = run.doc;
  const doc = solveDoc(doc0);
  const sk0 = doc0.features.find((f) => f.kind === 'sketch'), sk1 = doc.features.find((f) => f.kind === 'sketch');
  const soup = Array.isArray(sk1.geoms) && sk1.geoms.length > 0;
  rec.soup = soup;
  rec.solveDocMovedSoup = soup ? JSON.stringify(sk0.geoms) !== JSON.stringify(sk1.geoms) : null;
  if (soup && !start) start = clone(sk1.geoms);
  const rules = soup ? sk1.rules ?? [] : [];
  // --- SolidCraft through the translator
  const tr = await translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  const ef = aggregateExtrude(tr);
  rec.scTranslator = ef.status === 'built' ? { ...bodyOfMeasure(ef.measure) } : { refused: ef.refusal };
  rec.sc = rec.scTranslator;
  if (soup && ef.status === 'built') {
    // the translator only totals bodies named exactly like the feature; a sketch with several profiles makes 'B' and 'B (2)'. Total ALL bodies.
    const mapped = mapSketch({ ...sk1, id: sk1.id }, { name: 'sk' });
    if (mapped.ok) {
      const cmds = extrudeCommands(mapped, { height: H }).filter((c) => c.command !== '@sketch');
      const r = await runSC(cmds);
      if (r.ok) {
        const bs = r.measure.bodies; const vol = bs.reduce((a, b) => a + b.volume_mm3, 0);
        rec.sc = { volume: vol, bbox: [...[0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i]))), ...[0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])))],
          com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / vol), faces: bs.reduce((a, b) => a + b.faces, 0), faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}), bodies: bs.length };
        rec.translatorUnderreports = (bs.length !== (rec.scTranslator.bodies ?? 1)) || rel(rec.scTranslator.volume, vol) > 1e-9 ? { allBodies: bs.length, translatorBodies: rec.scTranslator.bodies, allVolume: vol, translatorVolume: rec.scTranslator.volume } : null;
      }
    }
  }
  rec.scCommandCount = tr.commands.length;
  if ((cs.nested || cs.holePlate) && soup && rec.sc && !rec.sc.refused) {
    // hazard probe: the translator's default extrudes every profile (the hole is filled); the host page re-selects by the even-odd fill of the doc
    rec.scDefaultProfiles = { volume: rec.sc.volume, bodies: rec.sc.bodies, bbox: rec.sc.bbox };
    const pt = oddPoint(sk1.geoms);
    const d = pt ? await scDirectWithProfiles(sk1.geoms, sk1.rules ?? [], [pt]) : { refused: 'no odd-depth interior point found' };
    rec.profilePoint = pt;
    rec.holeFilledByDefault = rel(rec.sc.volume, cs.area * H) > 1e-3;
    rec.sc = d.refused ? { refused: d.refused } : { ...d };
  }
  // --- legacy solver residual (our TS solver) for legacy cases
  if (!soup) {
    const sk = sk1; rec.legacyPoints = sk.points;
  }
  // --- brep-rs
  const bm = await blib.measureDoc(doc);
  rec.brep = bm.outcome === 'built' ? { volume: bm.volume, bbox: bm.bbox, com: bm.com, faces: bm.faces } : { refused: bm.refusal };
  let bs = null;
  if (soup) { bs = brepSolve(sk1.geoms, sk1.rules); rec.brepSolve = { open: bs.open, solved: bs.solved, dof: bs.diag?.dof ?? null, bucket: bs.diag?.bucket ?? null, lastError: bs.lastError ?? null }; }
  // --- OCCT (brep-rs-solved geoms for a soup, the TS-solved polygon for legacy)
  rec.occt = await occtOf(doc, soup && bs?.geoms ? bs.geoms : null);
  if (soup && bs?.geoms) {
    const rc = checkRules(bs.geoms, sk1.rules ?? [], sk1.geoms).filter((r) => r.driving && r.residual !== null);
    rec.brepRuleResidualMax = Math.max(0, ...rc.map((r) => r.residual));
  }
  // --- score SolidCraft vs closed form
  const t = cs.curved ? TOL.curved : cs.legacy ? 1e-5 : TOL.planar; // legacy panel rules are solved by packages/sketch (its TOL is 1e-7 per residual; measured coordinate error up to ~2e-6 mm): the closed-form bar is loosened for them, SolidCraft-vs-OCCT stays at 1e-9
  const ct = cs.curved ? COMTOL.curved : cs.legacy ? 1e-5 : COMTOL.planar;
  const wantVol = cs.area * H;
  rec.want = { volume: wantVol, bbox: cs.bbox ? [cs.bbox[0], cs.bbox[1], 0, cs.bbox[2], cs.bbox[3], H] : null, area: cs.area };
  const checks = [];
  const scoreAgainst = (label, got, want, tt = t, ctt = ct) => {
    if (!got || got.refused) return;
    const diag = Math.max(Math.hypot(...(want.bbox ?? got.bbox).slice(0, 3).map((v, i) => ((want.bbox ?? got.bbox)[i + 3] - v))), 1);
    if (want.volume != null) checks.push({ vs: label, name: 'volume', delta: rel(got.volume, want.volume), tol: tt });
    if (want.bbox) checks.push({ vs: label, name: 'bbox', delta: Math.max(...want.bbox.map((w, i) => rel(got.bbox[i], w))), tol: tt });
    if (want.com && got.com) checks.push({ vs: label, name: 'com', delta: Math.max(...want.com.map((w, i) => Math.abs(got.com[i] - w))) / diag, tol: ctt });
  };
  const closedCom = cs.centroid ? [cs.centroid[0], cs.centroid[1], H / 2] : null;
  const wantCF = { volume: wantVol, bbox: rec.want.bbox, com: closedCom };
  if (rec.sc && !rec.sc.refused) {
    if (cs.nested) { /* disc with internal tangent disc: volume only reads area of the larger disc minus hole? see note */ }
    scoreAgainst('closed form', rec.sc, wantCF);
    if (rec.brep && !rec.brep.refused) scoreAgainst('brep-rs', rec.sc, { volume: rec.brep.volume, bbox: rec.brep.bbox, com: rec.brep.com }, cs.curved ? TOL.curved : TOL.planar, cs.curved ? 3e-4 : COMTOL.planar); // brep-rs COM is read off its own 0.01-tolerance mesh
    if (rec.occt && !rec.occt.refused) scoreAgainst('OCCT', rec.sc, { volume: rec.occt.volume, bbox: rec.occt.bbox, com: rec.occt.com }, cs.curved ? TOL.curved : TOL.planar, cs.curved ? COMTOL.curved : COMTOL.planar);
    if (cs.fc?.bbox) {
      const fb = [cs.fc.bbox[0], cs.fc.bbox[1], 0, cs.fc.bbox[3], cs.fc.bbox[4], H];
      checks.push({ vs: 'FreeCAD ref', name: 'bbox', delta: Math.max(...fb.map((w, i) => rel(rec.sc.bbox[i], w))), tol: t });
    }
    if (cs.bodies && rec.sc.bodies !== cs.bodies) checks.push({ vs: 'closed form', name: 'bodies', delta: Math.abs(rec.sc.bodies - cs.bodies), tol: 0 });
  }
  rec.checks = checks.map((c) => ({ ...c, pass: c.delta <= c.tol }));
  if (rec.brep && !rec.brep.refused && rec.want) rec.brepVsClosed = rel(rec.brep.volume, wantVol);
  if (rec.occt && !rec.occt.refused) rec.occtVsClosed = rel(rec.occt.volume, wantVol);
  // --- verdict
  if (rec.sc.refused) {
    rec.sentence = rec.sc.refused;
    rec.verdict = cs.expect === 'refuse' && (!cs.refusePattern || cs.refusePattern.test(rec.sc.refused)) ? 'REFUSED-EXPECTED' : cs.expect === 'refuse' ? 'REFUSED-OTHER-SENTENCE' : 'REFUSED';
  } else {
    const bad = rec.checks.filter((c) => !c.pass);
    const closedBad = bad.filter((c) => c.vs === 'closed form' || c.vs === 'FreeCAD ref');
    if (cs.expect === 'refuse') rec.verdict = closedBad.length ? 'WRONG-BUILT-INSTEAD-OF-REFUSE' : 'BUILT-MATCHING-REQUEST';
    else rec.verdict = closedBad.length ? 'WRONG' : bad.length ? 'MATCH-CLOSED-DISAGREES-OTHER' : 'MATCH';
  }
  return rec;
}

// ---- reporting helpers ------------------------------------------------------------------------------------------------
const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); console.log(s); };
const worst = (r) => (r.checks ?? []).reduce((m, c) => (c.delta / Math.max(c.tol, 1e-300) > m.r ? { r: c.delta / Math.max(c.tol, 1e-300), c } : m), { r: 0, c: null }).c;

const results = [];
for (const cs of CASES) {
  if (only.length && !only.some((o) => cs.id.includes(o))) continue;
  for (const mode of cs.modes) {
    let rec;
    try { rec = await runCase(cs, mode); } catch (e) { rec = { id: cs.id, mode, verdict: 'HARNESS-ERROR', sentence: String(e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
    rec.feats = cs.feats;
    if (cs.paramRerun && mode === 'stored') {
      const r2 = await runCase({ ...cs, area: cs.paramRerun.area, bbox: [cs.paramRerun.bbox[0], cs.paramRerun.bbox[1], cs.paramRerun.bbox[2], cs.paramRerun.bbox[3]], centroid: [22.5, 10] }, mode, { valuesOverride: { [cs.paramRerun.key]: cs.paramRerun.value } });
      rec.paramRerun = { value: cs.paramRerun.value, verdict: r2.verdict, scVolume: r2.sc?.volume, wantVolume: cs.paramRerun.area * H, bbox: r2.sc?.bbox, checks: r2.checks, brepVolume: r2.brep?.volume };
    }
    results.push(rec);
    const w = worst(rec);
    const s = rec.sc && !rec.sc.refused ? `vol ${f6(rec.sc.volume)}/${f6(rec.want.volume)} bodies ${rec.sc.bodies} faces ${rec.sc.faces}` : '';
    const fails = (rec.checks ?? []).filter((c) => !c.pass).map((c) => `${c.vs}/${c.name} ${ex(c.delta)}>${ex(c.tol)}`).join(', ');
    log(`${(rec.verdict ?? '?').padEnd(30)} ${cs.id.padEnd(58)} ${mode.padEnd(6)} ${s} ${w ? `worst ${w.vs}/${w.name} ${ex(w.delta)}` : ''}${fails ? ' FAILS[' + fails + ']' : ''}${rec.translatorUnderreports ? ' TRANSLATOR-UNDERREPORTS' : ''} ${rec.sentence ? '| ' + rec.sentence.slice(0, 260) : ''}`);
  }
}
// ---- light runner (no translator/brep-rs/OCCT): same mapper, same extrude, closed-form score. Used for sweeps/controls. -----
async function lightRun(cs, start, { commandEdit = null, rulesOverride = null } = {}) {
  const rules = plainRules(rulesOverride ?? cs.rules);
  const sk = { id: 'sk1', plane: 'xy', geoms: start, rules };
  const mapped = mapSketch(sk, { name: 'sk' });
  if (!mapped.ok) return { out: 'MAPPER-REFUSED', sentence: mapped.refusals.map((r) => r.sentence).join(' | ') };
  let cmds = extrudeCommands(mapped, { height: H }).filter((c) => c.command !== '@sketch');
  if (cs.nested || cs.holePlate) { const pt = oddPoint(start); const ex_ = cmds.find((c) => c.command === 'solid.extrude'); if (pt) ex_.params.profiles = [{ point: pt }]; }
  if (commandEdit) cmds = commandEdit(cmds);
  const r = await runSC(cmds);
  if (!r.ok) return { out: 'SC-REFUSED', sentence: `${r.failed?.command}: ${r.failed?.error}` };
  const bs = r.measure.bodies; const vol = bs.reduce((a, b) => a + b.volume_mm3, 0);
  const bbox = [...[0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i]))), ...[0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])))];
  const com = [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / vol);
  const t = cs.curved ? TOL.curved : TOL.planar;
  const want = [cs.bbox[0], cs.bbox[1], 0, cs.bbox[2], cs.bbox[3], H];
  const dv = rel(vol, cs.area * H), db = Math.max(...want.map((w, i) => rel(bbox[i], w)));
  const ok = dv <= t && db <= t && (!cs.bodies || bs.length === cs.bodies);
  // MATCH inside the bar; TOL-MISS = right solid, planar bar (1e-9) missed by solver residual (everything within 1e-6); POSE = same volume,
  // different place/orientation; VOLUME = a different solid
  const cls = ok ? 'MATCH' : (dv <= 1e-6 && db <= 1e-6 && (!cs.bodies || bs.length === cs.bodies)) ? 'TOL-MISS' : dv <= t ? 'POSE' : 'VOLUME';
  const res = { out: cls, dVol: dv, dBbox: db, volume: vol, bbox, com, bodies: bs.length };
  if (cls === 'POSE' || cls === 'VOLUME') res.brep = await brepOnStart(cs, start, rules, vol, bbox);
  return res;
}
/** brep-rs (the oracle) on the SAME start and rules: does it land on the closed form, on SolidCraft's solid, or elsewhere / refuse? */
async function brepOnStart(cs, start, rules, scVol, scBbox) {
  try {
    const run = runScript(soupScript(start, rules));
    if (run.errors?.length) return { class: 'SCRIPT-ERROR' };
    const m = await blib.measureDoc(solveDoc(run.doc));
    if (m.outcome !== 'built') return { class: 'BREP-REFUSED', sentence: m.refusal };
    const t = cs.curved ? TOL.curved : TOL.planar;
    const want = [cs.bbox[0], cs.bbox[1], 0, cs.bbox[2], cs.bbox[3], H];
    const eqClosed = rel(m.volume, cs.area * H) <= t && Math.max(...want.map((w, i) => rel(m.bbox[i], w))) <= t;
    const eqSc = rel(m.volume, scVol) <= 1e-3 && Math.max(...scBbox.map((w, i) => rel(m.bbox[i], w))) <= 1e-3;
    return { class: eqClosed ? 'BREP-MATCHES-CLOSED-FORM' : eqSc ? 'BREP-SAME-AS-SOLIDCRAFT' : 'BREP-OTHER', volume: m.volume };
  } catch (e) { return { class: 'BREP-ERROR', sentence: String(e.message).slice(0, 100) }; }
}
const SWEEP = [];
async function sweep(id, fracs, N, { rulesOverride = null, label = null } = {}) {
  const cs = CASES.find((c) => c.id === id);
  for (const frac of fracs) {
    const tally = { MATCH: 0, 'TOL-MISS': 0, POSE: 0, VOLUME: 0, 'MAPPER-REFUSED': 0, 'SC-REFUSED': 0 };
    const wrong = []; const sentences = new Map(); const brepClass = {}; let maxTolMiss = 0;
    for (let k = 0; k < N; k++) {
      const start = roughen(cs.geoms, cs.rules, `${id}#${k}#${frac}`, frac);
      const r = await lightRun(cs, start, { rulesOverride });
      tally[r.out]++;
      if (r.out === 'POSE' || r.out === 'VOLUME') { wrong.push({ k, cls: r.out, dVol: r.dVol, dBbox: r.dBbox, volume: r.volume, bbox: r.bbox, brep: r.brep?.class }); brepClass[`${r.out} / ${r.brep?.class}`] = (brepClass[`${r.out} / ${r.brep?.class}`] ?? 0) + 1; }
      if (r.out === 'TOL-MISS') maxTolMiss = Math.max(maxTolMiss, r.dBbox, r.dVol);
      if (r.sentence) { const key = r.sentence.replace(/[-0-9.]+(e-?[0-9]+)?/g, '#').slice(0, 140); const cur = sentences.get(key); sentences.set(key, { n: (cur?.n ?? 0) + 1, raw: cur?.raw ?? r.sentence }); }
    }
    SWEEP.push({ id, label, frac, N, tally, brepClass, maxTolMiss, wrong: wrong.slice(0, 6), topSentences: [...sentences.values()].sort((a, b) => b.n - a.n).slice(0, 3) });
    log(`sweep ${id}${label ? ' [' + label + ']' : ''} amplitude ${frac} x diagonal, N=${N}: ${JSON.stringify(tally)}${wrong.length ? ' brep-rs on the same start: ' + JSON.stringify(brepClass) : ''}${tally['TOL-MISS'] ? ' tol-miss max ' + ex(maxTolMiss) : ''}`);
  }
}
const SWEEPS_ON = !only.length || only.includes('sweep');
const FR = [0.035, 0.15, 0.4, 0.8];
if (SWEEPS_ON) {
  log('\n--- rough-start sweeps (SolidCraft via the mapper; any WRONG = built, not refused, and disagrees with the closed form of the REQUESTED branch) ---');
  await sweep('rect-corner-dx-dy-negative', FR, 40);
  await sweep('right-trapezoid-par-perp-neg-dx', FR, 40);
  await sweep('triangle-length-angle-120', FR, 40);
  await sweep('circle-circle-external-mode', FR, 40);
  await sweep('circle-circle-internal-mode', FR, 40);
  await sweep('tangent-line-circle-side-matching', FR, 40);
  await sweep('slot-hand-rows-R10-L40', FR, 40);
  await sweep('slot-dims-from-points', FR, 40);
  await sweep('oval-four-arcs-endpoint-tangent', FR, 40);
  await sweep('hexagon-equal-pointOn-circle', FR, 40);
  await sweep('symmetric-trapezoid-about-Y-axis', FR, 40);
  await sweep('rect-origin-dims', FR, 40);
  await sweep('rect-lock-offset-corner', FR, 40);
  await sweep('symmetric-about-construction-line', FR, 40);
  await sweep('tangent-line-circle', FR, 40);
  await sweep('triangle-apex-on-diagonal-line', FR, 40);
  await sweep('rect-diagonal-two-point-distance', FR, 40);
  await sweep('circle-radius-dx-dy', FR, 40);
  await sweep('symmetric-3point-midpoint', FR, 40);
}
// ---- controls ---------------------------------------------------------------------------------------------------------
const EXTRAS_ON = !only.length || only.includes('extras');
const CONTROLS = [];
if (EXTRAS_ON) {
  log('\n--- controls ---');
  // lock hoisting: the same rect-lock-offset-corner rough start with the fix command moved to the END of the command list (what an un-hoisted mapper would send)
  const cs = CASES.find((c) => c.id === 'rect-lock-offset-corner');
  for (const k of [0, 1, 2]) {
    const start = roughen(cs.geoms, cs.rules, `lockctl#${k}`, 0.035);
    const hoisted = await lightRun(cs, start);
    const unhoisted = await lightRun(cs, start, { commandEdit: (cmds) => { const fix = cmds.filter((c) => c.command === 'sketch.constraint.fix'); const rest = cmds.filter((c) => c.command !== 'sketch.constraint.fix'); const i = rest.findIndex((c) => c.command === 'sketch.finish'); rest.splice(i, 0, ...fix); return rest; } });
    CONTROLS.push({ control: 'lock-hoisting', seed: k, hoisted: { out: hoisted.out, bbox: hoisted.bbox, dBbox: hoisted.dBbox }, unhoisted: { out: unhoisted.out, bbox: unhoisted.bbox, dBbox: unhoisted.dBbox, sentence: unhoisted.sentence } });
    log(`control lock-hoisting seed ${k}: hoisted ${hoisted.out} dBbox ${ex(hoisted.dBbox ?? NaN)}; fix moved to the end: ${unhoisted.out} dBbox ${ex(unhoisted.dBbox ?? NaN)} bbox ${JSON.stringify(f6(unhoisted.bbox ?? null))}`);
  }
  // branch request stripped: what SolidCraft builds if the mapper did NOT refuse a wrong-branch start (shows why the refusal matters)
  const strip = (cs0, geoms, edit) => lightRun({ ...cs0, rules: edit(cs0.rules) }, geoms);
  {
    const c1 = CASES.find((c) => c.id === 'circle-circle-mode-request-external-start-internal');
    const r = await strip(c1, c1.geoms, (rs) => rs.map((x) => { const y = { ...x }; delete y.mode; return y; }));
    CONTROLS.push({ control: 'mode-stripped external requested, internal start', out: r.out, volume: r.volume, bbox: r.bbox, wantVolume: c1.area * H });
    log(`control mode stripped (external requested, circles start internal): ${r.out} volume ${f6(r.volume)} vs requested-branch ${f6(c1.area * H)} bbox ${JSON.stringify(f6(r.bbox))}`);
    const c2 = CASES.find((c) => c.id === 'circle-circle-mode-request-internal-start-external');
    const r2 = await strip(c2, c2.geoms, (rs) => rs.map((x) => { const y = { ...x }; delete y.mode; return y; }));
    CONTROLS.push({ control: 'mode-stripped internal requested, external start', out: r2.out, volume: r2.volume, bbox: r2.bbox, wantVolume: c2.area * H, bodies: r2.bodies });
    log(`control mode stripped (internal requested, circles start external): ${r2.out} volume ${f6(r2.volume)} vs requested-branch ${f6(c2.area * H)} bodies ${r2.bodies}`);
    const c3 = CASES.find((c) => c.id === 'triangle-angle-wrong-orientation-start');
    const r3 = await lightRun(c3, c3.geoms);
    CONTROLS.push({ control: 'angle wrong orientation start (mapper refusal in force)', out: r3.out, sentence: r3.sentence });
    // un-refused: send the angle dimension straight to SolidCraft from that start
    const mapped = mapSketch({ id: 'x', plane: 'xy', geoms: c3.geoms, rules: c3.rules.filter((x) => x.k !== 'angle') }, { name: 'sk' });
    const cmds = [...extrudeCommands(mapped, { height: H }).filter((c) => c.command !== '@sketch')];
    const i = cmds.findIndex((c) => c.command === 'sketch.finish');
    cmds.splice(i, 0, { command: 'sketch.dimension', params: { entities: ['g1', 'g2'], type: 'angle', value: '120 deg' } });
    const rr = await runSC(cmds);
    const bs = rr.ok ? rr.measure.bodies : null;
    CONTROLS.push({ control: 'angle wrong orientation start, mapper bypassed', ok: rr.ok, error: rr.failed?.error, volume: bs ? bs.reduce((a, b) => a + b.volume_mm3, 0) : null, bbox: bs ? bs[0].bbox : null, wantVolume: c3.area * H });
    log(`control angle 120 requested but triangle drawn with the opposite turn, mapper bypassed: ${rr.ok ? 'BUILT volume ' + f6(bs.reduce((a, b) => a + b.volume_mm3, 0)) + ' want ' + f6(c3.area * H) + ' bbox ' + JSON.stringify(f6(bs[0].bbox)) : 'refused ' + rr.failed?.error}`);
    // signed dx: negative requested, start positive, mapper bypassed (sign dropped to |d|)
    const c4 = CASES.find((c) => c.id === 'rect-corner-dx-dy-negative');
    const posStart = rectG(5.2, 3.1, 33.4, 21.1);
    const rr4 = await lightRun({ ...c4, rules: c4.rules }, posStart);
    CONTROLS.push({ control: 'signed dx negative requested, start positive (mapper in force)', out: rr4.out, sentence: rr4.sentence });
    log(`control signed distanceX -8 requested, rect drawn on the positive side: ${rr4.out} ${rr4.sentence ? '| ' + rr4.sentence.slice(0, 200) : ''}`);
    const bypass = await lightRun({ ...c4 }, posStart, { rulesOverride: c4.rules.map((x) => (x.k === 'distanceX' || x.k === 'distanceY' ? { ...x, value: Math.abs(x.value) } : x)) });
    CONTROLS.push({ control: 'signed dx negative requested, start positive, sign dropped (what |d| builds)', out: bypass.out, bbox: bypass.bbox, wantBbox: c4.bbox });
    log(`control same start with |d| (sign dropped): ${bypass.out} bbox ${JSON.stringify(f6(bypass.bbox))} vs requested ${JSON.stringify(c4.bbox)}`);
  }
}
// ---- rule-order dependence of the over-constrained check (arc-arc endpoint tangent from a rough start) ---------------------
const ORDER = [];
if (EXTRAS_ON) {
  const cs = CASES.find((c) => c.id === 'oval-four-arcs-endpoint-tangent');
  const rs = cs.rules;
  const tangentRows = rs.filter((r) => r.k === 'coincident' || r.k === 'tangent');
  const rad = rs.filter((r) => r.k === 'radius'), eq = rs.filter((r) => r.k === 'equal'), lk = rs.filter((r) => r.k === 'lock');
  const orders = { 'as written (joints, radii, equals, locks)': [...tangentRows, ...rad, ...eq, ...lk], 'radii and equals first': [...rad, ...eq, ...lk, ...tangentRows], 'equals first, then joints': [...eq, ...tangentRows, ...rad, ...lk]};
  log('\n--- oval (4-arc endpoint tangent) rough start, 40 seeds x 3.5% , rule order permutations ---');
  for (const [name, order] of Object.entries(orders)) {
    const tally = { MATCH: 0, 'TOL-MISS': 0, POSE: 0, VOLUME: 0, 'MAPPER-REFUSED': 0, 'SC-REFUSED': 0 }; let wrong = null; const sent = new Map();
    for (let k = 0; k < 40; k++) {
      const start = roughen(cs.geoms, cs.rules, `oval#${k}`, 0.035);
      const r = await lightRun(cs, start, { rulesOverride: order });
      const cs2 = name.startsWith('locks only') ? { ...cs } : cs;
      tally[r.out]++; if ((r.out === 'POSE' || r.out === 'VOLUME') && !wrong) wrong = { k, dVol: r.dVol, dBbox: r.dBbox, brep: r.brep?.class };
      if (r.sentence) { const key = r.sentence.replace(/[-0-9.]+(e-?[0-9]+)?/g, '#').slice(0, 150); const cur = sent.get(key); sent.set(key, { n: (cur?.n ?? 0) + 1, raw: cur?.raw ?? r.sentence }); }
      void cs2;
    }
    ORDER.push({ order: name, tally, wrong, sentences: [...sent.values()].sort((a, b) => b.n - a.n).slice(0, 2) });
    log(`oval order "${name}": ${JSON.stringify(tally)}${wrong ? ' WRONG ' + JSON.stringify(wrong) : ''} ${[...sent.values()][0] ? '| ' + [...sent.values()][0].raw.slice(0, 200) : ''}`);
  }
}
// ---- multi-profile translator probe: a two-circle sketch -------------------------------------------------------------------
writeFileSync(path.join(OUT, 'sketch-constraints-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results, sweeps: SWEEP, controls: CONTROLS, order: ORDER }, null, 1) + '\n');
writeFileSync(path.join(OUT, 'sketch-constraints-last-run.txt'), lines.join('\n') + '\n');
log(`wrote ${path.join(OUT, 'sketch-constraints-results.json')}`);

export { CASES, lightRun, runCase, roughen, mapSketch, extrudeCommands, runSC, soupScript, brepOnStart, oddPoint, clone, TOL, H };
