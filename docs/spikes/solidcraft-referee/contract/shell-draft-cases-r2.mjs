// SPIKE, referee only. Round 4 (critic) cases for the shell-draft group. Consumed by shell-draft-runner.mjs next to shell-draft-cases.mjs and
// shell-draft-cases-steep.mjs.
//   groups: h-closed2 (closed hollow, no open face), d-whole2 (whole-shape draft), d-whole2-fuzz, hd2 (draft after hollow, tilt vs wall),
//           h-mirror2 (hollow of a mirror/join whose result is a plain box), h-bevel2 (hollow after a whole-shape bevel, ModelDoc only),
//           hd2-whole (whole-shape draft with a hollow in the history), h-after-draft2 (hollow after a whole-shape draft)
// Every reference is independent of the kernels: half-space closed forms (shell-draft-polytope.mjs), exact formulas, or the mitre polygon offset below.
const WORD = { top: '+z', bottom: '-z', front: '-y', back: '+y', left: '-x', right: '+x' };
const PULL_IDX = { top: 2, bottom: 2, front: 1, back: 1, left: 0, right: 0 };
const AXI = { x: 0, y: 1, z: 2 };
const LOW = new Set(['bottom', 'front', 'left']);

// ---- mitre polygon offset (non-convex outlines): out(z) moves every edge along its outward normal -------------------------------------------------
function offsetPoly(poly, d) {
  const n = poly.length;
  const sg = Math.sign(poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0)) || 1;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]; const e = [q[0] - p[0], q[1] - p[1]]; const l = Math.hypot(...e);
    const nn = [sg * e[1] / l, -sg * e[0] / l];
    return { n: nn, c: nn[0] * p[0] + nn[1] * p[1] + d, dir: [e[0] / l, e[1] / l] };
  });
  const vs = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i]; const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
    vs.push([(a.c * b.n[1] - b.c * a.n[1]) / det, (a.n[0] * b.c - b.n[0] * a.c) / det]);
  }
  let ok = true;
  for (let i = 0; i < n; i++) { const p = vs[i], q = vs[(i + 1) % n]; if ((q[0] - p[0]) * lines[i].dir[0] + (q[1] - p[1]) * lines[i].dir[1] <= 1e-9) ok = false; }
  // simple-polygon test: no two non-adjacent edges cross
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const segX = (p1, p2, p3, p4) => { const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4); return d1 * d2 < 0 && d3 * d4 < 0; };
  for (let i = 0; i < n && ok; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segX(vs[i], vs[(i + 1) % n], vs[j], vs[(j + 1) % n])) { ok = false; break; } }
  let A = 0; for (let i = 0; i < n; i++) A += vs[i][0] * vs[(i + 1) % n][1] - vs[(i + 1) % n][0] * vs[i][1];
  return { area: Math.abs(A) / 2, ok };
}
/** whole-shape draft of an extruded outline: out(z) = sigma tan(deg)(z - n); the area is exactly quadratic in z while no edge vanishes */
export function wholeExtrudeVolume(poly, z0, z1, n, deg, sigma) {
  const t = sigma * Math.tan(deg * Math.PI / 180);
  const at = (z) => offsetPoly(poly, t * (z - n));
  const zs = [0, 0.25, 0.5, 0.75, 1].map((k) => z0 + k * (z1 - z0));
  const rs = zs.map(at);
  return { volume: (z1 - z0) / 6 * (rs[0].area + 4 * rs[2].area + rs[4].area), vanish: !rs.every((r) => r.ok) };
}

export function R2_FN({ P, sigma }) {
  const C = [];
  const add = (id, group, feature, script, extra = {}) => C.push({ id, group, feature, script, ...extra });
  const boxP = (size, c = [0, 0, 0], rot) => {
    let pl = P.boxPlanes(size.map((s) => -s / 2), size.map((s) => s / 2));
    if (rot && rot.some(Boolean)) pl = P.rotatePlanes(pl, rot);
    return P.translatePlanes(pl, c);
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // draft every plane whose normal is square to the pull axis; vanish = the face count changed
  const wholePlanes = (pl, pullIdx, neutral, deg) => pl.map((p) => (Math.abs(p.n[pullIdx]) > 1e-9 ? p : P.draftPlane(p, 'xyz'[pullIdx], neutral, deg, sigma)));
  const wholeE = (pl, pullIdx, neutral, deg) => {
    const base = P.measure(pl); const m = P.measure(wholePlanes(pl, pullIdx, neutral, deg));
    return { volume: m.volume, com: m.com, bbox: m.bbox, vanish: m.faces !== base.faces, faces: m.faces };
  };
  const hollowE = (pl, word, t) => {
    const { index } = P.wordPlane(pl, WORD[word]);
    const h = P.hollow(pl, index, t);
    const ib = h.inner.bbox; const thin = !ib || ib.some((v) => !Number.isFinite(v)) || Math.min(ib[3] - ib[0], ib[4] - ib[1], ib[5] - ib[2]) < 1e-7 * Math.max(...h.bbox.map(Math.abs), 1);
    return { volume: h.volume, com: h.com, bbox: h.bbox, collapse: thin || !(h.inner.volume > 1e-9) };
  };

  // =========================================================== 1. CLOSED HOLLOW (no open face) ===========================================================
  // outer minus inner, both exact: the centre of mass of a symmetric sealed shell is the centre of the primitive
  const sealedBox = (size, c, t) => () => { const o = size[0] * size[1] * size[2]; const i = size.reduce((a, s) => a * (s - 2 * t), 1); return { volume: o - i, com: c, bbox: [c[0] - size[0] / 2, c[1] - size[1] / 2, c[2] - size[2] / 2, c[0] + size[0] / 2, c[1] + size[1] / 2, c[2] + size[2] / 2] }; };
  const sealedCyl = (r, h, t, c) => () => ({ volume: Math.PI * (r * r * h - (r - t) ** 2 * (h - 2 * t)), com: c, bbox: [c[0] - r, c[1] - r, c[2] - h / 2, c[0] + r, c[1] + r, c[2] + h / 2] });
  const sealedSph = (r, t, c) => () => ({ volume: 4 / 3 * Math.PI * (r ** 3 - (r - t) ** 3), com: c, bbox: [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r] });
  const sealedPrism = (n, R, h, t, c) => () => { const A = (r) => n / 2 * r * r * Math.sin(2 * Math.PI / n); const R2 = R - t / Math.cos(Math.PI / n); return { volume: A(R) * h - A(R2) * (h - 2 * t), com: c }; };
  add('hc2-box', 'h-closed2', 'hollow closed box', `const b = box(40, 30, 20);\nhollow(b, { wall: 2 });`, { expect: sealedBox([40, 30, 20], [0, 0, 0], 2) });
  add('hc2-box-offcentre', 'h-closed2', 'hollow closed box (off-centre)', `const b = box(40, 30, 12, { at: [15, -7, 3] });\nhollow(b, { wall: 2 });`, { expect: sealedBox([40, 30, 12], [15, -7, 3], 2) });
  add('hc2-box-cube', 'h-closed2', 'hollow closed box (cube)', `const b = box(20, 20, 20);\nhollow(b, { wall: 3 });`, { expect: sealedBox([20, 20, 20], [0, 0, 0], 3) });
  add('hc2-box-thin', 'h-closed2', 'hollow closed box (thin wall)', `const b = box(120, 90, 36, { at: [45, -21, 9] });\nhollow(b, { wall: 0.3 });`, { expect: sealedBox([120, 90, 36], [45, -21, 9], 0.3) });
  add('hc2-box-thick', 'h-closed2', 'hollow closed box (wall just under the limit)', `const b = box(40, 30, 20);\nhollow(b, { wall: 9.5 });`, { expect: sealedBox([40, 30, 20], [0, 0, 0], 9.5) });
  for (const s of [0.01, 100]) add(`hc2-box-scale-${s}`, 'h-closed2', 'hollow closed box (scaled)', `const b = box(${40 * s}, ${30 * s}, ${20 * s}, { at: [${5 * s}, 0, 0] });\nhollow(b, { wall: ${2 * s} });`, { expect: sealedBox([40 * s, 30 * s, 20 * s], [5 * s, 0, 0], 2 * s) });
  add('hc2-box-moved', 'h-closed2', 'hollow closed box after a move', `const b = box(40, 30, 20);\nconst m = move(b, [10, -5, 8]);\nhollow(m, { wall: 2 });`, { expect: sealedBox([40, 30, 20], [10, -5, 8], 2) });
  add('hc2-box-turned', 'h-closed2', 'hollow closed box turned at creation', `const b = box(40, 30, 12, { at: [30, 10, 0] });\nturn(b, [0, 0, 30]);\nhollow(b, { wall: 2 });`, { expect: () => { const e = sealedBox([40, 30, 12], [30, 10, 0], 2)(); return { volume: e.volume, com: e.com }; } });
  add('hc2-box-wall-limit', 'h-closed2', 'hollow closed box (wall = half the thinnest side)', `const b = box(40, 30, 20);\nhollow(b, { wall: 10 });`, { shouldRefuse: true });
  add('hc2-box-wall-over', 'h-closed2', 'hollow closed box (wall over half the thinnest side)', `const b = box(40, 30, 20);\nhollow(b, { wall: 12 });`, { shouldRefuse: true });
  add('hc2-cylinder', 'h-closed2', 'hollow closed cylinder', `const c = cylinder(24, 30);\nhollow(c, { wall: 2 });`, { expect: sealedCyl(12, 30, 2, [0, 0, 0]) });
  add('hc2-cylinder-offcentre', 'h-closed2', 'hollow closed cylinder (off-centre)', `const c = cylinder(24, 30, { at: [5, 3, 2] });\nhollow(c, { wall: 2 });`, { expect: sealedCyl(12, 30, 2, [5, 3, 2]) });
  add('hc2-cylinder-wall4', 'h-closed2', 'hollow closed cylinder (wall 4)', `const c = cylinder(24, 30);\nhollow(c, { wall: 4 });`, { expect: sealedCyl(12, 30, 4, [0, 0, 0]) });
  add('hc2-cylinder-flat', 'h-closed2', 'hollow closed cylinder (short)', `const c = cylinder(40, 8);\nhollow(c, { wall: 1.5 });`, { expect: sealedCyl(20, 8, 1.5, [0, 0, 0]) });
  add('hc2-cylinder-wall-limit', 'h-closed2', 'hollow closed cylinder (wall = radius)', `const c = cylinder(24, 30);\nhollow(c, { wall: 12 });`, { shouldRefuse: true });
  add('hc2-cylinder-moved', 'h-closed2', 'hollow closed cylinder after a move', `const c = cylinder(24, 30);\nconst m = move(c, [0, 0, 30]);\nhollow(m, { wall: 2 });`, { expect: sealedCyl(12, 30, 2, [0, 0, 30]) });
  add('hc2-sphere', 'h-closed2', 'hollow closed sphere', `const s = sphere(30);\nhollow(s, { wall: 2 });`, { expect: sealedSph(15, 2, [0, 0, 0]) });
  add('hc2-sphere-offcentre', 'h-closed2', 'hollow closed sphere (off-centre)', `const s = sphere(30, { at: [4, -3, 9] });\nhollow(s, { wall: 3 });`, { expect: sealedSph(15, 3, [4, -3, 9]) });
  for (const n of [3, 4, 5, 6, 8, 12]) add(`hc2-prism${n}`, 'h-closed2', 'hollow closed prism', `const s = prism(${n}, 30, 20);\nhollow(s, { wall: 2 });`, { expect: sealedPrism(n, 15, 20, 2, [0, 0, 0]) });
  add('hc2-prism6-moved', 'h-closed2', 'hollow closed prism after a move', `const s = prism(6, 30, 20);\nconst m = move(s, [7, 3, 20]);\nhollow(m, { wall: 2 });`, { expect: sealedPrism(6, 15, 20, 2, [7, 3, 20]) });
  // refused: shapes and histories the closed hollow is not built for
  add('hc2-wedge', 'h-closed2-no', 'hollow closed wedge', `const s = wedge(30, 20, 15);\nhollow(s, { wall: 2 });`);
  add('hc2-cone', 'h-closed2-no', 'hollow closed cone', `const s = cone(30, 30);\nhollow(s, { wall: 2 });`);
  add('hc2-extrude', 'h-closed2-no', 'hollow closed extrude', `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const p = extrude(s1, 10); hollow(p, { wall: 2 });`);
  add('hc2-box-joined', 'h-closed2-no', 'hollow closed join', `const a = box(40, 40, 10); const c = box(10, 10, 10, { at: [0, 0, 10] }); const u = join(a, c); hollow(u, { wall: 2 });`);
  add('hc2-box-hole', 'h-closed2-no', 'hollow closed box with a through hole', `const b = box(40, 40, 20); hole(b, { across: 6, deep: 22 }); hollow(b, { wall: 2 });`);
  add('hc2-box-rounded', 'h-closed2-no', 'hollow closed rounded box', `const b = box(40, 40, 20); round(b, 3); hollow(b, { wall: 2 });`);
  add('hc2-then-hollow', 'h-closed2-no', 'hollow closed twice', `const b = box(40, 30, 20); hollow(b, { wall: 2 }); hollow(b, { wall: 1 });`);
  add('hc2-then-hollow-open', 'h-closed2-no', 'open hollow after a closed hollow', `const b = box(40, 30, 20); hollow(b, { wall: 2 }); hollow(b, { wall: 1, open: 'top' });`);
  add('hc2-then-draft', 'h-closed2-no', 'closed hollow then draft(face)', `const b = box(40, 40, 20); hollow(b, { wall: 2 }); draft(b.face("right"), 5, {from:"bottom"});`);
  add('hc2-then-hole', 'h-closed2-no', 'closed hollow then a hole', `const b = box(40, 40, 20); hollow(b, { wall: 2 }); hole(b, { across: 6, deep: 22 });`);
  add('hc2-then-join', 'h-closed2-no', 'closed hollow then join', `const a = box(40, 40, 20); hollow(a, { wall: 2 }); const c = box(10, 10, 10, { at: [0, 0, 15] }); join(a, c);`);
  add('hc2-then-round', 'h-closed2-no', 'closed hollow then round one edge', `const b = box(40, 40, 20); hollow(b, { wall: 2 }); round(b.edge('top', 'right'), 2);`);
  add('hc2-then-move', 'h-closed2', 'closed hollow then move', `const b = box(40, 30, 20); hollow(b, { wall: 2 }); const m = move(b, [10, 5, 3]);`, { expect: () => { const e = sealedBox([40, 30, 20], [10, 5, 3], 2)(); return { volume: e.volume, com: e.com }; } });
  add('hc2-then-turn', 'h-closed2', 'closed hollow then turn', `const b = box(40, 30, 20, { at: [10, 5, 3] }); hollow(b, { wall: 2 }); turn(b, [0, 0, 30]);`, { expect: () => { const e = sealedBox([40, 30, 20], [10, 5, 3], 2)(); const a = 30 * Math.PI / 180; return { volume: e.volume }; } });
  add('hc2-cyl-then-move', 'h-closed2', 'closed hollow cylinder then move', `const c = cylinder(24, 30); hollow(c, { wall: 2 }); const m = move(c, [3, 4, 5]);`, { expect: () => { const e = sealedCyl(12, 30, 2, [3, 4, 5])(); return { volume: e.volume, com: e.com }; } });
  add('hc2-cyl-chamfer', 'h-closed2-no', 'hollow closed bevelled cylinder (ModelDoc only)', `const c = cylinder(24, 30); round(c, 1); hollow(c, { wall: 2 });`, { patch: (doc) => { const c = doc.features.find((f) => f.kind === 'cylinder'); c.roundStyle = 'chamfer'; } });

  // =========================================================== 2. WHOLE-SHAPE DRAFT ======================================================================
  const BX = { s: [40, 30, 12], c: [15, -7, 3] };
  const bxs = `box(40, 30, 12, { at: [15, -7, 3] })`;
  const bxP = () => boxP(BX.s, BX.c);
  const W = (id, feature, script, expect, extra = {}) => add(id, 'd-whole2', feature, script, { expect, ...extra });
  // default pull z, neutral 0
  for (const a of [1, 5, 20, 45, -5, -20, -45]) W(`dw2-box-${a}`, 'draft(shape, angle) whole box', `const b = ${bxs};\ndraft(b, ${a});`, () => wholeE(bxP(), 2, 0, a));
  W('dw2-box-option', 'draft(face, angle, {whole:true})', `const b = ${bxs};\ndraft(b.face('right'), 5, { whole: true });`, () => wholeE(bxP(), 2, 0, 5));
  W('dw2-box-option-only', 'draft(shape, angle, {whole:true})', `const b = ${bxs};\ndraft(b, 8, { whole: true });`, () => wholeE(bxP(), 2, 0, 8));
  W('dw2-box-from-bottom', 'draft whole {from:bottom}', `const b = ${bxs};\ndraft(b, 5, { from: 'bottom' });`, () => wholeE(bxP(), 2, -3, 5));
  W('dw2-box-from-top', 'draft whole {from:top}', `const b = ${bxs};\ndraft(b, 5, { from: 'top' });`, () => wholeE(bxP(), 2, 9, 5));
  W('dw2-box-from-top-neg', 'draft whole {from:top} negative', `const b = ${bxs};\ndraft(b, -7, { from: 'top' });`, () => wholeE(bxP(), 2, 9, -7));
  W('dw2-box-neutral', 'draft whole {neutral:3}', `const b = ${bxs};\ndraft(b, 5, { neutral: 3 });`, () => wholeE(bxP(), 2, 3, 5));
  W('dw2-box-neutral-far', 'draft whole {neutral:-100}', `const b = ${bxs};\ndraft(b, 3, { neutral: -100 });`, () => wholeE(bxP(), 2, -100, 3));
  W('dw2-box-pull-x', 'draft whole pull x {from:left}', `const b = ${bxs};\ndraft(b, 8, { from: 'left' });`, () => wholeE(bxP(), 0, 15 - 20, 8));
  W('dw2-box-pull-x-right', 'draft whole pull x {from:right}', `const b = ${bxs};\ndraft(b, 8, { from: 'right' });`, () => wholeE(bxP(), 0, 15 + 20, 8));
  W('dw2-box-pull-y', 'draft whole pull y {from:front}', `const b = ${bxs};\ndraft(b, 6, { from: 'front' });`, () => wholeE(bxP(), 1, -7 - 15, 6));
  W('dw2-box-pull-y-back', 'draft whole pull y {from:back}', `const b = ${bxs};\ndraft(b, -6, { from: 'back' });`, () => wholeE(bxP(), 1, -7 + 15, -6));
  W('dw2-box-small', 'draft whole tiny angle', `const b = ${bxs};\ndraft(b, 0.001);`, () => wholeE(bxP(), 2, 0, 0.001));
  W('dw2-box-tiny2', 'draft whole tiny angle', `const b = ${bxs};\ndraft(b, 0.000001);`, () => wholeE(bxP(), 2, 0, 0.000001));
  add('dw2-box-moved', 'd-whole2-no', 'draft whole after a move with from:bottom (the script layer read the unmoved bottom)', `const b = ${bxs};\nconst m = move(b, [10, 4, -2]);\ndraft(m, 5, { from: 'bottom' });`, { shouldRefuse: true });
  W('dw2-box-moved-neutral', 'draft whole after a move (neutral given)', `const b = ${bxs};\nconst m = move(b, [10, 4, -2]);\ndraft(m, 5, { neutral: 1 });`, () => wholeE(boxP(BX.s, BX.c.map((v, i) => v + [10, 4, -2][i])), 2, 1, 5));
  W('dw2-box-turned-z30', 'draft whole on a box turned 30 about z', `const b = box(40, 30, 12, { at: [15, -7, 3] });\nturn(b, [0, 0, 30]);\ndraft(b, 5);`, () => wholeE(boxP(BX.s, BX.c, [0, 0, 30]), 2, 0, 5));
  W('dw2-box-turned-z45', 'draft whole on a box turned 45 about z', `const b = box(40, 40, 12, { at: [5, 5, 0] });\nturn(b, [0, 0, 45]);\ndraft(b, 5, { neutral: -6 });`, () => wholeE(boxP([40, 40, 12], [5, 5, 0], [0, 0, 45]), 2, -6, 5));
  W('dw2-box-turned-x90', 'draft whole on a box turned 90 about x (pull z)', `const b = box(40, 30, 12, { at: [15, -7, 3] });\nturn(b, [90, 0, 0]);\ndraft(b, 5);`, () => wholeE(boxP(BX.s, BX.c, [90, 0, 0]), 2, 0, 5));
  // steep: the sides cross -> a face vanishes (must be refused)
  for (const a of [60, 70, 78]) W(`dw2-box-vanish-${a}`, 'draft whole, tilt so steep that a face vanishes', `const b = ${bxs};\ndraft(b, ${a}, { from: 'bottom' });`, () => wholeE(bxP(), 2, -3, a));
  W('dw2-box-vanish-neg', 'draft whole, steep outward tilt (fits)', `const b = ${bxs};\ndraft(b, -78, { from: 'bottom' });`, () => wholeE(bxP(), 2, -3, -78));
  W('dw2-box-89', 'draft whole 89 degrees', `const b = ${bxs};\ndraft(b, 89, { from: 'bottom' });`, () => wholeE(bxP(), 2, -3, 89));
  add('dw2-box-90', 'd-whole2', 'draft whole 90 degrees', `const b = ${bxs};\ndraft(b, 90);`, { shouldRefuse: true });
  add('dw2-box-0', 'd-whole2', 'draft whole 0 degrees', `const b = ${bxs};\ndraft(b, 0);`, { expect: () => wholeE(bxP(), 2, 0, 0) });
  // prisms, wedge, extrudes
  for (const n of [3, 4, 5, 6, 7, 8, 12]) for (const [a, nu] of [[5, 0], [-6, -10]]) W(`dw2-prism${n}-${a}`, 'draft whole prism', `const s = prism(${n}, 30, 20);\ndraft(s, ${a}, { neutral: ${nu} });`, () => wholeE(P.prismPlanes(n, 15, 20), 2, nu, a));
  for (const [a, nu] of [[5, 0], [-5, 0], [12, -7.5]]) W(`dw2-wedge-${a}`, 'draft whole wedge', `const s = wedge(30, 20, 15);\ndraft(s, ${a}, { neutral: ${nu} });`, () => wholeE(P.wedgePlanes(30, 20, 15), 2, nu, a));
  const ex = (plane, pts, h, call) => `const s1 = sketch('${plane}'); s1.polygon(${pts}); const p = extrude(s1, ${h}); ${call}`;
  const rect = '[[0,0],[40,0],[40,30],[0,30]]';
  W('dw2-extrude-rect', 'draft whole rectangle extrude', ex('top', rect, 10, 'draft(p, 5, {from:"bottom"});'), () => wholeE(boxP([40, 30, 10], [20, 15, 5]), 2, 0, 5));
  W('dw2-extrude-rect-front', 'draft whole rectangle extrude on the front plane', ex('front', rect, 10, 'draft(p, 5, {neutral: 0});'), () => wholeE(P.boxPlanes([0, -10, 0], [40, 0, 30]), 2, 0, 5));
  W('dw2-extrude-tri', 'draft whole triangle extrude', ex('top', '[[0,0],[40,0],[0,30]]', 10, 'draft(p, 4, {neutral: 0});'), () => wholeE(P.polyPrismPlanes([[0, 0], [40, 0], [0, 30]], 0, 10), 2, 0, 4));
  add('dw2-extrude-circle', 'd-whole2', 'draft whole circle extrude', `const s1 = sketch('top'); s1.circle(30); const p = extrude(s1, 10); draft(p, 5, {neutral: 0});`, { expect: () => { const R = 15, t = sigma * Math.tan(5 * Math.PI / 180); const r = (z) => R + t * z; return { volume: Math.PI / (3 * t) * (r(10) ** 3 - r(0) ** 3) }; } });
  // cylinders (curved: tessellation tolerance)
  const frustum = (R, H, z0, n, deg) => { const t = sigma * Math.tan(deg * Math.PI / 180); const r = (z) => R + t * (z - n); return Math.abs(t) < 1e-12 ? Math.PI * R * R * H : Math.PI / (3 * t) * (r(z0 + H) ** 3 - r(z0) ** 3); };
  for (const [a, nu] of [[5, 0], [-5, 0], [5, -15], [20, 5], [-10, 15]]) add(`dw2-cylinder-${a}-${nu}`, 'd-whole2', 'draft whole cylinder', `const c = cylinder(24, 30);\ndraft(c, ${a}, { neutral: ${nu} });`, { expect: () => ({ volume: frustum(12, 30, -15, nu, a) }) });
  add('dw2-cylinder-moved', 'd-whole2', 'draft whole cylinder after a move', `const c = cylinder(24, 30, { at: [5, 3, 2] });\nconst m = move(c, [1, 2, 3]);\ndraft(m, 5, { neutral: 5 });`, { expect: () => ({ volume: frustum(12, 30, 5 - 15, 5, 5) }) });
  add('dw2-cylinder-from-bottom', 'd-whole2', 'draft whole cylinder {from:bottom}', `const c = cylinder(24, 30);\ndraft(c, 5, { from: 'bottom' });`, { expect: () => ({ volume: frustum(12, 30, -15, -15, 5) }) });
  add('dw2-cylinder-vanish', 'd-whole2', 'draft whole cylinder, steep tilt (cone tip inside)', `const c = cylinder(24, 30);\ndraft(c, 60, { from: 'bottom' });`, { shouldRefuse: true });
  // refused: pull not along the sides, cone, sphere
  add('dw2-cylinder-pull-x', 'd-whole2-no', 'draft whole cylinder pulled along x', `const c = cylinder(24, 30);\ndraft(c, 5, { from: 'left' });`);
  add('dw2-prism-pull-x', 'd-whole2-no', 'draft whole prism pulled along x', `const s = prism(6, 30, 20);\ndraft(s, 5, { from: 'left' });`);
  add('dw2-box-turned-x45', 'd-whole2-no', 'draft whole of a box turned 45 about x (its sides are no longer square to the pull)', `const b = ${bxs};\nturn(b, [45, 0, 0]);\ndraft(b, 5);`);
  add('dw2-cone',  'd-whole2-no', 'draft whole cone', `const s = cone(30, 30);\ndraft(s, 5);`);
  add('dw2-sphere', 'd-whole2-no', 'draft whole sphere', `const s = sphere(30);\ndraft(s, 5);`);
  add('dw2-ring', 'd-whole2-no', 'draft whole ring', `const s = ring(40, 12);\ndraft(s, 5);`);
  // history: refused
  add('dw2-after-join', 'd-whole2-no', 'draft whole after a join', `const a = box(40, 40, 10); const c = box(10, 10, 10, { at: [0, 0, 10] }); const u = join(a, c); draft(u, 5, {neutral: 0});`);
  add('dw2-after-hole', 'd-whole2-no', 'draft whole after a through hole', `const b = box(40, 40, 20); hole(b, { across: 6, deep: 22 }); draft(b, 5);`);
  add('dw2-after-round', 'd-whole2-no', 'draft whole after rounding the box', `const b = box(40, 40, 20); round(b, 3); draft(b, 5);`);
  add('dw2-after-face-draft', 'd-whole2-no', 'draft whole after a face draft', `const b = ${bxs}; draft(b.face('right'), 4); draft(b, 5);`);
  add('dw2-face-draft-after-whole', 'd-whole2-no', 'draft(face) after a whole draft', `const b = ${bxs}; draft(b, 4); draft(b.face('right'), 5);`);
  add('dw2-after-mirror', 'd-whole2-no', 'draft whole after a mirror', `const b = box(20, 20, 20, { at: [10, 0, 0] }); const m = mirror(b, 'left-right'); draft(m, 5);`);
  add('dw2-after-turn-step', 'd-whole2-no', 'draft whole after a separate turn', `const b = ${bxs}; hollow(b, { wall: 2, open: 'top' }); turn(b, [0, 0, 30]); draft(b, 5);`);
  add('dw2-twice', 'd-whole2-no', 'draft whole twice', `const b = ${bxs}; draft(b, 3); draft(b, 2);`);
  // non-convex outlines: L, T, C(U) extrudes. Oracle = mitre polygon offset with event detection.
  const polyCases = {
    L: { pts: [[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]], h: 20 },
    T: { pts: [[0, 10], [10, 10], [10, 0], [30, 0], [30, 10], [40, 10], [40, 20], [0, 20]], h: 20 },
    U: { pts: [[0, 0], [40, 0], [40, 30], [28, 30], [28, 10], [12, 10], [12, 30], [0, 30]], h: 16 },
    Lthin: { pts: [[0, 0], [40, 0], [40, 6], [6, 6], [6, 30], [0, 30]], h: 20 },
  };
  for (const [k, def] of Object.entries(polyCases)) {
    for (const a of [2, 5, 10, -5, -10, -25]) add(`dw2-${k}-${a}`, 'd-whole2', `draft whole ${k} extrude`, ex('top', JSON.stringify(def.pts), def.h, `draft(p, ${a}, {neutral: 0});`), { expect: () => { const r = wholeExtrudeVolume(def.pts, 0, def.h, 0, a, sigma); return r.vanish ? { vanish: true } : { volume: r.volume }; } });
    for (const a of [15, 30, 45, 60]) add(`dw2-${k}-steep-${a}`, 'd-whole2', `draft whole ${k} extrude, steep inward tilt`, ex('top', JSON.stringify(def.pts), def.h, `draft(p, ${a}, {neutral: 0});`), { expect: () => { const r = wholeExtrudeVolume(def.pts, 0, def.h, 0, a, sigma); return r.vanish ? { vanish: true } : { volume: r.volume }; } });
    add(`dw2-${k}-neutral-top`, 'd-whole2', `draft whole ${k} extrude, neutral at the top`, ex('top', JSON.stringify(def.pts), def.h, `draft(p, 8, {neutral: ${def.h}});`), { expect: () => { const r = wholeExtrudeVolume(def.pts, 0, def.h, def.h, 8, sigma); return r.vanish ? { vanish: true } : { volume: r.volume }; } });
  }

  // an outline whose edges overlap (the U with arms that cross): the sketch is not a valid outline
  add('dw2-outline-overlap', 'd-whole2-no', 'draft whole of an extrude whose outline overlaps itself', ex('top', '[[0,0],[20,0],[20,41],[5,41],[5,11],[15,11],[15,41],[0,41]]', 10, 'draft(p, 15, {neutral: 0});'));
  add('dw2-outline-bowtie', 'd-whole2-no', 'draft whole of an extrude whose outline crosses itself', ex('top', '[[0,0],[30,30],[30,0],[0,30]]', 10, 'draft(p, 5, {neutral: 0});'));

  // ---- seeded fuzz --------------------------------------------------------------------------------------------------------------------------------
  let seed = 20261018; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const ri = (a, b) => Math.round(a + rnd() * (b - a)); const rf = (a, b, d = 1) => +(a + rnd() * (b - a)).toFixed(d);
  const WORDS = ['top', 'bottom', 'front', 'back', 'left', 'right'];
  for (let i = 0; i < 40; i++) {
    const s = [ri(10, 60), ri(10, 60), ri(8, 40)]; const c = [ri(-20, 20), ri(-20, 20), ri(-10, 10)];
    const w = WORDS[ri(0, 5)]; const pidx = PULL_IDX[w];
    const a = (rnd() < 0.5 ? -1 : 1) * rf(0.5, 60);
    const useNeutral = rnd() < 0.5; const nu = rf(-30, 30);
    const lo = c[pidx] - s[pidx] / 2, hi = c[pidx] + s[pidx] / 2;
    const call = useNeutral ? `draft(b, ${a}, { neutral: ${nu} });` : `draft(b, ${a}, { from: '${w}' });`;
    const neutral = useNeutral ? nu : (LOW.has(w) ? lo : hi);
    add(`dw2-fuzz-box-${i}`, 'd-whole2-fuzz', `fuzz box whole draft ${w}`, `const b = box(${s.join(', ')}, { at: [${c.join(', ')}] });\n${call}`, { expect: () => wholeE(boxP(s, c), useNeutral ? 2 : pidx, neutral, a) });
  }
  for (let i = 0; i < 20; i++) {
    const n = ri(3, 12); const R = rf(8, 25); const h = rf(8, 30);
    const a = (rnd() < 0.5 ? -1 : 1) * rf(0.5, 40); const nu = rf(-h / 2 - 5, h / 2 + 5);
    add(`dw2-fuzz-prism-${i}`, 'd-whole2-fuzz', 'fuzz prism whole draft', `const s = prism(${n}, ${2 * R}, ${h});\ndraft(s, ${a}, { neutral: ${nu} });`, { expect: () => wholeE(P.prismPlanes(n, R, h), 2, nu, a) });
  }
  for (let i = 0; i < 40; i++) {
    // random rectilinear L / U outlines
    const W1 = ri(20, 60), H1 = ri(20, 60); const a1 = ri(4, Math.min(W1, H1) - 4); const b1 = i % 2 === 0 ? ri(4, Math.min(W1, H1) - 4) : ri(4, Math.floor((W1 - 4) / 2));
    const pts = i % 2 === 0 ? [[0, 0], [W1, 0], [W1, a1], [b1, a1], [b1, H1], [0, H1]] : [[0, 0], [W1, 0], [W1, H1], [W1 - b1, H1], [W1 - b1, a1], [b1, a1], [b1, H1], [0, H1]];
    const h = ri(6, 30); const a = (rnd() < 0.5 ? -1 : 1) * rf(0.5, 45); const nu = rnd() < 0.5 ? 0 : h;
    add(`dw2-fuzz-poly-${i}`, 'd-whole2-fuzz', 'fuzz non-convex extrude whole draft', ex('top', JSON.stringify(pts), h, `draft(p, ${a}, {neutral: ${nu}});`), { expect: () => { const r = wholeExtrudeVolume(pts, 0, h, nu, a, sigma); return r.vanish ? { vanish: true } : { volume: r.volume }; } });
  }

  // =========================================================== 3. DRAFT AFTER HOLLOW: tilt vs wall ======================================================
  // box 40x30x20 centred, hollow open top (wall t), then draft(face, deg, {from:'bottom'}) - positive deg moves the face into the part as z grows, so the
  // tilted plane sweeps 20 tan(deg) at the top: it stays in the wall when 20 tan(deg) < t and cuts through the cavity when it does not.
  // Reference: outer solid drafted, minus the cavity clipped by the tilted plane (shell-draft-polytope.mjs), exact.
  const hdRef = (face, deg, t, size = [40, 30, 20]) => () => {
    const pl = boxP(size); const idx = P.wordPlane(pl, WORD[face]).index; const top = P.wordPlane(pl, '+z').index;
    const dr = pl.map((p) => ({ ...p })); dr[idx] = P.draftPlane(pl[idx], 'z', -size[2] / 2, deg, sigma);
    const outer = P.measure(dr);
    const cav = pl.map((p, i) => (i === top ? p : { n: p.n, d: p.d - t })); cav.push(dr[idx]);
    const cm = P.measure(cav); const V = outer.volume - cm.volume;
    return { volume: V, com: outer.com.map((c, k) => (outer.volume * c - cm.volume * cm.com[k]) / V), bbox: outer.bbox };
  };
  for (const t of [2, 3]) for (const face of ['right', 'left', 'front', 'back']) for (const deg of [1, 2, 3, 4, 5, 6, 8, 10, 15]) {
    const fits = 20 * Math.tan(deg * Math.PI / 180) < t;
    add(`hd2-${face}-w${t}-${deg}`, fits ? 'hd2-fit' : 'hd2-cross', fits ? 'draft(face) after hollow open:top, tilt stays inside the wall' : 'draft(face) after hollow open:top, tilt cuts through the cavity', `const b = box(40, 30, 20);\nhollow(b, { wall: ${t}, open: 'top' });\ndraft(b.face('${face}'), ${deg}, { from: 'bottom' });`, { expect: hdRef(face, deg, t) });
  }
  // the boundary: 20 tan(deg) = wall -/+ 0.01
  for (const t of [2, 3]) for (const dd of [-0.01, -0.001, 0, 0.001, 0.01]) {
    const deg = +(Math.atan((t + dd) / 20) * 180 / Math.PI).toFixed(6);
    add(`hd2-edge-w${t}-${dd}`, 'hd2-edge', 'draft(face) after hollow open:top, tilt at the wall thickness', `const b = box(40, 30, 20);\nhollow(b, { wall: ${t}, open: 'top' });\ndraft(b.face('right'), ${deg}, { from: 'bottom' });`, { expect: hdRef('right', deg, t) });
  }
  for (const [face, deg] of [['right', -8], ['right', -20], ['left', -10], ['front', -12]]) add(`hd2-${face}-out${-deg}`, 'hd2-fit', 'draft(face) after hollow open:top, outward tilt', `const b = box(40, 30, 20);\nhollow(b, { wall: 2, open: 'top' });\ndraft(b.face('${face}'), ${deg}, { from: 'bottom' });`, { expect: hdRef(face, deg, 2) });
  // neutral at the top: positive deg moves the face OUT as z drops toward the bottom
  add('hd2-right-top-neutral', 'hd2-fit', 'draft(face) after hollow open:top, neutral at the top', `const b = box(40, 30, 20);\nhollow(b, { wall: 2, open: 'top' });\ndraft(b.face('right'), 6, { from: 'top' });`, { expect: () => { const pl = boxP([40, 30, 20]); const idx = P.wordPlane(pl, '+x').index; const top = P.wordPlane(pl, '+z').index; const dr = pl.map((p) => ({ ...p })); dr[idx] = P.draftPlane(pl[idx], 'z', 10, 6, sigma); const outer = P.measure(dr); const cav = pl.map((p, i) => (i === top ? p : { n: p.n, d: p.d - 2 })); cav.push(dr[idx]); const cm = P.measure(cav); return { volume: outer.volume - cm.volume }; } });
  // the one the existing contract row cites (12 tall, 5 degrees) for comparison
  add('hd2-contract-case', 'hd2-fit', 'the case the contract row cites (40x30x12, wall 2, right 5 degrees, neutral 0)', `const b = ${bxs};\nhollow(b, { wall: 2, open: 'top' });\ndraft(b.face('right'), 5);`, { expect: () => { const pl = bxP(); const idx = P.wordPlane(pl, '+x').index; const top = P.wordPlane(pl, '+z').index; const dr = pl.map((p) => ({ ...p })); dr[idx] = P.draftPlane(pl[idx], 'z', 0, 5, sigma); const outer = P.measure(dr); const cav = pl.map((p, i) => (i === top ? p : { n: p.n, d: p.d - 2 })); cav.push(dr[idx]); const cm = P.measure(cav); return { volume: outer.volume - cm.volume }; } });
  // whole-shape draft with a hollow in the history: refused (the raw engine returns a NEGATIVE volume, see shell-draft-r2-probe.mjs)
  for (const a of [3, 5, 10]) add(`hd2-whole-${a}`, 'hd2-whole', 'draft whole after hollow open:top', `const b = box(40, 30, 20);\nhollow(b, { wall: 2, open: 'top' });\ndraft(b, ${a}, { from: 'bottom' });`);
  add('hd2-whole-closed', 'hd2-whole', 'draft whole after a closed hollow', `const b = box(40, 30, 20);\nhollow(b, { wall: 2 });\ndraft(b, 5, { from: 'bottom' });`);
  // hollow AFTER a whole-shape draft: the cavity is the drafted outer offset inward by the wall (every plane but the open one moves in by t)
  const hollowDrafted = (size, c, deg, nu, openWord, t) => () => {
    const pl = boxP(size, c); const dr = wholePlanes(pl, 2, nu, deg); const idx = P.wordPlane(pl, WORD[openWord]).index;
    const h = P.hollow(dr, idx, t); return { volume: h.volume, com: h.com, bbox: h.bbox, collapse: !(h.inner.volume > 1e-9) };
  };
  for (const [a, w, t, word] of [[3, 'z0', 2, 'top'], [5, 'z0', 2, 'top'], [-5, 'z0', 2, 'top'], [4, 'z0', 2, 'bottom'], [5, 'z0', 3, 'top'], [8, 'z0', 2, 'right']]) {
    const call = `draft(b, ${a}, { neutral: 0 });`;
    add(`ha2-${word}-${a}-w${t}`, 'h-after-draft2', 'hollow after a whole-shape draft', `const b = ${bxs};\n${call}\nhollow(b, { wall: ${t}, open: '${word}' });`, { expect: hollowDrafted(BX.s, BX.c, a, 0, word, t) });
  }

  // =========================================================== 4. HOLLOW of a mirror / join that is a plain box ==============================================
  const m40 = () => boxP([40, 20, 20], [0, 0, 0]);
  for (const word of ['top', 'bottom', 'front', 'back']) add(`hm2-mirror-lr-${word}`, 'h-mirror2', 'hollow of a box mirrored left-right (result is a plain 40x20x20 block)', `const b = box(20, 20, 20, { at: [10, 0, 0] });\nconst m = mirror(b, 'left-right');\nhollow(m, { wall: 2, open: '${word}' });`, { expect: () => hollowE(m40(), word, 2), expectAlt: () => hollowE(m40(), { top: 'bottom', bottom: 'top', front: 'back', back: 'front' }[word], 2) });
  add('hm2-mirror-lr-right', 'h-mirror2', 'hollow open:right of the box mirrored left-right', `const b = box(20, 20, 20, { at: [10, 0, 0] });\nconst m = mirror(b, 'left-right');\nhollow(m, { wall: 2, open: 'right' });`, { expect: () => hollowE(m40(), 'right', 2) });
  add('hm2-mirror-lr-left', 'h-mirror2-no', 'hollow open:left of the box mirrored left-right (the left face is consumed by the mirror)', `const b = box(20, 20, 20, { at: [10, 0, 0] });\nconst m = mirror(b, 'left-right');\nhollow(m, { wall: 2, open: 'left' });`);
  add('hm2-mirror-fb-top', 'h-mirror2', 'hollow of a box mirrored front-back', `const b = box(30, 12, 18, { at: [0, 6, 0] });\nconst m = mirror(b, 'front-back');\nhollow(m, { wall: 2, open: 'top' });`, { expect: () => hollowE(boxP([30, 24, 18]), 'top', 2) });
  add('hm2-mirror-tb-front', 'h-mirror2', 'hollow of a box mirrored top-bottom', `const b = box(30, 20, 10, { at: [0, 0, 5] });\nconst m = mirror(b, 'top-bottom');\nhollow(m, { wall: 2, open: 'front' });`, { expect: () => hollowE(boxP([30, 20, 20]), 'front', 2) });
  add('hm2-mirror-moved', 'h-mirror2', 'hollow of a mirrored box that was moved', `const b = box(20, 20, 20, { at: [10, 0, 0] });\nconst m = mirror(b, 'left-right');\nconst v = move(m, [5, 5, 5]);\nhollow(v, { wall: 2, open: 'top' });`, { expect: () => hollowE(boxP([40, 20, 20], [5, 5, 5]), 'top', 2) });
  add('hm2-mirror-tb-top', 'h-mirror2', 'hollow open:top of the box mirrored top-bottom', `const b = box(30, 20, 10, { at: [0, 0, 5] });\nconst m = mirror(b, 'top-bottom');\nhollow(m, { wall: 2, open: 'top' });`, { expect: () => hollowE(boxP([30, 20, 20]), 'top', 2) });
  add('hm2-mirror-tb-bottom', 'h-mirror2-no', 'hollow open:bottom of the box mirrored top-bottom (the bottom face is swallowed by the mirror)', `const b = box(30, 20, 10, { at: [0, 0, 5] });\nconst m = mirror(b, 'top-bottom');\nhollow(m, { wall: 2, open: 'bottom' });`);
  add('hm2-mirror-offset', 'h-mirror2', 'hollow of a box mirrored through its near face, 40x30x12 at x 10..50 (result is an 80 wide block)', `const b = box(40, 30, 12, { at: [30, 10, 0] });\nconst m = mirror(b, 'left-right');\nhollow(m, { wall: 2, open: 'top' });`, { expect: () => hollowE(boxP([80, 30, 12], [10, 10, 0]), 'top', 2) });
  add('hm2-join-adjacent', 'h-mirror2-no', 'hollow of two joined boxes that form a block', `const a = box(20, 20, 20, { at: [-10, 0, 0] }); const c = box(20, 20, 20, { at: [10, 0, 0] }); const u = join(a, c);\nhollow(u, { wall: 2, open: 'top' });`);
  add('hm2-mirror-twice-L', 'h-mirror2-no', 'hollow of an L (not a box) mirrored', `const b = box(20, 20, 10, { at: [10, 0, 0] }); const c = box(10, 10, 20, { at: [5, 0, 5] }); const u = join(b, c); const m = mirror(u, 'left-right');\nhollow(m, { wall: 2, open: 'bottom' });`);

  // =========================================================== 5. HOLLOW after a whole-shape bevel (ModelDoc only) ======================================
  const chamfer = (kind) => (doc) => { const f = doc.features.find((x) => x.kind === kind); f.roundStyle = 'chamfer'; };
  for (const [c, t] of [[1, 2], [1.5, 2], [2, 3], [3, 2], [2, 2]]) add(`hb2-box-c${c}-w${t}`, 'h-bevel2', 'hollow open:top after a whole-shape bevel of a box (ModelDoc only)', `const b = box(40, 40, 20); round(b, ${c}); hollow(b, { wall: ${t}, open: 'top' });`, { patch: chamfer('box') });
  add('hb2-box-only', 'h-bevel2', 'whole-shape bevel of a box with nothing after it (ModelDoc only)', `const b = box(40, 40, 20); round(b, 1);`, { patch: chamfer('box') });
  for (const [c, t, w] of [[1, 2, 'top'], [1, 2, 'bottom'], [0.5, 2, 'top'], [2, 2, 'top'], [3, 2, 'top']]) add(`hb2-cyl-c${c}-w${t}-${w}`, 'h-bevel2', 'hollow after a whole-shape bevel of a cylinder (ModelDoc only)', `const c = cylinder(24, 30); round(c, ${c}); hollow(c, { wall: ${t}, open: '${w}' });`, { patch: chamfer('cylinder') });
  // the same with a ROUND (fillet): the case that has always been in the contract, for the sentence wording
  add('hb2-box-round3-w2', 'h-bevel2-round', 'hollow after a whole-shape round bigger than the wall', `const b = box(40, 40, 20); round(b, 3); hollow(b, { wall: 2, open: 'top' });`);
  add('hb2-cyl-round1-w2', 'h-bevel2-round', 'hollow open:top after a whole-shape round of a cylinder smaller than the wall', `const c = cylinder(24, 30); round(c, 1); hollow(c, { wall: 2, open: 'top' });`);
  add('hb2-cyl-round3-w2', 'h-bevel2-round', 'hollow open:top after a whole-shape round of a cylinder bigger than the wall', `const c = cylinder(24, 30); round(c, 3); hollow(c, { wall: 2, open: 'top' });`);

  // =========================================================== 6. sentences: faces that do not exist / were changed ==================================
  add('sn2-draft-sphere-face', 'sn2', 'draft(face) on a sphere', `const s = sphere(30);\ndraft(s.face("right"), 5);`);
  add('sn2-draft-cap-from-right', 'sn2', 'draft(right face, {from:left}) (face square to the pull)', `const b = ${bxs};\ndraft(b.face('right'), 8, { from: 'left' });`);
  add('sn2-draft-cap-top', 'sn2', 'draft(top face) default pull', `const b = ${bxs};\ndraft(b.face('top'), 8);`);
  add('sn2-draft-cap-top-from-bottom', 'sn2', 'draft(top face, {from:bottom})', `const b = ${bxs};\ndraft(b.face('top'), 8, { from: 'bottom' });`);
  add('sn2-draft-cap-front-from-back', 'sn2', 'draft(front face, {from:back})', `const b = ${bxs};\ndraft(b.face('front'), 8, { from: 'back' });`);
  add('sn2-hollow-open-drafted', 'sn2', 'hollow open:right on the face that was just drafted', `const b = ${bxs};\ndraft(b.face('right'), 5);\nhollow(b, { wall: 2, open: 'right' });`);
  add('sn2-hollow-twice', 'sn2', 'hollow twice (open)', `const b = ${bxs};\nhollow(b, { wall: 2, open: 'top' });\nhollow(b, { wall: 1, open: 'top' });`);

  // =========================================================== 7. second seeded fuzz (round 4, written after the first pass found nothing wrong) ====================
  // 7a. closed hollow of random boxes / cylinders / prisms with a random turn and move: outer minus inner, centre of mass at the centre.
  let seed2 = 7777; const rnd2 = () => { seed2 = (seed2 * 1664525 + 1013904223) >>> 0; return seed2 / 4294967296; };
  const ri2 = (a, b) => Math.round(a + rnd2() * (b - a)); const rf2 = (a, b, d = 1) => +(a + rnd2() * (b - a)).toFixed(d);
  for (let i = 0; i < 36; i++) {
    const kind = ['box', 'box', 'cylinder', 'prism'][i % 4]; const c = [ri2(-30, 30), ri2(-30, 30), ri2(-15, 15)];
    const turn = rnd2() < 0.5 ? null : [[0, 0, 37], [90, 0, 0], [0, 90, 0], [0, 0, 90], [45, 0, 0]][ri2(0, 4)];
    const mv = rnd2() < 0.5 ? [ri2(-20, 20), ri2(-20, 20), ri2(-20, 20)] : null;
    let decl, ex2, name;
    if (kind === 'box') { const sz = [ri2(10, 60), ri2(10, 60), ri2(8, 40)]; const t = rf2(0.3, Math.min(...sz) / 2 - 0.5); decl = `const b = box(${sz.join(', ')}, { at: [${c.join(', ')}] });`; ex2 = () => { const o = sz[0] * sz[1] * sz[2]; const inn = sz.reduce((a, v) => a * (v - 2 * t), 1); return { volume: o - inn, com: c.map((v, k) => v + (mv ? mv[k] : 0)) }; }; name = `hollow(h, { wall: ${t} })`; var wall = t; }
    else if (kind === 'cylinder') { const R = ri2(6, 30), H = ri2(8, 50); const t = rf2(0.3, Math.min(R, H / 2) - 0.5); decl = `const b = cylinder(${2 * R}, ${H}, { at: [${c.join(', ')}] });`; ex2 = () => ({ volume: Math.PI * (R * R * H - (R - t) ** 2 * (H - 2 * t)), com: c.map((v, k) => v + (mv ? mv[k] : 0)) }); var wall = t; }
    else { const n = ri2(3, 12), R = ri2(8, 25), H = ri2(8, 40); const ap = R * Math.cos(Math.PI / n); const t = rf2(0.3, Math.min(ap, H / 2) - 0.5); decl = `const b = prism(${n}, ${2 * R}, ${H}, { at: [${c.join(', ')}] });`; const A = (r) => n / 2 * r * r * Math.sin(2 * Math.PI / n); ex2 = () => { const R2 = R - t / Math.cos(Math.PI / n); return { volume: A(R) * H - A(R2) * (H - 2 * t), com: c.map((v, k) => v + (mv ? mv[k] : 0)) }; }; var wall = t; }
    // a turn about the origin moves the centre; only turn parts centred on the origin (the centre of mass then stays at the move offset)
    const cc = turn ? [0, 0, 0] : c;
    decl = decl.replace(/at: \[[^\]]*\]/, `at: [${cc.join(', ')}]`);
    const body = `${decl}\n${turn ? `turn(b, [${turn.join(', ')}]);\n` : ''}${mv ? `const m = move(b, [${mv.join(', ')}]);\nhollow(m, { wall: ${wall} });` : `hollow(b, { wall: ${wall} });`}`;
    const exp = ex2;
    add(`hc2-fuzz-${i}`, 'h-closed2-fuzz', `fuzz closed hollow ${kind}${turn ? ' turned' : ''}${mv ? ' moved' : ''}`, body, { expect: () => { const e = exp(); return { volume: e.volume, com: cc.map((v, k) => v + (mv ? mv[k] : 0)) }; } });
  }
  // 7b. whole-shape draft of extrudes on the front / right planes (the plane whose sweep direction is not its frame normal), pull along the sweep
  add('dw2-front-rect-pull-y', 'd-whole2', 'draft whole of a front-plane rectangle extrude pulled along y', ex('front', '[[0,0],[40,0],[40,30],[0,30]]', 10, 'draft(p, 5, { from: "front", neutral: -3 });'), { expect: () => wholeE(P.boxPlanes([0, -10, 0], [40, 0, 30]), 1, -3, 5) });
  add('dw2-right-rect-pull-x', 'd-whole2', 'draft whole of a right-plane rectangle extrude pulled along x', ex('side', '[[0,0],[30,0],[30,20],[0,20]]', 12, 'draft(p, -6, { from: "left", neutral: 4 });'), { expect: () => wholeE(P.boxPlanes([0, 0, 0], [12, 30, 20]), 0, 4, -6) });
  add('dw2-front-rect-pull-z', 'd-whole2', 'draft whole of a front-plane rectangle extrude pulled along z (the end faces are square to z)', ex('front', '[[0,0],[40,0],[40,30],[0,30]]', 10, 'draft(p, 7, { from: "bottom", neutral: 0 });'), { expect: () => wholeE(P.boxPlanes([0, -10, 0], [40, 0, 30]), 2, 0, 7) });
  add('dw2-right-rect-pull-z', 'd-whole2', 'draft whole of a right-plane rectangle extrude pulled along z', ex('side', '[[0,0],[30,0],[30,20],[0,20]]', 12, 'draft(p, 7, { neutral: 5 });'), { expect: () => wholeE(P.boxPlanes([0, 0, 0], [12, 30, 20]), 2, 5, 7) });
  // 7c. hollow after a whole-shape draft of something that is not a box, and after a face draft of a prism
  const hollowOf = (pl, word, t) => () => hollowE(pl, word, t);
  const dPrism = (n, nu, a) => wholePlanes(P.prismPlanes(n, 15, 20), 2, nu, a);
  for (const [n, a, nu, t] of [[6, 5, 0, 2], [4, -4, 0, 2], [8, 3, -10, 1.5], [3, 3, 0, 1]]) add(`ha3-prism${n}-${a}`, 'h-after-draft3', 'hollow open:top after a whole-shape draft of a prism', `const s = prism(${n}, 30, 20);\ndraft(s, ${a}, { neutral: ${nu} });\nhollow(s, { wall: ${t}, open: 'top' });`, { expect: () => { const pl = dPrism(n, nu, a); const h = P.hollow(pl, 4 + (n - 4) + 0, t); return h; } });
  add('ha3-prism6-face', 'h-after-draft3', 'hollow open:top after a face draft of a prism', `const s = prism(6, 30, 20);\ndraft(s.face('front'), 5, { neutral: -10 });\nhollow(s, { wall: 2, open: 'top' });`, { expect: () => { const pl = P.prismPlanes(6, 15, 20); const fi = P.wordPlane(pl, '-y').index; const q = pl.map((p) => ({ ...p })); q[fi] = P.draftPlane(pl[fi], 'z', -10, 5, sigma); return P.hollow(q, 6, 2); } });
  add('ha3-cylinder-5', 'h-after-draft3', 'hollow open:top after a whole-shape draft of a cylinder', `const c = cylinder(24, 30);\ndraft(c, 5, { neutral: -15 });\nhollow(c, { wall: 2, open: 'top' });`, { expect: () => { const R = 12, H = 30, t = 2; const k = sigma * Math.tan(5 * Math.PI / 180); const r = (z) => R + k * (z + 15); const frus = (f, a, b) => Math.PI / (3 * k) * (f(b) ** 3 - f(a) ** 3); const cav = (z) => r(z) - t * Math.sqrt(1 + k * k); return { volume: frus(r, -15, 15) - frus(cav, -15 + t, 15) }; } });
  add('ha3-extrude-circle', 'h-after-draft3', 'hollow open:top after a whole-shape draft of a circle extrude', `const s1 = sketch('top'); s1.circle(30); const p = extrude(s1, 12); draft(p, 4, { neutral: 0 });\nhollow(p, { wall: 1.5, open: 'top' });`);
  add('ha3-cylinder-neg', 'h-after-draft3', 'hollow open:bottom after a whole-shape draft of a cylinder', `const c = cylinder(24, 30);\ndraft(c, -5, { neutral: 15 });\nhollow(c, { wall: 2, open: 'bottom' });`);
  add('ha3-extrude-rect', 'h-after-draft3', 'hollow open:top after a whole-shape draft of a rectangle extrude', ex('top', '[[0,0],[40,0],[40,30],[0,30]]', 10, 'draft(p, 5, { neutral: 0 });\nhollow(p, { wall: 2, open: "top" });'), { expect: () => { const pl = wholePlanes(boxP([40, 30, 10], [20, 15, 5]), 2, 0, 5); return P.hollow(pl, 4, 2); } });
  add('ha3-extrude-L', 'h-after-draft3', 'hollow after a whole-shape draft of an L extrude', ex('top', '[[0,0],[40,0],[40,15],[15,15],[15,30],[0,30]]', 10, 'draft(p, 5, { neutral: 0 });\nhollow(p, { wall: 1, open: "top" });'));
  // 7d. hollow of random mirrored boxes: the result is a plain block; the open face is the root's own face and must still be on the outside
  const MIR = { 'left-right': [0, 'x'], 'front-back': [1, 'y'], 'top-bottom': [2, 'z'] };
  for (let i = 0; i < 36; i++) {
    const sz = [ri2(10, 40), ri2(10, 40), ri2(10, 40)]; const c = [ri2(-30, 30), ri2(-30, 30), ri2(-30, 30)];
    const mw = ['left-right', 'front-back', 'top-bottom'][i % 3]; const ax = MIR[mw][0];
    const lo = c.map((v, k) => v - sz[k] / 2), hi = c.map((v, k) => v + sz[k] / 2);
    const at = Math.abs(lo[ax]) <= Math.abs(hi[ax]) ? lo[ax] : hi[ax];
    const blo = [...lo], bhi = [...hi]; blo[ax] = Math.min(lo[ax], 2 * at - hi[ax]); bhi[ax] = Math.max(hi[ax], 2 * at - lo[ax]);
    const word = ['top', 'bottom', 'front', 'back', 'left', 'right'][ri2(0, 5)]; const wi = PULL_IDX[word]; const low = LOW.has(word);
    const rootFace = low ? lo[wi] : hi[wi]; const blockFace = low ? blo[wi] : bhi[wi];
    const swallowed = Math.abs(rootFace - blockFace) > 1e-9;
    const blockSize = [0, 1, 2].map((k) => bhi[k] - blo[k]); const blockC = [0, 1, 2].map((k) => (bhi[k] + blo[k]) / 2);
    const t = rf2(0.3, Math.min(...blockSize.map((v, k) => (k === wi ? v : v / 2))) - 0.4);
    add(`hm2-fuzz-${i}`, 'h-mirror2-fuzz', `fuzz hollow of a ${mw} mirrored box, open:${word}${swallowed ? ' (swallowed)' : ''}`, `const b = box(${sz.join(', ')}, { at: [${c.join(', ')}] });\nconst m = mirror(b, '${mw}');\nhollow(m, { wall: ${t}, open: '${word}' });`, swallowed ? { shouldRefuse: true } : { expect: () => hollowE(boxP(blockSize, blockC), word, t) });
  }
  return C;
}
