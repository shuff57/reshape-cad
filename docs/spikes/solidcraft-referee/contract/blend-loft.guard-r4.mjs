// FROZEN COPY of blend-loft.guard.mjs as it stood at the end of round 4 (tolerances 1e-9). Kept ONLY so blend-loft.r5.mjs can show what the round-4 guard said about hand-typed input. Do not use.
// blend-loft guard (round 3). Pure functions, no kernel, no wasm. This is the ENFORCEMENT half of the blend-loft contract:
// every loft the measurements showed to build a wrong solid on the spike translator is turned into a refusal with one
// plain sentence (no kernel names, no internal ids, "first sketch"/"second sketch" for the two inputs).
//
// It lives in contract/ because packages/script and phase0/translate.mjs are read-only for this campaign. Use:
//   import { guardBlend, guardDoc } from './blend-loft.guard.mjs';
//   const verdicts = guardDoc(solvedDoc, { outlineOf: arc.outlineOf, neutral });   // Map blendId -> null | {code, sentence}
// `neutral` is Map(sketchId -> offset the sketch had BEFORE blend() rewrote it); see neutralRun() in
// blend-loft.guarded-run.mjs (re-runs the script with loft()/blend() calls turned into no-ops). Without it the guard falls
// back to the conservative rule "a sketch that a loft uses must not be used by any other feature".
//
// The SUPPORTED set is exactly what blend-loft.json measured as exact (see each row); everything else is refused:
//   S1 two plain polygons, same corner count, every side parallel (same direction) to its matching side, one unambiguous
//      matching, and both kernels' start-vertex rules land on that matching            -> exact to 1e-9 (planar)
//   S2 circle <-> circle                                                              -> <= 1.0e-4 (tessellation)
//   S3 regular polygon (3..8 corners) with a corner pointing along +u  <-> circle      -> <= 2.0e-4
//   S4 axis-aligned rectangle (long side <= 2x short side) <-> circle                  -> <= 1.1e-4
//   S5 rounded rectangle (4 equal corners, long side <= 1.35x short side) <-> circle   -> <= 6.8e-5 (rounded square 1:1..4:3)
export const GAP_MIN = 1e-6;          // below this the two sketches are "the same place" (measured: 1e-6 exact, 1e-12 zero volume)
export const RECT_ASPECT_MAX = 2.0;   // measured exact to 40x20; 40x13.3 (3:1) circle-first is 1.1e-2 off
export const ROUNDED_ASPECT_MAX = 1.1;  // round 4 (live sweep): 1.35 is 3.8e-4 off, 1.15 is 1.9e-4 off (circle first), 1.0 is 9.4e-5 off
export const POLY_CIRCLE_N = [4, 5, 6, 8]; // round 4: 3 dropped (live: triangle<->circle is off by 1.9e-3 .. 1.2e-1 and OCCT has 6 faces, truck 5); 7 never measured
// Round 4 windows for every loft that has a circle in it (calibrated on live truck vs live OCCT, see blend-loft.json rows 7-10 and RIG.md):
export const CC_TILT_MAX = 5;        // circle<->circle: centre distance / gap. Live: 10.7 -> 4.0e-4, 19.5 -> 2.0 (negative volume), >=200 -> up to 1.5e-2
export const COARSE_MAX = 40;        // bbox diagonal / largest circle radius. Truck's mesh tolerance scales with the bbox diagonal: error ~ 4e-6 x ratio above the 1e-4 floor
export const CIRCLE_R_MIN = 0.5;     // largest circle radius, mm. Below this the mesh tolerance floor is coarse: r0.09 h0.5 -> 4.0e-4, r0.13/0.26 h5.6 -> 3.7e-4
export const PC_RATIO_MAX = 15;      // polygon/rounded <-> circle: bbox diagonal / circle radius
export const PC_SIZE_MIN = 0.25;     // circle diameter / long side of the other outline, lower bound
export const PC_SIZE_MAX = 4;        // ... upper bound
export const PC_THIN_MIN = 0.3;      // gap / long side of the other outline (regular polygon, rounded rectangle): live, 0 of 50 / 18 over the bar inside the window
export const PC_THIN_MIN_RECT = 1.0; // axis-aligned rectangle <-> circle needs a gap of at least its long side: at 0.3 a 5.5x3.4 rect against r5.1 at gap 3.3 is 6.5e-4 off (OCCT 7 faces, truck 6)
export const PC_SIZE_MAX_RECT = 2;   // ... and a circle at most twice as wide as the rectangle is long: a 1.9x1.0 rect against r3.6 (ratio 3.8) is 4.9e-3 off. Inside both: 0 of 43 over the bar, max 1.6e-4 // measured n; 7 not measured -> refused rather than guessed
const PLANE_WORD = { xy: 'top', xz: 'front', yz: 'side' };
const STARTER = [[0, 0], [40, 0], [40, 25], [0, 25]];
const ord = (i) => (i === 0 ? 'first' : 'second');
const WORDS = ['first', 'second'];
const num = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));

const area2 = (P) => P.reduce((s, a, i) => { const b = P[(i + 1) % P.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
const centroid = (P) => { // area-weighted, same definition as the kernel's Loop2::centroid for straight loops
  let a2 = 0; let cx = 0; let cy = 0;
  P.forEach((p, i) => { const q = P[(i + 1) % P.length]; const k = p[0] * q[1] - q[0] * p[1]; a2 += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; });
  return Math.abs(a2) < 1e-15 ? P[0] : [cx / (3 * a2), cy / (3 * a2)];
};
/** The counter-clockwise loop the kernel ends up with for a list of corners. A list that already runs counter-clockwise keeps its first corner first.
 *  A clockwise list becomes [P1, P0, Pn-1, ..., P2]: found EMPIRICALLY (the sketch-to-loft path of the spike starts a reversed loop at the second corner),
 *  it reproduces the truck outcome of 230 of 230 planar-sided fuzz pairs (contract/blend-loft.r3-results.json N7), where "keep P0 first" gets 226. */
export const ccwLoop = (P) => (area2(P) >= 0 ? P : [P[1], P[0], ...P.slice(2).reverse()]);
const scaleOf = (P) => Math.max(1e-12, ...P.flat().map(Math.abs));

function segsCross(p1, p2, p3, p4) {
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p3, p4, p1); const d2 = o(p3, p4, p2); const d3 = o(p1, p2, p3); const d4 = o(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function selfCrossing(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segsCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return true;
  }
  return false;
}

/** every cyclic shift s of Q (both CCW) for which all side pairs P_i->P_i+1 and Q_i+s->Q_i+s+1 run the SAME direction */
export function parallelShifts(P, Q, tol = 1e-9) {
  const n = P.length; const out = [];
  if (Q.length !== n) return out;
  const e = (X, i) => { const a = X[i % n]; const b = X[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; };
  for (let s = 0; s < n; s++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const u = e(P, i); const v = e(Q, i + s);
      const lu = Math.hypot(...u); const lv = Math.hypot(...v);
      if (lu < 1e-12 || lv < 1e-12) { ok = false; break; }
      const cr = u[0] * v[1] - u[1] * v[0]; const d = u[0] * v[0] + u[1] * v[1];
      if (Math.abs(cr) > tol * lu * lv || d <= 0) ok = false;
    }
    if (ok) out.push(s);
  }
  return out;
}

/** The start-vertex rule of the SolidCraft loft (kernel/src/build.rs loft(), equal corner counts): the lead section is the
 *  last one with the most segments; the other section starts at the vertex whose direction from its own centroid is
 *  angularly closest to the lead's first vertex. Returns the shift s (P_i pairs with Q_{i+s}) and the angular margin. */
export function truckShift(P, Q, leadIsB) {
  const n = P.length;
  const ang = (X, c, k) => Math.atan2(X[k][1] - c[1], X[k][0] - c[0]);
  const dist = (a, b) => { const d = (((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
  const cP = centroid(P); const cQ = centroid(Q);
  const lead = leadIsB ? Q : P; const other = leadIsB ? P : Q; const cl = leadIsB ? cQ : cP; const co = leadIsB ? cP : cQ;
  const target = ang(lead, cl, 0);
  const ds = other.map((_, k) => dist(ang(other, co, k), target));
  const order = ds.map((d, k) => [d, k]).sort((a, b) => a[0] - b[0]);
  const k = order[0][1]; const margin = n > 1 ? order[1][0] - order[0][0] : Infinity;
  // other rotated left by k pairs other_k with lead_0
  const s = leadIsB ? ((n - k) % n) : k; // leadIsB: P_k <-> Q_0 => P_i <-> Q_{i-k}; else: Q_k <-> P_0 => P_i <-> Q_{i+k}
  return { s, margin };
}

/** world position of a point of a named-plane sketch (translator frames: xy -> (x, y, off), xz -> (x, off, y), yz -> (off, x, y)) */
const WORLD = { xy: (c, o) => [c[0], c[1], o], xz: (c, o) => [c[0], o, c[1]], yz: (c, o) => [o, c[0], c[1]] };
/** kernel/src/build.rs loft(): the sections are turned round when the largest-magnitude component of (last centroid - first centroid) is negative;
 *  with equal corner counts the lead is then the FIRST sketch, otherwise the SECOND (max_by_key keeps the last maximum). Returns true when the lead is B. */
export function leadIsB(plane, offA, ptsA, offB, ptsB) {
  const w = WORLD[plane] ?? WORLD.xy;
  const a = w(centroid(ptsA), offA); const b = w(centroid(ptsB), offB);
  const step = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let big = 0; for (const v of step) if (Math.abs(v) >= Math.abs(big)) big = v; // total_cmp max_by keeps the last maximum
  return !(big < 0);
}

function describeOutline(sk, outlineOf) {
  if (sk.shape === 'circle') {
    const [a, b] = sk.points; const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { type: 'circle', d, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }
  const o = outlineOf(sk);
  if (!o || !o.ok) return { type: 'unreadable' };
  const bulges = Object.entries(o.bulges ?? {}).filter(([, g]) => g);
  return { type: bulges.length ? 'arcs' : 'polygon', pts: o.points.map((p) => [p[0], p[1]]), bulges: Object.fromEntries(bulges.map(([k, g]) => [Number(k), g])) };
}

const isAxisRect = (P) => {
  if (P.length !== 4) return null;
  const xs = P.map((p) => p[0]); const ys = P.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs); const h = Math.max(...ys) - Math.min(...ys);
  if (w < 1e-12 || h < 1e-12) return null;
  const tol = 1e-9 * Math.max(w, h);
  for (let i = 0; i < 4; i++) { const a = P[i]; const b = P[(i + 1) % 4]; if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return null; }
  // all four corners of the bounding box present
  const corners = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]];
  if (!corners.every((c) => P.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= tol))) return null;
  return { w, h, aspect: Math.max(w, h) / Math.min(w, h) };
};
const regularPhase0 = (P) => {
  const n = P.length; if (!POLY_CIRCLE_N.includes(n)) return false;
  const c = centroid(P); const r = P.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]));
  if (Math.max(...r) - Math.min(...r) > 1e-9 * Math.max(...r)) return false;
  const angs = P.map((p) => Math.atan2(p[1] - c[1], p[0] - c[0]));
  const step = 2 * Math.PI / n;
  // equally spaced (either winding)
  const sgn = area2(P) >= 0 ? 1 : -1;
  for (let i = 1; i < n; i++) { const d = ((sgn * (angs[i] - angs[i - 1])) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (Math.abs(d - step) > 1e-9) return false; }
  // some corner points exactly along +u from the centroid
  return angs.some((a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 1e-9);
};
/** rounded rectangle: 8 segments, 4 equal quarter-circle bulges on alternating edges, straight edges axis-aligned */
const roundedRect = (o) => {
  if (o.type !== 'arcs' || o.pts.length !== 8) return null;
  const idx = Object.keys(o.bulges).map(Number).sort((a, b) => a - b);
  if (idx.length !== 4 || idx.some((v, i) => v !== idx[0] + 2 * i) || (idx[0] !== 0 && idx[0] !== 1)) return null;
  const gs = idx.map((i) => Math.abs(o.bulges[i]));
  if (Math.max(...gs) - Math.min(...gs) > 1e-9 || Math.abs(gs[0] - Math.tan(Math.PI / 8)) > 1e-9) return null;
  const xs = o.pts.map((p) => p[0]); const ys = o.pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs); const h = Math.max(...ys) - Math.min(...ys);
  const straight = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !idx.includes(i));
  const tol = 1e-9 * Math.max(w, h);
  for (const i of straight) { const a = o.pts[i]; const b = o.pts[(i + 1) % 8]; if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return null; }
  return { w, h, aspect: Math.max(w, h) / Math.min(w, h) };
};


const extentOf = (o) => {
  if (o.type === 'circle') { const r = o.d / 2; return [o.c[0] - r, o.c[0] + r, o.c[1] - r, o.c[1] + r]; }
  const xs = o.pts.map((p) => p[0]); const ys = o.pts.map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};
const consumersOf = (doc, id, exceptId) => doc.features.filter((f) => f.id !== exceptId && f.id !== id && f.kind !== 'datum'
  && Object.entries(f).some(([k, v]) => k !== 'id' && (v === id || (Array.isArray(v) && v.includes(id)))));

/** Returns null (the loft is in the supported set) or {code, sentence}. `doc` is the SOLVED ModelDoc. */
export function guardBlend(doc, f, { outlineOf, neutral = null, argOrder = null } = {}) {
  const byId = (id) => doc.features.find((x) => x.id === id);
  // `first` / `second` in every sentence follow the ORDER THE STUDENT WROTE THE ARGUMENTS in (blend(first, second, gap)), not the
  // bottom-first order of f.targets: for a negative gap the two differ (round 4: blend(a, b, -30) used to blame the "first" sketch for b).
  const argIds = argOrder?.get?.(f.id) ?? null;
  const label = (i) => { const k = argIds ? argIds.indexOf(f.targets[i]) : i; return WORDS[k < 0 ? i : k]; };
  const n = f.targets?.length ?? 0;
  if (n !== 2) return { code: 'targets', sentence: `A loft joins exactly two sketches, and this one has ${n === 0 ? 'none' : n === 1 ? 'one' : n}, so choose two.` };
  const sks = f.targets.map(byId);
  if (sks.some((s) => !s || s.kind !== 'sketch')) return { code: 'not-sketch', sentence: 'A loft needs two sketches, and one of the things given to it is not a sketch.' };
  // Round 4: the SAME sketch handed to the loft twice (loft(a, a, 30), or const c = a; loft(a, c, 30), or a ModelDoc with targets [a, a]). Both ends are one
  // sketch at one height, so the solid has zero volume whatever gap was typed; the old 'gap0' sentence ("the gap is zero") contradicted the 30 the student wrote.
  if (sks[0].id === sks[1].id) return { code: 'same', sentence: 'The loft was given the same sketch twice, so both of its ends would be in the same place whatever gap you type; draw a second sketch for the other end.' };
  for (let i = 0; i < 2; i++) if (Array.isArray(sks[i].geoms) && sks[i].geoms.length > 0 && sks[i].shape !== 'circle') {
    return { code: 'soup', sentence: `The ${label(i)} sketch was drawn with geom() or slot(), and a loft can only use plain outlines (rect, circle or polygon), so redraw it as a plain outline.` };
  }
  for (let i = 0; i < 2; i++) if (sks[i].frame) {
    return { code: 'frame', sentence: `The ${label(i)} sketch is placed with its own origin and direction, which a loft cannot combine with its gap, so draw both sketches on 'top', 'front' or 'side' and give the distance as the gap.` };
  }
  const pl = sks.map((s) => s.plane ?? 'xy');
  if (pl[0] !== pl[1]) return { code: 'planes', sentence: `The two sketches are on different planes ('${PLANE_WORD[pl[0]]}' and '${PLANE_WORD[pl[1]]}'), so there is no single direction to loft along; draw both on the same plane.` };
  // undrawn: the starter rectangle with its four rectangle rules and nothing else
  for (let i = 0; i < 2; i++) {
    const s = sks[i];
    const starter = s.shape !== 'circle' && s.points?.length === 4 && s.points.every((p, k) => p[0] === STARTER[k][0] && p[1] === STARTER[k][1]) && (s.constraints?.length ?? 0) === 4 && !s.rounds;
    if (starter) return { code: 'undrawn', sentence: `The ${label(i)} sketch has not been drawn yet, so the loft would use the default 40 by 25 rectangle; draw its outline first, for example with rect(20, 20).` };
  }
  // the outlines themselves
  const outs = [];
  for (let i = 0; i < 2; i++) {
    const o = describeOutline(sks[i], outlineOf);
    if (o.type === 'unreadable') return { code: 'unreadable', sentence: `The ${label(i)} sketch has no usable outline, so there is nothing to loft; redraw it as a closed shape.` };
    if (o.type === 'circle') { if (!(o.d > 1e-9)) return { code: 'flat', sentence: `The ${label(i)} sketch has no area, so there is nothing to loft to; give it a real size.` }; }
    else {
      const sc = scaleOf(o.pts);
      if (o.type === 'polygon' && o.pts.length >= 4 && selfCrossing(o.pts)) return { code: 'crossing', sentence: `The ${label(i)} sketch crosses itself, so it is not a closed shape; reorder its corners so that no two sides cross.` };
      if (o.pts.length < 3 || Math.abs(area2(o.pts)) < 1e-9 * sc * sc) return { code: 'flat', sentence: `The ${label(i)} sketch has no area (all its points lie on one line), so there is nothing to loft to; give it at least three corners that are not in a row.` };
      if (o.type === 'polygon' && o.pts.some((p, k) => Math.hypot(p[0] - o.pts[(k + 1) % o.pts.length][0], p[1] - o.pts[(k + 1) % o.pts.length][1]) < 1e-9 * sc)) return { code: 'dup', sentence: `Two corners of the ${label(i)} sketch are in the same place, so delete one of them.` };
      if (o.type === 'polygon' && selfCrossing(o.pts)) return { code: 'crossing', sentence: `The ${label(i)} sketch crosses itself, so it is not a closed shape; reorder its corners so that no two sides cross.` };
    }
    outs.push(o);
  }
  // gap
  const off = sks.map((s) => s.offset ?? 0);
  if (Math.abs(off[1] - off[0]) < GAP_MIN) return { code: 'gap0', sentence: 'The two sketches are in the same place (the gap is zero), so there is nothing between them to fill; give the loft a gap above zero.' };
  // sketch reuse / contradiction with an explicit placement
  for (let i = 0; i < 2; i++) {
    const s = sks[i];
    const others = consumersOf(doc, s.id, f.id);
    if (neutral) {
      const was = neutral.get(s.id);
      const moved = was !== undefined && Math.abs(was - (s.offset ?? 0)) > 1e-12;
      if (moved && Math.abs(was) > 1e-12) return { code: 'datum', sentence: `The ${label(i)} sketch was placed at height ${num(was)}, but the loft's gap puts it at ${num(s.offset ?? 0)}, so make the two agree by changing the gap or the height the sketch was drawn at.` };
      if (moved && others.length) return { code: 'shared', sentence: `The ${label(i)} sketch is also used by another feature, and a loft moves its second sketch to the gap you give, which would move the other feature too, so draw a separate sketch for the loft.` };
    } else if (others.length) {
      return { code: 'shared', sentence: `The ${label(i)} sketch is also used by another feature, and a loft may move one of its sketches, so draw separate sketches for the loft.` };
    }
  }
  const [A, B] = outs;
  const gap = Math.abs(off[1] - off[0]);
  const EA = extentOf(A); const EB = extentOf(B);
  const diag = Math.hypot(Math.max(EA[1], EB[1]) - Math.min(EA[0], EB[0]), Math.max(EA[3], EB[3]) - Math.min(EA[2], EB[2]), gap);
  const circles = outs.filter((o) => o.type === 'circle');
  const rCirc = circles.length ? Math.max(...circles.map((o) => o.d / 2)) : 0;
  // ---- matching classes ----
  if (A.type === 'circle' && B.type === 'circle') {
    const tilt = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1]) / gap;
    if (tilt > CC_TILT_MAX) return { code: 'tilt', sentence: 'The second circle is so far to the side compared with the gap between them that the loft leans over almost flat and cannot be built exactly, so move the circles closer together sideways or make the gap bigger.' };
    if (rCirc < CIRCLE_R_MIN || diag / rCirc > COARSE_MAX) return { code: 'coarse', sentence: 'The circles are so small next to the length of this loft that the preview would draw them as rough many-sided shapes and the volume would come out wrong, so make the circles bigger or the loft shorter.' };
    return null; // plus postCheckBlend(): the kernel's own volume must match the closed form
  }
  if (circles.length === 1 && (diag / rCirc > PC_RATIO_MAX || rCirc < CIRCLE_R_MIN)) {
    return { code: 'coarse', sentence: 'The circle is so small next to the size of this loft that the preview would draw it as a rough many-sided shape and the volume would come out wrong, so make the circle bigger or the loft smaller.' };
  }
  if (circles.length === 1) {
    const other = A.type === 'circle' ? B : A; const E = other === A ? EA : EB;
    const longSide = Math.max(E[1] - E[0], E[3] - E[2]);
    const isRect = other.type === 'polygon' && !!isAxisRect(other.pts);
    if (!(2 * rCirc / longSide >= PC_SIZE_MIN && 2 * rCirc / longSide <= (isRect ? PC_SIZE_MAX_RECT : PC_SIZE_MAX))) return { code: 'size-mix', sentence: 'The circle and the other outline differ too much in size for this loft to be built exactly (the circle should be between a quarter and four times as wide as the other outline is long, or at most twice for a rectangle), so resize one of them.' };
    if (gap / longSide < (isRect ? PC_THIN_MIN_RECT : PC_THIN_MIN)) return { code: 'thin', sentence: 'This loft is too thin compared with the size of its sketches to be built exactly between a circle and another shape, so make the gap bigger or the sketches smaller.' };
  }
  if (A.type === 'arcs' || B.type === 'arcs') {
    const rr = roundedRect(A.type === 'arcs' ? A : B); const other = A.type === 'arcs' ? B : A;
    if (rr && other.type === 'circle' && rr.aspect <= ROUNDED_ASPECT_MAX) return null;
    return { code: 'arcs', sentence: 'A loft with rounded corners only works against a circle, and only for a nearly square shape (long side at most 1.1 times the short side), so use a circle or draw the shape with straight sides.' };
  }
  if (A.type === 'circle' || B.type === 'circle') {
    const P = A.type === 'circle' ? B.pts : A.pts;
    const rect = isAxisRect(P);
    if (rect && rect.aspect <= RECT_ASPECT_MAX) return null;
    if (regularPhase0(P)) return null;
    return { code: 'circle-poly', sentence: 'A circle can only be lofted to another circle, a rectangle (long side at most twice the short side) with sides along the sketch axes, or a regular 4, 5, 6 or 8 sided shape with one corner pointing right, and this outline is none of those.' };
  }
  // polygon <-> polygon
  const na = A.pts.length; const nb = B.pts.length;
  const [nFirst, nSecond] = label(0) === 'first' ? [na, nb] : [nb, na];
  if (na !== nb) return { code: 'count', sentence: `The first sketch has ${nFirst} corners and the second has ${nSecond}, but a loft needs the same number on both (a point in the middle of a straight side counts as a corner, so delete it if you did not mean one).` };
  const P = ccwLoop(A.pts); const Q = ccwLoop(B.pts);
  const shifts = parallelShifts(P, Q);
  const lead = leadIsB(pl[0], off[0], A.pts, off[1], B.pts);
  if (shifts.length === 0) {
    const tie = truckShift(P, Q, lead).margin < 1e-6;
    return tie
      ? { code: 'tie', sentence: 'The second sketch is turned exactly half way between two corners of the first, so its corners could be matched two ways; change one sketch so each side of the first runs parallel to the matching side of the second.' }
      : { code: 'sides', sentence: 'These two sketches cannot be lofted exactly because each side of the first has to run parallel to the matching side of the second (as when a shape is scaled up or down), so change one sketch to match.' };
  }
  if (shifts.length > 1) return { code: 'ambiguous', sentence: 'The corners of these two sketches could be matched up in more than one way, so change one sketch so only one matching is possible.' };
  const t = truckShift(P, Q, lead);
  if (t.s !== shifts[0] || t.margin < 1e-6) {
    // Round 4: the round-3 sentence told the student to "draw both sketches starting at matching corners" even when they already had (6 of 400
    // index-aligned parallel-sided pairs): the kernel pairs the corners BY GEOMETRY (the lead sketch's first corner meets the nearest corner of the
    // other one), so which list position a corner has is what decides. Find a re-start of one of the two lists that the simulation accepts and name it.
    const pass = (Ap, Bp) => {
      const P2 = ccwLoop(Ap); const Q2 = ccwLoop(Bp); const sh = parallelShifts(P2, Q2);
      if (sh.length !== 1) return false;
      const tt = truckShift(P2, Q2, leadIsB(pl[0], off[0], Ap, off[1], Bp));
      return tt.s === sh[0] && tt.margin >= 1e-6;
    };
    const rot = (L, k) => L.slice(k).concat(L.slice(0, k));
    const nth = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[k % 10] ?? 'th')}`;
    const order = label(0) === 'first' ? [1, 0] : [0, 1]; // try the sketch written second first, then the one written first (indexes into f.targets)
    let advice = null;
    for (const j of order) {
      for (let k = 1; k < na && !advice; k++) {
        const ok = j === 0 ? pass(rot(A.pts, k), B.pts) : pass(A.pts, rot(B.pts, k));
        if (ok) advice = { sketch: label(j), corner: k + 1 };
      }
      if (advice) break;
    }
    const base = 'The corners of these two sketches would be matched in a different order than the one you drew, which twists the loft';
    return { code: 'start', advice, sentence: advice ? `${base}; list the corners of the ${advice.sketch} sketch starting from its ${nth(advice.corner)} corner instead.` : `${base}, and no other starting corner fixes it, so change one of the two outlines.` };
  }
  return null;
}

export function guardDoc(doc, ctx) {
  const out = new Map();
  for (const f of doc.features) if (f.kind === 'blend') out.set(f.id, guardBlend(doc, f, ctx));
  return out;
}

/** POST-BUILD check (the independent-measure half of the guard). Only circle<->circle has an exact closed form: a ruled loft between two
 *  circles on parallel planes has volume h/3 (A1 + A2 + sqrt(A1 A2)) whatever the sideways offset, and live OCCT equals it to 3e-10.
 *  `kernelVolume` is the volume the kernel reports for the built solid. Returns null (agrees) or {code, sentence}. Other classes have no closed
 *  form here and rely on the pre-flight windows only. */
export const POST_BAR = 2.5e-4;
export function postCheckBlend(doc, f, { kernelVolume, outlineOf }) {
  const sks = (f.targets ?? []).map((id) => doc.features.find((x) => x.id === id));
  if (sks.length !== 2 || sks.some((x) => !x || x.shape !== 'circle')) return null;
  const rad = (s) => Math.hypot(s.points[1][0] - s.points[0][0], s.points[1][1] - s.points[0][1]) / 2;
  const r1 = rad(sks[0]); const r2 = rad(sks[1]); const h = Math.abs((sks[1].offset ?? 0) - (sks[0].offset ?? 0));
  const A1 = Math.PI * r1 * r1; const A2 = Math.PI * r2 * r2; const exact = h / 3 * (A1 + A2 + Math.sqrt(A1 * A2));
  const d = Math.abs(kernelVolume - exact) / exact;
  return d <= POST_BAR ? null : { code: 'volume', d, sentence: 'The solid built for these two circles has a volume that is off from the exact value, so it cannot be trusted; make the circles bigger or the loft shorter.' };
}
