// Round 2 of group 'sketch-constraints'. Case table extracted verbatim from ../sketch-constraints-run.mjs (lines 58-372: factories, rough-start
// generator, closed forms, cases); the only edits are the imports and the exports at the bottom. Referee only.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');
const H = 10;
const clone = (o) => JSON.parse(JSON.stringify(o));
const { gauntletFixtures } = await import(pathToFileURL(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/fixtures-p2.mjs')).href);
const GAUNTLET = path.join(REPO, 'docs/replica/freecad/gauntlet/variants');
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
add({ id: 'tangent-line-circle', mirrorY: true, feats: ['rule:tangent', 'tangent:line-circle', 'rule:lock'],
  geoms: [L(1, [-20, 0], [20, 0], { construction: true, noRough: true }), C(2, [8.3, 6.4], 5.7)],
  rules: [{ k: 'lock', a: 1, aEnd: 'a' }, { k: 'lock', a: 1, aEnd: 'b' }, { k: 'tangent', a: 1, b: 2 }, { k: 'radius', a: 2, value: 6 }, dX(-1, 'a', 2, 'c', 8)],
  area: Math.PI * 36, bbox: [2, 0, 14, 12], centroid: [8, 6], curved: true });
add({ id: 'tangent-line-circle-side-matching', mirrorY: true, feats: ['tangent:side option'],
  geoms: [L(1, [-20, 0], [20, 0], { construction: true, noRough: true }), C(2, [8.3, 6.4], 5.7)],
  rules: [{ k: 'lock', a: 1, aEnd: 'a' }, { k: 'lock', a: 1, aEnd: 'b' }, { k: 'tangent', a: 1, b: 2, side: 1 }, { k: 'radius', a: 2, value: 6 }, dX(-1, 'a', 2, 'c', 8)],
  area: Math.PI * 36, bbox: [2, 0, 14, 12], centroid: [8, 6], curved: true, modes: ['stored'] });
add({ id: 'tangent-line-circle-side-opposite', feats: ['tangent:side option'], expect: 'refuse',
  geoms: [L(1, [-20, 0], [20, 0], { construction: true, noRough: true }), C(2, [8.3, 6.4], 5.7)],
  rules: [{ k: 'lock', a: 1, aEnd: 'a' }, { k: 'lock', a: 1, aEnd: 'b' }, { k: 'tangent', a: 1, b: 2, side: -1 }, { k: 'radius', a: 2, value: 6 }, dX(-1, 'a', 2, 'c', 8)],
  area: Math.PI * 36, bbox: [2, 0, 14, 12], curved: true, modes: ['stored'], refusePattern: /side/ });
// circle-circle: two circles r 8 and 5, big one locked at (0,0); small centre on the X axis
const cc = (id, feats, d, mode, startC, extra = {}) => add({ id, feats, curved: true, mirrorX: true, ...extra,
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
  geoms: (() => { // hand-drawn numbers, but every arc row is consistent (its two ends lie on its circle): round 2 refuses arc rows that are not
    const pt = (c, r, deg) => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
    const c2 = [25, 0.1], c4 = [0.1, 0];
    return [L(1, [0.2, -5.1], pt(c2, 5, -88)), A(2, c2, 5, pt(c2, 5, -88), pt(c2, 5, 92), 'ccw'), L(3, pt(c2, 5, 92), pt(c4, 5, 88)), A(4, c4, 5, pt(c4, 5, 88), pt(c4, 5, 268), 'ccw')];
  })(),
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
// round 3: a reference adds no equation and its stored number is stale by design (brep-rs reference_values), so a reference distanceX of 0 (or of the opposite sign to the drawing) is not a request: it builds the same solid
add({ id: 'rect-reference-distanceX-zero', feats: ['driving:false reference dimension'], modes: ['stored'],
  geoms: rectG(0, 0, 30, 20), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), { ...dX(1, 'a', 4, 'a', 0), driving: false }],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
add({ id: 'rect-reference-distanceX-opposite-sign', feats: ['driving:false reference dimension'], modes: ['stored', 'rough'],
  geoms: rectG(0.3, 0.2, 28.4, 17.1), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), { ...dX(1, 'a', 2, 'a', -30), driving: false }, { ...dY(1, 'a', 3, 'a', -20), driving: false }],
  area: 600, bbox: [0, 0, 30, 20], centroid: [15, 10] });
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
// round 2: a dimension that only repeats what the rows already fix (30 = 30) is consistent; building it is correct (FreeCAD calls it redundant but solves it). Round 1 listed it as expected-refuse.
add({ id: 'rect-redundant-width-dimension', feats: ['rule:distance', 'redundant/conflicting dimensions'], modes: ['stored'], expect: 'build',
  geoms: rectG(0, 0, 30, 20), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), len(3, 30)],
  area: 600, bbox: [0, 0, 30, 20], refusePattern: /./ });
add({ id: 'rect-conflicting-width-dimension', feats: ['rule:distance', 'redundant/conflicting dimensions'], modes: ['stored'], expect: 'refuse',
  geoms: rectG(0, 0, 30, 20), rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20), len(3, 35)],
  area: 600, bbox: [0, 0, 30, 20], refusePattern: /./ });
add({ id: 'slot-arc-rows-inconsistent-with-lock-c', feats: ['rule:lock', 'point-ref:a/b/c ends'], modes: ['stored'], expect: 'refuse', refusePattern: /not on its circle/,
  // arc ends are NOT on the circle the row's c and r describe (a hand-edited row); brep-rs pins c where the ROW says, SolidCraft builds the arc from its three points
  geoms: [A(1, [0.1, 10.2], 10, [0.2, 0], [-0.1, 20.1], 'cw'), A(2, [40, 10], 10, [40, 20], [40, 0], 'cw'), L(3, [0, 20], [40.2, 19.9]), L(4, [40, 0.1], [0, 0])],
  rules: [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'), { k: 'radius', a: 1, value: 10 }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, 40), { k: 'lock', a: 1, aEnd: 'c' }],
  area: slotArea(40, 10), bbox: [-9.9, 0.2, 50.1, 20.2], centroid: [20.1, 10.2], curved: true, inconsistentArc: true });

// ---- ROUND 5 additions (critic): chains of 3+ tangent joints, l-shapes, under-constrained sketches --------------------------------------------------------------------------------------
// rounded rectangle: 4 lines + 4 arcs, 8 endpoint-tangent joints (coincident + tangent), equal arcs, one radius, h/v, two lengths, the bottom-left arc centre pinned. Area = W*H - (4 - pi) r^2.
export const roundedRectG = (W, Hh, r) => [
  L(1, [r, 0], [W - r, 0]), A(2, [W - r, r], r, [W - r, 0], [W, r], 'ccw'), L(3, [W, r], [W, Hh - r]), A(4, [W - r, Hh - r], r, [W, Hh - r], [W - r, Hh], 'ccw'),
  L(5, [W - r, Hh], [r, Hh]), A(6, [r, Hh - r], r, [r, Hh], [0, Hh - r], 'ccw'), L(7, [0, Hh - r], [0, r]), A(8, [r, r], r, [0, r], [r, 0], 'ccw')];
export const roundedRectRules = (r, l1, l3, lockCentre = [5, 5]) => [
  ...tj(1, 'b', 2, 'a'), ...tj(3, 'a', 2, 'b'), ...tj(3, 'b', 4, 'a'), ...tj(5, 'a', 4, 'b'), ...tj(5, 'b', 6, 'a'), ...tj(7, 'a', 6, 'b'), ...tj(7, 'b', 8, 'a'), ...tj(1, 'a', 8, 'b'),
  { k: 'horizontal', a: 1 }, { k: 'vertical', a: 3 }, { k: 'horizontal', a: 5 }, { k: 'vertical', a: 7 },
  { k: 'radius', a: 2, value: r }, { k: 'equal', a: 2, b: 4 }, { k: 'equal', a: 4, b: 6 }, { k: 'equal', a: 6, b: 8 }, len(1, l1), len(3, l3), { k: 'lock', a: 8, aEnd: 'c' }];
add({ id: 'rounded-rect-4-lines-4-arcs', feats: ['rule:tangent', 'tangent:endpoint line-arc', 'rounded rectangle / chain of 3+ tangent joints', 'rule:equal', 'rule:radius', 'rule:lock', 'endpoint tangency curved accuracy'],
  geoms: roundedRectG(40, 24, 5), rules: roundedRectRules(5, 30, 14),
  area: 40 * 24 - (4 - Math.PI) * 25, bbox: [0, 0, 40, 24], centroid: [20, 12], curved: true });
add({ id: 'rounded-rect-R3-60x30', feats: ['rounded rectangle / chain of 3+ tangent joints', 'tangent:endpoint line-arc'],
  geoms: roundedRectG(66, 36, 3).map((g) => (g.k === 'arc' && g.id === 8 ? { ...g, c: [3, 3] } : g)), rules: roundedRectRules(3, 60, 30, [3, 3]),
  area: 66 * 36 - (4 - Math.PI) * 9, bbox: [0, 0, 66, 36], centroid: [33, 18], curved: true });
// one rounded corner: four sharp joins (coincident) and two tangent joints
add({ id: 'rect-one-rounded-corner-R6', feats: ['rule:tangent', 'tangent:endpoint line-arc', 'rounded rectangle / chain of 3+ tangent joints', 'rule:radius'],
  geoms: [L(1, [0, 0], [30, 0]), L(2, [30, 0], [30, 14]), A(3, [24, 14], 6, [30, 14], [24, 20], 'ccw'), L(4, [24, 20], [0, 20]), L(5, [0, 20], [0, 0])],
  rules: [join(1, 2), ...tj(2, 'b', 3, 'a'), ...tj(4, 'a', 3, 'b'), join(4, 5), join(5, 1), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 4 }, { k: 'vertical', a: 5 }, { k: 'radius', a: 3, value: 6 }, len(1, 30), len(5, 20), atOrigin(1)],
  area: 600 - (1 - Math.PI / 4) * 36, bbox: [0, 0, 30, 20], curved: true });
// L-shape twice: the phase2 fixture the contract dropped (its planar delta was 1.1e-9) and a version written with perpendicular rows
const lShapeG = () => [L(1, [0.4, 0.3], [40, 0]), L(2, [40, 0], [40.5, 12]), L(3, [40.5, 12], [15, 11.5]), L(4, [15, 11.5], [15.2, 30]), L(5, [15.2, 30], [0, 30.4]), L(6, [0, 30.4], [0.4, 0.3])];
add({ id: 'own-l-shape-dims', feats: ['rule:horizontal', 'rule:vertical', 'rule:distance', 'rule:coincident', 'planar bar over polygons with 6 edges'],
  geoms: lShapeG(), rules: [...loopJoins(6), ...[1, 3, 5].map((i) => ({ k: 'horizontal', a: i })), ...[2, 4, 6].map((i) => ({ k: 'vertical', a: i })), atOrigin(1), len(1, 40), len(2, 12), len(3, 25), len(4, 18)],
  area: 40 * 12 + 15 * 18, bbox: [0, 0, 40, 30] });
add({ id: 'l-shape-perpendicular-rows', feats: ['rule:perpendicular', 'rule:horizontal', 'rule:distance', 'planar bar over polygons with 6 edges'],
  geoms: lShapeG(), rules: [...loopJoins(6), { k: 'horizontal', a: 1 }, ...[[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]].map(([a, b]) => ({ k: 'perpendicular', a, b })), atOrigin(1), len(1, 40), len(2, 12), len(3, 25), len(4, 18)],
  area: 40 * 12 + 15 * 18, bbox: [0, 0, 40, 30] });
// the same two shapes pinned by a LINE end instead of an arc centre, so a hand-drawn arc whose ends are off its circle is a legal input (the preflight only refuses off-circle arcs whose centre is pinned)
add({ id: 'slot-line-pinned-R10-L40', feats: ['tangent:endpoint line-arc', 'slot with tangent joints', 'arcs drawn off their circle, no pinned centre'], mirrorY: true,
  geoms: [A(1, [0, 10], 10, [0, 0], [0, 20], 'cw'), A(2, [40, 10], 10, [40, 20], [40, 0], 'cw'), L(3, [0, 20], [40.2, 19.9]), L(4, [40, 0.1], [0, 0])],
  rules: [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'), { k: 'radius', a: 1, value: 10 }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, 40), { k: 'lock', a: 4, aEnd: 'b' }],
  area: slotArea(40, 10), bbox: [-10, 0, 50, 20], centroid: [20, 10], curved: true });
add({ id: 'rounded-rect-line-pinned', feats: ['rounded rectangle / chain of 3+ tangent joints', 'arcs drawn off their circle, no pinned centre'],
  geoms: roundedRectG(40, 24, 5), rules: [...roundedRectRules(5, 30, 14).slice(0, -1), { k: 'lock', a: 1, aEnd: 'a' }],
  area: 40 * 24 - (4 - Math.PI) * 25, bbox: [0, 0, 40, 24], centroid: [20, 12], curved: true });
// under-constrained sketches (dof > 0): the 8 saved FreeCAD sk-rect-underconstrained refs. The stored geometry obeys every rule, so the right solid is the stored one; a rough start is not the same sketch.
const UNDER = {
  'sk-rect-underconstrained__hv-only-30x15': { area: 450, bbox: [0, 0, 30, 15], curved: false },
  'sk-rect-underconstrained__width-only': { area: 450, bbox: [0, 0, 30, 15], curved: false },
  'sk-rect-underconstrained__width-and-height': { area: 450, bbox: [0, 0, 30, 15], curved: false },
  'sk-rect-underconstrained__pinned-corner-only': { area: 450, bbox: [2, 3, 32, 18], curved: false },
  'sk-rect-underconstrained__triangle-joined': { area: 300, bbox: [0, 0, 30, 20], curved: false },
  'sk-rect-underconstrained__free-circle': { area: 16 * Math.PI, bbox: [1, 1, 9, 9], curved: true },
  'sk-rect-underconstrained__circle-radius-only': { area: 16 * Math.PI, bbox: [1, 1, 9, 9], curved: true },
  'sk-rect-underconstrained__free-line': { area: null, bbox: null, curved: false, expect: 'refuse' },
};
for (const g of gauntletFixtures()) {
  const u = UNDER[g.id];
  if (!u) continue;
  const fc = fcRef(g.id);
  add({ id: `underconstrained:${g.id}`, feats: ['under-constrained sketch (dof > 0)'], modes: ['stored'], geoms: g.geoms, rules: g.rules, area: u.area, bbox: u.bbox, curved: u.curved, fc, gauntlet: true, underconstrained: true,
    ...(u.expect ? { expect: u.expect, refusePattern: /./ } : {}) });
}

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

export { CASES, L, C, A, join, loopJoins, len, rectG, rectShape, atOrigin, dist, dX, dY, P, fmt, row, rowsTxt, soupScript, plainRules, mulberry, seedOf, geomBox, roughen, slotArea, arcLoopArea, H, clone, tj };
