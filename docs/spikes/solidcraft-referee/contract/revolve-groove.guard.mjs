// revolve-groove guard (round 2). Pure functions, no kernel, no wasm. This is the ENFORCEMENT half of the revolve-groove contract:
// every spin/groove the measurements showed to build a wrong solid on the spike translators (phase0 translate.mjs and the phase7
// pane's translate-p4.mjs) is turned into a refusal with ONE plain sentence, every translator slip is fixed, and every kernel error
// a student could meet is replaced by a sentence with no engine words in it.
//
// It lives in contract/ because packages/script and phase0/translate.mjs are read-only for this campaign. It is wired into BOTH
// translators by contract/revolve-groove-rig/make-translators.mjs, which patches copies of the pristine files (so the claim
// "this is what the product does with the guard" is checked on the same code the product runs, not on a hand-written twin).
//
//   G1 SIGN   solidcraft turns toward the sketch normal PER PROFILE: its canonical_revolve_axis flips with the side of the axis the
//             profile centroid lies on. The translators negate the angle for every profile, which is right only for a profile on the
//             +u side. A partial turn of a profile on the -u side came out mirrored (volume right, bbox/COM off by up to 0.5 of the
//             diagonal). Fix: negate only for a profile on the +u side. Applies to spin AND groove, any plane, any frame, circles too.
//   G2 SPLIT  a cut that splits the target returns the pieces as 'body', 'body (1)', ...; the translators kept only 'body'. Fix:
//             aggregate every piece (the translators' aggregate() is patched), so a split groove is a multi-body result, not a hole.
//   G3 CLAMP  |spin angle| in [360, 720] is the full ring (the script layer allows it, FreeCAD builds it, solidcraft refuses > 360).
//   G4 REFUSE one plain sentence, before any kernel runs, for: a sketch drawn with geom()/slot()/hole (more than one outline or an
//             outline with a hole), a sketch nothing was drawn in (the 40 x 25 starter rectangle), a profile with no area / a repeated
//             corner / that crosses or touches itself (a bow-tie, which truck builds silently as two bodies), a profile that crosses
//             the axis it spins about, a turn under MIN_TURN degrees (truck returns flat faces for a curved wall below ~0.6 degree),
//             a groove whose ring cannot touch the part, and a groove into a part an earlier groove left in several pieces.
//   G5 AFTER  a groove that built but left the part unchanged (the ring misses it, or turns away from it) is refused with the
//             same plain sentence, so truck (silent) and brep-rs ("cuts nothing") agree.
//   G6 WORDS  kernel errors are mapped to plain sentences (plainRefusal); the kernel's own text is kept only in the evidence.
//   G7 PLANE  a groove whose profile plane (spanned by u and n, z = 0 for every front/side sketch) holds a flat face of an all-flat part: PART turn refused with the true plane named,
//             FULL turn built with the sketch plane turned 17 degrees about the axis (same solid, seam off the face).
//   G8 COST   static tool/cost rule (costRefusal): a ring that is not made of faces parallel and square to its axis is refused; part turns that reach a round part's wall, full turns
//             not on a plain post's own axis, and full turns about a tilted axis are refused; the page also stops any groove after COST_BUDGET_S in a Worker.
//   G9 SEALED a ring completely inside a plain box/cylinder (a sealed hollow) is refused at every angle, with the cause.
//   G10 GRAZE a ring edge 0 < d <= 0.25 mm short of a part face (a lip), or a round wall tangent to / within 0.25 mm of a flat face of a box, is refused.
//   chain     a refused groove leaves its target handle pointing at itself (onRefused), so a later groove / feature on the same part is refused with a pointer instead of building on the un-grooved part.
//   script    scriptSentence() maps the three script-layer messages that are two sentences or contain an engine word to one plain sentence.
import { sampleOutline, selfTouch } from './outline-guard.mjs';

export const MIN_TURN = 1;           // degrees. Measured: 0.55 degree and under comes back as flat faces (any radius); 0.6 and over is a cylinder.
export const MAX_SPIN = 720;         // degrees, the script layer's MAX_SPIN_DEGREES
export const AXIS_TOL = 1e-9;        // mm. A profile point this far (relative to scale) on both sides of the axis crosses it.
export const STARTER = [[0, 0], [40, 0], [40, 25], [0, 25]];
const SAME = 1e-9;                   // relative: two corners closer than this are "the same place"
const NOTHING = 1e-9;                // relative volume change below which a groove "cut nothing"

/** Negative controls / cost measurements: RG_OFF=G1,G3,G4,G5,G7,G8,G9,G10 switches single guards off (comma list, read from the environment when there is one). */
const OFF = new Set(((typeof process !== 'undefined' && process.env?.RG_OFF) || '').split(',').filter(Boolean));
const on = (g) => !OFF.has(g);
const num = (v) => (Number.isInteger(v) ? String(v) : String(+Number(v).toFixed(4)));
const verbOf = (f) => (f.kind === 'revolve' ? 'spin' : 'groove');
const lead = (f) => `${f.id} (${f.kind}): `;

/** Walk the groove/hole/pocket head chain the way the translators do (a cut leaves its target id pointing at the newest cut). */
const headOf = (st, id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };

/** Everything the guard needs to know about a sketch's outline, in the sketch's own (u, v). */
export function profileInfo(sk, arc) {
  const o = arc.outlineOf(sk);
  if (!o.ok) return { ok: false, why: 'unreadable' };
  if (sk.shape === 'circle') {
    const [a, b] = o.points;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    return { ok: true, circle: true, scale: Math.max(1e-12, Math.abs(c[0]) + r, Math.abs(c[1]) + r), umin: c[0] - r, umax: c[0] + r, vmin: c[1] - r, vmax: c[1] + r, r };
  }
  const { pts } = sampleOutline(o, arc);
  const us = pts.map((p) => p[0]); const vs = pts.map((p) => p[1]);
  const scale = Math.max(1e-12, ...pts.flat().map(Math.abs));
  let a2 = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a2 += p[0] * q[1] - q[0] * p[1]; });
  const dup = o.points.some((p, i) => { const q = o.points[(i + 1) % o.points.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) <= SAME * scale; });
  // every corner on one line? (a bow-tie has signed area 0 too, so the area alone cannot tell the two apart)
  const P = o.points; let far = [P[0], P[0]]; let best = -1;
  for (const a of P) for (const b of P) { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > best) { best = d; far = [a, b]; } }
  const collinear = best <= SAME * scale || P.every((q) => Math.abs((far[1][0] - far[0][0]) * (q[1] - far[0][1]) - (far[1][1] - far[0][1]) * (q[0] - far[0][0])) / best <= 1e-9 * scale)
    && !(o.bulges && Object.values(o.bulges).some((g) => g));
  return { ok: true, circle: false, o, scale, umin: Math.min(...us), umax: Math.max(...us), vmin: Math.min(...vs), vmax: Math.max(...vs), area2: a2, dup, collinear, n: o.points.length, pts };
}

const isStarter = (sk) => sk.shape !== 'circle' && sk.points?.length === 4 && sk.points.every((p, k) => p[0] === STARTER[k][0] && p[1] === STARTER[k][1])
  && (sk.constraints?.length ?? 0) === 4 && !sk.rounds && !sk.chamfers;

/** The preflight: null when the sketch is fine, else the plain sentence. Pure arithmetic on the outline. */
export function profileProblem(f, sk, arc) {
  const verb = verbOf(f);
  const L = lead(f);
  if (!sk) return `${L}${f.target} is not a sketch, so there is nothing to ${verb}.`;
  if (sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0) {
    return `${L}the sketch holds more than one shape (or a hole, geom() or slot()), and a ${verb} takes one plain outline, so draw one rect, circle or polygon per sketch.`;
  }
  if (isStarter(sk)) return `${L}the sketch is exactly the default 40 by 25 rectangle at the corner (an undrawn sketch looks the same), so the ${verb} is not built; draw your outline, for example with rect(10, 30, { at: [15, 15] }), or move this rectangle by a fraction of a millimetre if it is the one you want.`;
  if (sk.shape !== 'circle' && Array.isArray(sk.points) && sk.points.length > 1) {
    const sc = Math.max(1e-12, ...sk.points.flat().map(Math.abs));
    if (sk.points.some((q, i) => { const r = sk.points[(i + 1) % sk.points.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) <= SAME * sc; })) return `${L}two corners of the sketch are in the same place, so delete one of them.`;
  }
  const p = profileInfo(sk, arc);
  if (!p.ok) return `${L}the sketch has no usable outline, so there is nothing to ${verb}; redraw it as a closed shape.`;
  if (p.circle) {
    if (!(p.r > SAME * p.scale)) return `${L}the circle has no size, so there is nothing to ${verb}; give it a diameter.`;
  } else {
    if (p.dup) return `${L}two corners of the sketch are in the same place, so delete one of them.`;
    if (p.n < 3 || p.collinear) return `${L}the sketch has no area (all its corners lie on one line), so give it at least three corners that are not in a row.`;
    const st = selfTouch(p.o, arc);
    if (st) return `${L}the sketch ${st === 'cross' ? 'crosses' : 'touches'} itself, so it is not one closed shape; reorder its corners so that no two sides ${st === 'cross' ? 'cross' : 'meet'}.`;
  }
  const tol = AXIS_TOL * Math.max(1, p.scale);
  if (p.umin < -tol && p.umax > tol) return `${L}the outline crosses the line it ${verb === 'spin' ? 'spins' : 'is turned'} about, so one side would overlap the other; draw the whole outline on one side of that line.`;
  return null;
}

/** Which side of the axis the profile is on: +1 (u > 0) or -1 (u < 0). Only meaningful once profileProblem() passed. */
export const sideOf = (p) => (p.umax > AXIS_TOL * Math.max(1, p.scale) ? 1 : -1);

/** The angle the translators must hand to solid.revolve for this feature, or null for a full turn (no angle parameter). */
export function kernelAngle(f, side) {
  const a = f.angle;
  if (Math.abs(a) >= 360) return null;
  return side < 0 ? a : -a;
}

/** World-space sufficient test that a groove's ring cannot touch the target: ring envelope vs the target's bbox. Returns a reason or null. */
export function ringMisses(p, fr, bbox, eps = 1e-6) {
  if (!bbox || !fr) return null;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const o = fr.origin; const n = fr.n;
  const nl = Math.hypot(...n) || 1; const nn = n.map((x) => x / nl);
  let tmin = Infinity; let tmax = -Infinity; let rmax = 0;
  for (const x of [bbox[0], bbox[3]]) for (const y of [bbox[1], bbox[4]]) for (const z of [bbox[2], bbox[5]]) {
    const d = [x - o[0], y - o[1], z - o[2]];
    const t = dot(d, nn);
    const rad = Math.hypot(d[0] - t * nn[0], d[1] - t * nn[1], d[2] - t * nn[2]);
    tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); rmax = Math.max(rmax, rad);
  }
  // the profile's v coordinate IS the distance along n (the translators lay it in (u, n)); its |u| is the distance from the axis
  const rmin = p.umin >= 0 ? p.umin : (p.umax <= 0 ? -p.umax : 0);
  if (p.vmax < tmin - eps || p.vmin > tmax + eps) return 'axial';
  if (rmin > rmax + eps) return 'radial';
  return null;
}

/**
 * G7 (measured, 24 box configurations: contract/revolve-groove-rig, Z-crit-box-* and Z-coin-box-*): the groove's profile lies in the plane through the
 * revolve axis spanned by u and n, so the revolve seam and the end caps of a part turn sit IN that plane. When that plane holds a flat face of a part that has
 * only flat faces (a box), a ring about the world X or Y axis (sketched on 'front' or 'side') comes back with extra planar faces (OCCT 10 faces, truck 12;
 * 12 vs 18; 10 vs 13) or is refused by the kernel with a long text; moved off the face by 1 or 3 mm the same ring builds with the right face count. A ring about
 * the world Z axis ('top') was exact in all 6 coincident configurations, so it is not touched. The plane is NOT the sketch plane: it is spanned by u and n, so for the
 * named front and side planes it is always z = 0 whatever the sketch offset. Round 3: a PART turn is refused (sentence names the real plane and the remedy: lift the part);
 * a FULL turn is built with the sketch plane turned 17 degrees about the axis (same solid, seam off the face; measured in rg3 nudge runs). Returns {axis, at} or null.
 */
export function profilePlaneOnFlatFace(fr, bbox, faceTypes) {
  if (!fr || !bbox || !faceTypes) return false;
  const kinds = Object.keys(faceTypes).filter((k) => faceTypes[k] > 0);
  if (kinds.length !== 1 || kinds[0] !== 'plane') return false;
  const v = fr.v; const n = fr.n;
  const vl = Math.hypot(...v) || 1; const nl = Math.hypot(...n) || 1;
  const vv = v.map((x) => x / vl); const nn = n.map((x) => x / nl);
  if (Math.abs(nn[2]) > 0.5) return false;                                   // ring about world Z: exact in the sample
  const ax = vv.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
  if (ax < 0) return false;                                                   // profile plane not axis-aligned: the bbox says nothing about the part's faces
  const c = fr.origin[0] * vv[0] + fr.origin[1] * vv[1] + fr.origin[2] * vv[2];
  const c1 = c * Math.sign(vv[ax]);                                           // plane position along +axis
  const scale = Math.max(1, ...bbox.map(Math.abs));
  if (Math.abs(bbox[ax] - c1) <= 1e-6 * scale || Math.abs(bbox[ax + 3] - c1) <= 1e-6 * scale) return { axis: 'xyz'[ax], at: c1 };
  return null;
}
export const NUDGE_DEG = 17;       // degrees. A full turn about a horizontal axis whose seam plane lies in a flat face of the part is built with the sketch plane turned by this much about the axis (same solid, seam off the face).
export const COST_BUDGET_S = 45;    // seconds. The page runs every groove in a Worker and stops it at this budget (the same 45 s as the booleans and holes groups, contract/bool-watchdog.mjs).
export const COST_SUPPORT_S = 30;   // seconds of CPU. A class of groove is 'supported' only if EVERY measured run of it stays at or under this (1.5 x margin below the budget); one run over it puts the class under the static rule.
const S_TOOL = 'a ring with a slanted or curved side (a triangle, a circle, a rounded corner) is not built, because in the measurements the engine cut such rings wrongly or took minutes and the two cannot be told apart in advance; give the ring straight sides that are parallel and square to its axis';
const S_TILT = 'a full-turn ring about a tilted axis took from 19 to 42 seconds here and is not reliable, so it is not built; sketch the ring on the top, front or side plane, or turn it less than 360 degrees';
const S_PART = 'a part turn of a ring that reaches the curved outside of a round part, or of a part with several round surfaces, takes a minute or more to cut here, so it is not built; turn the ring a full 360 degrees on the part\'s own axis, or keep it clear of the round outside wall';
const S_FULL = 'a full-turn ring cut into a round part takes a minute or more here unless its axis is the part\'s own axis, so it is not built; centre the ring on the axis of the round part';
/**
 * G8 (tool and cost), the static half of the cost rule. Inputs are the cost features logged for every groove (costFeatures). Returns a plain sentence (without the "groove1 (groove): " lead) or null.
 * Measured classes (revolve-groove-results/r3/cost-*.json and the per-case dirs, CPU seconds of the translated run, single wasm call, Bun):
 *   - tool with an arc or circle in its outline (torus face): 4.9 s to 248 s, no pattern; tool with a slanted side (cone face): fast when it works but 2 of 96 builds came back with the
 *     volume wrong beyond the bar (fzc3-32: 2.6e-3, 5 percent of the removed volume, identical at every sketch phase, so the solid and not the mesh; fzc3-8: 5.5e-4) and the full turn
 *     into a box took 14 to 29 s -> a tool that is not made of faces parallel and square to the axis is refused (S_TOOL);
 *   - flat tool into a part with no curved face: 17 s or less in every run;
 *   - flat tool, PART turn, into a part with a curved face when the ring reaches the nearest outer side of the part (or the part has two or more curved faces, or the axis is tilted):
 *     12 s to 204 s, typically 40 to 100 -> refused (S_PART);
 *   - flat tool, FULL turn, into a curved part that is not a plain cylinder with the ring on its own axis: 6 s to 79 s -> refused (S_FULL; the fast ones are over-refused);
 *   - flat tool, FULL turn, about a tilted axis: 19 to 42 s -> refused (S_TILT);
 *   - everything else (ring on the axis of a plain cylinder, or a part turn that stays clear of the outer wall of a single-round-face part): 30 s or less in every measured run.
 * Backstop for anything this rule lets through: the page's 45 s Worker budget (COST_BUDGET_S).
 */
export function costRefusal(c) {
  if (!c) return null;
  if (c.tool !== 'flat') return S_TOOL;
  if (!c.worldAxis && !c.partial) return S_TILT;
  if (c.curved === 0) return null;
  if (c.partial) return (c.reachesWall || c.curved >= 2 || !c.worldAxis) ? S_PART : null;
  return c.coaxial ? null : S_FULL;
}

/** Surfaces the ring tool is made of, from the profile's edges (profile coordinates: u = distance from the axis, v = along the axis). */
export function toolSurfaces(sk, arc) {
  const o = arc.outlineOf(sk);
  if (!o.ok) return null;
  if (sk.shape === 'circle') return { kinds: ['torus'] };
  const P = o.points; const n = P.length;
  const sc = Math.max(1e-12, ...P.flat().map(Math.abs));
  const kinds = new Set();
  for (let i = 0; i < n; i++) {
    const a = P[i]; const b = P[(i + 1) % n]; const g = o.bulges?.[i];
    if (g) { const { center } = arc.arcFromBulge(a, b, g); kinds.add(Math.abs(center[0]) <= AXIS_TOL * Math.max(1, sc) ? 'sphere' : 'torus'); continue; }
    const du = b[0] - a[0]; const dv = b[1] - a[1]; const len = Math.hypot(du, dv);
    if (len <= SAME * sc) continue;
    if (Math.abs(dv) <= 1e-9 * len) kinds.add('annulus');                                   // a flat ring face (plane perpendicular to the axis)
    else if (Math.abs(du) <= 1e-9 * len) kinds.add(Math.abs(a[0]) <= AXIS_TOL * Math.max(1, sc) ? 'axis' : 'cylinder');
    else kinds.add('cone');
  }
  return { kinds: [...kinds] };
}

/**
 * The cost features of a groove, logged for every groove the translator plans (the cost rule below reads them; the measurements in
 * contract/revolve-groove-results/ are keyed by them). Pure arithmetic on the profile, the frame and the head body's measure.
 */
export function costFeatures(p, sk, arc, fr, meas, a) {
  const ts = toolSurfaces(sk, arc);
  const tool = !ts ? 'unknown' : ts.kinds.some((k) => k === 'torus' || k === 'sphere') ? 'torus' : ts.kinds.includes('cone') ? 'cone' : 'flat';
  const ft = meas?.faceTypes ?? {};
  const curved = Object.entries(ft).reduce((n, [k, v]) => n + (k !== 'plane' ? v : 0), 0);
  const tol = AXIS_TOL * Math.max(1, p.scale ?? 1);
  const touchesAxis = !(p.umin > tol || p.umax < -tol);
  let axis = -1; let nearest = null;
  if (fr) {
    const nl = Math.hypot(...fr.n) || 1; const nn = fr.n.map((x) => x / nl);
    axis = nn.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
    if (axis >= 0 && meas?.bbox) { nearest = Infinity; for (const k of [0, 1, 2]) if (k !== axis) nearest = Math.min(nearest, Math.abs(meas.bbox[k] - fr.origin[k]), Math.abs(meas.bbox[k + 3] - fr.origin[k])); }
  }
  const rOuter = Math.max(Math.abs(p.umin), Math.abs(p.umax));
  const sh = certifiedShape(meas);
  const coaxial = !!(sh && sh.kind === 'cylinder' && fr && axis === sh.axis && [0, 1, 2].filter((k) => k !== axis).every((k) => Math.abs(fr.origin[k] - sh.centre[k]) <= 1e-6 * Math.max(1, Math.abs(sh.R))));
  return { tool, shape: sh?.kind ?? null, coaxial, kinds: ts?.kinds ?? null, partial: a < 360, curved, headTypes: ft, touchesAxis, worldAxis: axis >= 0, reachesWall: nearest !== null && rOuter >= nearest - 1e-6, rOuter, nearest, bodies: meas?.bodies?.length ?? null };
}

/** A part the guard can PROVE is a plain box or a plain cylinder, from its measure alone (volume equals the bounding box's, or the cylinder's closed form). */
export function certifiedShape(meas) {
  if (!meas || !meas.bbox || !meas.faceTypes || (meas.bodies?.length ?? 1) !== 1) return null;
  const b = meas.bbox; const d = [b[3] - b[0], b[4] - b[1], b[5] - b[2]]; const V = meas.volume;
  const kinds = Object.keys(meas.faceTypes).filter((k) => meas.faceTypes[k] > 0);
  if (kinds.every((k) => k === 'plane') && Math.abs(V - d[0] * d[1] * d[2]) <= 1e-9 * V) return { kind: 'box', bbox: b };
  if (kinds.every((k) => k === 'plane' || k === 'cylinder') && kinds.includes('cylinder')) {
    for (let k = 0; k < 3; k++) {
      const o1 = (k + 1) % 3; const o2 = (k + 2) % 3;
      const R = d[o1] / 2;
      if (Math.abs(d[o1] - d[o2]) <= 1e-6 * d[o1] && Math.abs(V - Math.PI * R * R * d[k]) <= 3e-4 * V) return { kind: 'cylinder', axis: k, R, centre: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], bbox: b };
    }
  }
  return null;
}

/**
 * G9 (sealed ring). True when the ring lies completely inside a part the guard can prove is a plain box or cylinder, so cutting it would leave a hollow with no
 * opening. Measured (revolve-groove-results/r3/sealed-g9off, rg3 sweep): the engine builds some turns of such a ring and fails others with no pattern in the angle (post, ring
 * u 8..12, z 12..18: 90..179 and 185, 190 build; 180, 181, 200, 225, 270, 315, 360 fail), so one geometry is refused at EVERY angle.
 */
export function ringSealed(p, fr, meas, eps = 1e-6) {
  const sh = certifiedShape(meas);
  if (!sh || !fr) return false;
  const nl = Math.hypot(...fr.n) || 1; const nn = fr.n.map((x) => x / nl);
  const a = nn.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
  if (a < 0) return false;
  const o = fr.origin; const rmax = Math.max(Math.abs(p.umin), Math.abs(p.umax));
  const t0 = o[a] + nn[a] * p.vmin; const t1 = o[a] + nn[a] * p.vmax;
  const lo = Math.min(t0, t1); const hi = Math.max(t0, t1);
  const b = sh.bbox;
  if (!(lo > b[a] + eps && hi < b[a + 3] - eps)) return false;
  if (sh.kind === 'box') return [0, 1, 2].filter((k) => k !== a).every((k) => o[k] - rmax > b[k] + eps && o[k] + rmax < b[k + 3] - eps);
  if (sh.axis !== a) return false;
  const [k1, k2] = [0, 1, 2].filter((k) => k !== a);
  return Math.hypot(o[k1] - sh.centre[k1], o[k2] - sh.centre[k2]) + rmax < sh.R - eps;
}

export const GRAZE_MM = 0.25;     // mm. Measured (revolve-groove-results/r3/graze-*.txt): a ring face 0.01 to 0.1 mm short of a part face leaves a lip that comes back with wrong faces/area/volume; 0.2 mm and more is exact.

/**
 * G10 (graze). A groove ring whose end plane stops 0 < d <= 0.25 mm short of a face of the part (a thin lip), or whose round wall is tangent to / within 0.25 mm of a flat face
 * of the part (a box) with the tangent line on that face, comes back from the engine with wrong area and wrong volume (box lip: area -3 %, dVol up to 2.5e-4; post lip: area -7 %,
 * faces 5 instead of 7, dVol up to 7.8e-4; near-tangent top face: dVol 1.2e-3, area 8e-3), silently. Checked only for a part the guard can prove is a plain box or cylinder.
 * Returns {kind, gap, what} or null. Exact coincidence of a ring PLANE with a part plane (d = 0) is fine and is not flagged.
 */
export function grazing(p, fr, meas, s = GRAZE_MM) {
  const sh = certifiedShape(meas);
  if (!sh || !fr) return null;
  const nl = Math.hypot(...fr.n) || 1; const nn = fr.n.map((x) => x / nl);
  const a = nn.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
  if (a < 0) return null;
  const o = fr.origin; const b = sh.bbox;
  const t0 = o[a] + nn[a] * p.vmin; const t1 = o[a] + nn[a] * p.vmax; const lo = Math.min(t0, t1); const hi = Math.max(t0, t1);
  const rmax = Math.max(Math.abs(p.umin), Math.abs(p.umax)); const rmin = p.umin >= 0 ? p.umin : (p.umax <= 0 ? -p.umax : 0);
  const [k1, k2] = [0, 1, 2].filter((k) => k !== a);
  // radial range of a part end face as seen from the ring axis
  const faceRadial = () => {
    if (sh.kind === 'cylinder') { const off = Math.hypot(o[k1] - sh.centre[k1], o[k2] - sh.centre[k2]); return [Math.max(0, off - sh.R), off + sh.R]; }
    const dx = [b[k1] - o[k1], b[k1 + 3] - o[k1]]; const dy = [b[k2] - o[k2], b[k2 + 3] - o[k2]];
    const nearx = dx[0] <= 0 && dx[1] >= 0 ? 0 : Math.min(Math.abs(dx[0]), Math.abs(dx[1])); const neary = dy[0] <= 0 && dy[1] >= 0 ? 0 : Math.min(Math.abs(dy[0]), Math.abs(dy[1]));
    return [Math.hypot(nearx, neary), Math.hypot(Math.max(Math.abs(dx[0]), Math.abs(dx[1])), Math.max(Math.abs(dy[0]), Math.abs(dy[1])))];
  };
  const [fr0, fr1] = faceRadial();
  const radialOverlap = rmax >= fr0 - 1e-9 && rmin <= fr1 + 1e-9;
  // lips: a ring end plane just short of a part end face (perpendicular to the ring axis)
  if (radialOverlap && (sh.kind === 'box' || sh.axis === a)) {
    for (const f of [b[a], b[a + 3]]) for (const t of [lo, hi]) { const d = Math.abs(t - f); if (d > 1e-9 && d <= s) return { kind: 'lip', gap: d, what: 'the ring end' }; }
  }
  // near-tangent round wall against a flat face parallel to the axis (box only)
  if (sh.kind === 'box') {
    for (const k of [k1, k2]) {
      const kk = k === k1 ? k2 : k1;
      for (const f of [b[k], b[k + 3]]) {
        const pd = Math.abs(f - o[k]);
        const foot = o[kk] >= b[kk] - 1e-9 && o[kk] <= b[kk + 3] + 1e-9;
        const axial = hi >= b[a] - 1e-9 && lo <= b[a + 3] + 1e-9;
        if (!foot || !axial) continue;
        for (const rho of [rmin, rmax]) if (rho > 0 && Math.abs(rho - pd) <= s) return { kind: 'tangent', gap: Math.abs(rho - pd), what: 'the ring wall' };
      }
    }
  }
  return null;
}

/** Rotate vector `v` about the unit-ish axis `k` by `deg` degrees (right-hand). */
export function rotateAbout(v, k, deg) {
  const kl = Math.hypot(...k) || 1; const u = k.map((x) => x / kl); const c = Math.cos(deg * Math.PI / 180); const s = Math.sin(deg * Math.PI / 180);
  const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return v.map((x, i) => x * c + cr[i] * s + u[i] * d * (1 - c));
}

/** The sentence for a script-layer error of spin()/groove() (packages/script is read-only, so the page maps the three families whose wording fails the one-sentence / no-engine-word bar). null = keep the script's own sentence. */
export function scriptSentence(msg) {
  const m = String(msg);
  if (/^spin\(\): the angle is how far the sketch turns, and 0 degrees turns it nowhere/.test(m)) return 'spin(): a spin turns the sketch by an angle other than 0 degrees, so use 1 to 360 degrees, or a negative angle to turn the other way.';
  let x = /^spin\(\): the angle is how far the sketch turns, and (\S+) degrees is more than 720/.exec(m);
  if (x) return `spin(): a spin turns at most two full turns (720 degrees) either way, and ${x[1]} is more; use 360 for one full turn.`;
  x = /^groove\(\): the angle is how far the sketch turns, more than 0 and at most 360 degrees -- got (.+?)\. (?=A negative)/.exec(m);
  if (x) return `groove(): a groove turns the ring more than 0 and at most 360 degrees, and ${x[1]} is not in that range; use 360 for a full turn.`;
  return null;
}

/** A refusal sentence must be ONE sentence: no sentence break (". " + capital), no " -- " splice. */
export const oneSentence = (s) => !/[.!?]\s+[A-Z]/.test(String(s)) && !/ -- /.test(String(s));

/** Called by the patched translators when a groove is refused: later features that name the same part must not silently build on the un-grooved part. */
export function onRefused(f, st) {
  if (f.kind !== 'groove' || !f.into) return;
  st.head[headOf(st, f.into)] = f.id;
}

/**
 * Wrap a translator's planFeature. `raw` is the pristine planFeature of that translator.
 * Refuses (G4), then lets the translator plan, then rewrites the angle (G1, G3) of its solid.revolve command.
 */
export function guardPlan(raw, f, st, ctx) {
  if (f.kind !== 'revolve' && f.kind !== 'groove') return raw(f, st, ctx);
  const verb = verbOf(f);
  const L = lead(f);
  const sk = st.sketches[f.target];
  const prob = on('G4') ? profileProblem(f, sk, ctx.arc) : null;
  if (prob) return { refusal: prob };
  const p = profileInfo(sk, ctx.arc);
  const a = f.angle;
  if (typeof a !== 'number' || !Number.isFinite(a)) return { refusal: `${L}the angle has to be a number of degrees.` };
  if (f.kind === 'groove' && (a <= 0 || a > 360)) return { refusal: `${L}a groove turns the ring more than 0 and at most 360 degrees, and ${num(a)} is not in that range; use 360 for a full turn.` };
  if (f.kind === 'revolve' && Math.abs(a) > MAX_SPIN) return { refusal: `${L}a spin turns at most two full turns (720 degrees) either way, and ${num(a)} is more; use 360 for one full turn.` };
  if (a === 0) return { refusal: `${L}a ${verb} needs an angle other than 0 degrees.` };
  if (Math.abs(a) < MIN_TURN) return { refusal: `${L}a turn of ${num(a)} degrees is too thin to build as a curved part here; use a turn of 1 degree or more.` };
  let guard = null; let nudge = null;
  if (f.kind === 'groove') {
    const head = headOf(st, f.into);
    if (st.refused[head]) return { refusal: `${L}${head} was not built, so this groove has no finished part to cut; fix ${head} first.` };
    const bodies = st.bodies[head];
    if (bodies && bodies.length > 1) return { refusal: `${L}${f.into} was left in ${bodies.length} separate pieces, and a groove cuts one piece, so cut before the part is split.` };
    const meas = st.measure[head];
    const fr = ctx.mt?.sketchFrameOf ? ctx.mt.sketchFrameOf(sk) : null;
    const cost = costFeatures(p, sk, ctx.arc, fr, meas, a);
    guard = { cost };
    if (meas && fr && ringMisses(p, fr, meas.bbox)) return { refusal: `${L}the ring does not reach the part, so it would cut nothing.`, guard };
    if (on('G9') && meas && fr && ringSealed(p, fr, meas)) return { refusal: `${L}the ring lies completely inside the part, so cutting it would leave a sealed hollow with no opening, which cannot be built reliably here; let the ring reach the outside of the part.`, guard };
    const gz = on('G10') && meas && fr ? grazing(p, fr, meas) : null;
    if (gz) return { refusal: `${L}${gz.kind === 'lip' ? `the ring ends ${num(gz.gap)} mm short of a face of the part, which leaves a wall thinner than ${GRAZE_MM} mm that cannot be built reliably here` : `the round wall of the ring touches or passes within ${num(gz.gap)} mm of a flat face of the part, which cannot be built reliably here`}; move the ring edge onto that face or at least ${GRAZE_MM} mm away from it.`, guard };
    const g7 = on('G7') && meas && fr ? profilePlaneOnFlatFace(fr, meas.bbox, meas.faceTypes) : null;
    if (g7) {
      if (Math.abs(a) < 360) return { refusal: `${L}the ring starts in the flat plane ${g7.axis} = ${num(g7.at)}, which is also a flat face of the part, and a part turn cut from there does not come out reliably; lift the part off that plane by 1 mm or more, or turn the ring a full 360 degrees.`, guard };
      nudge = NUDGE_DEG;
    }
    if (on('G8') && meas && fr) { const c = costRefusal(cost); if (c) return { refusal: `${L}${c}.`, guard }; }
  }
  const plan = raw(f, st, ctx);
  if (plan.refusal) return plan;
  const side = on('G1') ? sideOf(p) : 1;
  const want = on('G3') ? kernelAngle(f, side) : (f.angle === 360 ? null : (side < 0 ? f.angle : -f.angle));
  for (const v of plan.variants ?? []) for (const c of v) {
    if (c.command === 'solid.revolve') { if (want === null) delete c.params.angle; else c.params.angle = want; }
    if (nudge && c.command === 'sketch.create' && c.params.plane) c.params.plane.x_dir = rotateAbout(c.params.plane.x_dir, c.params.plane.y_dir, nudge);
  }
  plan.guard = { ...(guard ?? {}), side, kernelAngle: want, nudgeDeg: nudge };
  return plan;
}

/** G5: a groove that built but changed nothing. Returns {plain} or null. `m` is the aggregate measure of the produced bodies. */
export function postCheck(f, st, m) {
  if (f.kind !== 'groove' || !on('G5')) return null;
  const before = st.measure[headOf(st, f.into)];
  if (!before || !m) return null;
  const same = Math.abs(m.volume - before.volume) <= NOTHING * Math.max(1, Math.abs(before.volume)) && m.faces === before.faces && m.bodies.length === before.bodies.length;
  return same ? { plain: `${lead(f)}the ring does not cut the part (it misses it, or turns away from it), so there is nothing to remove.` } : null;
}

/**
 * G6: the sentence for a feature solidcraft refused. `err` is the translator's lastErr (a string) or a {plain} from postCheck.
 * Returns a plain one-sentence refusal for revolve/groove, null for every other feature (the translator keeps its own wording).
 */
export function plainRefusal(f, err) {
  if (f.kind !== 'revolve' && f.kind !== 'groove') return null;
  if (err && typeof err === 'object' && err.plain) return err.plain;
  const t = String(err ?? '');
  const L = lead(f);
  if (/no body named/i.test(t)) {
    return f.kind === 'groove'
      ? `${L}the ring covers the whole part, so nothing would be left; make the ring smaller than the part.`
      : `${L}nothing came out of this spin; check that the outline has an area.`;
  }
  if (/crosses the revolve axis/i.test(t)) return `${L}the outline crosses the line it spins about, so one side would overlap the other; draw the whole outline on one side of that line.`;
  if (/came out empty/i.test(t)) return `${L}the ring does not reach the part, so it would cut nothing.`;
  if (/more than 0 and at most 360/i.test(t)) return `${L}a turn has to be more than 0 and at most 360 degrees here.`;
  if (/Cut|fallback|implausible|coincident|no result|reliabl/i.test(t)) {
    return f.kind === 'groove'
      ? `${L}this ring cannot be cut out of the part reliably, so the part is shown without it.`
      : `${L}this spin cannot be built reliably here, so it is not built.`;
  }
  if (/WASM TRAP|trap|unreachable|out of memory/i.test(t)) return `${L}this ${verbOf(f)} is too much for the engine, so it is not built.`;
  return `${L}this ${verbOf(f)} cannot be built here, so it is not built.`;
}

/** Words that must never reach a student (engine or internal names). */
export const JARGON = /solidcraft|solid\.|truck|kernel|brep|occt|opencascade|outlineOf|wasm|\bCut:|nudged|fallback|\bsoup\b|b_pull|b_rev|sk_|canonical|tessellat|body_name|rows and rules|\bdemo\b|translator|spike/i;
