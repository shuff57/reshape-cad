// SPIKE, referee only (contract / extrude-pocket group). The cases measured by extrude-pocket-measure.mjs.
// Each case is a reSHape Script text plus (usually) a CLOSED FORM written here with no kernel involved:
//   analytic() -> { volume, bbox:[x0,y0,z0,x1,y1,z1], com:[x,y,z] }   (any field may be left out; the missing ones are taken from live OCCT)
// World frames are hard-coded below (NOT read from model-types) so the closed forms are independent of the code under test:
//   top   sketch: u=+X v=+Y, sweep +Z, offset moves +Z
//   front sketch: u=+X v=+Z, sweep -Y, offset moves +Y        (the known asymmetry: model-types.ts NAMED_PLANE_FRAMES)
//   side  sketch: u=+Y v=+Z, sweep +X, offset moves +X
const PI = Math.PI;
const PL = {
  top: { U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1], O: [0, 0, 1] },
  front: { U: [1, 0, 0], V: [0, 0, 1], N: [0, -1, 0], O: [0, 1, 0] },
  side: { U: [0, 1, 0], V: [0, 0, 1], N: [1, 0, 0], O: [1, 0, 0] },
};
const add = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, k) => a.map((x) => x * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(...a);
// world point of plane coords (u, v, n); `fr` is a PL entry or {U,V,N,O:[0,0,0]-ish origin} with off a scalar along O
const W = (fr, off, u, v, n) => add(add(add(mul(fr.O, off), mul(fr.U, u)), mul(fr.V, v)), mul(fr.N, n));
const frame = (pl) => (typeof pl === 'string' ? PL[pl] : pl);

// ---- 2-D profiles: {area, cen:[u,v], bb:[u0,v0,u1,v1]} -----------------------------------------------------------------------
const R = (u0, v0, u1, v1) => ({ area: (u1 - u0) * (v1 - v0), cen: [(u0 + u1) / 2, (v0 + v1) / 2], bb: [u0, v0, u1, v1] });
const Cc = (cu, cv, d) => ({ area: PI * d * d / 4, cen: [cu, cv], bb: [cu - d / 2, cv - d / 2, cu + d / 2, cv + d / 2] });
function P(pts) {
  let a2 = 0; let cx = 0; let cy = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; const c = p[0] * q[1] - q[0] * p[1]; a2 += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; });
  const sg = a2 < 0 ? -1 : 1;
  return { area: Math.abs(a2) / 2, cen: [cx / (3 * a2), cy / (3 * a2)], bb: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))], pts, sg };
}
const minus = (A, B) => { const a = A.area - B.area; return { area: a, cen: [(A.area * A.cen[0] - B.area * B.cen[0]) / a, (A.area * A.cen[1] - B.area * B.cen[1]) / a], bb: A.bb }; };
const plus = (A, B) => { const a = A.area + B.area; return { area: a, cen: [(A.area * A.cen[0] + B.area * B.cen[0]) / a, (A.area * A.cen[1] + B.area * B.cen[1]) / a], bb: [Math.min(A.bb[0], B.bb[0]), Math.min(A.bb[1], B.bb[1]), Math.max(A.bb[2], B.bb[2]), Math.max(A.bb[3], B.bb[3])] }; };

// ---- solids: {volume, com, bbox} ---------------------------------------------------------------------------------------------
const bboxOf = (pts) => [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))).concat([0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))));
/** straight prism of `prof` placed on plane `pl` at offset `off`, spanning plane-normal coordinates n0..n1 */
function prism(pl, off, prof, n0, n1) {
  const fr = frame(pl); const [u0, v0, u1, v1] = prof.bb;
  const corners = [];
  for (const u of [u0, u1]) for (const v of [v0, v1]) for (const n of [n0, n1]) corners.push(W(fr, off, u, v, n));
  return { volume: prof.area * (n1 - n0), com: W(fr, off, prof.cen[0], prof.cen[1], (n0 + n1) / 2), bbox: bboxOf(corners) };
}
/** sheared prism: the profile placed at plane coordinate n=0 displaced by `start`, swept by the world vector S */
function sheared(pl, off, prof, start, S) {
  const fr = frame(pl); const [u0, v0, u1, v1] = prof.bb;
  const corners = [];
  for (const u of [u0, u1]) for (const v of [v0, v1]) for (const k of [0, 1]) corners.push(add(add(W(fr, off, u, v, 0), start), mul(S, k)));
  const sn = Math.abs(dot(S, fr.N));
  return { volume: prof.area * sn, com: add(add(W(fr, off, prof.cen[0], prof.cen[1], 0), start), mul(S, 0.5)), bbox: bboxOf(corners) };
}
const box = (x0, y0, z0, x1, y1, z1) => ({ volume: (x1 - x0) * (y1 - y0) * (z1 - z0), com: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], bbox: [x0, y0, z0, x1, y1, z1] });
const sub = (b, c) => { const v = b.volume - c.volume; return { volume: v, com: b.com.map((x, i) => (b.volume * x - c.volume * c.com[i]) / v), bbox: b.bbox }; };
const uni = (a, b) => { const v = a.volume + b.volume; return { volume: v, com: a.com.map((x, i) => (a.volume * x + b.volume * b.com[i]) / v), bbox: [0, 1, 2].map((i) => Math.min(a.bbox[i], b.bbox[i])).concat([0, 1, 2].map((i) => Math.max(a.bbox[i + 3], b.bbox[i + 3]))) }; };
const clip = (n0, n1, lo, hi) => [Math.max(n0, lo), Math.min(n1, hi)];

/** a tapered prism: profAt(d) is the profile after the walls have moved outward by d; d = t*tan(taper), t = 0..L along the sweep sgn*N.
 *  Simpson's rule is EXACT here: the area is quadratic in d and the moments are at most cubic in t. */
function tapered(pl, off, profAt, L, deg, sgn = 1) {
  const fr = frame(pl); const tn = Math.tan(deg * PI / 180);
  const st = (t) => { const p = profAt(t * tn); return { A: p.area, mu: p.area * p.cen[0], mv: p.area * p.cen[1], t, p }; };
  const s0 = st(0); const sm = st(L / 2); const s1 = st(L);
  const simp = (f) => L / 6 * (f(s0) + 4 * f(sm) + f(s1));
  const V = simp((s) => s.A);
  const u = simp((s) => s.mu) / V; const v = simp((s) => s.mv) / V; const t = simp((s) => s.t * s.A) / V;
  const corners = [];
  for (const [p, n] of [[s0.p, 0], [s1.p, sgn * L]]) for (const uu of [p.bb[0], p.bb[2]]) for (const vv of [p.bb[1], p.bb[3]]) corners.push(W(fr, off, uu, vv, n));
  return { volume: V, com: W(fr, off, u, v, sgn * t), bbox: bboxOf(corners) };
}
/** mitre offset of a closed polygon by d (positive outward): line offset + intersection, independent of every kernel */
function offsetPoly(pts, d) {
  const n = pts.length;
  let a2 = 0; for (let i = 0; i < n; i++) { const p = pts[i]; const q = pts[(i + 1) % n]; a2 += p[0] * q[1] - q[0] * p[1]; }
  const sg = a2 > 0 ? 1 : -1;
  const lines = pts.map((p, i) => { const q = pts[(i + 1) % n]; const dx = q[0] - p[0]; const dy = q[1] - p[1]; const l = Math.hypot(dx, dy); return { p: [p[0] + sg * dy / l * d, p[1] - sg * dx / l * d], dir: [dx / l, dy / l] }; });
  return pts.map((_, i) => {
    const A = lines[(i + n - 1) % n]; const B = lines[i];
    const den = A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0];
    const t = ((B.p[0] - A.p[0]) * B.dir[1] - (B.p[1] - A.p[1]) * B.dir[0]) / den;
    return [A.p[0] + A.dir[0] * t, A.p[1] + A.dir[1] * t];
  });
}

// ---- case builders -----------------------------------------------------------------------------------------------------------
const sketchCall = (pl, off) => `sketch('${pl}'${off ? `, ${off}` : ''})`;
const optsStr = (o) => (o && Object.keys(o).length ? `, ${JSON.stringify(o).replace(/"([a-zA-Z0-9]+)":/g, '$1: ')}` : '');
export const CASES = [];
const add_ = (c) => CASES.push(c);

/** pull on a sketch: nr = [n0,n1] plane-normal range the solid should span (hand-derived per case, not from a formula) */
function pull({ id, feature, plane = 'top', off = 0, draw, prof, h, o, nr, curved, fc, note, analytic }) {
  add_({
    id, feature, curved, fc, note,
    script: `const sk = ${sketchCall(plane, off)}; ${draw} const part = pull(sk, ${h}${optsStr(o)});`,
    analytic: analytic ?? (nr ? () => prism(plane, off, prof, nr[0], nr[1]) : undefined),
  });
}
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = pull(s1, 10);";
const PLATEBOX = box(0, 0, 0, 40, 30, 10);
const bodyN = (pl, off, b) => (pl === 'top' ? [b[2] - off, b[5] - off] : pl === 'front' ? [off - b[4], off - b[1]] : [b[0] - off, b[3] - off]);
/** pocket into the 40x30x10 plate (or `base`): nr = the tool's n-range from the sketch plane; the tool is clipped to the body */
function pocket({ id, feature, plane = 'top', off = 10, draw, prof, depth, o, nr, base = PLATE, baseSolid = PLATEBOX, bodyBox = [0, 0, 0, 40, 30, 10], curved, fc, note, analytic, tail = '' }) {
  add_({
    id, feature, curved, fc, note,
    script: `${base} const sk = ${sketchCall(plane, off)}; ${draw} const cut = pocket(sk, plate, ${depth}${optsStr(o)});${tail}`,
    analytic: analytic ?? (nr ? () => {
      const [a, b] = clip(nr[0], nr[1], ...bodyN(plane, off, bodyBox));
      return b > a ? sub(baseSolid, prism(plane, off, prof, a, b)) : baseSolid;
    } : undefined),
  });
}

// ================================================================================================================================
// pull(sketch,height) / extrude                                                                  feature key: 'pull'
// ================================================================================================================================
const F_PULL = 'pull(sketch,height) / extrude: ExtrudeFeature height (negative allowed, pulls the other way); sweep direction = sketch normal u x v (xy +Z, xz -Y, yz +X)';
const F_DEFAULT = "default sketch: an untouched sketch() is a 40 x 25 rectangle, so pull(sketch('top'),10) builds 10000 mm3";
const F_MID = 'pull option {midplane:true}: same length either side of the sketch plane';
const F_L2 = 'pull option {length2:n>0}: second length the other way (mutually exclusive with midplane)';
const F_REV = 'pull option {reversed:true}: flip the sweep direction';
const F_TAPER = 'pull option {taper:deg}: draft angle on the sides, -90 < taper < 90, 0 dropped';
const F_DIR = 'pull option {direction:[x,y,z]}: oblique sweep (non-zero vector); with {alongNormal:false} (only legal together with direction): length is measured along the direction rather than the normal';
const F_POCKET = 'pocket(sketch,target,depth): PocketFeature target/into, depth>0, subtractive extrude into the named shape';
const F_PADJ = 'pad = join(base, pull(sketch,h)): union of a base and a plain pull (recognised as a pad by the interpreter)';
const F_SOUP = 'pocket/pull where the sketch is a multi-loop soup: nested loops are holes by the even-odd rule, shapes side by side are separate pieces, crossing or touching shapes refused';
const PO = (name) => `pocket options: ${name}`;
export const FEATURES = { F_PULL, F_DEFAULT, F_MID, F_L2, F_REV, F_TAPER, F_DIR, F_POCKET, F_PADJ, F_SOUP };

// ---- default sketch
add_({ id: 'def-top', feature: F_DEFAULT, script: "const a = pull(sketch('top'),10);", analytic: () => prism('top', 0, R(0, 0, 40, 25), 0, 10) });
add_({ id: 'def-front', feature: F_DEFAULT, script: "const a = pull(sketch('front'),10);", analytic: () => prism('front', 0, R(0, 0, 40, 25), 0, 10) });
add_({ id: 'def-side', feature: F_DEFAULT, script: "const a = pull(sketch('side'),10);", analytic: () => prism('side', 0, R(0, 0, 40, 25), 0, 10) });
add_({ id: 'def-extrude-alias', feature: F_DEFAULT, script: "const a = extrude(sketch('top'),10);", analytic: () => prism('top', 0, R(0, 0, 40, 25), 0, 10) });

// ---- plain pull, sweep direction per plane, negative height
pull({ id: 'pp-top-offset', feature: F_PULL, off: 7, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: 12, nr: [0, 12] });
pull({ id: 'pp-front-offset', feature: F_PULL, plane: 'front', off: 5, draw: 'sk.rect(40, 30, { at: [20, 15] });', prof: R(0, 0, 40, 30), h: 10, nr: [0, 10], note: 'front sweeps -Y while its offset moves +Y: y spans -5..5' });
pull({ id: 'pp-side-L', feature: F_PULL, plane: 'side', draw: 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', prof: P([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), h: 12, nr: [0, 12] });
pull({ id: 'pp-neg-top', feature: F_PULL, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: -7, nr: [-7, 0] });
pull({ id: 'pp-neg-front', feature: F_PULL, plane: 'front', draw: 'sk.rect(40, 30, { at: [20, 15] });', prof: R(0, 0, 40, 30), h: -7, nr: [-7, 0] });
pull({ id: 'pp-neg-side', feature: F_PULL, plane: 'side', draw: 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', prof: P([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), h: -6, nr: [-6, 0] });
pull({ id: 'pp-circle', feature: F_PULL, draw: 'sk.circle(18, { at: [10, -20] });', prof: Cc(10, -20, 18), h: 25, nr: [0, 25], curved: true });
pull({ id: 'pp-circle-front-neg', feature: F_PULL, plane: 'front', off: 3, draw: 'sk.circle(18, { at: [10, 20] });', prof: Cc(10, 20, 18), h: -25, nr: [-25, 0], curved: true });
{
  // rect 40 x 25 with corner index 2 (the point [40,0]) rounded r=5: the removed corner is (square - quarter disc)
  const r = 5; const sqA = r * r; const qA = PI * r * r / 4; const qc = 4 * r / (3 * PI);
  const remA = sqA - qA; const remC = [(sqA * 37.5 - qA * (35 + qc)) / remA, (sqA * 2.5 - qA * (5 - qc)) / remA];
  const full = R(0, 0, 40, 25);
  pull({ id: 'pp-arc-outline', feature: F_PULL, draw: "sk.polygon([[0,0],[40,0],[40,25],[0,25]]); sk.round(2, 5);", prof: { area: full.area - remA, cen: [(full.area * 20 - remA * remC[0]) / (full.area - remA), (full.area * 12.5 - remA * remC[1]) / (full.area - remA)], bb: full.bb }, h: 10, nr: [0, 10], curved: true, note: 'one corner rounded r=5' });
}
add_({ id: 'pp-frame', feature: F_PULL, script: "const sk = sketch({ origin: [0, 0, 3], u: [0, 1, 0], v: [1, 0, 0] }); sk.rect(20, 10, { at: [10, 5] }); const part = pull(sk, 8);", note: 'framed sketch: normal u x v = -Z, so the pull goes DOWN from z=3',
  analytic: () => ({ volume: 1600, bbox: [0, 0, -5, 10, 20, 3], com: [5, 10, -1] }) });
pull({ id: 'pp-thin-plate', feature: F_PULL, draw: 'sk.rect(200, 120);', prof: R(-100, -60, 100, 60), h: 1.5, nr: [0, 1.5] });
pull({ id: 'pp-slender-post', feature: F_PULL, draw: 'sk.rect(4, 4, { at: [5, -6] });', prof: R(3, -8, 7, -4), h: 120, nr: [0, 120] });
add_({ id: 'pp-zero-height', feature: F_PULL, script: "const sk = sketch('top'); sk.rect(10, 10); const part = pull(sk, 0);", note: 'height 0: nothing to build (brep-rs refuses)' });

// ---- midplane
pull({ id: 'pm-top', feature: F_MID, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: 10, o: { midplane: true }, nr: [-5, 5] });
pull({ id: 'pm-front-offset', feature: F_MID, plane: 'front', off: 5, draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: R(0, 0, 20, 10), h: 16, o: { midplane: true }, nr: [-8, 8] });
pull({ id: 'pm-side-L', feature: F_MID, plane: 'side', draw: 'sk.polygon([[0,0],[20,0],[20,6],[6,6],[6,18],[0,18]]);', prof: P([[0, 0], [20, 0], [20, 6], [6, 6], [6, 18], [0, 18]]), h: 7, o: { midplane: true }, nr: [-3.5, 3.5] });
pull({ id: 'pm-circle', feature: F_MID, draw: 'sk.circle(24);', prof: Cc(0, 0, 24), h: 3, o: { midplane: true }, nr: [-1.5, 1.5], curved: true });
pull({ id: 'pm-offset-plane', feature: F_MID, off: 12, draw: 'sk.rect(30, 20, { at: [15, 10] });', prof: R(0, 0, 30, 20), h: 8, o: { midplane: true }, nr: [-4, 4] });
pull({ id: 'pm-neg-height', feature: F_MID, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: -10, o: { midplane: true }, nr: [-5, 5], note: 'a negative height is the same length: still centred' });
pull({ id: 'pm-long-slab', feature: F_MID, draw: 'sk.rect(2, 50, { at: [1, 25] });', prof: R(0, 0, 2, 50), h: 60, o: { midplane: true }, nr: [-30, 30] });

// ---- length2 (second length the other way)
pull({ id: 'pl-top', feature: F_L2, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: 10, o: { length2: 4 }, nr: [-4, 10] });
pull({ id: 'pl-front', feature: F_L2, plane: 'front', off: 2, draw: 'sk.rect(40, 30, { at: [20, 15] });', prof: R(0, 0, 40, 30), h: 10, o: { length2: 6 }, nr: [-6, 10] });
pull({ id: 'pl-side-L', feature: F_L2, plane: 'side', draw: 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', prof: P([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), h: 12, o: { length2: 5 }, nr: [-5, 12] });
pull({ id: 'pl-reversed', feature: F_L2, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: 10, o: { length2: 4, reversed: true }, nr: [-10, 4], note: 'reversed + length2: 10 down, 4 up' });
pull({ id: 'pl-neg-height', feature: F_L2, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: -10, o: { length2: 4 }, nr: [-10, 4], note: 'negative height + length2: 10 down, 4 up' });
pull({ id: 'pl-circle', feature: F_L2, draw: 'sk.circle(18, { at: [10, -20] });', prof: Cc(10, -20, 18), h: 9, o: { length2: 3 }, nr: [-3, 9], curved: true });
add_({ id: 'pl-both-midplane', feature: F_L2, script: "const sk = sketch('top'); sk.rect(10, 10); const part = pull(sk, 10, { midplane: true, length2: 3 });", note: 'midplane and length2 together: the interpreter refuses' });
add_({ id: 'pl-zero-length2', feature: F_L2, script: "const sk = sketch('top'); sk.rect(10, 10); const part = pull(sk, 10, { length2: 0 });", note: 'length2 must be positive: the interpreter refuses' });

// ---- reversed
pull({ id: 'pr-top', feature: F_REV, draw: 'sk.rect(40, 30, { at: [25, 20] });', prof: R(5, 5, 45, 35), h: 10, o: { reversed: true }, nr: [-10, 0] });
pull({ id: 'pr-front', feature: F_REV, plane: 'front', draw: 'sk.rect(40, 30, { at: [20, 15] });', prof: R(0, 0, 40, 30), h: 10, o: { reversed: true }, nr: [-10, 0], note: 'front reversed sweeps +Y' });
pull({ id: 'pr-side', feature: F_REV, plane: 'side', draw: 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', prof: P([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), h: 12, o: { reversed: true }, nr: [-12, 0] });
pull({ id: 'pr-neg-double', feature: F_REV, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: -10, o: { reversed: true }, nr: [0, 10], note: 'reversed + negative height flips twice: pulls UP' });
pull({ id: 'pr-offset', feature: F_REV, off: 7, draw: 'sk.circle(20, { at: [4, 4] });', prof: Cc(4, 4, 20), h: 6, o: { reversed: true }, nr: [-6, 0], curved: true });
pull({ id: 'pr-false', feature: F_REV, draw: 'sk.rect(30, 20, { at: [5, -3] });', prof: R(-10, -13, 20, 7), h: 10, o: { reversed: false }, nr: [0, 10], note: 'reversed:false is the plain pull' });

// ---- taper
const RECT_TAPER = (u0, v0, u1, v1) => (d) => R(u0 - d, v0 - d, u1 + d, v1 + d);
const polyTaper = (pts) => (d) => P(offsetPoly(pts, d));
function taperPull({ id, plane = 'top', off = 0, draw, profAt, h, deg, o = {}, curved, note, sgn }) {
  add_({
    id, feature: F_TAPER, curved, note,
    script: `const sk = ${sketchCall(plane, off)}; ${draw} const part = pull(sk, ${h}, { taper: ${deg}${Object.entries(o).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join('')} });`,
    analytic: () => tapered(plane, off, profAt, Math.abs(h), deg, sgn ?? (h < 0 ? -1 : 1) * (o.reversed ? -1 : 1)),
  });
}
taperPull({ id: 'pt-rect-pos', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 10, deg: 10 });
taperPull({ id: 'pt-rect-neg', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 10, deg: -10 });
taperPull({ id: 'pt-rect-5', draw: 'sk.rect(40, 25, { at: [20, 12.5] });', profAt: RECT_TAPER(0, 0, 40, 25), h: 15, deg: 5 });
taperPull({ id: 'pt-triangle', draw: 'sk.polygon([[0,0],[30,0],[10,20]]);', profAt: polyTaper([[0, 0], [30, 0], [10, 20]]), h: 12, deg: 8 });
taperPull({ id: 'pt-L-concave', draw: 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', profAt: polyTaper([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), h: 6, deg: 6, note: 'L outline has one reflex corner' });
taperPull({ id: 'pt-front', plane: 'front', off: 4, draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 10, deg: 12 });
taperPull({ id: 'pt-side', plane: 'side', draw: 'sk.polygon([[0,0],[20,0],[20,6],[6,6],[6,18],[0,18]]);', profAt: polyTaper([[0, 0], [20, 0], [20, 6], [6, 6], [6, 18], [0, 18]]), h: 4, deg: -5 });
taperPull({ id: 'pt-neg-height', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: -10, deg: 10, note: 'negative height: grows downward' });
taperPull({ id: 'pt-reversed', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 10, deg: 10, o: { reversed: true } });
taperPull({ id: 'pt-80deg', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 1, deg: 80, note: 'very flat draft' });
taperPull({ id: 'pt-circle-pos', draw: 'sk.circle(20, { at: [10, 6] });', profAt: (d) => Cc(10, 6, 20 + 2 * d), h: 10, deg: 10, curved: true });
taperPull({ id: 'pt-circle-neg', draw: 'sk.circle(20, { at: [10, 6] });', profAt: (d) => Cc(10, 6, 20 + 2 * d), h: 10, deg: -10, curved: true });
taperPull({ id: 'pt-fold', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 10, deg: -45, note: 'walls cross before the end (20x12 shrinks 10 per side): must be refused, never built folded' });
{
  // a rounded outline tapers as an offset curve: the rounded corner's radius grows by d
  const r = 5; const full = (d) => R(-d, -d, 40 + d, 25 + d);
  const remA = (d) => (1 - PI / 4) * (r + d) ** 2;
  taperPull({ id: 'pt-arc-outline', draw: "sk.polygon([[0,0],[40,0],[40,25],[0,25]]); sk.round(2, 5);", profAt: (d) => { const f = full(d); const a = remA(d); const q = (r + d); const qc = 4 * q / (3 * PI); const sq = q * q; const qA = PI * q * q / 4; const cx0 = 40 + d - q / 2; const cy0 = -d + q / 2; const rc = [(sq * cx0 - qA * (40 + d - q + qc)) / a, (sq * cy0 - qA * (-d + q - qc)) / a]; return { area: f.area - a, cen: [(f.area * f.cen[0] - a * rc[0]) / (f.area - a), (f.area * f.cen[1] - a * rc[1]) / (f.area - a)], bb: f.bb }; }, h: 10, deg: 5, curved: true, note: 'one rounded corner; offset curve semantics' });
}
taperPull({ id: 'pt-ring', draw: 'sk.circle(40); sk.circle(20);', profAt: (d) => minus(Cc(0, 0, 40 + 2 * d), Cc(0, 0, 20 - 2 * d)), h: 10, deg: 5, curved: true, note: 'annulus: outer wall grows, hole shrinks (every wall leans the same way)' });
add_({ id: 'pt-midplane', feature: F_TAPER, script: "const sk = sketch('top'); sk.rect(20, 12); const part = pull(sk, 10, { taper: 10, midplane: true });", note: 'taper + midplane: no oracle builds it (brep-rs refuses)' });
add_({ id: 'pt-length2', feature: F_TAPER, script: "const sk = sketch('top'); sk.rect(20, 12); const part = pull(sk, 10, { taper: 10, length2: 4 });", note: 'taper + length2: no oracle builds it (brep-rs refuses)' });
add_({ id: 'pt-90', feature: F_TAPER, script: "const sk = sketch('top'); sk.rect(20, 12); const part = pull(sk, 10, { taper: 90 });", note: 'taper 90: the interpreter refuses' });
add_({ id: 'pt-zero', feature: F_TAPER, script: "const sk = sketch('top'); sk.rect(20, 12, { at: [10, 6] }); const part = pull(sk, 10, { taper: 0 });", note: 'taper 0 is dropped: the plain pull', analytic: () => prism('top', 0, R(0, 0, 20, 12), 0, 10) });

// ---- direction (oblique) / alongNormal
function slantPull({ id, plane = 'top', off = 0, draw, prof, h, dir, o = {}, an, curved, note }) {
  add_({
    id, feature: F_DIR, curved, note,
    script: `const sk = ${sketchCall(plane, off)}; ${draw} const part = pull(sk, ${h}, { direction: [${dir.join(', ')}]${Object.entries(o).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join('')} });`,
    analytic: an,
  });
}
const RECT20x10 = R(0, 0, 20, 10);
const dh = (v) => mul(v, 1 / len3(v));
slantPull({ id: 'pd-45-normal', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, 0, 1], an: () => sheared('top', 0, RECT20x10, [0, 0, 0], [10, 0, 10]), note: 'height measured along the normal: the sweep reaches x+10 at z=10' });
slantPull({ id: 'pd-45-along', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, 0, 1], o: { alongNormal: false }, an: () => sheared('top', 0, RECT20x10, [0, 0, 0], mul(dh([1, 0, 1]), 10)), note: 'length 10 measured ALONG the direction' });
slantPull({ id: 'pd-30deg-y', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 8, dir: [0, 1, 2], an: () => sheared('top', 0, RECT20x10, [0, 0, 0], [0, 4, 8]) });
slantPull({ id: 'pd-triangle', draw: 'sk.polygon([[0,0],[30,0],[10,20]]);', prof: P([[0, 0], [30, 0], [10, 20]]), h: 12, dir: [1, 1, 3], an: () => sheared('top', 0, P([[0, 0], [30, 0], [10, 20]]), [0, 0, 0], [4, 4, 12]) });
slantPull({ id: 'pd-L-concave', draw: 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', prof: P([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), h: 6, dir: [-1, 0, 2], an: () => sheared('top', 0, P([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), [0, 0, 0], [-3, 0, 6]) });
slantPull({ id: 'pd-front', plane: 'front', off: 2, draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, -2, 1], an: () => sheared('front', 2, RECT20x10, [0, 0, 0], [5, -10, 5]), note: 'front: sweep -Y; direction [1,-2,1] has the normal component -2 so 10 along the normal is 5 x the vector' });
slantPull({ id: 'pd-side', plane: 'side', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 6, dir: [3, 2, 0], an: () => sheared('side', 0, RECT20x10, [0, 0, 0], [6, 4, 0]) });
slantPull({ id: 'pd-neg-height', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: -10, dir: [1, 0, 1], an: () => sheared('top', 0, RECT20x10, [0, 0, 0], [-10, 0, -10]), note: 'negative height reverses the sweep along the direction' });
slantPull({ id: 'pd-reversed', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, 0, 1], o: { reversed: true }, an: () => sheared('top', 0, RECT20x10, [0, 0, 0], [-10, 0, -10]) });
slantPull({ id: 'pd-midplane', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, 0, 1], o: { midplane: true }, an: () => sheared('top', 0, RECT20x10, [-5, 0, -5], [10, 0, 10]), note: 'centred on the sketch plane along the sweep' });
slantPull({ id: 'pd-length2', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, 0, 1], o: { length2: 4 }, an: () => sheared('top', 0, RECT20x10, [-4, 0, -4], [14, 0, 14]), note: 'span 14 along the normal, starting 4 behind' });
slantPull({ id: 'pd-parallel-down', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [0, 0, -1], an: () => prism('top', 0, RECT20x10, -10, 0), note: 'a direction along the normal but pointing against it is the plain pull, swept the other way' });
slantPull({ id: 'pd-parallel-up', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [0, 0, 5], an: () => prism('top', 0, RECT20x10, 0, 10) });
slantPull({ id: 'pd-in-plane', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, 0, 0], note: 'a direction lying in the sketch plane never leaves the profile: must be refused' });
slantPull({ id: 'pd-circle', draw: 'sk.circle(10, { at: [5, 5] });', prof: Cc(5, 5, 10), h: 10, dir: [1, 0, 1], curved: true, an: () => sheared('top', 0, Cc(5, 5, 10), [0, 0, 0], [10, 0, 10]), note: 'a slanted cylinder' });
slantPull({ id: 'pd-arc-outline', draw: "sk.polygon([[0,0],[40,0],[40,25],[0,25]]); sk.round(2, 5);", prof: R(0, 0, 40, 25), h: 10, dir: [1, 0, 1], curved: true, note: 'outline with an arc in it' });
add_({ id: 'pd-alongnormal-alone', feature: F_DIR, script: "const sk = sketch('top'); sk.rect(10, 10); const part = pull(sk, 10, { alongNormal: false });", note: 'alongNormal without a direction: the interpreter refuses' });
add_({ id: 'pd-zero-vector', feature: F_DIR, script: "const sk = sketch('top'); sk.rect(10, 10); const part = pull(sk, 10, { direction: [0, 0, 0] });", note: 'direction [0,0,0]: the interpreter refuses' });
slantPull({ id: 'pd-with-taper', draw: 'sk.rect(20, 10, { at: [10, 5] });', prof: RECT20x10, h: 10, dir: [1, 0, 1], o: { taper: 5 }, note: 'taper and direction together: no oracle builds it (brep-rs refuses)' });

// ================================================================================================================================
// pocket                                                                                      feature key: 'pocket'
// ================================================================================================================================
pocket({ id: 'kp-top-rect', feature: F_POCKET, draw: 'sk.rect(8, 6, { at: [30, 8] });', prof: R(26, 5, 34, 11), depth: 4, nr: [-4, 0] });
pocket({ id: 'kp-top-circle', feature: F_POCKET, draw: 'sk.circle(8, { at: [12, 20] });', prof: Cc(12, 20, 8), depth: 9.5, nr: [-9.5, 0], curved: true, note: '0.5 floor' });
pocket({ id: 'kp-front-face', feature: F_POCKET, plane: 'front', off: 0, draw: 'sk.circle(8, { at: [20, 5] });', prof: Cc(20, 5, 8), depth: 8, nr: [-8, 0], curved: true, note: 'from the y=0 face; the cut runs +Y' });
pocket({ id: 'kp-side-face', feature: F_POCKET, plane: 'side', off: 40, draw: 'sk.rect(12, 6, { at: [14, 5] });', prof: R(8, 2, 20, 8), depth: 6, nr: [-6, 0], note: 'from the x=40 face; the cut runs -X' });
pocket({ id: 'kp-bottom-face', feature: F_POCKET, off: 0, plane: 'top', draw: 'sk.circle(12, { at: [10, 12] });', prof: Cc(10, 12, 12), depth: 4, nr: [0, 0], curved: true, note: 'a top sketch at z=0 pocket cuts DOWN (out of the plate): nothing is removed',
  analytic: () => PLATEBOX });
add_({ id: 'kp-bottom-frame', feature: F_POCKET, script: `${PLATE} const sk = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, -1, 0] }); sk.circle(12, { at: [10, -12] }); const cut = pocket(sk, plate, 4);`, curved: true, note: 'pocket from the bottom face through a framed sketch with normal -Z',
  analytic: () => sub(PLATEBOX, prism({ U: [1, 0, 0], V: [0, -1, 0], N: [0, 0, -1], O: [0, 0, 1] }, 0, Cc(10, -12, 12), -4, 0)) });
pocket({ id: 'kp-eq-thickness', feature: F_POCKET, draw: 'sk.rect(8, 6, { at: [30, 8] });', prof: R(26, 5, 34, 11), depth: 10, nr: [-10, 0], note: 'depth equals the thickness: a hole all the way' });
pocket({ id: 'kp-deeper-than-part', feature: F_POCKET, draw: 'sk.circle(10, { at: [20, 15] });', prof: Cc(20, 15, 10), depth: 50, nr: [-50, 0], curved: true });
pocket({ id: 'kp-runs-off-side', feature: F_POCKET, draw: 'sk.rect(10, 6, { at: [40, 15] });', prof: R(35, 12, 40, 18), depth: 4, nr: [-4, 0], note: 'the sketch reaches 5 mm past the x=40 side; only 5 x 6 is inside', analytic: () => sub(PLATEBOX, prism('top', 10, R(35, 12, 40, 18), -4, 0)) });
pocket({ id: 'kp-in-air', feature: F_POCKET, off: 15, draw: 'sk.rect(8, 6, { at: [30, 8] });', prof: R(26, 5, 34, 11), depth: 3, nr: [-3, 0], note: 'sketch 5 above the plate, depth 3: the tool never reaches the plate' });
pocket({ id: 'kp-two-sequential', feature: F_POCKET, draw: 'sk.rect(8, 6, { at: [10, 8] });', prof: R(6, 5, 14, 11), depth: 4, tail: " const sk2 = sketch('top', 10); sk2.circle(8, { at: [30, 20] }); const cut2 = pocket(sk2, cut, 3);", curved: true,
  analytic: () => sub(sub(PLATEBOX, prism('top', 10, R(6, 5, 14, 11), -4, 0)), prism('top', 10, Cc(30, 20, 8), -3, 0)), note: 'the second pocket names the first pocket (its head)' });
add_({ id: 'kp-on-cylinder', feature: F_POCKET, script: "const c = cylinder(30, 20, { at: [0, 0, 10] }); const sk = sketch('top', 20); sk.circle(6, { at: [4, 0] }); const cut = pocket(sk, c, 5);", curved: true,
  analytic: () => sub({ volume: PI * 225 * 20, com: [0, 0, 10], bbox: [-15, -15, 0, 15, 15, 20] }, prism('top', 20, Cc(4, 0, 6), -5, 0)), note: 'a bore from the top of a cylinder' });
add_({ id: 'kp-on-holed-plate', feature: F_POCKET, script: "const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] }); s1.circle(10, { at: [20, 15] }); const plate = pull(s1, 10); const sk = sketch('top', 10); sk.rect(8, 6, { at: [8, 15] }); const cut = pocket(sk, plate, 4);", curved: true,
  analytic: () => sub(sub(box(0, 0, 0, 40, 30, 10), prism('top', 0, Cc(20, 15, 10), 0, 10)), prism('top', 10, R(4, 12, 12, 18), -4, 0)), note: 'pocket into a plate that already has a hole (soup base)' });

// ---- through
pocket({ id: 'kt-top-circle', feature: PO('through:true (cut all the way)'), draw: 'sk.circle(12, { at: [30, 10] });', prof: Cc(30, 10, 12), depth: 10, o: { through: true }, nr: [-1e6, 0], curved: true });
pocket({ id: 'kt-slot', feature: PO('through:true (cut all the way)'), draw: 'sk.rect(36, 4, { at: [20, 15] });', prof: R(2, 13, 38, 17), depth: 10, o: { through: true }, nr: [-1e6, 0] });
pocket({ id: 'kt-front', feature: PO('through:true (cut all the way)'), plane: 'front', off: 0, draw: 'sk.circle(6, { at: [20, 5] });', prof: Cc(20, 5, 6), depth: 30, o: { through: true }, nr: [-1e6, 0], curved: true });
pocket({ id: 'kt-side', feature: PO('through:true (cut all the way)'), plane: 'side', off: 40, draw: 'sk.circle(6, { at: [15, 5] });', prof: Cc(15, 5, 6), depth: 40, o: { through: true }, nr: [-1e6, 0], curved: true });
pocket({ id: 'kt-depth-small', feature: PO('through:true (cut all the way)'), draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 1, o: { through: true }, nr: [-1e6, 0], note: 'depth stays stored but through wins' });
pocket({ id: 'kt-mid-sketch', feature: PO('through:true (cut all the way)'), off: 5, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 2, o: { through: true }, nr: [-1e6, 0], note: 'sketch halfway into the plate: through cuts DOWN only, leaving the upper half intact' });
pocket({ id: 'kt-triangle-thick', feature: PO('through:true (cut all the way)'), base: "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = pull(s1, 25);", baseSolid: box(0, 0, 0, 40, 30, 25), bodyBox: [0, 0, 0, 40, 30, 25], off: 25, draw: 'sk.polygon([[5,5],[30,5],[5,25]]);', prof: P([[5, 5], [30, 5], [5, 25]]), depth: 25, o: { through: true }, nr: [-1e6, 0] });
pocket({ id: 'kt-crossing-hole', feature: PO('through:true (cut all the way)'), base: "const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] }); s1.circle(8, { at: [20, 15] }); const plate = pull(s1, 10);", baseSolid: sub(box(0, 0, 0, 40, 30, 10), prism('top', 0, Cc(20, 15, 8), 0, 10)), draw: 'sk.circle(10, { at: [24, 15] });', prof: Cc(24, 15, 10), depth: 10, o: { through: true }, curved: true,
  analytic: undefined,
  note: 'second hole overlaps the first (lens overlap): closed form left to the oracles' });
pocket({ id: 'kt-through-reversed', feature: PO('through:true (cut all the way)'), off: 5, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 2, o: { through: true, reversed: true }, nr: [0, 1e6], note: 'through + reversed from the mid plane: cuts UP' });
pocket({ id: 'kt-through-midplane', feature: PO('through:true (cut all the way)'), off: 5, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 2, o: { through: true, midplane: true }, note: 'through + midplane together: ambiguous (brep-rs lets midplane win with a half-far length)' });

// ---- reversed
pocket({ id: 'kr-mid', feature: PO('reversed:true'), off: 5, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 3, o: { reversed: true }, nr: [0, 3] });
pocket({ id: 'kr-top-air', feature: PO('reversed:true'), draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 3, o: { reversed: true }, nr: [0, 3], note: 'reversed from the top face cuts air: the plate is unchanged' });
pocket({ id: 'kr-bottom', feature: PO('reversed:true'), off: 0, draw: 'sk.circle(10, { at: [20, 15] });', prof: Cc(20, 15, 10), depth: 4, o: { reversed: true }, nr: [0, 4], curved: true, note: 'a z=0 sketch reversed cuts UP into the plate' });
pocket({ id: 'kr-front-mid', feature: PO('reversed:true'), plane: 'front', off: 12, draw: 'sk.circle(6, { at: [20, 5] });', prof: Cc(20, 5, 6), depth: 5, o: { reversed: true }, nr: [0, 5], curved: true, note: 'front sketch at y=12, reversed: cuts toward -Y (y 7..12)' });
pocket({ id: 'kr-false', feature: PO('reversed:true'), draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 3, o: { reversed: false }, nr: [-3, 0] });

// ---- midplane
pocket({ id: 'km-mid', feature: PO('midplane'), off: 5, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 4, o: { midplane: true }, nr: [-2, 2] });
pocket({ id: 'km-top', feature: PO('midplane'), draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 4, o: { midplane: true }, nr: [-2, 2], note: 'on the top face half the tool is in air' });
pocket({ id: 'km-front', feature: PO('midplane'), plane: 'front', off: 15, draw: 'sk.circle(6, { at: [20, 5] });', prof: Cc(20, 5, 6), depth: 10, o: { midplane: true }, nr: [-5, 5], curved: true });
pocket({ id: 'km-through-the-body', feature: PO('midplane'), off: 5, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 40, o: { midplane: true }, nr: [-20, 20], note: 'a tool longer than the plate both ways: a through cut' });

// ---- length2
pocket({ id: 'kl-top', feature: PO('length2'), draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 4, o: { length2: 3 }, nr: [-4, 3], note: 'on the top face the second length is out of the mouth: only 4 is in the plate' });
pocket({ id: 'kl-mid', feature: PO('length2'), off: 5, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 4, o: { length2: 3 }, nr: [-4, 3] });
pocket({ id: 'kl-reversed', feature: PO('length2'), off: 5, draw: 'sk.circle(6, { at: [20, 15] });', prof: Cc(20, 15, 6), depth: 4, o: { length2: 3, reversed: true }, nr: [-3, 4], curved: true });
pocket({ id: 'kl-front', feature: PO('length2'), plane: 'front', off: 10, draw: 'sk.rect(8, 6, { at: [20, 5] });', prof: R(16, 2, 24, 8), depth: 6, o: { length2: 2 }, nr: [-6, 2] });

// ---- taper
const potap = (id, deg, o = {}, extra = {}) => {
  const rectAt = (d) => R(16 - d, 12 - d, 24 + d, 18 + d);
  add_({
    id, feature: PO('taper'), note: extra.note,
    script: `${PLATE} const sk = sketch('top', 10); sk.rect(8, 6, { at: [20, 15] }); const cut = pocket(sk, plate, ${extra.depth ?? 5}, { taper: ${deg}${Object.entries(o).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join('')} });`,
    analytic: extra.noAnalytic ? undefined : () => sub(PLATEBOX, tapered('top', 10, rectAt, extra.len ?? Math.min(extra.depth ?? 5, 10), deg, -1)),
  });
};
potap('kk-pos', 10);
potap('kk-neg', -10);
potap('kk-deep', 5, {}, { depth: 10 });
potap('kk-through', 10, { through: true }, { depth: 3, len: 10, note: 'through + taper: the tool keeps widening to the bottom face' });
potap('kk-fold', -45, {}, { depth: 8, noAnalytic: true, note: '8x... walls cross: must be refused (no built answer)' });
potap('kk-midplane', 10, { midplane: true }, { noAnalytic: true, note: 'taper + midplane: no oracle builds it' });
add_({ id: 'kk-circle', feature: PO('taper'), script: `${PLATE} const sk = sketch('top', 10); sk.circle(8, { at: [20, 15] }); const cut = pocket(sk, plate, 6, { taper: 8 });`, curved: true,
  analytic: () => sub(PLATEBOX, tapered('top', 10, (d) => Cc(20, 15, 8 + 2 * d), 6, 8, -1)) });

// ---- direction / alongNormal
function podir({ id, feature, dir, o = {}, depth = 5, an, note, curved, draw = 'sk.rect(8, 6, { at: [14, 15] });', off = 10 }) {
  add_({ id, feature, note, curved, script: `${PLATE} const sk = sketch('top', ${off}); ${draw} const cut = pocket(sk, plate, ${depth}, { direction: [${dir.join(', ')}]${Object.entries(o).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join('')} });`, analytic: an });
}
const PR8x6 = R(10, 12, 18, 18);
podir({ id: 'kd-slant', feature: PO('direction'), dir: [1, 0, -1], an: () => sub(PLATEBOX, sheared('top', 10, PR8x6, [0, 0, 0], [5, 0, -5])), note: 'cut travels +X and down: depth 5 along the normal' });
podir({ id: 'kd-slant-y', feature: PO('direction'), dir: [0, -1, -2], depth: 6, an: () => sub(PLATEBOX, sheared('top', 10, PR8x6, [0, 0, 0], [0, -3, -6])) });
podir({ id: 'kd-up-slant', feature: PO('direction'), dir: [1, 0, 1], an: () => PLATEBOX, note: 'the cut travels UP and out of the plate from the top face: nothing is removed (brep-rs follows the vector, no flip)' });
podir({ id: 'kd-along-false', feature: PO('alongNormal'), dir: [1, 0, -1], o: { alongNormal: false }, an: () => sub(PLATEBOX, sheared('top', 10, PR8x6, [0, 0, 0], mul(dh([1, 0, -1]), 5))), note: 'depth 5 measured ALONG the direction' });
podir({ id: 'kd-along-false-steep', feature: PO('alongNormal'), dir: [1, 0, -4], o: { alongNormal: false }, depth: 8, an: () => sub(PLATEBOX, sheared('top', 10, PR8x6, [0, 0, 0], mul(dh([1, 0, -4]), 8))) });
podir({ id: 'kd-parallel-down', feature: PO('direction'), dir: [0, 0, -1], an: () => sub(PLATEBOX, prism('top', 10, PR8x6, -5, 0)), note: 'a direction along the normal, pointing into the plate: the plain pocket' });
podir({ id: 'kd-parallel-up', feature: PO('direction'), dir: [0, 0, 1], an: () => PLATEBOX, note: 'a direction pointing out of the plate from the top face: cuts air' });
podir({ id: 'kd-reversed', feature: PO('direction'), dir: [1, 0, -1], o: { reversed: true }, an: () => PLATEBOX, note: 'reversed slant from the top face: the tool goes up, out of the plate' });
podir({ id: 'kd-midplane', feature: PO('direction'), dir: [1, 0, -1], o: { midplane: true }, off: 5, depth: 4, an: () => sub(PLATEBOX, sheared('top', 5, PR8x6, [-2, 0, 2], [4, 0, -4])), note: 'centred on the sketch plane (z=5) along the slant' });
podir({ id: 'kd-in-plane', feature: PO('direction'), dir: [1, 0, 0], note: 'in the sketch plane: must be refused' });
podir({ id: 'kd-circle', feature: PO('direction'), dir: [1, 0, -1], draw: 'sk.circle(6, { at: [14, 15] });', curved: true, an: () => sub(PLATEBOX, sheared('top', 10, Cc(14, 15, 6), [0, 0, 0], [5, 0, -5])), note: 'a slanted bore (elliptic cylinder)' });

// ================================================================================================================================
// pad = join(base, pull)
// ================================================================================================================================
const padCase = (id, script, an, o = {}) => add_({ id, feature: F_PADJ, script, analytic: an, ...o });
padCase('jp-on-top', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 15] }); const pad = join(plate, pull(s2, 6));`, () => uni(PLATEBOX, prism('top', 10, R(15, 10, 25, 20), 0, 6)));
padCase('jp-overlap-inside', `${PLATE} const s2 = sketch('top', 5); s2.rect(10, 10, { at: [20, 15] }); const pad = join(plate, pull(s2, 3));`, () => PLATEBOX, { note: 'the pulled block sits wholly inside the plate: the union is the plate' });
padCase('jp-half-embedded', `${PLATE} const s2 = sketch('top', 5); s2.rect(10, 10, { at: [20, 15] }); const pad = join(plate, pull(s2, 10));`, () => uni(PLATEBOX, box(15, 10, 10, 25, 20, 15)), { note: 'block from z=5 to 15: 5 mm stand out above the plate' });
padCase('jp-side-face', `${PLATE} const s2 = sketch('side', 40); s2.rect(10, 10, { at: [15, 5] }); const pad = join(plate, pull(s2, 8));`, () => uni(PLATEBOX, prism('side', 40, R(10, 0, 20, 10), 0, 8)), { note: 'a boss pulled +X out of the x=40 face' });
padCase('jp-disjoint', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [60, 15] }); const pad = join(plate, pull(s2, 6));`, () => uni(PLATEBOX, prism('top', 10, R(55, 10, 65, 20), 0, 6)), { note: 'does not touch the plate: two solids' });
padCase('jp-circle-boss', `${PLATE} const s2 = sketch('top', 10); s2.circle(12, { at: [20, 15] }); const pad = join(plate, pull(s2, 8));`, () => uni(PLATEBOX, prism('top', 10, Cc(20, 15, 12), 0, 8)), { curved: true });
padCase('jp-pad-midplane', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 15] }); const pad = join(plate, pull(s2, 8, { midplane: true }));`, () => uni(PLATEBOX, prism('top', 10, R(15, 10, 25, 20), 0, 4)), { note: 'a symmetric block on the top face: 4 stands out' });
padCase('jp-pad-tapered', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 15] }); const pad = join(plate, pull(s2, 8, { taper: 10 }));`, () => uni(PLATEBOX, tapered('top', 10, RECT_TAPER(15, 10, 25, 20), 8, 10, 1)));
padCase('jp-pad-reversed-into', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 15] }); const pad = join(plate, pull(s2, 6, { reversed: true }));`, () => PLATEBOX, { note: 'reversed from the top face goes down into the plate: no change' });
padCase('jp-two-pulls', `${PLATE} const s2 = sketch('top', 10); s2.rect(8, 8, { at: [10, 15] }); const s3 = sketch('top', 10); s3.rect(8, 8, { at: [30, 15] }); const pad = join(plate, pull(s2, 5), pull(s3, 7));`, () => uni(uni(PLATEBOX, prism('top', 10, R(6, 11, 14, 19), 0, 5)), prism('top', 10, R(26, 11, 34, 19), 0, 7)), { note: 'join of three' });

// ================================================================================================================================
// multi-loop soups (script text from docs/replica/freecad/gauntlet/variants/defs.mjs, so the saved FreeCAD result applies)
// ================================================================================================================================
const SK = "const sk = sketch('top'); ";
const soupPull = (id, fc, body, an, o = {}) => add_({ id, feature: F_SOUP, fc, script: `${SK}${body}`, analytic: an, ...o });
soupPull('sp-circle-in-rect', 'pad-basic__circle-in-rect-one-sketch', 'sk.rect(40, 30); sk.circle(10); extrude(sk, 15);', () => ({ volume: (1200 - 25 * PI) * 15 }), { curved: true });
soupPull('sp-rect-in-circle', 'pad-basic__rect-in-circle-one-sketch', 'sk.circle(40); sk.rect(10, 10); extrude(sk, 15);', () => ({ volume: (400 * PI - 100) * 15 }), { curved: true });
soupPull('sp-two-holes', 'pad-basic__two-holes-one-sketch', 'sk.rect(60, 40); sk.circle(12, { at: [-15, 0] }); sk.circle(12, { at: [15, 0] }); extrude(sk, 15);', () => ({ volume: (2400 - 72 * PI) * 15 }), { curved: true });
soupPull('sp-rect-rect-frame', 'pad-basic__rect-and-rect-one-sketch', 'sk.rect(40, 30); sk.rect(10, 10); extrude(sk, 15);', () => ({ volume: (1200 - 100) * 15, bbox: [-20, -15, 0, 20, 15, 15], com: [0, 0, 7.5] }));
soupPull('sp-polygon-with-hole', 'pad-basic__polygon-with-rect-hole-one-sketch', 'sk.polygon([[-20, -20], [20, -20], [0, 20]]); sk.rect(4, 4, { at: [0, -8] }); extrude(sk, 15);', () => ({ volume: (800 - 16) * 15 }));
soupPull('sp-disjoint-rects', 'pad-basic__two-disjoint-rects-one-sketch', 'sk.rect(20, 20, { at: [-20, 0] }); sk.rect(20, 20, { at: [20, 0] }); extrude(sk, 15);', () => ({ volume: 800 * 15, bbox: [-30, -10, 0, 30, 10, 15], com: [0, 0, 7.5] }), { note: 'two separate pieces of one pull' });
soupPull('sp-disjoint-circles', 'pad-basic__two-disjoint-circles-one-sketch', 'sk.circle(16, { at: [-20, 0] }); sk.circle(16, { at: [20, 0] }); extrude(sk, 15);', () => ({ volume: 2 * 64 * PI * 15 }), { curved: true });
soupPull('sp-rect-circle-apart', 'pad-basic__rect-and-circle-apart-one-sketch', 'sk.rect(20, 20, { at: [-20, 0] }); sk.circle(16, { at: [20, 0] }); extrude(sk, 10);', () => ({ volume: (400 + 64 * PI) * 10 }), { curved: true });
soupPull('sp-three-deep-rects', 'pad-basic__three-deep-rects-one-sketch', 'sk.rect(60, 60); sk.rect(40, 40); sk.rect(20, 20); extrude(sk, 15);', () => ({ volume: (3600 - 1600 + 400) * 15, bbox: [-30, -30, 0, 30, 30, 15], com: [0, 0, 7.5] }), { note: 'a frame and a block standing in its hole: two solids' });
soupPull('sp-four-circles', 'pad-basic__four-deep-circles-one-sketch', 'sk.circle(80); sk.circle(60); sk.circle(40); sk.circle(20); extrude(sk, 10);', () => ({ volume: PI * (1600 - 900 + 400 - 100) * 10 }), { curved: true, note: 'two rings by the even-odd rule' });
soupPull('sp-island-far-disc', 'pad-basic__island-and-far-disc-one-sketch', 'sk.circle(60); sk.circle(40); sk.circle(20); sk.circle(10, { at: [60, 0] }); extrude(sk, 15);', () => ({ volume: PI * (900 - 400 + 100 + 25) * 15 }), { curved: true, note: 'three solids' });
soupPull('sp-holed-plate-far-rect', 'pad-basic__holed-plate-and-far-rect-one-sketch', 'sk.rect(40, 30); sk.circle(10); sk.rect(10, 10, { at: [40, 0] }); extrude(sk, 15);', () => ({ volume: (1200 - 25 * PI + 100) * 15 }), { curved: true });
soupPull('sp-ring-geom-rows', 'pad-basic__ring-with-hole', "sk.geom([{ k: 'circle', id: 1, c: [0, 0], r: 20 }, { k: 'circle', id: 2, c: [0, 0], r: 10 }]); extrude(sk, 15);", () => ({ volume: PI * (400 - 100) * 15 }), { curved: true });
soupPull('sp-crossing-rects', 'pad-basic__crossing-rects-one-sketch', 'sk.rect(30, 20, { at: [-5, 0] }); sk.rect(30, 20, { at: [5, -10] }); extrude(sk, 15);', undefined, { note: 'two crossing rectangles: must be refused in a sentence' });
soupPull('sp-crossing-circles', 'pad-basic__crossing-circles-one-sketch', 'sk.circle(20, { at: [-5, 0] }); sk.circle(20, { at: [5, 0] }); extrude(sk, 15);', undefined, { note: 'two crossing circles: must be refused' });
soupPull('sp-tangent-inside', 'pad-basic__tangent-inside-circles-one-sketch', 'sk.circle(40); sk.circle(20, { at: [10, 0] }); extrude(sk, 15);', undefined, { note: 'a circle touching its container from inside at one point: must be refused' });
soupPull('sp-tangent-outside', 'pad-basic__tangent-outside-circles-one-sketch', 'sk.circle(20, { at: [-10, 0] }); sk.circle(20, { at: [10, 0] }); extrude(sk, 15);', () => ({ volume: 2 * 100 * PI * 15 }), { curved: true, note: 'two discs touching at one point' });
soupPull('sp-shared-edge', 'pad-basic__shared-edge-rects-one-sketch', 'sk.rect(20, 20, { at: [-10, 0] }); sk.rect(20, 20, { at: [10, 0] }); extrude(sk, 15);', undefined, { note: 'two rectangles sharing a side: must be refused' });
soupPull('sp-soup-midplane', undefined, 'sk.rect(40, 30); sk.circle(10); pull(sk, 15, { midplane: true });', () => ({ volume: (1200 - 25 * PI) * 15, bbox: [-20, -15, -7.5, 20, 15, 7.5], com: [0, 0, 0] }), { curved: true, note: 'a holed profile pulled symmetric' });
soupPull('sp-soup-taper', undefined, 'sk.rect(40, 30); sk.circle(10); pull(sk, 10, { taper: 5 });', undefined, { curved: true, note: 'a holed profile with a taper (brep-rs refuses)' });
soupPull('sp-soup-reversed-length2', undefined, 'sk.rect(40, 30); sk.rect(10, 10); pull(sk, 10, { reversed: true, length2: 4 });', () => ({ volume: 1100 * 14, bbox: [-20, -15, -10, 20, 15, 4], com: [0, 0, -3] }));
const soupPocket = (id, fc, draw, depth, an, o = {}, popt = '') => add_({ id, feature: F_SOUP, fc, script: `${PLATE} const sk = sketch('top', 10); ${draw} pocket(sk, plate, ${depth}${popt});`, analytic: an, ...o });
soupPocket('spk-two-holes', 'pocket-blind__two-holes-one-sketch', 'sk.circle(8, { at: [10, 15] }); sk.circle(8, { at: [30, 15] });', 4, () => ({ volume: 12000 - 2 * 16 * PI * 4 }), { curved: true });
soupPocket('spk-rect-circle', 'pocket-blind__rect-and-circle-one-sketch', 'sk.rect(8, 8, { at: [10, 15] }); sk.circle(8, { at: [30, 15] });', 3, () => ({ volume: 12000 - (64 + 16 * PI) * 3 }), { curved: true });
soupPocket('spk-ring', 'pocket-blind__ring-island-one-sketch', 'sk.circle(20, { at: [20, 15] }); sk.circle(8, { at: [20, 15] });', 4, () => ({ volume: 12000 - PI * (100 - 16) * 4 }), { curved: true, note: 'a ring-shaped cut leaves a round island standing' });
soupPocket('spk-three-deep', 'pocket-blind__three-deep-one-sketch', 'sk.circle(24, { at: [20, 15] }); sk.circle(16, { at: [20, 15] }); sk.circle(8, { at: [20, 15] });', 4, () => ({ volume: 12000 - PI * (144 - 64 + 16) * 4 }), { curved: true });
soupPocket('spk-through-two-holes', 'pocket-through__two-holes-one-sketch', 'sk.circle(8, { at: [10, 15] }); sk.circle(8, { at: [30, 15] });', 10, () => ({ volume: 12000 - 2 * 16 * PI * 10 }), { curved: true }, ', { through: true }');
add_({ id: 'spk-through-ring-far-rect', feature: F_SOUP, fc: 'pocket-through__ring-and-far-rect-one-sketch', curved: true, note: 'a ring-shaped through cut frees a disc standing apart (two solids) and a separate square',
  script: "const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,30],[0,30]]); const plate = pull(s1, 10); const s2 = sketch('top', 10); s2.circle(24, { at: [15, 15] }); s2.circle(16, { at: [15, 15] }); s2.rect(8, 8, { at: [45, 15] }); pocket(s2, plate, 10, { through: true });",
  analytic: () => ({ volume: (1800 - PI * (144 - 64) - 64) * 10 }) });
add_({ id: 'spk-blind-ring-far-rect', feature: F_SOUP, fc: 'pocket-blind__ring-and-far-rect-one-sketch', curved: true,
  script: "const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,30],[0,30]]); const plate = pull(s1, 10); const s2 = sketch('top', 10); s2.circle(24, { at: [15, 15] }); s2.circle(16, { at: [15, 15] }); s2.rect(8, 8, { at: [45, 15] }); pocket(s2, plate, 4);",
  analytic: () => ({ volume: 18000 - (PI * (144 - 64) + 64) * 4 }) });
soupPocket('spk-soup-midplane', undefined, 'sk.circle(8, { at: [10, 15] }); sk.circle(8, { at: [30, 15] });', 6, () => ({ volume: 12000 - 2 * 16 * PI * 3 }), { curved: true, note: 'soup pocket, midplane: half the tool in air' }, ', { midplane: true }');
soupPocket('spk-soup-taper', undefined, 'sk.circle(8, { at: [10, 15] }); sk.circle(8, { at: [30, 15] });', 4, undefined, { curved: true, note: 'soup pocket with taper (brep-rs refuses)' }, ', { taper: 5 }');

// ================================================================================================================================
// extra cases added after round-1 reading of the first results
// ================================================================================================================================
taperPull({ id: 'pt-near-collapse-ok', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 10, deg: -30, note: '12 wide shrinks 5.77 per side: a 0.46 mm sliver at the top, still a solid' });
taperPull({ id: 'pt-just-folded', draw: 'sk.rect(20, 12, { at: [10, 6] });', profAt: RECT_TAPER(0, 0, 20, 12), h: 10, deg: -31.5, note: '12 wide would shrink 6.12 per side: the walls cross at 9.8 of 10; must be refused' });
add_({ id: 'pl-frame', feature: F_L2, script: "const sk = sketch({ origin: [0, 0, 3], u: [0, 1, 0], v: [1, 0, 0] }); sk.rect(20, 10, { at: [10, 5] }); const part = pull(sk, 8, { length2: 3 });", note: 'framed sketch with normal -Z: 8 ahead (down), 3 behind (up)',
  analytic: () => ({ volume: 2200, bbox: [0, 0, -5, 10, 20, 6], com: [5, 10, 0.5] }) });
add_({ id: 'pr-frame', feature: F_REV, script: "const sk = sketch({ origin: [0, 0, 3], u: [0, 1, 0], v: [1, 0, 0] }); sk.rect(20, 10, { at: [10, 5] }); const part = pull(sk, 8, { reversed: true });", note: 'framed sketch with normal -Z, reversed: pulls UP from z=3',
  analytic: () => ({ volume: 1600, bbox: [0, 0, 3, 10, 20, 11], com: [5, 10, 7] }) });
pocket({ id: 'kt-in-air', feature: PO('through:true (cut all the way)'), off: 15, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 3, o: { through: true }, nr: [-1e6, 0], note: 'sketch 5 above the plate: through cuts the whole plate' });
pocket({ id: 'kt-below', feature: PO('through:true (cut all the way)'), off: -3, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 3, o: { through: true }, nr: [-1e6, 0], note: 'sketch 3 below the plate, cut goes further down: nothing to cut' });
add_({ id: 'kt-cylinder', feature: PO('through:true (cut all the way)'), curved: true, script: "const c = cylinder(30, 20, { at: [0, 0, 10] }); const sk = sketch('top', 20); sk.circle(6, { at: [4, 0] }); const cut = pocket(sk, c, 5, { through: true });",
  analytic: () => sub({ volume: PI * 225 * 20, com: [0, 0, 10], bbox: [-15, -15, 0, 15, 15, 20] }, prism('top', 20, Cc(4, 0, 6), -20, 0)), note: 'through-bore of a cylinder from its top cap' });
{
  // stadium (two lines, two half-circle arcs) with a round hole, as raw rows with the joining rules
  const rows = "sk.geom([{ k: 'line', id: 1, a: [-10, -5], b: [10, -5] }, { k: 'arc', id: 2, c: [10, 0], r: 5, a: [10, -5], b: [10, 5], sense: 'ccw' }, { k: 'line', id: 3, a: [10, 5], b: [-10, 5] }, { k: 'arc', id: 4, c: [-10, 0], r: 5, a: [-10, 5], b: [-10, -5], sense: 'ccw' }, { k: 'circle', id: 5, c: [0, 0], r: 2 }]); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }]);";
  add_({ id: 'sp-slot-hole', feature: F_SOUP, curved: true, script: `${SK}${rows} extrude(sk, 10);`, note: 'a slot (lines + arcs) with a round hole, written as rows and rules', analytic: () => ({ volume: (200 + 25 * PI - 4 * PI) * 10, bbox: [-15, -5, 0, 15, 5, 10], com: [0, 0, 5] }) });
  add_({ id: 'sp-slot-hole-pocket', feature: F_SOUP, curved: true, script: `${PLATE} const sk = sketch('top', 10); sk.geom([{ k: 'line', id: 1, a: [10, 10], b: [30, 10] }, { k: 'arc', id: 2, c: [30, 15], r: 5, a: [30, 10], b: [30, 20], sense: 'ccw' }, { k: 'line', id: 3, a: [30, 20], b: [10, 20] }, { k: 'arc', id: 4, c: [10, 15], r: 5, a: [10, 20], b: [10, 10], sense: 'ccw' }, { k: 'circle', id: 5, c: [20, 15], r: 2 }]); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }]); const cut = pocket(sk, plate, 4);`,
    note: 'a slot-shaped pocket with an island post in the middle', analytic: () => ({ volume: 12000 - (200 + 25 * PI - 4 * PI) * 4 }) });
  // dimensions move the drawn geometry: the line is drawn 40 long but dimensioned 30; the hole drawn r3, dimensioned r4
  const dim = "sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [40, 0] }, { k: 'line', id: 2, a: [40, 0], b: [40, 25], }, { k: 'line', id: 3, a: [40, 25], b: [0, 25] }, { k: 'line', id: 4, a: [0, 25], b: [0, 0] }, { k: 'circle', id: 5, c: [10, 10], r: 3 }]); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }, { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }, { k: 'lock', a: 1, aEnd: 'a' }, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }, { k: 'radius', a: 5, value: 4 }]);";
  add_({ id: 'sp-dimensioned', feature: F_SOUP, curved: true, script: `${SK}${dim} extrude(sk, 10);`, note: 'the dimensions move the drawn rectangle (40 -> 30 long) and the hole (r3 -> r4) before the pull', analytic: () => ({ volume: (30 * 25 - 16 * PI) * 10 }) });
}

// ---- more reach: the pocket's target kinds, tilted frames, winding, rounded pocket outline
add_({ id: 'kp-into-pad', feature: F_POCKET, curved: true, script: `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 15] }); const pad = join(plate, pull(s2, 6)); const sk = sketch('top', 16); sk.circle(4, { at: [20, 15] }); const cut = pocket(sk, pad, 3);`,
  note: 'the pocket names a join (the pad), not a pull', analytic: () => sub(uni(PLATEBOX, prism('top', 10, R(15, 10, 25, 20), 0, 6)), prism('top', 16, Cc(20, 15, 4), -3, 0)) });
add_({ id: 'kp-into-box', feature: F_POCKET, script: "const b = box(40, 30, 10, { at: [20, 15, 5] }); const sk = sketch('top', 10); sk.rect(8, 6, { at: [20, 15] }); const cut = pocket(sk, b, 4);",
  note: 'the pocket names a box primitive', analytic: () => sub(PLATEBOX, prism('top', 10, R(16, 12, 24, 18), -4, 0)) });
{
  const s = Math.SQRT1_2;
  add_({ id: 'pp-tilted-frame', feature: F_PULL, script: `const sk = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${s}] }); sk.rect(10, 6, { at: [5, 3] }); const part = pull(sk, 7);`,
    note: 'a 45 degree frame: normal u x v = (0, -0.7071, 0.7071)', analytic: () => prism({ U: [1, 0, 0], V: [0, s, s], N: [0, -s, s], O: [0, 0, 0] }, 0, R(0, 0, 10, 6), 0, 7) });
  add_({ id: 'pl-tilted-frame', feature: F_L2, script: `const sk = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${s}] }); sk.rect(10, 6, { at: [5, 3] }); const part = pull(sk, 7, { length2: 2 });`,
    analytic: () => prism({ U: [1, 0, 0], V: [0, s, s], N: [0, -s, s], O: [0, 0, 0] }, 0, R(0, 0, 10, 6), -2, 7) });
  add_({ id: 'pm-tilted-frame', feature: F_MID, script: `const sk = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${s}] }); sk.rect(10, 6, { at: [5, 3] }); const part = pull(sk, 7, { midplane: true });`,
    analytic: () => prism({ U: [1, 0, 0], V: [0, s, s], N: [0, -s, s], O: [0, 0, 0] }, 0, R(0, 0, 10, 6), -3.5, 3.5) });
  add_({ id: 'pt-tilted-frame', feature: F_TAPER, script: `const sk = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${s}] }); sk.rect(10, 6, { at: [5, 3] }); const part = pull(sk, 7, { taper: 8 });`,
    analytic: () => tapered({ U: [1, 0, 0], V: [0, s, s], N: [0, -s, s], O: [0, 0, 0] }, 0, RECT_TAPER(0, 0, 10, 6), 7, 8, 1) });
}
add_({ id: 'pp-cw-polygon', feature: F_PULL, script: "const sk = sketch('top'); sk.polygon([[0,25],[10,25],[10,10],[30,10],[30,0],[0,0]]); const part = pull(sk, 6);", note: 'the same L outline wound clockwise',
  analytic: () => prism('top', 0, P([[0, 25], [10, 25], [10, 10], [30, 10], [30, 0], [0, 0]]), 0, 6) });
pocket({ id: 'kp-arc-outline', feature: F_POCKET, draw: 'sk.polygon([[10,10],[22,10],[22,20],[10,20]]); sk.round(2, 3); sk.round(4, 3);', prof: (() => { const r = 3; const rem = 2 * (r * r - PI * r * r / 4); return { area: 120 - rem, cen: [16, 15], bb: [10, 10, 22, 20] }; })(), depth: 5, nr: [-5, 0], curved: true, note: 'a pocket outline with two rounded corners (opposite corners, so the centroid stays at (16,15))' });

// Cases whose correct outcome is a REFUSAL (the language rule, or no oracle builds it, or the sentence is the point). A route that builds
// one of these has built something the language does not define.
const EXPECT_REFUSE = ['pp-zero-height', 'pt-ring', 'pt-fold', 'pt-just-folded', 'pt-midplane', 'pt-length2', 'pd-in-plane', 'pd-with-taper',
  'kk-fold', 'kk-midplane', 'kd-in-plane', 'kt-through-midplane', 'sp-crossing-rects', 'sp-crossing-circles', 'sp-tangent-inside',
  'sp-tangent-outside', 'sp-shared-edge', 'sp-soup-taper', 'spk-soup-taper'];
for (const c of CASES) if (EXPECT_REFUSE.includes(c.id)) c.expect = 'refuse';

// ---- gauntlet scripts taken verbatim (docs/replica/freecad/gauntlet/variants/defs.mjs), so the saved FreeCAD result applies
add_({ id: 'fc-pad-reversed', feature: F_REV, fc: 'pad-basic__reversed', script: "const sk = sketch('top'); sk.rect(40, 30, { at: [25, 20] }); extrude(sk, -10);", note: 'the gauntlet writes a reversed pad as a negative height', analytic: () => prism('top', 0, R(5, 5, 45, 35), -10, 0) });
add_({ id: 'fc-pad-offset-neg-reversed', feature: F_REV, fc: 'pad-basic__top-offset-negative-reversed', curved: true, script: "const sk = sketch('top', -4); sk.circle(14, { at: [5, 5] }); extrude(sk, -9);", analytic: () => prism('top', -4, Cc(5, 5, 14), -9, 0) });
add_({ id: 'fc-pad-side-offset-neg', feature: F_PULL, fc: 'pad-basic__side-offset-negative', script: "const sk = sketch('side', -6); sk.rect(25, 18, { at: [12.5, 9] }); extrude(sk, 10);", analytic: () => prism('side', -6, R(0, 0, 25, 18), 0, 10) });
add_({ id: 'fc-pad-sym-front', feature: F_MID, fc: 'pad-symmetric__front-plane', script: "const sk = sketch('front'); sk.rect(20, 10, { at: [10, 5] }); pull(sk, 16, { midplane: true });", note: 'FreeCAD "Symmetric to plane" pad, front plane', analytic: () => prism('front', 0, R(0, 0, 20, 10), -8, 8) });
add_({ id: 'fc-pad-sym-rect-offcentre', feature: F_MID, fc: 'pad-symmetric__rect-offcentre', script: "const sk = sketch('top'); sk.rect(40, 30, { at: [5, 22] }); pull(sk, 10, { midplane: true });", analytic: () => prism('top', 0, R(-15, 7, 25, 37), -5, 5) });
add_({ id: 'fc-pocket-front-12', feature: F_POCKET, fc: 'pocket-blind__from-front-face', curved: true, script: `${PLATE} const s2 = sketch('front', 0); s2.circle(12, { at: [20, 5] }); pocket(s2, plate, 8);`, note: 'gauntlet script: the 12 across circle reaches 1 mm past the top and bottom faces' });
add_({ id: 'fc-pocket-runs-off', feature: F_POCKET, fc: 'pocket-blind__runs-off-the-side', script: `${PLATE} const s2 = sketch('top', 10); s2.rect(20, 10, { at: [40, 15] }); pocket(s2, plate, 3);`, analytic: () => sub(PLATEBOX, prism('top', 10, R(30, 10, 40, 20), -3, 0)) });
add_({ id: 'fc-pocket-two-seq', feature: F_POCKET, fc: 'pocket-blind__two-sequential', curved: true, script: `${PLATE} const s2 = sketch('top', 10); s2.circle(6, { at: [10, 15] }); const q = pocket(s2, plate, 4); const s3 = sketch('top', 10); s3.rect(8, 8, { at: [28, 15] }); pocket(s3, q, 3);`,
  analytic: () => sub(sub(PLATEBOX, prism('top', 10, Cc(10, 15, 6), -4, 0)), prism('top', 10, R(24, 11, 32, 19), -3, 0)) });
add_({ id: 'fc-pocket-through-two-seq', feature: PO('through:true (cut all the way)'), fc: 'pocket-through__two-sequential', curved: true, script: `${PLATE} const s2 = sketch('top', 10); s2.circle(6, { at: [10, 15] }); const q = pocket(s2, plate, 10); const s3 = sketch('top', 10); s3.rect(8, 4, { at: [28, 15] }); pocket(s3, q, 10);`,
  note: 'depth equal to the thickness (the gauntlet writes "through" this way)', analytic: () => sub(sub(PLATEBOX, prism('top', 10, Cc(10, 15, 6), -10, 0)), prism('top', 10, R(24, 13, 32, 17), -10, 0)) });
add_({ id: 'fc-pocket-depth-negative', feature: F_POCKET, script: `${PLATE} const s2 = sketch('top', 10); s2.circle(8, { at: [20, 15] }); pocket(s2, plate, -3);`, note: 'the gauntlet: "the reference and the script should both refuse"' });
add_({ id: 'fc-pocket-depth-zero', feature: F_POCKET, script: `${PLATE} const s2 = sketch('top', 10); s2.circle(8, { at: [20, 15] }); pocket(s2, plate, 0);`, note: 'the gauntlet: "the reference and the script should both refuse"' });
const FC_BY_ID = {
  'pm-offset-plane': 'pad-symmetric__about-offset-plane', 'pm-circle': 'pad-symmetric__thin-disc', 'pm-long-slab': 'pad-symmetric__long-slab', 'pm-side-L': 'pad-symmetric__side-plane-L',
  'pp-front-offset': 'pad-basic__front-offset', 'pp-side-L': 'pad-basic__side-plane-L', 'pp-thin-plate': 'pad-basic__thin-plate', 'pp-slender-post': 'pad-basic__slender-post', 'pp-circle': 'pad-basic__circle-offcentre',
  'kp-top-rect': 'pocket-blind__rect-offcentre', 'kp-top-circle': 'pocket-blind__almost-through', 'kp-side-face': 'pocket-blind__from-side-face', 'kp-bottom-frame': 'pocket-blind__from-bottom-face',
  'kt-top-circle': 'pocket-through__circle-offcentre', 'kt-slot': 'pocket-through__long-slot', 'kt-front': 'pocket-through__from-front-face', 'kt-side': 'pocket-through__from-side-face',
  'kt-triangle-thick': 'pocket-through__triangle-thick', 'kp-deeper-than-part': 'pocket-through__deeper-than-part',
};
for (const c of CASES) if (FC_BY_ID[c.id]) c.fc = FC_BY_ID[c.id];

// helpers for extrude-pocket-cases-r2.mjs (round 2)
export const H = { sheared, R, Cc, P, prism, box, sub, uni, tapered, offsetPoly, polyTaper, sketchCall, optsStr, PLATE, PLATEBOX, bodyN, clip, PL, W, mul, add, PI, add_, pocket, pull };
