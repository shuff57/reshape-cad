// sketch-geometry guard layer (round 4). Pure functions, no kernel, no wasm. This is the ENFORCEMENT half of the sketch-geometry contract:
// every sketch the measurements showed to build a WRONG solid on the pinned SolidCraft (truck, fe3717f) becomes a refusal with ONE plain
// sentence that this file produces (no engine words, no internal ids, the student's own numbers). Nothing here is typed into the JSON by hand:
// contract/sketch-geometry-harness/build-rows.mjs reads the sentence the guard actually returned for the case that was run.
//
// Lives in contract/ because packages/script, packages/sketch and phase7/translate-p4.mjs are read-only for this campaign.
//
//   import { guardSketch, noticesOf, explainEngineError, plainScriptSentence, scriptProbeVerdict, PROBE_PREAMBLE, repairOutline,
//            piecesSentence, lintSentence } from './sketch-geometry.guard.mjs';
//
// What the guard covers (each maps to a measured failure in sketch-geometry-harness/results/):
//   frame        u/v off unit length or off orthogonal by more than 1e-9 (the language accepts 1e-6; truck normalises, OCCT does not)
//   size         a curved outline under 0.5 mm across (tessellation error up to 58% and a NEGATIVE volume), a flat one under 1e-3 mm
//   outline      a polygon / rounded / bulged outline whose edges cross or touch each other (bow-tie, pentagram, spike, inward bow too deep)
//   treatments   a round/chamfer that is negative, sits on a circle, sits on a straight corner, or leaves a sliver edge; a pair that eats a
//                whole edge is REPAIRED (the zero-length line is dropped, both oracles build it)
//   soup         .geom rows: loose ends (no coincident row), an arc whose ends are not on its circle, a zero-length line, a full-circle arc,
//                a line ending in the middle of another (T junction), shapes that cross, overlap, share an edge, touch, or repeat a shape
//   script       circle(across <= 0), a negative round/chamfer, rect with a 0 side (read by a probe of the call arguments)
//   pieces       a sketch that made several separate pieces: later features cannot work on one piece (see piecesSentence)
//   engine       any engine sentence that still gets through is rewritten by explainEngineError(); lintSentence() proves none leaks
// Round 5 additions:
//   solve        soup sketches are solved by sketch-geometry.solve.mjs (no kernel, no brep-rs); rules that MOVE the rows and leave freedom in what moved are refused
//                (solveVerdict); the host passes ctx.solve to use SolidCraft's own solved rows and SolveReport dof instead
//   values       valuesVerdicts(values): panel / RunOptions.values written after the script ran (round below 0, across or radius at or below 0)
//   corners      guardTypedCorners(sk): typed corners on top of each other, judged BEFORE the rule solve re-shapes the polygon
//   pull         guardPull: a pull of 0 or a non-number; guardFar: a curved outline far from the origin (FAR_RATIO x the part's size)
//   sentences    oneSentence() / studentSentence(): every text the student sees is ONE sentence (the harness lints this on every sentence it reports)

import { solveSoup } from './sketch-geometry.solve.mjs';
export { solveSoup };

export const LIMITS = {
  frameTol: 1e-9,       // |u|-1, |v|-1, u.v: the build is exact to 1e-9 on a unit frame; the language accepts 1e-6
  curvedError: 3e-4,    // relative volume error the curve-size rule allows (the curved bar). See tessError().
  safety: 1.5,          // the estimate is multiplied by this before it is compared (the estimate was 18% low for a 0.003 mm slot: 2.8e-4 estimated, 3.3e-4 measured)
  curvedFloor: 20,      // mm. The mesh tolerance of a part never gets finer than that of a 20 mm part (measured: a 0.1 mm circle is 1.8e-3 off pulled 1 AND pulled 10)
  minFlat: 1e-5,        // mm. Smallest across of a straight-edged outline measured exact (rect 0.00001 x 5 pulled 10: 0 error vs OCCT and brep-rs; 1e-6 is refused by the interpreter)
  minArea: 4e-6,        // mm2. Smallest area of a straight-edged outline measured exact (rect 0.002 x 0.002); 1e-5 x 1e-5 is refused by the engine
  minEdge: 1e-4,        // mm. A remaining edge shorter than this (but not zero) is refused (chamfer / round leaving 1e-4 of an edge builds exactly; 1e-5 and below is refused by the engine)
  minTreatment: 1e-4,   // mm. A round radius / chamfer distance between 0 and this is refused (chamfer 1e-4 builds exactly, 1e-5 is off by 5.6e-8)
  minRadius: 3e-3,      // mm. Smallest arc / circle radius accepted (slot r=0.003 builds, r=0.002 returns a negative volume); recalibrated by floor-slot-long cases
  zero: 1e-9,           // mm. Two corners closer than this are the same point
  join: 1e-7,           // mm. Two ends a coincident row joins must sit this close
  arcEnds: 1e-7,        // mm (+1e-9 r). An arc's two ends must be this close to its radius
  contact: 1e-7,        // mm. Two curves closer than this touch
  gap: 2e-6,            // mm. Two non-neighbour parts of one outline closer than this count as touching (the 3D build snaps ends up to 1e-6 apart; a 1e-5 wide rect builds exactly)
};

const fmt = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v));
const pt = (p) => `(${fmt(p[0])}, ${fmt(p[1])})`;
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const TAU = Math.PI * 2;
const ord = (n) => `corner ${n}`;
/**
 * Turn any text into ONE sentence: a full stop (or ? / !) followed by a new sentence becomes a semicolon and the new sentence starts in lower case.
 * Decimal points, "e.g." style abbreviations and identifiers such as .rect() or sk.line() are left alone. A text that is already one sentence comes back unchanged.
 */
export function oneSentence(text) {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const keep = []; // protect decimals, identifiers with a dot, e.g. / i.e.
  s = s.replace(/(\d\.\d)|(\b(?:e\.g|i\.e|etc)\.)/gi, (m) => { keep.push(m); return `\u0001${keep.length - 1}\u0002`; });
  s = s.replace(/([.!?])\s+(?=[A-Z"'(\[]|\.[a-z])/g, (m, p, off, str) => {
    const rest = str.slice(off + m.length);
    const first = /^[A-Z][a-z]*\b/.exec(rest);
    return '; ' + (first && /^(?:[A-Z]|[A-Z][a-z]+)\b/.test(rest) && !/^[A-Z]{2,}/.test(rest) ? '\u0003' : '');
  });
  s = s.replace(/;\s\u0003([A-Z])/g, (m, c) => '; ' + c.toLowerCase());
  s = s.replace(/\u0003/g, '');
  s = s.replace(/\u0001(\d+)\u0002/g, (m, i) => keep[Number(i)]);
  s = s.replace(/;\s*([.!?])(?=\s|$)/g, '$1');
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}
const verdict = (code, sentence, extra) => ({ code, sentence: oneSentence(sentence), ...(extra ?? {}) });

// ======================================================================================================================
// frame
// ======================================================================================================================
/**
 * Round 6. toScript prints a frame's numbers to 6 decimals, so a frame such as u = (1/sqrt 2, 1/sqrt 2, 0) comes back as (0.707107, 0.707107, 0) with a length of 1.000000309: the
 * part the student SAVED builds, the part they RELOAD would be refused by a strict frame check (measured: 45, 37 and 30 degree frames). Print rounding is at most 5e-7 per
 * component, so it moves a length by at most 8.7e-7 and a dot product by at most 1.3e-6; a frame within FRAME_REPAIR (2e-6, which also covers the 1e-6 the language accepts) is
 * STRAIGHTENED (u divided by its length, v made exactly square to u and unit) with a notice, not refused. Beyond FRAME_REPAIR it is not print rounding and is refused as before.
 */
export const FRAME_REPAIR = 2e-6;
function frameDeviation(sk) {
  const { u, v } = sk.frame; const lu = len3(u); const lv = len3(v); const d = dot3(u, v);
  return { lu, lv, d, worst: Math.max(Math.abs(lu - 1), Math.abs(lv - 1), Math.abs(d)) };
}
/** {frame, worst} with u, v made exactly unit and square (Gram-Schmidt, the handedness is kept) when the frame is off by more than frameTol but at most FRAME_REPAIR; else null. */
export function repairFrame(sk) {
  if (!sk.frame) return null;
  const { u, v, origin } = sk.frame;
  if (![u, v].every((a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))) return null;
  const dev = frameDeviation(sk);
  if (dev.worst <= LIMITS.frameTol || dev.worst > FRAME_REPAIR || !(dev.lu > 0)) return null;
  const un = u.map((c) => c / dev.lu);
  const dv = dot3(v, un); const v1 = v.map((c, i) => c - dv * un[i]); const l1 = len3(v1);
  if (!(l1 > 0.5)) return null; // u and v nearly parallel: not a rounding problem
  return { frame: { origin, u: un, v: v1.map((c) => c / l1) }, worst: dev.worst };
}
export function guardFrame(sk) {
  if (!sk.frame) return null;
  const { u, v } = sk.frame;
  if (![u, v].every((a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))) return verdict('frame-malformed', 'The sketch frame needs u and v as three numbers each.');
  const { lu, lv, d, worst } = frameDeviation(sk);
  const t = LIMITS.frameTol;
  if (worst <= FRAME_REPAIR && repairFrame(sk)) return null; // straightened by repairFrame(), with a notice from frameNotice()
  if (Math.abs(lu - 1) > t) return verdict('frame-not-unit', `The sketch frame's u has length ${lu.toPrecision(10)}, not 1 to within ${FRAME_REPAIR}, so the part would come out scaled; divide u by its length.`);
  if (Math.abs(lv - 1) > t) return verdict('frame-not-unit', `The sketch frame's v has length ${lv.toPrecision(10)}, not 1 to within ${FRAME_REPAIR}, so the part would come out scaled; divide v by its length.`);
  if (Math.abs(d) > t) return verdict('frame-not-square', `The sketch frame's u and v are not at right angles to within ${FRAME_REPAIR} (their dot product is ${d.toExponential(3)}), so the part would come out sheared; make them perpendicular.`);
  return null;
}
/** The notice for a frame that repairFrame() straightened. */
export function frameNotice(sk) {
  const r = repairFrame(sk); if (!r) return null;
  return { code: 'frame-straightened', sentence: `The frame of ${sk.id ? `sketch ${sk.id}` : 'this sketch'} was off exact unit length and right angles by ${r.worst.toExponential(1)} (script text keeps only six decimals of a frame), so it was straightened and the part moves by less than ${fmt(+(r.worst * 10).toPrecision(1))} mm per 10 mm of size.` };
}

// ======================================================================================================================
// classic outline (rect / circle / polygon / rounds / chamfers / bulges)
// ======================================================================================================================
const isSoup = (sk) => sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;

/** sampled outline of a classic sketch: {pts, owner}. Arcs every 2 degrees. */
function sampleOutline(o, arc, step = TAU / 180) {
  const P = o.points; const n = P.length; const pts = []; const owner = [];
  for (let i = 0; i < n; i++) {
    const a = P[i]; const b = P[(i + 1) % n];
    pts.push([a[0], a[1]]); owner.push(i);
    const g = o.bulges?.[i];
    if (!g) continue;
    const { center, radius, startAngle, endAngle } = arc.arcFromBulge(a, b, g);
    let sweep = endAngle - startAngle;
    if (g > 0 && sweep < 0) sweep += TAU;
    if (g < 0 && sweep > 0) sweep -= TAU;
    const k = Math.max(2, Math.ceil(Math.abs(sweep) / step));
    for (let j = 1; j < k; j++) { const t = startAngle + (sweep * j) / k; pts.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]); owner.push(i); }
  }
  return { pts, owner };
}
function segDist(p, q, r, s) {
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0) return -1; // a proper crossing
  const pd = (a, b, c) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l)) : 0; return Math.hypot(a[0] + t * dx - c[0], a[1] + t * dy - c[1]); };
  return Math.min(pd(p, q, r), pd(p, q, s), pd(r, s, p), pd(r, s, q));
}
/** smallest distance between segments of non-neighbouring edges of a closed sampled outline, with the pair of edge indices */
function selfClearance(P, owner, nEdges) {
  const n = P.length; let best = Infinity; let who = null;
  const near = (a, b) => { const d = Math.abs(a - b); return d <= 1 || d === nEdges - 1; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = segDist(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n]);
    // neighbouring edges share a vertex, so only a PROPER crossing counts for them (an arc can leave a neighbour and cross it again)
    if (near(owner[i], owner[j]) && d >= 0) continue;
    if (d < best) { best = d; who = [owner[i], owner[j]]; }
    if (best < 0) return { d: -1, who };
  }
  return { d: best, who };
}

/**
 * The outline the build is given, with zero-length straight edges dropped. A round/chamfer pair whose trims together eat a whole edge
 * leaves two coincident points and a 0-length line between two arcs/lines; the 3D engine refuses a zero-length line, OCCT and the old
 * kernel build the pair. Dropping the duplicate point (bulge of the dropped edge is 0 by construction) gives the oracle's geometry.
 * Only used when rounds/chamfers produced the points; a typed polygon with a repeated vertex is refused, not repaired.
 */
export function repairOutline(out, sk) {
  if (!out?.ok || sk.shape === 'circle') return out;
  if (!Object.keys(sk.rounds ?? {}).length && !Object.keys(sk.chamfers ?? {}).length) return out;
  const P = out.points; const B = out.bulges ?? {}; const n = P.length;
  const keep = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!B[i] && hyp(P[i], P[j]) < LIMITS.zero) continue; // drop point i: the next point is the same spot
    keep.push(i);
  }
  if (keep.length === n) return out;
  const nb = {};
  keep.forEach((old, k) => { if (B[old]) nb[k] = B[old]; });
  return { ...out, points: keep.map((i) => P[i]), bulges: nb, repaired: n - keep.length };
}

/** Notices (not refusals): a round / chamfer the corner could not take in full. */
export function noticesOf(sk, arc) {
  if (isSoup(sk) || sk.shape === 'circle') return [];
  const out = arc.outlineOf(sk);
  return (out.notes ?? []).map((n) => {
    const kind = (sk.chamfers && sk.chamfers[n.corner] !== undefined && !(sk.rounds && sk.rounds[n.corner] > 0)) ? 'chamfer' : 'round';
    const what = kind === 'round' ? 'radius' : 'distance';
    return { code: 'treatment-clamped', corner: n.corner + 1, want: n.want, got: n.got,
      sentence: `Corner ${n.corner + 1}: you asked for a ${kind} ${what} of ${fmt(n.want)} but the corner can only take ${fmt(n.got)}, so ${fmt(n.got)} was used.` };
  });
}

function guardTreatments(sk, arc) {
  const rounds = sk.rounds ?? {}; const chamfers = sk.chamfers ?? {};
  const asks = [...Object.entries(rounds).map(([k, v]) => ({ k: Number(k), kind: 'round', v })), ...Object.entries(chamfers).map(([k, v]) => ({ k: Number(k), kind: 'chamfer', v }))];
  if (!asks.length) return null;
  // round 6: a corner asked to take BOTH a round and a chamfer. The outline builder keeps the round and drops the chamfer (the oracles do the same), so the student's second request would vanish without a word.
  for (const [k, rv] of Object.entries(rounds)) {
    const cv = chamfers[k];
    if (rv > 0 && cv > 0) return verdict('round-and-chamfer', `${ord(Number(k) + 1)} was given both a round (radius ${fmt(rv)}) and a chamfer (distance ${fmt(cv)}), but a corner can take only one of them and the build would silently drop the chamfer; keep the .round() or the .chamfer() for this corner and remove the other.`);
  }
  if (sk.shape === 'circle') {
    const a = asks.find((x) => x.v !== 0);
    if (a) return verdict('treatment-on-circle', `A circle has no corners, so a ${a.kind} cannot be applied to it; remove the .${a.kind}() or draw the shape as a polygon.`);
    return null;
  }
  for (const a of asks) {
    if (!Number.isFinite(a.v)) return verdict('treatment-not-number', `The ${a.kind} on ${ord(a.k + 1)} is not a number.`);
    if (a.v < 0) return verdict('treatment-negative', `The ${a.kind} on ${ord(a.k + 1)} is ${fmt(a.v)}; a ${a.kind} needs a ${a.kind === 'round' ? 'radius' : 'distance'} of 0 or more (0 leaves the corner sharp).`);
    if (a.v > 0 && a.v < LIMITS.minTreatment) return verdict('treatment-tiny', `The ${a.kind} on ${ord(a.k + 1)} is ${fmt(a.v)} mm, smaller than the ${LIMITS.minTreatment} mm this build keeps exact; use 0 for a sharp corner or at least ${LIMITS.minTreatment}.`);
    if (a.v > 0) {
      const ceil = a.kind === 'round' ? arc.maxFilletRadius(sk.points, a.k, sk.bulges) : arc.maxChamferDistance(sk.points, a.k, sk.bulges);
      if (!(ceil > 0)) {
        const why = a.kind === 'round' ? arc.whyCannotRoundCorner(sk.points, a.k, sk.bulges) : arc.whyCannotChamferCorner?.(sk.points, a.k, sk.bulges);
        return verdict('treatment-impossible', `${ord(a.k + 1)} cannot take a ${a.kind}: ${(why ?? 'its edges leave no room for it').replace(/shCode/g, 'the sketch tool').replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\s*Drag .*$/, '')}`.replace(/\.?$/, '.'));
      }
    }
  }
  return null;
}

/**
 * Corners the student TYPED (or a box wrote) that sit on top of each other, looked at BEFORE the rules re-solve the sketch. A rule solve can pull such a polygon apart into
 * a different shape (measured: slider p1u/p1v of a .rect() set onto corner 1: the interpreter's solve gives a 5 mm wide sliver, brep-rs' own solve gives the 10 mm wide
 * triangle; the 3D build and the oracle disagree by 100% in bbox), so the typed corners are judged first.
 */
export function guardTypedCorners(sk) {
  if (isSoup(sk) || sk.shape === 'circle' || !Array.isArray(sk.points)) return null;
  const P = sk.points; const n = P.length; const scale = Math.max(1, ...P.flat().map(Math.abs));
  for (let i = 0; i < n; i++) {
    const d = hyp(P[i], P[(i + 1) % n]);
    if (d < 1e-6 * scale) return verdict('edge-no-length', d === 0
      ? `${ord(i + 1)} and ${ord(((i + 1) % n) + 1)} sit on the same point ${pt(P[i])}, so the edge between them has no length; remove one of the two points.`
      : `${ord(i + 1)} and ${ord(((i + 1) % n) + 1)} are only ${fmt(d)} mm apart, too close to count as two separate corners, so the edge between them is too short to build; remove one of the two points or move them further apart.`);
  }
  return null;
}

/** Guard one classic (non-soup) sketch. Returns null or {code, sentence}. */
export function guardClassic(sk, arc) {
  const t = guardTreatments(sk, arc); if (t) return t;
  const out = arc.outlineOf(sk);
  if (!out.ok) {
    // a typed polygon with two corners on top of each other
    const P = sk.points; const n = P.length;
    for (let i = 0; i < n; i++) if (hyp(P[i], P[(i + 1) % n]) < 1e-6 * Math.max(1, ...P.flat().map(Math.abs))) {
      const d = hyp(P[i], P[(i + 1) % n]);
      return verdict('edge-no-length', d === 0
        ? `${ord(i + 1)} and ${ord(((i + 1) % n) + 1)} sit on the same point ${pt(P[i])}, so the edge between them has no length; remove one of the two points.`
        : `${ord(i + 1)} and ${ord(((i + 1) % n) + 1)} are only ${fmt(d)} mm apart, too close to count as two separate corners, so the edge between them is too short to build; remove one of the two points or move them further apart.`);
    }
    return verdict('outline-unusable', 'This outline has no usable shape; check that its corners are not on top of each other or on one line.');
  }
  const rep = repairOutline(out, sk);
  if (sk.shape === 'circle') {
    const [a, b] = rep.points; const d = hyp(a, b);
    if (!(d > 0)) return verdict('circle-no-size', 'This circle has no size (its across is 0); give .circle() an across above 0.');
    if (d / 2 < LIMITS.minRadius) return verdict('too-small-curved', `This circle is ${fmt(d)} mm across; arcs with a radius under ${LIMITS.minRadius} mm cannot be built exactly here. Make it larger.`);
    return null;
  }
  { // every corner on one straight line: no area (a spike check would call this a fold)
    const P = rep.points; let far = [P[0], P[0]]; let best = 0;
    for (const a of P) for (const b of P) { const d = hyp(a, b); if (d > best) { best = d; far = [a, b]; } }
    const off = best > 0 ? Math.max(...P.map((q) => Math.abs((far[1][0] - far[0][0]) * (q[1] - far[0][1]) - (far[1][1] - far[0][1]) * (q[0] - far[0][0])) / best)) : 0;
    if (!(best > 0) || off <= 1e-9 * Math.max(1, best)) return verdict('no-area', 'This outline has no area (all its corners lie on one line); move at least one corner off the line.');
  }
  { // a straight edge that doubles back along the edge before it leaves a spike with no width
    const P = rep.points; const nn = P.length;
    for (let i = 0; i < nn; i++) {
      if (rep.bulges?.[i] || rep.bulges?.[(i + 1) % nn]) continue;
      const a = P[i]; const b = P[(i + 1) % nn]; const c = P[(i + 2) % nn];
      const u = [b[0] - a[0], b[1] - a[1]]; const v = [c[0] - b[0], c[1] - b[1]]; const lu = Math.hypot(...u); const lv = Math.hypot(...v);
      if (lu > 0 && lv > 0 && Math.abs(u[0] * v[1] - u[1] * v[0]) <= 1e-9 * lu * lv && u[0] * v[0] + u[1] * v[1] < 0) return verdict('edge-folds-back', `${ord(((i + 1) % nn) + 1)} sends the outline straight back along the edge it came from, leaving a spike with no width; move the corner off that line.`);
    }
  }
  const o = { ...rep, shape: sk.shape };
  const { pts, owner } = sampleOutline(o, arc);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs); const h = Math.max(...ys) - Math.min(...ys);
  const curved = Object.values(rep.bulges ?? {}).some((g) => g);
  if (!(w > 0) || !(h > 0)) return verdict('no-area', 'This outline has no area (all its corners lie on one line); move at least one corner off the line.');
  if (Math.min(w, h) < LIMITS.minFlat) return verdict('too-small-flat', `This outline is ${fmt(Math.min(w, h))} mm across, smaller than the ${LIMITS.minFlat} mm this build keeps exact; draw it larger.`);
  if (curved) {
    for (const [i, g] of Object.entries(sk.bulges ?? {})) { // the arcs the student drew (the arcs a round makes are covered by the treatment floor)
      if (!g) continue;
      const r = arc.arcFromBulge(sk.points[Number(i)], sk.points[(Number(i) + 1) % sk.points.length], g).radius;
      if (r < LIMITS.minRadius) return verdict('too-small-curved', `An arc of this outline has a radius of ${fmt(r)} mm; arcs under ${LIMITS.minRadius} mm cannot be built exactly here. Make it larger.`);
    }
  }
  // shortest straight/arc-chord edge that is left
  const n = rep.points.length;
  const treated = Object.keys(sk.rounds ?? {}).length + Object.keys(sk.chamfers ?? {}).length > 0;
  const designMin = Math.min(...sk.points.map((p, i) => hyp(p, sk.points[(i + 1) % sk.points.length])));
  for (let i = 0; i < n && treated; i++) { // an edge a round / chamfer left (a shorter edge than any the student drew)
    const l = hyp(rep.points[i], rep.points[(i + 1) % n]);
    if (l < LIMITS.minEdge * 0.999 && l < designMin * 0.999) {
      const near = (sk.points ?? []).length;
      return verdict('edge-sliver', `After the rounds and chamfers, one edge of this outline is only ${fmt(l)} mm long; leave at least ${LIMITS.minEdge} mm of it (or make the two corners eat it exactly, with nothing left).`, { near });
    }
  }
  const c = selfClearance(pts, owner, n);
  if (c.d <= LIMITS.gap) {
    const e = c.who ? ` (edges ${c.who[0] + 1} and ${c.who[1] + 1})` : '';
    return c.d < 0
      ? verdict('outline-crosses', `Two edges of this outline cross each other${e}, so it does not enclose one area; redraw it without crossing, or shrink the round / chamfer / bow that makes it fold back.`)
      : verdict('outline-touches', `Two parts of this outline touch each other${e}, so it does not enclose one clean area; pull them apart.`);
  }
  { let ar = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; ar += p[0] * q[1] - q[0] * p[1]; }
    if (Math.abs(ar) / 2 < LIMITS.minArea) return verdict('too-small-flat', `This outline encloses only ${fmt(Math.abs(ar) / 2)} mm2, smaller than the ${LIMITS.minArea} mm2 this build keeps exact; draw it larger.`); }
  return null;
}

// ======================================================================================================================
// soup (.geom rows, slots, several shapes)
// ======================================================================================================================
const live = (g) => !g.construction && g.k !== 'point';
const ENDS = { line: ['a', 'b'], arc: ['a', 'b'] };
const kindWord = (g) => (g.k === 'circle' ? 'circle' : g.k === 'arc' ? 'arc' : 'line');
const name = (g) => `${kindWord(g)} ${g.id}`;
const endPt = (g, e) => (e === 'a' ? g.a : e === 'b' ? g.b : g.c);

function arcSweep(g) {
  const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]); const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
  let sw = (((a1 - a0) % TAU) + TAU) % TAU;
  if (g.sense === 'cw') sw = sw === 0 ? -TAU : sw - TAU; else if (sw === 0) sw = TAU;
  return { a0, sweep: sw };
}
const angIn = (ang, a0, sw, eps) => { // is `ang` inside the arc starting at a0 sweeping sw (signed)? returns 'in' | 'end' | 'out'
  let d = sw >= 0 ? (((ang - a0) % TAU) + TAU) % TAU : (((a0 - ang) % TAU) + TAU) % TAU;
  const L = Math.abs(sw);
  if (d < eps || Math.abs(d - TAU) < eps) return 'end';
  if (Math.abs(d - L) < eps) return 'end';
  return d < L ? 'in' : 'out';
};

/** primitive view of a geom row */
function prim(g) {
  if (g.k === 'line') return { g, t: 'seg', p: g.a, q: g.b };
  if (g.k === 'circle') return { g, t: 'circ', c: g.c, r: g.r };
  const r = (hyp(g.a, g.c) + hyp(g.b, g.c)) / 2; const { a0, sweep } = arcSweep(g);
  return { g, t: 'arc', c: g.c, r, a0, sweep };
}

/**
 * Contacts between two primitives: [{pt, a:'int'|'end', b:'int'|'end', tangent:boolean}] and `overlap` (a stretch in common).
 */
function contacts(P, Q, eps) {
  const out = []; let overlap = false;
  const add = (p, a, b, tangent) => out.push({ pt: p, a, b, tangent: !!tangent });
  const segSeg = (S, T) => {
    const d = [S.q[0] - S.p[0], S.q[1] - S.p[1]]; const e = [T.q[0] - T.p[0], T.q[1] - T.p[1]];
    const ls = Math.hypot(...d); const lt = Math.hypot(...e);
    const den = d[0] * e[1] - d[1] * e[0];
    const w = [T.p[0] - S.p[0], T.p[1] - S.p[1]];
    if (Math.abs(den) <= 1e-12 * ls * lt) { // parallel
      const dist = Math.abs(w[0] * d[1] - w[1] * d[0]) / ls;
      if (dist > eps) return;
      const t0 = (w[0] * d[0] + w[1] * d[1]) / ls; // T.p along S
      const t1 = t0 + (e[0] * d[0] + e[1] * d[1]) / ls;
      const lo = Math.max(0, Math.min(t0, t1)); const hi = Math.min(ls, Math.max(t0, t1));
      if (hi - lo > eps) { overlap = true; return; }
      if (hi - lo >= -eps) { // meet at one point
        const p = [S.p[0] + (d[0] / ls) * lo, S.p[1] + (d[1] / ls) * lo];
        add(p, lo < eps || lo > ls - eps ? 'end' : 'int', hyp(p, T.p) < eps || hyp(p, T.q) < eps ? 'end' : 'int');
      }
      return;
    }
    const s = (w[0] * e[1] - w[1] * e[0]) / den; const u = (w[0] * d[1] - w[1] * d[0]) / den;
    const es = eps / ls; const et = eps / lt;
    if (s < -es || s > 1 + es || u < -et || u > 1 + et) return;
    add([S.p[0] + s * d[0], S.p[1] + s * d[1]], s < es || s > 1 - es ? 'end' : 'int', u < et || u > 1 - et ? 'end' : 'int');
  };
  const segCirc = (S, C) => { // C is circ or arc
    const d = [S.q[0] - S.p[0], S.q[1] - S.p[1]]; const ls = Math.hypot(...d);
    const f = [S.p[0] - C.c[0], S.p[1] - C.c[1]];
    const h = Math.abs(f[0] * d[1] - f[1] * d[0]) / ls; // distance from centre to the infinite line
    const tm = -(f[0] * d[0] + f[1] * d[1]) / (ls * ls); // param of the foot point
    const hits = [];
    if (Math.abs(h - C.r) <= eps) hits.push({ t: tm, tangent: true });
    else if (h < C.r) { const dt = Math.sqrt(C.r * C.r - h * h) / ls; hits.push({ t: tm - dt, tangent: false }, { t: tm + dt, tangent: false }); }
    for (const x of hits) {
      const es = eps / ls;
      if (x.t < -es || x.t > 1 + es) continue;
      const p = [S.p[0] + x.t * d[0], S.p[1] + x.t * d[1]];
      let cpos = 'int';
      if (C.t === 'arc') { const where = angIn(Math.atan2(p[1] - C.c[1], p[0] - C.c[0]), C.a0, C.sweep, eps / C.r); if (where === 'out') continue; cpos = where === 'end' ? 'end' : 'int'; }
      add(p, x.t < es || x.t > 1 - es ? 'end' : 'int', cpos, x.tangent);
    }
  };
  const circCirc = (A, B) => {
    const d = hyp(A.c, B.c);
    if (d < eps && Math.abs(A.r - B.r) < eps) { // same circle: overlap unless two arcs on it that do not share a stretch
      if (A.t === 'circ' || B.t === 'circ') { overlap = true; return; }
      const sa = A.sweep >= 0 ? [A.a0, A.sweep] : [A.a0 + A.sweep, -A.sweep]; const sb = B.sweep >= 0 ? [B.a0, B.sweep] : [B.a0 + B.sweep, -B.sweep];
      const lo = (x) => ((x % TAU) + TAU) % TAU;
      const a1 = lo(sa[0]); const b1 = lo(sb[0]);
      const ovl = (x0, xl, y0, yl) => { const dd = lo(y0 - x0); return dd < xl - eps / A.r || dd + yl > TAU + eps / A.r; };
      if (ovl(a1, sa[1], b1, sb[1]) || ovl(b1, sb[1], a1, sa[1])) overlap = true;
      return;
    }
    if (d > A.r + B.r + eps || d < Math.abs(A.r - B.r) - eps) return;
    const tangent = Math.abs(d - (A.r + B.r)) <= eps || Math.abs(d - Math.abs(A.r - B.r)) <= eps;
    const base = Math.atan2(B.c[1] - A.c[1], B.c[0] - A.c[0]);
    const cosv = Math.max(-1, Math.min(1, (A.r * A.r + d * d - B.r * B.r) / (2 * A.r * d)));
    const da = tangent ? 0 : Math.acos(cosv);
    for (const sg of (tangent ? [1] : [1, -1])) {
      const ang = base + sg * da;
      // tangent externally: the point is on the line of centres, away from B when A.r+B.r=d
      const p = [A.c[0] + A.r * Math.cos(ang), A.c[1] + A.r * Math.sin(ang)];
      let pa = 'int'; let pb = 'int';
      if (A.t === 'arc') { const w = angIn(ang, A.a0, A.sweep, eps / A.r); if (w === 'out') continue; pa = w === 'end' ? 'end' : 'int'; }
      if (B.t === 'arc') { const w = angIn(Math.atan2(p[1] - B.c[1], p[0] - B.c[0]), B.a0, B.sweep, eps / B.r); if (w === 'out') continue; pb = w === 'end' ? 'end' : 'int'; }
      add(p, pa, pb, tangent);
    }
  };
  if (P.t === 'seg' && Q.t === 'seg') segSeg(P, Q);
  else if (P.t === 'seg') segCirc(P, Q);
  else if (Q.t === 'seg') { const before = out.length; segCirc(Q, P); for (let i = before; i < out.length; i++) { const x = out[i]; [x.a, x.b] = [x.b, x.a]; } }
  else circCirc(P, Q);
  return { list: out, overlap };
}

function polyOf(p, n = 180) {
  if (p.t === 'seg') return [p.p, p.q];
  if (p.t === 'circ') return Array.from({ length: n }, (_, k) => [p.c[0] + p.r * Math.cos((TAU * k) / n), p.c[1] + p.r * Math.sin((TAU * k) / n)]);
  return Array.from({ length: n + 1 }, (_, k) => [p.c[0] + p.r * Math.cos(p.a0 + (p.sweep * k) / n), p.c[1] + p.r * Math.sin(p.a0 + (p.sweep * k) / n)]);
}
const inPoly = (pt0, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]; const b = poly[j]; if ((a[1] > pt0[1]) !== (b[1] > pt0[1]) && pt0[0] < ((b[0] - a[0]) * (pt0[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const areaOf = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i]; const q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

// ---- round 6: exact even-odd regions of a soup (area by Green's theorem, loops chained by their ends, one interior point per solid region) --------------------
/**
 * The closed loops of the live rows of a soup, chained end to end by coincident ends (1e-6), each with a fine polygon, its EXACT area (lines and arcs by Green's theorem, a circle
 * as pi r^2: no sampling error), its nesting depth (how many other loops contain it) and the solid area by the even-odd rule (depth 0 solid, 1 hole, 2 solid ...).
 * `count` = the number of separate solid regions (loops at an even depth): the number of pieces the pull must make. `ok:false` when a chain does not close (the guard has refused such soups before).
 */
export function soupRegions(rows) {
  const L = rows.filter(live);
  if (!L.length) return { ok: false, loops: [], solidArea: 0, count: 0 };
  const tol = 1e-6;
  const P = L.map((g) => (g.k === 'line' ? { g, ends: [g.a, g.b] } : g.k === 'arc' ? { g, ends: [g.a, g.b] } : { g, ends: [] }));
  const used = new Set(); const loops = [];
  for (let s = 0; s < P.length; s++) {
    if (used.has(s)) continue;
    const g0 = P[s].g;
    if (g0.k === 'circle') {
      used.add(s); const n = 1440;
      loops.push({ poly: Array.from({ length: n }, (_, k) => [g0.c[0] + g0.r * Math.cos((TAU * k) / n), g0.c[1] + g0.r * Math.sin((TAU * k) / n)]), area: Math.PI * g0.r * g0.r });
      continue;
    }
    used.add(s);
    const poly = []; let green = 0; let start = g0.a; let at;
    const walk = (g, fromA) => {
      if (g.k === 'line') { const a = fromA ? g.a : g.b; const b = fromA ? g.b : g.a; poly.push(a); green += (a[0] * b[1] - b[0] * a[1]) / 2; return b; }
      const r = (hyp(g.a, g.c) + hyp(g.b, g.c)) / 2; const { a0, sweep } = arcSweep(g);
      const s0 = fromA ? a0 : a0 + sweep; const w = fromA ? sweep : -sweep;
      const n = Math.max(8, Math.ceil(Math.abs(w) / (TAU / 720)));
      for (let k = 0; k < n; k++) poly.push([g.c[0] + r * Math.cos(s0 + (w * k) / n), g.c[1] + r * Math.sin(s0 + (w * k) / n)]);
      green += (r * r * w + g.c[0] * r * (Math.sin(s0 + w) - Math.sin(s0)) - g.c[1] * r * (Math.cos(s0 + w) - Math.cos(s0))) / 2;
      return fromA ? g.b : g.a;
    };
    at = walk(g0, true); let closed = false;
    for (let guard = 0; guard < P.length + 1; guard++) {
      if (hyp(at, start) < tol) { closed = true; break; }
      const k = P.findIndex((q, i) => !used.has(i) && q.ends.length && (hyp(q.ends[0], at) < tol || hyp(q.ends[1], at) < tol));
      if (k < 0) break;
      used.add(k); at = walk(P[k].g, hyp(P[k].ends[0], at) < tol);
    }
    if (!closed) return { ok: false, loops: [], solidArea: 0, count: 0 };
    loops.push({ poly, area: Math.abs(green) });
  }
  loops.forEach((l, i) => { const probe = l.poly[Math.floor(l.poly.length / 3)]; l.depth = loops.filter((q, j) => j !== i && inPoly(probe, q.poly)).length; });
  const solidArea = loops.reduce((a, l) => a + (l.depth % 2 === 0 ? 1 : -1) * l.area, 0);
  return { ok: true, loops, solidArea, count: loops.filter((l) => l.depth % 2 === 0).length };
}
/**
 * One interior point per solid region of a soup, for a host that picks profiles by point. Found by horizontal scan lines through every loop: along a scan line the even-odd
 * rule gives the solid stretches, the midpoint of a stretch is as far from every edge as the stretch is wide, and the loop that owns the point is the deepest loop containing it.
 * The widest stretch of each region wins, so a ring only 1e-4 of its width thick still gets exactly ONE point (a picker that takes a point at each side of the ring pulls it four times).
 */
export function regionPoints(rows) {
  const R = soupRegions(rows);
  if (!R.ok) return [];
  const loops = R.loops;
  const owner = (m) => { let best = -1; let bd = -1; loops.forEach((l, i) => { if (inPoly(m, l.poly) && l.depth > bd) { bd = l.depth; best = i; } }); return best; };
  const out = [];
  loops.forEach((l, li) => {
    if (l.depth % 2 !== 0) return;
    const ys = [...new Set(l.poly.map((q) => q[1]))].sort((a, b) => a - b);
    const bands = []; for (let k = 0; k + 1 < ys.length; k++) if (ys[k + 1] - ys[k] > 0) bands.push((ys[k] + ys[k + 1]) / 2);
    const step = Math.max(1, Math.ceil(bands.length / 120));
    let best = null;
    for (let b = 0; b < bands.length; b += step) {
      const y = bands[b]; const xs = [];
      for (const q of loops) for (let i = 0, n = q.poly.length; i < n; i++) { const a = q.poly[i]; const c = q.poly[(i + 1) % n]; if ((a[1] > y) !== (c[1] > y)) xs.push(a[0] + ((y - a[1]) * (c[0] - a[0])) / (c[1] - a[1])); }
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const w = xs[k + 1] - xs[k]; if (!(w > 0)) continue;
        const m = [(xs[k] + xs[k + 1]) / 2, y];
        if (owner(m) !== li) continue;
        if (!best || w > best.w) best = { w, m };
      }
    }
    if (best) out.push(best.m);
  });
  return out;
}

/**
 * Guard one soup sketch. `geoms` are the SOLVED rows (the host reads them back from the build; the rig takes them from the sketch session),
 * `rules` the sketch's rows. Returns null or {code, sentence}.
 */
export function guardSoup(geoms, rules = [], rawGeoms = null) {
  return analyseSoup(geoms, rules, rawGeoms).verdict;
}
const RADIUS_RULES = new Set(['radius', 'diameter', 'equal']);
/** {verdict, solid, curved}: the verdict of guardSoup plus the even-odd solid area and whether any shape is curved. */
export function analyseSoup(geoms, rules = [], rawGeoms = null) {
  let info = { solid: 0, curved: geoms.some((g) => live(g) && g.k !== 'line') };
  const v = soupVerdict(geoms, rules, rawGeoms, info);
  return { verdict: v, ...info };
}
/** rows as the 3D build is handed them: an arc whose radius disagrees with its ends and that no radius rule drives is a different arc */
export function rawArcVerdict(rawGeoms, rules) {
  for (const g of (rawGeoms ?? []).filter(live)) {
    if (g.k !== 'arc') continue;
    const ra = hyp(g.a, g.c); const rb = hyp(g.b, g.c); const tol = LIMITS.arcEnds + 1e-9 * Math.max(ra, rb);
    const bad = Math.abs(ra - rb) > tol || (typeof g.r === 'number' && Math.abs(g.r - (ra + rb) / 2) > tol);
    if (bad && !rules.some((r) => r.active !== false && RADIUS_RULES.has(r.k) && (r.a === g.id || r.b === g.id))) {
      return typeof g.r === 'number' && Math.abs(ra - rb) <= tol
        ? verdict('arc-radius-mismatch', `Arc ${g.id} is set to radius ${fmt(g.r)} but its ends are ${fmt((ra + rb) / 2)} from its centre, and no rule pins the radius, so the arc would not be the one you set; add a radius rule, or make the radius and the ends agree.`)
        : verdict('arc-ends-off-circle', `Arc ${g.id} starts ${fmt(ra)} from its centre but ends ${fmt(rb)} from it, and no rule pins its radius; both ends of an arc must sit on the same circle. Move an end, or dimension the radius.`);
    }
  }
  return null;
}
function soupVerdict(geoms, rules, rawGeoms, info) {
  const rawArc = rawArcVerdict(rawGeoms, rules); if (rawArc) return rawArc;
  const L = geoms.filter(live);
  if (!L.length) return verdict('soup-empty', geoms.some((g) => g.construction) ? 'Every shape in this sketch is construction geometry, so there is no outline to build; make at least one closed shape a real (not construction) shape.' : 'This sketch has no lines, arcs or circles to build.');
  const scale = Math.max(1, ...L.flatMap((g) => (g.k === 'circle' ? [Math.abs(g.c[0]) + g.r, Math.abs(g.c[1]) + g.r] : [g.a, g.b, ...(g.c ? [g.c] : [])].flat().map(Math.abs))));
  const eps = LIMITS.contact * Math.max(1, scale / 100);
  // ---- per-row sanity
  for (const g of L) {
    if (g.k === 'line' && hyp(g.a, g.b) < LIMITS.zero) return verdict('line-no-length', `Line ${g.id} starts and ends at the same point ${pt(g.a)}, so it has no length; move one end or remove the line.`);
    if (g.k === 'circle' && !(g.r > 0)) return verdict('circle-no-size', `Circle ${g.id} has no size; its radius must be above 0.`);
    if (g.k === 'arc') {
      if (hyp(g.a, g.b) < LIMITS.zero) return verdict('arc-full-circle', `Arc ${g.id} starts and ends at the same point ${pt(g.a)}, which would be a full circle; draw a circle instead.`);
      const ra = hyp(g.a, g.c); const rb = hyp(g.b, g.c); const tol = LIMITS.arcEnds + 1e-9 * Math.max(ra, rb);
      if (Math.abs(ra - rb) > tol) return verdict('arc-ends-off-circle', `Arc ${g.id} starts ${fmt(ra)} from its centre but ends ${fmt(rb)} from it; both ends of an arc must sit on the same circle. Move one end, or dimension the radius.`);
      if (typeof g.r === 'number' && Math.abs(g.r - (ra + rb) / 2) > tol) return verdict('arc-radius-mismatch', `Arc ${g.id} is set to radius ${fmt(g.r)} but its ends are ${fmt((ra + rb) / 2)} from its centre; make the radius and the ends agree (add a radius rule, or move the ends).`);
      if (Math.min(ra, rb) < LIMITS.minRadius) return verdict('too-small-curved', `Arc ${g.id} has a radius of ${fmt(Math.min(ra, rb))} mm; arcs under ${LIMITS.minRadius} mm cannot be built exactly here. Make it larger.`);
    }
    if (g.k === 'circle' && g.r < LIMITS.minRadius) return verdict('too-small-curved', `Circle ${g.id} is ${fmt(2 * g.r)} mm across; circles under ${fmt(2 * LIMITS.minRadius)} mm across cannot be built exactly here. Make it larger.`);
  }
  // ---- joins: coincident rows between ends of lines/arcs
  const key = (id, e) => `${id}:${e}`;
  const parent = new Map(); const fd = (x) => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r; };
  const byId = new Map(geoms.map((g) => [g.id, g]));
  const isEnd = (id, e) => { const g = byId.get(id); return g && live(g) && ENDS[g.k]?.includes(e ?? 'a'); };
  for (const g of L) for (const e of ENDS[g.k] ?? []) fd(key(g.id, e));
  const joinsOf = [];
  for (const r of rules) {
    if (r.k !== 'coincident' || r.active === false) continue;
    const ae = r.aEnd ?? 'a'; const be = r.bEnd ?? 'a';
    if (!isEnd(r.a, ae) || !isEnd(r.b, be)) continue;
    const ga = byId.get(r.a); const gb = byId.get(r.b);
    const d = hyp(endPt(ga, ae), endPt(gb, be));
    if (d > LIMITS.join) return verdict('join-apart', `${name(ga)} and ${name(gb)} are joined by a coincident row but their ends sit ${fmt(d)} mm apart; fix the rows so the joined ends meet.`);
    parent.set(fd(key(r.a, ae)), fd(key(r.b, be)));
    joinsOf.push([key(r.a, ae), key(r.b, be)]);
  }
  const clusters = new Map();
  for (const g of L) for (const e of ENDS[g.k] ?? []) { const root = fd(key(g.id, e)); (clusters.get(root) ?? clusters.set(root, []).get(root)).push({ g, e }); }
  for (const members of clusters.values()) {
    if (members.length === 1) { const { g, e } = members[0]; return verdict('loose-end', `${name(g)} ends at ${pt(endPt(g, e))} and nothing says it meets another edge, so the outline does not close; join it to the next edge with a coincident row.`); }
    if (members.length > 2) return verdict('junction', `${members.map((m) => name(m.g)).join(', ')} all meet at ${pt(endPt(members[0].g, members[0].e))}; an outline can have only two edges at a corner.`);
  }
  // ---- primitives and loops
  const prims = L.map(prim);
  const idx = new Map(prims.map((p, i) => [p.g.id, i]));
  const lp = prims.map((_, i) => i); const lf = (i) => (lp[i] === i ? i : (lp[i] = lf(lp[i])));
  const nodeOf = new Map(); // cluster root -> [prim index]
  for (const [root, members] of clusters) { const is = members.map((m) => idx.get(m.g.id)); nodeOf.set(root, { is, pt: endPt(members[0].g, members[0].e) }); lp[lf(is[0])] = lf(is[1]); }
  const loopOf = prims.map((_, i) => lf(i));
  const shared = (i, j) => [...nodeOf.values()].filter((n) => n.is.includes(i) && n.is.includes(j)).map((n) => n.pt);
  // ---- pairwise contacts (overlaps are reported before any touch or crossing)
  const cache = new Map();
  const contactsOf = (i, j) => { const k = i * 100003 + j; if (!cache.has(k)) cache.set(k, contacts(prims[i], prims[j], eps)); return cache.get(k); };
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < prims.length; i++) for (let j = i + 1; j < prims.length; j++) {
    const P = prims[i]; const Q = prims[j];
    const c = contactsOf(i, j);
    if (pass === 0 && !c.overlap) continue;
    if (pass === 1 && c.overlap) continue;
    const sameLoop = loopOf[i] === loopOf[j];
    const nodes = shared(i, j);
    const desc = `${name(P.g)} and ${name(Q.g)}`;
    if (c.overlap) {
      const same = P.t === 'circ' && Q.t === 'circ' && hyp(P.c, Q.c) < eps && Math.abs(P.r - Q.r) < eps;
      return same
        ? verdict('shape-repeated', `${name(P.g)} and ${name(Q.g)} are the same circle drawn twice, so nothing would be solid; remove one of them.`)
        : verdict('shape-overlaps', `${desc} lie along each other for part of their length, so the outline is not one clean edge there; the shapes cannot share an edge. Separate them, or draw one outline.`);
    }
    for (const x of c.list) {
      if (x.a === 'end' && x.b === 'end' && nodes.some((n) => hyp(n, x.pt) < eps * 4)) continue; // the joined corner itself
      if (x.tangent && x.a === 'int' && x.b === 'int' && !sameLoop && P.t !== 'seg' && Q.t !== 'seg') continue; // two round shapes that just touch (measured as a PASS against FreeCAD)
      if (x.a === 'end' && x.b === 'end') return verdict('corner-touch', `${desc} meet at ${pt(x.pt)} without a coincident row joining them, so the outline is not clear there; join them with a coincident row, or move them apart.`);
      if (x.a !== x.b) {
        const [en, mid] = x.a === 'end' ? [P.g, Q.g] : [Q.g, P.g];
        return verdict('t-junction', `${name(en)} ends in the middle of ${name(mid)} at ${pt(x.pt)}, where nothing joins them; end ${name(mid)} there too (split it in two and join the pieces), or move the end away.`);
      }
      if (x.tangent) return verdict(sameLoop ? 'outline-touches' : 'shapes-touch', `${desc} just touch at ${pt(x.pt)}, which does not give one clean outline; separate them a little, or overlap them properly in one outline.`);
      return sameLoop
        ? verdict('outline-crosses', `${desc} cross each other at ${pt(x.pt)}, so this outline crosses itself and does not enclose one area; redraw it without crossing.`)
        : verdict('shapes-cross', `${desc} belong to two different shapes that cross at ${pt(x.pt)}; shapes on one sketch must sit apart or fully inside one another. Move them apart, or draw each on its own sketch.`);
    }
  }
  // ---- something must be solid (even-odd): outer area minus hole area, by nesting depth
  const loops = new Map();
  prims.forEach((p, i) => { const r = loopOf[i]; (loops.get(r) ?? loops.set(r, []).get(r)).push(p); });
  const outlines = [...loops.values()].map((ps) => {
    // order the pieces end to end only for area: sample every piece and take the polygon of all samples in loop order (pieces are chained by joins)
    const used = new Set(); const seq = []; let cur = ps[0]; let curEnd = null;
    if (cur.t === 'circ') return { poly: polyOf(cur), area: Math.PI * cur.r * cur.r };
    const take = (p, fromEnd) => { used.add(p); const pl = polyOf(p, 90); const arr = fromEnd === 'b' ? pl.slice().reverse() : pl; seq.push(...arr.slice(0, -1)); return fromEnd === 'b' ? p.g.a : p.g.b; };
    let at = take(cur, 'a');
    for (let n = 1; n < ps.length; n++) {
      const nx = ps.find((p) => !used.has(p) && (hyp(p.g.a, at) < 1e-6 || hyp(p.g.b, at) < 1e-6));
      if (!nx) break;
      at = take(nx, hyp(nx.g.a, at) < 1e-6 ? 'a' : 'b');
    }
    void curEnd;
    return { poly: seq, area: areaOf(seq) };
  });
  let solid = 0;
  outlines.forEach((o, i) => {
    const probe = o.poly[Math.floor(o.poly.length / 3)];
    const depth = outlines.filter((q, j) => j !== i && inPoly(probe, q.poly)).length;
    solid += (depth % 2 === 0 ? 1 : -1) * o.area;
  });
  info.solid = solid;
  info.inSolid = (q) => outlines.reduce((c, o) => c ^ (inPoly(q, o.poly) ? 1 : 0), 0) === 1;
  if (!(solid > 1e-9)) return verdict('nothing-solid', 'The shapes on this sketch cancel each other out (each one cuts away the one around it), so no area is solid; remove a shape or move it inside a larger one.');
  return null;
}

// ======================================================================================================================
// one sketch / one doc
// ======================================================================================================================
/**
 * Verdict for one sketch feature of a SOLVED doc: null (build it) or {code, sentence}. `ctx`: { arc, solvedGeoms?(sk) } where solvedGeoms
 * returns the solved rows of a soup (default: the rows as stored).
 */
export function guardSketch(sk, ctx) {
  const f = guardFrame(sk); if (f) return f;
  if (isSoup(sk)) {
    const rawArc = rawArcVerdict(sk.geoms, sk.rules ?? []); if (rawArc) return rawArc;
    const S = solvedOf(sk, ctx);
    const sv = solveVerdict(S); if (sv) return sv;
    return guardSoup(S.solved, sk.rules ?? [], sk.geoms);
  }
  return guardClassic(sk, ctx.arc);
}
/**
 * The solve of a soup sketch: `ctx.solve(sk)` when the caller has one (the host: SolidCraft's own solved rows plus its SolveReport dof, from the @sketch probe), else this
 * module's own solver (sketch-geometry.solve.mjs: independent of both kernels; the rig uses it). Cached per sketch object.
 */
const SOLVED = new WeakMap();
export function solvedOf(sk, ctx = {}) {
  if (ctx.solve) return ctx.solve(sk);
  let s = SOLVED.get(sk);
  if (!s) {
    try { s = solveSoup({ geoms: JSON.parse(JSON.stringify(sk.geoms)), rules: JSON.parse(JSON.stringify(sk.rules ?? [])) }); }
    catch (e) { s = { unsupported: `solve failed: ${e.message}`, solved: sk.geoms, residual: null, moved: null, dof: null }; } // e.g. a rule naming a row that does not exist: the rule mapper's own sentence follows
    SOLVED.set(sk, s);
  }
  return s;
}
/**
 * The rules move the rows and leave the result open: refuse. `S` = { solved, residual, moved, dofMoved, converged, unsupported? }.
 * Rows that already obey every rule (residual <= RULE_TOL) cannot be moved by any solver, so nothing is judged. Rows the rules DO move are fine when the rules pin them
 * completely (dofMoved 0); with dofMoved > 0 the final shape is the solver's choice (measured: an `equal` rule between circles of radius 3 and 9 gives radius 3 in the
 * 3D build and 6 in brep-rs, 13% apart in volume, with no sentence).
 */
export const RULE_TOL = 1e-6;
export function solveVerdict(S) {
  if (!S || S.unsupported || S.residual == null) return null;
  if (!(S.residual > RULE_TOL)) return null;
  if (!S.converged) return verdict('rules-conflict', `The rules of this sketch cannot all be met at once (the closest the shape can get still misses a rule by ${fmt(+S.residualAfter.toPrecision(2))} mm); remove or loosen one of them.`);
  if (S.dofMoved > 0) return verdict('rules-underdetermined', `The rules of this sketch have to move its shape (by up to ${fmt(+S.moved.toPrecision(2))} mm) but leave ${S.dofMoved} ways for it to slide, turn or change size, so where it ends up depends on the solver of the 3D build; pin it down with more rules (a lock on a point, a dimension on each free edge) or draw it at the size the rules give.`);
  return null;
}
export function guardDoc(doc, ctx) {
  const m = new Map();
  for (const f of doc.features) if (f.kind === 'sketch') m.set(f.id, guardSketch(f, ctx));
  return m;
}

/**
 * Relative volume error of a curved shape of radius r on a part whose 3D bounding diagonal is `diag`, as an UPPER envelope of the measured errors of a
 * circle pulled to many heights (cases-grid.mjs, results/grid.json). The truck mesh tolerance follows the size of the whole part, so the error is a step
 * function of rho = r / max(diag, 20): circle across 0.1 pulled 10 is 0.18% off, pulled 1000 it is 58% off (a triangle). Monotone in rho, so the measured
 * value at the next smaller measured rho bounds every rho in between.
 */
const TESS = [[0.333, 7.7e-5], [0.25, 1.2e-4], [0.025, 1.7e-4], [0.0125, 2.6e-4], [0.01, 4.6e-4], [0.005, 5.7e-4], [0.0025, 1.8e-3], [0.001, 2.9e-2], [0.0005, 4.9e-2], [0, 0.6]];
export const tessError = (rho) => TESS.find(([t]) => rho >= t)[1];

/** Largest in-plane world coordinate of a sketch whose outline spans [x0,x1] x [y0,y1] in its own (u, v) coordinates (the offset along the sketch normal is not counted). */
function inPlaneMax(sk, x0, x1, y0, y1) {
  const fr = sk.frame;
  if (!fr) return Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1)); // named planes: world in-plane coordinates ARE the sketch coordinates
  const { origin, u, v } = fr;
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const ln = len3(n) || 1; const nn = n.map((c) => c / ln);
  let best = 0;
  for (const a of [x0, x1]) for (const b of [y0, y1]) {
    const w = [0, 1, 2].map((i) => origin[i] + a * u[i] + b * v[i]); const d = dot3(w, nn);
    for (let i = 0; i < 3; i++) best = Math.max(best, Math.abs(w[i] - d * nn[i]));
  }
  return best;
}
/**
 * Area (mm2), the curved items {r, phi, sign} and the bounding box of the outline of a sketch, for the curve-size rule. `sign` is -1 when the arc's centre side is
 * solid (a convex arc: the mesh chord cuts a sliver OFF the solid) and +1 when it is void (a hole or a concave round: the chord ADDS a sliver), so a ring's two
 * circles cancel. Soup: the even-odd solid area of the solved rows.
 */
export function sketchInfo(sk, ctx) {
  // which side of the arc is solid, by a majority vote at three points of the arc (a single point can sit where another shape touches it)
  const side = (inSolid, c, r, a0, sweep) => {
    let v = 0;
    // the probe steps from the arc toward its centre by 5% of the radius, but never by more than a quarter of the arc's own sagitta (a nearly straight arc has its centre thousands of mm away, far outside the part)
    const fr = Math.min(0.05, (0.25 * r * (1 - Math.cos(Math.min(Math.abs(sweep), TAU) / 2))) / r);
    for (const t of [1 / 6, 1 / 2, 5 / 6]) { const ang = a0 + sweep * t; const m = [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]; v += inSolid([m[0] + (c[0] - m[0]) * fr, m[1] + (c[1] - m[1]) * fr]) ? -1 : 1; }
    return v < 0 ? -1 : 1;
  };
  if (isSoup(sk)) {
    const rows = ctx.solvedGeoms ? ctx.solvedGeoms(sk) : (solvedOf(sk, ctx).solved ?? sk.geoms);
    const a = analyseSoup(rows, sk.rules ?? [], sk.geoms);
    const L = rows.filter(live); const items = []; const xs = []; const ys = [];
    for (const g of L) {
      const pr = prim(g);
      if (g.k !== 'line' && a.inSolid) {
        items.push({ r: pr.r, phi: g.k === 'circle' ? TAU : Math.abs(pr.sweep), sign: side(a.inSolid, pr.c, pr.r, g.k === 'circle' ? 0 : pr.a0, g.k === 'circle' ? TAU : pr.sweep) });
      }
      for (const q of polyOf(pr, 90)) { xs.push(q[0]); ys.push(q[1]); }
    }
    const RG = soupRegions(rows);
    return { area: RG.ok ? RG.solidArea : a.solid, regions: RG.ok ? RG.count : null, curved: a.curved, items, bw: Math.max(...xs) - Math.min(...xs), bh: Math.max(...ys) - Math.min(...ys), off: inPlaneMax(sk, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)) };
  }
  if (sk.shape === 'circle') {
    const d = hyp(sk.points[0], sk.points[1]); const cx = (sk.points[0][0] + sk.points[1][0]) / 2; const cy = (sk.points[0][1] + sk.points[1][1]) / 2;
    return { area: Math.PI * d * d / 4, regions: 1, curved: true, items: [{ r: d / 2, phi: TAU, sign: -1 }], bw: d, bh: d, off: inPlaneMax(sk, cx - d / 2, cx + d / 2, cy - d / 2, cy + d / 2) };
  }
  const out = repairOutline(ctx.arc.outlineOf(sk), sk);
  if (!out.ok) return { area: 0, curved: false, items: [], bw: 0, bh: 0 };
  const { pts } = sampleOutline({ ...out, shape: sk.shape }, ctx.arc, TAU / 3600);
  let ar = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; ar += p[0] * q[1] - q[0] * p[1]; }
  const items = [];
  for (const [i, g] of Object.entries(out.bulges ?? {})) {
    if (!g) continue;
    const A = out.points[Number(i)]; const B = out.points[(Number(i) + 1) % out.points.length];
    const { center, radius, startAngle, endAngle } = ctx.arc.arcFromBulge(A, B, g);
    let sweep = endAngle - startAngle; if (g > 0 && sweep < 0) sweep += TAU; if (g < 0 && sweep > 0) sweep -= TAU;
    items.push({ r: radius, phi: Math.abs(sweep), sign: side((q) => inPoly(q, pts), center, radius, startAngle, sweep) });
  }
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  return { area: Math.abs(ar) / 2, regions: 1, curved: items.length > 0, items, bw: Math.max(...xs) - Math.min(...xs), bh: Math.max(...ys) - Math.min(...ys), off: inPlaneMax(sk, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)) };
}
/** Round 6. Mesh deflection of the 3D build as a fraction of the part's size (measured on edge bulges, cases-shallow.mjs: 2.5e-5 to 4.5e-5; 5e-5 is the upper envelope). */
export const DEFLECTION = 5e-5;
/**
 * Absolute area (mm2) by which the tessellated arc/circle can miss the true one. Two bounds, the smaller is used:
 *   table    tessError(r / diag) x sector area: calibrated on full circles and on rounded corners (the round-4 measurements); it grows with the sector r phi / 2, so for a NEARLY STRAIGHT
 *            arc (radius 167 mm for a 0.03 bulge on a 20 mm edge, 5e6 mm for a 1e-6 bulge) it claims an error many times the part's area. The critic found 0.048% claimed against 1.3e-5 to 6e-5 measured.
 *   chords   the mesh replaces the arc by chords that are never further than the deflection delta = DEFLECTION x max(diag, floor) from it: each chord misses (2/3) x chord x sagitta, so an
 *            arc of length r phi misses (2/3) r phi min(s, delta), and never more than its whole segment area r^2 (phi - sin phi) / 2 (the mesh cannot do worse than one chord).
 * Both are upper envelopes of the measurements; arcs of more than a half circle keep the table alone.
 */
export function arcError(it, diag) {
  const phi = it.phi ?? TAU;
  const table = tessError(it.r / diag) * phi * it.r * it.r / 2;
  if (!(phi < Math.PI)) return table;
  const segment = it.r * it.r * (phi - Math.sin(phi)) / 2;
  const sag = it.r * (1 - Math.cos(phi / 2));
  const delta = DEFLECTION * Math.max(diag, LIMITS.curvedFloor);
  const chords = Math.min(segment, (2 / 3) * it.r * phi * Math.min(sag, delta));
  return Math.min(table, chords);
}
/**
 * A pulled sketch whose curves are too small for the size of the part come out with a wrong volume (see tessError). The estimated relative error is
 * the sum over its arcs and circles of tessError(r / max(diag, 20)) x (sector area phi r^2 / 2) / area; above the curved bar it is refused. null or {code, sentence}.
 */
export function estimateCurveError(info, height, lengthTwo = 0) {
  if (!info?.curved || !(info.area > 0)) return { err: 0, worst: null, diag: 0 };
  const H = Math.abs(height) + Math.abs(lengthTwo || 0);
  const diag = Math.max(Math.hypot(info.bw, info.bh, H), LIMITS.curvedFloor);
  let tot = 0; let worst = null;
  // the absolute error of an arc is tessError x its SECTOR area (phi r^2 / 2): a full circle is the measured case; its sign is its `sign` (a ring's circles cancel)
  const hasVoid = info.items.some((q) => (q.sign ?? -1) > 0);
  let pos = 0; let neg = 0;
  for (const it of info.items) { const c = arcError(it, diag) / info.area; if ((it.phi ?? TAU) >= Math.PI - 1e-9) tot += (it.sign ?? -1) * c; else if ((it.sign ?? -1) > 0) pos += c; else neg += c; if (!worst || c > worst.c) worst = { c, r: it.r, thin: hasVoid, phi: it.phi ?? TAU, sag: it.r * (1 - Math.cos((it.phi ?? TAU) / 2)), chord: 2 * it.r * Math.sin((it.phi ?? TAU) / 2) }; }
  // arcs under a half circle (bulges, rounded corners): a chord replaced by the mesh only ever cuts a convex arc's sliver off and adds a concave one's on, so the two kinds can offset each other by at most the smaller sum
  return { err: Math.abs(tot) + Math.max(pos, neg), worst, diag };
}
export function guardPull(info, height, lengthTwo = 0) {
  if (typeof height === 'number' && height === 0 && !(lengthTwo > 0)) return verdict('pull-zero', 'pull() needs a distance other than 0; a pull of 0 has no thickness, so there is no solid to build.');
  if (typeof height === 'number' && !Number.isFinite(height)) return verdict('pull-not-number', 'pull() needs a distance that is a number; the distance given is not one.');
  const far = guardFar(info, height, lengthTwo); if (far) return far;
  const { err, worst, diag } = estimateCurveError(info, height, lengthTwo);
  if (!worst || err * LIMITS.safety <= LIMITS.curvedError) return null;
  const e = err * LIMITS.safety;
  const pct = !Number.isFinite(e) || e >= 1 ? 'by more than half its volume' : e >= 0.1 ? `by roughly ${fmt(+(e * 100).toPrecision(1))}% of its volume` : `by about ${fmt(+(e * 100).toPrecision(2))}% of its volume`;
  const thin = worst.thin ? ', or make the thin wall thicker' : '';
  if (worst.phi < Math.PI - 1e-9) return verdict('curves-too-small', `The curved edge that matters most bows out only ${fmt(+worst.sag.toPrecision(3))} mm over a length of ${fmt(+worst.chord.toPrecision(3))} mm on a part about ${fmt(+diag.toPrecision(3))} mm across, which the 3D build draws as a few straight facets, so its volume could be off ${pct}, more than the ${LIMITS.curvedError * 100}% allowed; make the bow larger or the part smaller${thin}.`, { err });
  return verdict('curves-too-small', `The curves in this sketch are too small for the size of this part: the curve that matters most has a radius of ${fmt(worst.r)} mm on a part about ${fmt(+diag.toPrecision(3))} mm across, so the 3D build could be off ${pct}, more than the ${LIMITS.curvedError * 100}% allowed; make the curves larger or the part smaller${thin}.`, { err });
}

/**
 * Round 6: the built solid against the sketch, whatever picked the profiles. A pull of a sketch makes (even-odd area of the sketch) x (pull length) of material in as many
 * separate pieces as the sketch has solid regions. The area is computed here from the rows (Green's theorem, no kernel); `built` = { volume, pieces } as measured on the finished
 * body (all pieces of it). A build that disagrees is refused, so a picker that pulls a thin ring four times, drops a hole or fills a slot never reaches the student.
 * Skipped for pulls this arithmetic does not describe (tapered, or measured along a custom direction rather than the sketch normal). null or {code, sentence}.
 */
export const RECONCILE_TOL = { planar: 1e-7, curved: 5e-4 };
export function reconcileExtrude(info, f, built) {
  if (!info || !(info.area > 0) || !built || !Number.isFinite(built.volume)) return null;
  if (f.taper || (f.direction && f.alongNormal === false) || typeof f.height !== 'number') return null;
  const H = f.midplane ? Math.abs(f.height) : Math.abs(f.height) + Math.abs(f.length2 || 0);
  const want = info.area * H;
  const tol = info.curved ? RECONCILE_TOL.curved : RECONCILE_TOL.planar;
  const rel = Math.abs(built.volume - want) / want;
  const wantPieces = info.regions ?? 1;
  if (rel <= tol && built.pieces === wantPieces) return null;
  const piecesWord = (n) => (n === 1 ? 'one piece' : `${n} separate pieces`);
  return verdict('built-disagrees-with-sketch', `Pulling ${f.target ? `sketch ${f.target}` : 'this sketch'} ${fmt(H)} mm should make about ${fmt(+want.toPrecision(7))} mm3 in ${piecesWord(wantPieces)} (its area ${fmt(+info.area.toPrecision(7))} mm2 times the length), but the 3D build came out at ${fmt(+built.volume.toPrecision(7))} mm3 in ${piecesWord(built.pieces)}, so it was not built; a thin wall or a very small gap between shapes is the usual cause, so make the walls thicker or draw the shapes on separate sketches.`, { want, got: built.volume, rel });
}

/**
 * Far from the origin: a curved outline whose in-plane position is more than FAR_RATIO times the size of the part puts the centre of mass of the 3D build off.
 * Measured (cases-far.mjs): volume and bounding box stay exact, but the centre of mass drifts with the square of the distance (rounded rect 30 x 20 x 12 at [1e4, 1e4]: 5.4e-5 of the
 * part's diagonal, 5.5e-3 at 1e5), and the outline stops closing at about 1e5 to 1e6. A plain rectangle is exact out to 1e6, so only curved outlines are checked.
 * `off` = the largest in-plane world coordinate of the outline (the part along the sketch normal is not counted: sketch('top', 1e6) is exact).
 */
export const FAR_RATIO = 150;        // outlines with a partial arc (rounded corner, slot cap, bulge): measured drift 5.4e-5 at 263x, 8e-6 at 105x
export const FAR_RATIO_FULL = 5000; // outlines whose curves are all full circles (symmetric, so the drift is smaller): 1.7e-6 at 2600x, 3.5e-5 at 7900x
export function guardFar(info, height, lengthTwo = 0) {
  if (!info?.curved || !(info.off > 0)) return null;
  const H = Math.abs(height || 0) + Math.abs(lengthTwo || 0);
  const diag = Math.max(Math.hypot(info.bw, info.bh, H), 1e-9);
  const partial = info.items.some((q) => (q.phi ?? TAU) < TAU - 1e-6);
  const ratio = partial ? FAR_RATIO : FAR_RATIO_FULL;
  if (info.off / diag <= ratio) return null;
  return verdict('far-from-origin', `This curved shape sits up to ${fmt(+info.off.toPrecision(3))} mm from the origin but the part is only about ${fmt(+diag.toPrecision(3))} mm across, and more than ${ratio} times its own size away from the origin the 3D build puts its centre of mass out of place; draw it nearer the origin (or move the finished part afterwards).`, { off: info.off, diag });
}

// ======================================================================================================================
// script level: a probe of the arguments of the sketch methods, and the sentence rewrites
// ======================================================================================================================
/** Prepend to a script text: records every sketch method call and its numeric arguments into globalThis.__SGPROBE__ (a list). Changes nothing else (doc identical, measured). */
export const PROBE_PREAMBLE = "(function (s) { if (!s || typeof s.sketch !== 'function') return; const orig = s.sketch; Object.defineProperty(s, 'sketch', { value: function (...a) { const h = orig(...a); const log = (globalThis.__SGPROBE__ = globalThis.__SGPROBE__ || []); const sid = (log.sketches = (log.sketches || 0) + 1); return new Proxy(h, { get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof v !== 'function' || typeof k !== 'string') return v; return function (...args) { log.push({ sid, m: k, args: args.map((x) => (x instanceof Number ? Number(x) : x)) }); const out = v.apply(t, args); return out === t ? r : out; }; } }); }, writable: true, configurable: true, enumerable: true }); })(typeof __RESHAPE_SCOPE__ === 'undefined' ? undefined : __RESHAPE_SCOPE__);";
export const withProbe = (src) => `${PROBE_PREAMBLE} ${src}`;

/** Verdict on the recorded calls: circle across <= 0, rect with a 0 side, a negative or non-finite round / chamfer, a treatment on a circle. */
export function scriptProbeVerdict(log) {
  const lastShape = new Map();
  for (const c of log ?? []) {
    const a = c.args;
    if (c.m === 'circle' && typeof a[0] === 'number') {
      if (!(a[0] > 0)) return verdict('circle-nonpositive', `.circle() needs an across above 0. You gave ${fmt(a[0])}.`, { sid: c.sid });
      lastShape.set(c.sid, 'circle');
    } else if (c.m === 'rect' && typeof a[0] === 'number' && typeof a[1] === 'number') {
      // the interpreter's own sentence for the same rect as the SECOND shape of a sketch; the first shape silently took the absolute value
      if (!(a[0] > 0) || !(a[1] > 0)) return verdict('rect-no-size', `.rect() needs a width and a height above 0. You gave ${fmt(a[0])} by ${fmt(a[1])}.`, { sid: c.sid });
      lastShape.set(c.sid, 'rect');
    } else if (c.m === 'polygon' || c.m === 'slot') lastShape.set(c.sid, c.m);
    else if ((c.m === 'round' || c.m === 'chamfer') && typeof a[1] === 'number') {
      if (!Number.isFinite(a[1]) || a[1] < 0) return verdict('treatment-negative', `.${c.m}(${fmt(a[0])}, ${fmt(a[1])}) needs a ${c.m === 'round' ? 'radius' : 'distance'} of 0 or more (0 leaves the corner sharp); you gave ${fmt(a[1])}.`, { sid: c.sid });
      if (lastShape.get(c.sid) === 'circle' && a[1] > 0) return verdict('treatment-on-circle', `A circle has no corners, so .${c.m}() cannot be applied to it; draw the shape as a polygon if you want a ${c.m}.`, { sid: c.sid });
    }
  }
  return null;
}

/**
 * Slider / panel values written into the doc AFTER the script ran (runScript's `values`, the panel's number boxes). The script probe cannot see them, and applyParam()
 * quietly turns some into something else: a round radius at or below 0 deletes the round (a sharp corner, no sentence), an `across` below 0 becomes 0 (the engine then
 * names the wrong cause). Returns Map(sketch id -> verdict). The slot names are model-codegen.ts generatedParams: <sketch>_across, <sketch>_r<corner>, <sketch>_g<row>r.
 */
export function valuesVerdicts(values) {
  const out = new Map();
  for (const [key, v] of Object.entries(values ?? {})) {
    const cut = key.lastIndexOf('_'); if (cut < 0 || typeof v !== 'number') continue;
    const id = key.slice(0, cut); const slot = key.slice(cut + 1);
    let r = null;
    if (!Number.isFinite(v) && /^(across|r\d+|g\d+r|p\d+[uv]|x|y|offset)$/.test(slot)) r = verdict('slider-not-number', `The value given for ${slot} of sketch ${id} is not a number.`);
    else if (slot === 'across' && !(v > 0)) r = verdict('circle-nonpositive', `The across box of sketch ${id} says ${fmt(v)}, and a circle needs an across above 0.`);
    else if (/^r\d+$/.test(slot) && v < 0) r = verdict('treatment-negative', `The round box of corner ${Number(slot.slice(1)) + 1} on sketch ${id} says ${fmt(v)}, and a round needs a radius of 0 or more (0 leaves the corner sharp).`);
    else if (/^g\d+r$/.test(slot) && !(v > 0)) r = verdict('radius-nonpositive', `The radius box of shape ${slot.slice(1, -1)} on sketch ${id} says ${fmt(v)}, and a circle or arc needs a radius above 0.`);
    if (r && !out.has(id)) out.set(id, r);
  }
  return out;
}

/** Rewrites of interpreter sentences that are hard to read or leave the student without a next step. null = keep the original. */
export function plainScriptSentence(msg, scriptText = '') {
  let m = /^\.(\w+)\(\) would be the second shape on this sketch, and the first one is driven by a param\(\), which a sketch of several shapes keeps its sizes as plain numbers, so a param\(\) cannot drive one of them\. Give the number itself, or draw this shape on its own sketch\(\)\.$/.exec(msg);
  if (m) return `.${m[1]}() would be the second shape on this sketch, but the first shape is driven by a param(), and a sketch of several shapes keeps its sizes as plain numbers. Give the first shape a plain number, or draw this shape on its own sketch().`;
  m = /^\.(\w+)\(\) is not the only shape on this sketch, and a sketch of several shapes keeps its sizes as plain numbers, so a param\(\) cannot drive one of them\. Give the number itself, or draw this shape on its own sketch\(\)\.$/.exec(msg);
  if (m) return `.${m[1]}() is not the only shape on this sketch, and a sketch of several shapes keeps its sizes as plain numbers, so a param() cannot drive its size. Give the number itself, or draw this shape on its own sketch().`;
  if (/^sk\.remove\(\) needs its argument to be a line or a circle or an arc or a point drawn on this sketch .* but got a \{ \} object\.$/.test(msg)) {
    const call = /\bsk\.remove\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(scriptText);
    const v = call ? call[1] : 'the rectangle';
    const isRect = call && new RegExp(`\\b${call[1].replace(/\$/g, '\\$')}\\s*=\\s*sk\\.rectangle\\(`).test(scriptText);
    if (isRect || !call) return `sk.remove() removes one line, circle, arc or point at a time, and ${v} is a rectangle (four lines). Remove its sides one by one: sk.remove(${v}.bottom), sk.remove(${v}.right), sk.remove(${v}.top), sk.remove(${v}.left).`;
    return `sk.remove() removes one line, circle, arc or point at a time, but ${v} is something else; pass the line, circle, arc or point itself.`;
  }
  return null;
}

// ======================================================================================================================
// pieces
// ======================================================================================================================
/** The sentence for a feature that needs one piece to work on when its target is several separate pieces. */
export function piecesSentence(a) { return oneSentence(piecesSentence0(a)); }
function piecesSentence0({ featureId, kind, sketchId, makerId, makerKind, pieces }) {
  const verb = { pocket: 'cut', hole: 'drill', groove: 'cut a groove into', pattern: 'repeat', mirror: 'mirror', shell: 'hollow', fillet: 'round', draft: 'draft', move: 'move', rotate: 'rotate', combine: 'combine', blend: 'blend' }[kind] ?? 'change';
  if (makerKind && makerKind !== 'extrude' && makerKind !== 'revolve') return `${featureId} needs one piece to ${verb}, but ${makerId} left the part in ${pieces} separate pieces; ${verb} before the cut that splits it, or build the pieces separately.`;
  return `${featureId} needs one piece to ${verb}, but ${sketchId ? `sketch ${sketchId}` : 'its target'} made ${pieces} separate pieces; draw the pieces on separate sketches and ${verb} each one.`;
}

/** Rewrite a refusal of the rule mapper ("sketch X cannot be handed to ... solver: rule N (kind): ...") into a sentence a student can act on. */
export function explainRuleRefusal(sketchId, text) { return oneSentence(explainRuleRefusal0(sketchId, text)); }
function explainRuleRefusal0(sketchId, text) {
  const lvl = /rule (\d+) \((distanceX|distanceY)\): the two points start level in (x|y)/.exec(text);
  if (lvl) return `Sketch ${sketchId}: the two points you dimension with sk.${lvl[2] === 'distanceX' ? 'dx' : 'dy'}() / sk.at() start level with each other in ${lvl[3]}, so the build cannot tell which side the distance goes; start the corner a little off the axis on the side you want, then dimension it.`;
  const nm = /names geometry (\d+), which is not in the sketch/.exec(text);
  if (nm) return `Sketch ${sketchId}: a rule names shape ${nm[1]}, but the sketch has no shape ${nm[1]}; fix the number in the rule.`;
  return `Sketch ${sketchId} cannot be built as written: ${String(text).replace(/solidcraft(?:'s)?/gi, 'the 3D build').replace(/\s+/g, ' ')}`;
}

// ======================================================================================================================
// engine sentences that still get through
// ======================================================================================================================
const ENGINE_WORDS = /solid\.\w+|sketch\.\w+|solidcraft|outlineOf|OpenCascade|brep-?rs|sk_sk\d|\bb_\w+|`|invalid (input|parameters)|wasm|translator|kernel|truck|\bg\d+\b/i;
export const lintSentence = (s) => (ENGINE_WORDS.test(s) ? ENGINE_WORDS.exec(s)[0] : null);

/** Rewrite any engine sentence into one the student can act on. `info`: {sketchId, featureId}. Never returns engine wording. */
export function explainEngineError(msg, info = {}) { return oneSentence(explainEngineError0(msg, info)); }
function explainEngineError0(msg, info = {}) {
  const where = info.sketchId ? `sketch ${info.sketchId}` : 'this sketch';
  const m = String(msg ?? '');
  if (/zero-length line/.test(m)) return `An edge of ${where} has no length (two of its points sit on the same spot); move the points apart or remove one.`;
  if (/radius must be positive/.test(m)) return `A circle in ${where} has no size; give it an across above 0.`;
  if (/collinear/.test(m)) return `An arc in ${where} is too small or too flat to build; make it larger, or draw a straight line.`;
  if (/no closed profiles|profile loop is not closed|has no usable outline|outlineOf refused/.test(m)) return `The 3D build could not close the outline of ${where}; check that its edges join end to end and that no edge or corner is tiny.`;
  if (/unknown profile/.test(m)) return `The 3D build could not find one clean closed area in ${where}; check that every edge end is joined to the next, that no edge ends in the middle of another, and that every arc fits its ends.`;
  if (/not on one plane/.test(m)) return `${where[0].toUpperCase()}${where.slice(1)} is too small to build; draw it larger.`;
  if (/solver/.test(m)) return `The rules of ${where} cannot be handed to the 3D build as written; simplify or remove the rule named in the message.`;
  return `${where[0].toUpperCase()}${where.slice(1)} could not be built; check that its outline closes, does not cross itself and is not tiny.`;
}

/**
 * The ONE entry point a host calls for any text that reaches the student (interpreter error, translator refusal, engine text): plain rewrite if there is one, engine words
 * turned into a sentence about the sketch, then forced to a single sentence. Never returns engine wording (lintSentence is asserted by the harness on every sentence).
 */
export function studentSentence(msg, info = {}) {
  const text = String(msg ?? '');
  const plain = plainScriptSentence(text, info.scriptText ?? '');
  const base = plain ?? (lintSentence(text) ? explainEngineError(text, info) : text);
  return oneSentence(base);
}
