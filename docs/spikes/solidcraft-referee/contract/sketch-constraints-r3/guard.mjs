// GUARDED SOUP ROUTE (round 3, group 'sketch-constraints'; round 2 + the round-3 fixes listed below). Proposed translator code; lives only in the contract dir.
//
// ROUND 3 CHANGES
//   placement   guardedSketch(sk, ...) now reads sk.plane / sk.offset / sk.frame (round 2 rebuilt the sketch from `plane` alone and silently built every offset or framed sketch at offset 0).
//               A new preflight refuses an unknown plane word, a non-finite offset and a malformed frame; a new post-build 'placement' check compares the solid's centre of mass and bbox with the frame.
//   sentences   every sentence is ONE sentence (sentenceCount() in refs.mjs is the lint, applied to every collected refusal in probes.mjs); only the first mapper refusal is shown.
//   references  driving:false rows are never sent to SolidCraft (a reference adds no equation); the value they carry is stale by design (brep-rs session.rs reference_values), so it is not a claim:
//               the measured value is returned in result.references instead, and a reference may sit on either side of the drawing.
//   redundancy  a row SolidCraft refuses as over-determined is set aside and the rest is solved; if the solved sketch then meets the set-aside row (within the residual tolerance) the doc
//               was redundant but consistent and is built, otherwise it is a real conflict and is refused. Row order no longer decides which of the two a student sees.
//
//   guardedSketch(sk, { height, order })  ->  { ok:true, body, solved, report, profiles, notes }  |  { ok:false, stage, sentence, detail }
//
// stages, each can refuse in ONE plain sentence (no ids, no solver internals):
//   preflight   arc rows whose ends are off their circle; a built-in origin (-1) named without an end in a dimension (brep-rs refuses the same row)
//   map         phase2/sketch-map.mjs refusals (branch requests that contradict the drawing, rows with no counterpart)  -> plainMapper()
//   solve       a command SolidCraft refuses (over/under-determined)                                                  -> plainSc()
//   report      SolidCraft's own report is not "solved" / has failing rows
//   residual    every driving rule is evaluated on the SOLVED geometry by phase2/rule-check.mjs (signed); a row it does not hold is refused
//   branch      branch.mjs: the solved geometry is on a different branch from the drawing
//   profiles    the doc's even-odd fill decides which of SolidCraft's profiles are extruded (robust winding number, not a ray)
//   extrude     SolidCraft's extrude errors                                                                           -> plainSc()
//
// Row order: the soup's rows are canonicalised before they are sent (canonicalOrder) because SolidCraft solves incrementally and lands on
// different branches for different orders of the SAME rows (measured in exp-order.mjs); locks stay first.
import { appendFileSync } from 'node:fs';
import { mapper, ruleCheck, scRaw, bodiesOf, solvedGeoms, clone } from './lib.mjs';
import { sizeOf, dist, sub, dot, cross, len, winding, circlePoints, arcPoints } from './geom.mjs';
import { branchViolations, loopsOf, loopSignature } from './branch.mjs';
import { nearestImageCheck } from './images.mjs';

export const ROW_CLASS = (r) => (r.k === 'lock' ? 'L' : r.k === 'coincident' ? 'J' : r.k === 'tangent' ? 'T' : ['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle'].includes(r.k) ? 'D' : 'G');
/** class order; locks always first (the mapper hoists them anyway). full:true also sorts INSIDE a class by (kind, a, aEnd, b, bEnd, c, cEnd, value) so the order does not depend on how the rows were written. */
export function canonicalOrder(rules, order = 'GTJD', full = true) {
  const idx = (r) => (ROW_CLASS(r) === 'L' ? -1 : order.indexOf(ROW_CLASS(r)));
  const key = (r) => [r.k, r.a, r.aEnd ?? '', r.b ?? 0, r.bEnd ?? '', r.c ?? 0, r.cEnd ?? '', r.value ?? 0].map((v) => (typeof v === 'number' ? String(v).padStart(12, '0') : String(v))).join('|');
  return rules.map((r, i) => [r, i]).sort((x, y) => idx(x[0]) - idx(y[0]) || (full ? (key(x[0]) < key(y[0]) ? -1 : key(x[0]) > key(y[0]) ? 1 : 0) : 0) || x[1] - y[1]);
}

// ---- plain wording -------------------------------------------------------------------------------------------------
const rowTxt = (i) => `Row ${i + 1} of sk.rules()`;
const nameOfRule = (r) => {
  switch (r.k) {
    case 'coincident': return `joins geometry ${r.a} and geometry ${r.b}`;
    case 'pointOnObject': return `puts a point of geometry ${r.a} on geometry ${r.b}`;
    case 'horizontal': return `makes geometry ${r.a} horizontal`;
    case 'vertical': return `makes geometry ${r.a} vertical`;
    case 'parallel': return `makes geometry ${r.a} parallel to geometry ${r.b}`;
    case 'perpendicular': return `makes geometry ${r.a} perpendicular to geometry ${r.b}`;
    case 'tangent': return `makes geometry ${r.a} tangent to geometry ${r.b}`;
    case 'equal': return `makes geometry ${r.a} and geometry ${r.b} equal`;
    case 'symmetric': return `mirrors geometry ${r.a} and geometry ${r.b}`;
    case 'distance': return r.a === r.b ? `sets the length of geometry ${r.a} to ${r.value}` : `sets the distance between geometry ${r.a} and geometry ${r.b} to ${r.value}`;
    case 'distanceX': return `sets the horizontal offset from geometry ${r.a} to geometry ${r.b} to ${r.value}`;
    case 'distanceY': return `sets the vertical offset from geometry ${r.a} to geometry ${r.b} to ${r.value}`;
    case 'radius': return `sets the radius of geometry ${r.a} to ${r.value}`;
    case 'diameter': return `sets the diameter of geometry ${r.a} to ${r.value}`;
    case 'angle': return `sets the angle between geometry ${r.a} and geometry ${r.b} to ${r.value} degrees`;
    case 'lock': return `pins geometry ${r.a}`;
    default: return `(${r.k})`;
  }
};
const CONFLICT = (i, rules) => `${rowTxt(i)} (it ${nameOfRule(rules[i])}) cannot be met together with the other rules from this drawing, so nothing was built; resolve the conflict, or redraw closer to the shape you mean.`;
const CROSSING = (what) => `With these values ${what}, which is not a valid outline, so nothing was built; change a value so the shapes stay clear of each other or fully inside one another.`;
const BRANCH = (what) => `The rules can be met by more than one shape and the solver would pick a different one from the one drawn (${what}), so nothing was built; redraw the sketch closer to the shape you want, or add a rule that fixes this.`;

/** mapper refusal -> plain sentence (the mapper's own text names solver internals) */
export function plainMapper(rf, rules, geoms = []) {
  const s = rf.sentence, i = rf.rule;
  const row = i >= 0 ? rowTxt(i) : 'The sketch';
  let m;
  if ((m = s.match(/^geometry row (\d+) carries id (\S+);/))) return `Geometry rows must be numbered 1, 2, 3 ... in order, but row ${m[1]} is numbered ${m[2]}.`;
  if ((m = s.match(/^geometry (\d+) is a (\w+), which this mapper does not draw/))) return `Geometry ${m[1]} is a ${m[2]}, and the sketch can only draw points, lines, circles and arcs.`;
  if (/axis has no point to name|sketch axis cannot be used here/.test(s)) return `${row} names an axis where it needs a point or a different kind of line.`;
  if ((m = s.match(/names geometry (-?\d+), which is not in the sketch/))) return `${row} names geometry ${m[1]}, but the sketch has no geometry ${m[1]}.`;
  if ((m = s.match(/needs a point of geometry (-?\d+) and the row names none/))) return `${row} needs one point of geometry ${m[1]} ('a', 'b' or 'c') and does not say which.`;
  if ((m = s.match(/geometry (\d+) is a point and has no end '(\w)'/))) return `${row} names end '${m[2]}' of geometry ${m[1]}, but a point has no ends.`;
  if ((m = s.match(/geometry (\d+) is a (\w+) and has no point '(\w)'/))) return `${row} names point '${m[3]}' of geometry ${m[1]}, but a ${m[2]} has no '${m[3]}'.`;
  if ((m = s.match(/geometry (\d+) is a point, not a curve/))) return `${row} needs a line or circle but geometry ${m[1]} is a point.`;
  if ((m = s.match(/geometry (\d+) is a (\w+); this rule needs (.+)$/))) { const need = { line: 'a line', 'circle or arc': 'a circle or an arc', 'line or circle or arc': 'a line, circle or arc' }[m[3]] ?? m[3]; return `${row} needs ${need} but geometry ${m[1]} is ${m[2] === 'arc' ? 'an' : 'a'} ${m[2]}.`; }
  if (/equal across a line and a circle/.test(s)) return `${row} sets a line equal to a circle; equal needs two lengths or two radii, not one of each.`;
  if (/endpoint tangent form with no coincident row/.test(s)) return `${row} makes two curves tangent at their ends, but no earlier row joins those two ends; add a coincident row for them first.`;
  if ((m = s.match(/asks for (\w+) tangency but the circles start (\w+)ly placed/))) return `${row} asks for ${m[1]} tangency but the two circles are drawn ${m[2]}ly; draw them ${m[1]}ly (or ask for ${m[2]} tangency).`;
  if (/records side .* circle starts on the other side of the line/.test(s)) return `${row} asks for the circle on one side of the line but it is drawn on the other side; redraw it on the side you mean.`;
  if (/carries no numeric value/.test(s)) return `${row} has no number to hold.`;
  if (/has value (-?[\d.e+-]+); .*distance dimension is a length/.test(s)) return `${row} is a distance of ${s.match(/has value (\S+);/)[1]}; a distance has to be more than zero.`;
  if (/is a reference .* of 0/.test(s)) return `${row} is a reference (driving: false) offset of 0, which the sketch cannot show; leave it out or use a number other than 0.`;
  if (/start level in/.test(s)) return `${row} sets a signed offset but the two points are drawn level, so the side it means cannot be told; draw them a little apart on the side you want.`;
  if (/is the SIGNED/.test(s)) { const mm = s.match(/SIGNED (distance[XY]) (-?[\d.]+).*points start (positive|negative)/); return `${row} asks for a ${mm?.[1] === 'distanceX' ? 'horizontal' : 'vertical'} offset of ${mm?.[2]} but the points are drawn on the other side; redraw them on the side you mean.`; }
  if (/has value (-?[\d.e+-]+); a radius or diameter must be positive/.test(s)) return `${row} sets a radius or diameter of ${s.match(/has value (\S+);/)[1]}; it has to be more than zero.`;
  if (/zero-length line at the start/.test(s)) return `${row} sets an angle but one of the two lines is drawn with no length.`;
  if (/is the directed angle .* opposite orientation/.test(s)) {
    const mm = s.match(/directed angle (-?[\d.]+) deg from line (\d+) to line (\d+)/);
    const ga = geoms.find((g) => g.id === +mm?.[2]), gb = geoms.find((g) => g.id === +mm?.[3]);
    let drawn = '';
    if (ga && gb) { const da = sub(ga.b, ga.a), db = sub(gb.b, gb.a); drawn = ` but the lines are drawn at about ${Math.round((Math.atan2(cross(da, db), dot(da, db)) * 180) / Math.PI)} degrees`; }
    const flipped = ga && gb && Math.sign(cross(sub(ga.b, ga.a), sub(gb.b, gb.a))) !== Math.sign(+mm?.[1]) ? ' (they turn the other way round)' : '';
    return `${row} asks for ${mm?.[1]} degrees from line ${mm?.[2]} to line ${mm?.[3]},${drawn || ' but the lines are drawn the other way round'}${flipped}; the solver cannot swing a line across that far, so redraw the lines near ${mm?.[1]} degrees first.`;
  }
  if (/a lock cannot be a reference/.test(s)) return `${row} pins a point, which cannot be a reference (driving: false) row.`;
  if (/reference .* of 0|has no reference form/.test(s)) return `${row} cannot be shown as a reference measurement.`;
  if (/kind '(\w+)' is not in the soup vocabulary/.test(s)) return `${row} is a '${s.match(/kind '(\w+)'/)[1]}' rule, which the sketch does not know.`;
  return `${row} has no counterpart in the sketch solver, so the sketch was not built.`;
}
/** a refused SolidCraft command / extrude -> plain sentence */
export function plainSc(error, rIndex, rules) {
  const e = String(error);
  if (/already determined|over-constrain|neither entity can move|conflicts with the sketch|redundant/i.test(e)) return rIndex >= 0 ? CONFLICT(rIndex, rules) : `The sketch's rules conflict, so the shape cannot be built; resolve the conflict first.`;
  if (/cannot attach a plane|not on one plane/i.test(e)) return `The outline does not close into one flat loop (some ends that should meet are apart), so there is nothing to extrude; check the rows that join the ends.`;
  if (/no closed profiles/i.test(e)) return `The outline does not close into a loop, so there is nothing to extrude; check the rows that join the ends.`;
  if (rIndex >= 0) return `${rowTxt(rIndex)} (it ${nameOfRule(rules[rIndex])}) could not be applied to the sketch, so it was not built.`;
  return `The sketch could not be built from these rules.`;
}

// ---- preflight ---------------------------------------------------------------------------------------------------
export function preflight(geoms, rules, { arcTol = 1e-6 } = {}) {
  // round 3: only an arc whose CENTRE is pinned by a lock row is refused for ends off its circle (the arc is built from its two ends and a third point, so the pinned centre would not be the one written);
  // every other off-circle arc is solved from the rules and checked after the solve (round 2 refused all of them, which is far wider than the failure it guards against)
  const pinned = new Set(rules.filter((r) => r.k === 'lock' && r.active !== false && (r.aEnd === undefined || r.aEnd === 'c')).map((r) => r.a));
  for (const g of geoms) {
    if (g.k !== 'arc' || !pinned.has(g.id)) continue;
    const tol = arcTol * Math.max(1, g.r);
    const ea = Math.abs(dist(g.a, g.c) - g.r), eb = Math.abs(dist(g.b, g.c) - g.r);
    if (ea > tol || eb > tol) return `Arc ${g.id} has an end that is not on its circle (off by ${Math.max(ea, eb).toPrecision(2)}) and a row pins its centre, so the pinned centre would not be where the row says; make the arc's centre, radius and ends agree, or pin one of its ends instead.`;
  }
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    // round 3: the independent rule checker (phase2/rule-check.mjs) has no reading for a tangent to a built-in axis, so it could not be verified after the solve: refused before the solve
    if (r.k === 'tangent' && r.active !== false && (r.a < 0 || r.b < 0)) return `${rowTxt(i)} makes a curve tangent to an axis, and that cannot be checked after the solve; draw a construction line along the axis and make the curve tangent to that.`;
    if (r.k === 'tangent' && r.active !== false && r.aEnd === undefined && r.bEnd === undefined) {
      const ga = geoms.find((x) => x.id === r.a), gb = geoms.find((x) => x.id === r.b);
      const flat = (id, x) => id === -2 || id === -3 || x?.k === 'line';
      if (flat(r.a, ga) && flat(r.b, gb)) return `${rowTxt(i)} makes a line tangent to a line; tangent needs at least one circle or arc.`;
    }
    if (!['distance', 'distanceX', 'distanceY'].includes(r.k) || r.active === false) continue;
    if (r.a === -1 && r.aEnd === undefined) return `${rowTxt(i)} measures from the origin but does not say which point of it; write aEnd: 'a'.`;
    if (r.b === -1 && r.bEnd === undefined) return `${rowTxt(i)} measures to the origin but does not say which point of it; write bEnd: 'a'.`;
  }
  return null;
}

// ---- residual ------------------------------------------------------------------------------------------------------
/** per-kind tolerance (mm, or unit-less sin/cos for parallel/perpendicular, degrees for angle). SolidCraft's joint error on arcs/tangents/distance-pinned points is ~1e-4 mm (measured, see rows). */
export const RES_TOL = { mm: 1e-6, mmCurved: 1e-3, unitless: 1e-6, deg: 1e-5 };
const touchesArc = (r, byId) => [r.a, r.b, r.c].some((id) => byId.get(id)?.k === 'arc') || r.k === 'tangent';
export function residualViolations(S, T, rules) {
  const byId = new Map(T.map((g) => [g.id, g]));
  const diag = sizeOf(S);
  const res = ruleCheck.checkRules(T, rules, S);
  const bad = [];
  for (const x of res) {
    if (!x.driving || x.residual === null) continue;
    const r = rules[x.rule];
    const tol = x.unit === 'mm' ? (touchesArc(r, byId) ? RES_TOL.mmCurved : RES_TOL.mm) * Math.max(1, diag / 40) : x.unit.startsWith('deg') ? RES_TOL.deg : RES_TOL.unitless;
    if (x.residual > tol) bad.push({ rule: x.rule, residual: x.residual, tol, unit: x.unit });
  }
  return { bad, all: res };
}

// ---- profile selection (even-odd fill of the doc's own loops) --------------------------------------------------------
/** which of SolidCraft's profiles (interior points) are solid in the doc's meaning: inside an ODD number of the doc's loops. Winding number, so no ray can graze a vertex. */
export function evenOddProfiles(profileList, T, rules) {
  const loops = loopsOf(T, rules);
  const sig = loopSignature(T, loops).filter((s) => s.closed);
  return profileList.map((p, i) => ({ i, depth: sig.filter((s) => winding(p.interior, s.poly) !== 0).length })).filter((x) => x.depth % 2 === 1).map((x) => x.i);
}

// ---- placement (round 3) ---------------------------------------------------------------------------------------------
const NAMED_PLANES = { xy: { u: [1, 0, 0], v: [0, 1, 0] }, xz: { u: [1, 0, 0], v: [0, 0, 1] }, yz: { u: [0, 1, 0], v: [0, 0, 1] } };
const v3 = { dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len: (a) => Math.hypot(a[0], a[1], a[2]) };
const isVec3 = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'number' && Number.isFinite(x));
/** the world frame the sketch is drawn in, exactly as model-types.ts sketchFrameOf resolves it (a literal frame wins; plane and offset are then ignored). Returns {ok, frame, sentence}. */
export function placementOf(sk) {
  if (sk.frame) {
    const { origin, u, v } = sk.frame;
    if (!isVec3(origin) || !isVec3(u) || !isVec3(v)) return { ok: false, sentence: 'The sketch frame needs an origin and two in-plane axes u and v, each three plain numbers.' };
    const eu = Math.abs(v3.len(u) - 1), ev = Math.abs(v3.len(v) - 1), eo = Math.abs(v3.dot(u, v));
    if (Math.max(eu, ev, eo) > 1e-6) return { ok: false, sentence: 'The sketch frame\'s axes u and v have to be unit length and at right angles to each other, and these are not.' };
    return { ok: true, frame: { origin, u, v } };
  }
  const plane = sk.plane ?? 'xy';
  if (!(plane in NAMED_PLANES)) return { ok: false, sentence: `The sketch is on a plane called '${String(plane).slice(0, 20)}', and the sketch planes are xy, xz and yz.` };
  const offset = sk.offset ?? 0;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return { ok: false, sentence: 'The sketch plane\'s offset has to be a plain number.' };
  const n = { xy: [0, 0, 1], xz: [0, 1, 0], yz: [1, 0, 0] }[plane];
  return { ok: true, frame: { origin: n.map((c) => c * offset), ...NAMED_PLANES[plane] } };
}
/** The solid must sit where the frame says: centre of mass along u x v is height/2 from the plane, its in-plane position is inside the solved sketch's box, and its world bbox is inside the box of the transformed sketch box. */
export function placementViolation(frame, T, body, height) {
  const n = v3.cross(frame.u, frame.v);
  const rel = v3.sub(body.com, frame.origin);
  const hn = v3.dot(rel, n), hu = v3.dot(rel, frame.u), hv = v3.dot(rel, frame.v);
  const pts = [];
  for (const g of T) {
    if (g.construction) continue;
    if (g.k === 'line') pts.push(g.a, g.b); else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]); else if (g.k === 'arc') pts.push(...arcPoints(g, 48)); else if (g.k === 'point') pts.push(g.p);
  }
  if (!pts.length) return null;
  const bx = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))], by = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const tol = 1e-3 * Math.max(1, Math.abs(height), bx[1] - bx[0], by[1] - by[0]);
  if (Math.abs(hn - height / 2) > tol) return `the solid sits ${hn.toFixed(4)} along the sketch normal from the sketch plane, not ${(height / 2).toFixed(4)}`;
  if (hu < bx[0] - tol || hu > bx[1] + tol || hv < by[0] - tol || hv > by[1] + tol) return `the solid's centre sits at (${hu.toFixed(3)}, ${hv.toFixed(3)}) in the sketch plane, outside the sketch`;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const x of bx) for (const y of by) for (const z of [0, height]) for (let k = 0; k < 3; k++) { const w = frame.origin[k] + frame.u[k] * x + frame.v[k] * y + n[k] * z; lo[k] = Math.min(lo[k], w); hi[k] = Math.max(hi[k], w); }
  for (let k = 0; k < 3; k++) if (body.bbox[k] < lo[k] - tol || body.bbox[3 + k] > hi[k] + tol) return `the solid reaches outside the box the sketch frame allows along axis ${'xyz'[k]}`;
  return null;
}

// ---- references (driving:false) --------------------------------------------------------------------------------------
const REF_KINDS = ['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle'];
/** what a reference dimension measures on the solved geometry (signed for distanceX / distanceY, degrees mod 180 for angle), the same readings brep-rs reference_values() gives. null if it cannot be read. */
export function measureRef(r, T) {
  const byId = new Map(T.map((g) => [g.id, g]));
  const P = (id, end) => (id === -1 ? [0, 0] : ruleCheck.pointOf(byId.get(id), end));
  try {
    switch (r.k) {
      case 'distance': { const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd); return a && b ? dist(a, b) : null; }
      case 'distanceX': { const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd); return a && b ? b[0] - a[0] : null; }
      case 'distanceY': { const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd); return a && b ? b[1] - a[1] : null; }
      case 'radius': return byId.get(r.a)?.r ?? null;
      case 'diameter': return byId.get(r.a) ? 2 * byId.get(r.a).r : null;
      case 'angle': { const ga = byId.get(r.a), gb = byId.get(r.b); const da = sub(ga.b, ga.a), db = sub(gb.b, gb.a); return ((((Math.atan2(cross(da, db), dot(da, db)) * 180) / Math.PI) % 180) + 180) % 180; }
      default: return null;
    }
  } catch { return null; }
}

/** a drawn (non-construction) line, circle or arc that the rules squashed to nothing */
export function collapsedGeom(T) {
  const sz = sizeOf(T);
  for (const g of T) {
    if (g.construction) continue;
    const tiny = g.k === 'line' ? dist(g.a, g.b) < 1e-7 * Math.max(1, sz) : g.k === 'circle' || g.k === 'arc' ? !(g.r > 1e-7 * Math.max(1, sz)) : false;
    if (tiny) return `Geometry ${g.id} was squashed to nothing by the rules (for example a line held both horizontal and vertical), so nothing was built; remove or change the rule that squashes it.`;
  }
  return null;
}

// ---- the guarded route -----------------------------------------------------------------------------------------------
const OVER = /already determined|over-constrain|neither entity can move|conflicts with the sketch|redundant/i;
function guardedSketchInner(sk, { height = 10, order = 'GTJD', plane = undefined, skipBranch = false, skipResidual = false, noCanon = false, permute = null, profileMode = 'evenodd', noDemote = false, noPlacement = false, arcTol = 1e-6, _dropFrame = false } = {}) {
  const geoms = clone(sk.geoms), rules = clone(sk.rules);
  const fail = (stage, sentence, detail = {}) => ({ ok: false, stage, sentence, detail });
  // round 3: placement comes from the sketch itself (round 2 passed only `plane`, so offset and frame were dropped and every such sketch was built at offset 0)
  const pl = placementOf({ plane: sk.plane ?? plane, offset: sk.offset, frame: sk.frame });
  if (!pl.ok) return fail('preflight', pl.sentence);
  const pre = preflight(geoms, rules, { arcTol });
  if (pre) return fail('preflight', pre);
  // a reference may only be a dimension (brep-rs refuses the rest); a reference adds no equation, so it is never sent
  const refIdx = new Set();
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].driving !== false || rules[i].active === false) continue;
    if (!REF_KINDS.includes(rules[i].k)) return fail('preflight', `${rowTxt(i)} (it ${nameOfRule(rules[i])}) is marked as a reference, and only a dimension (a distance, offset, radius, diameter or angle) can be a reference.`);
    refIdx.add(i);
  }
  // canonical row order; keep the map from sent index to original index for sentences
  const perm = permute ? permute(rules) : noCanon ? rules.map((r, i) => [r, i]) : canonicalOrder(rules, order);
  const demoted = [];
  let m, r, res, bad, dump, sent, orig;
  for (let attempt = 0; attempt < 8; attempt++) {
    const used = perm.filter((x) => !refIdx.has(x[1]) && !demoted.includes(x[1]));
    sent = used.map((x) => ({ ...x[0], ...(x[0].driving === false ? { driving: undefined } : {}) }));
    orig = used.map((x) => x[1]);
    m = mapper.mapSketch({ id: 'p', plane: sk.plane ?? plane ?? 'xy', offset: _dropFrame ? undefined : sk.offset, frame: _dropFrame ? undefined : sk.frame, geoms: clone(geoms), rules: clone(sent) }, { name: 'sk' });
    if (!m.ok) { const rf = m.refusals[0]; return fail('map', plainMapper({ ...rf, rule: rf.rule >= 0 ? orig[rf.rule] : -1 }, rules, geoms), { raw: m.refusals.map((x) => x.sentence), more: m.refusals.length - 1 }); }
    const cmds = mapper.extrudeCommands(m, { height });
    r = scRaw(cmds);
    res = r.results ?? [];
    bad = res.find((x) => !x.ok && x.command !== '@sketch');
    dump = res.find((x) => x.command === '@sketch')?.out;
    if (bad && !noDemote && OVER.test(String(bad.error)) && bad.command.startsWith('sketch.')) {
      const ri = m.ruleMap.findIndex((ix) => ix && ix.includes(bad.i));
      const oi = ri >= 0 ? orig[ri] : -1;
      if (oi >= 0 && rules[oi].k !== 'lock') { demoted.push(oi); continue; }
    }
    break;
  }
  if (bad) {
    const ri = m.ruleMap.findIndex((ix) => ix && ix.includes(bad.i));
    const oi = ri >= 0 ? orig[ri] : -1;
    // a refused extrude is often the visible end of a collapsed shape (a line held both horizontal and vertical has no length): name that instead
    if (bad.command === 'solid.extrude' && dump?.sketch) { const col = collapsedGeom(solvedGeoms(geoms, m.names, dump)); if (col) return fail('collapsed', col, { raw: bad.error }); }
    return fail(bad.command === 'solid.extrude' ? 'extrude' : 'solve', plainSc(bad.error, oi, rules), { raw: bad.error, command: bad.command });
  }
  if (!dump?.report) return fail('report', 'The sketch could not be solved.', { raw: 'no @sketch dump' });
  const rep = dump.report;
  if (rep.status !== 'solved' || (rep.failing ?? []).length) return fail('report', `The solver could not satisfy all the rules (${rep.status}), so nothing was built; check for rules that fight each other.`, { report: rep });
  const T = solvedGeoms(geoms, m.names, dump);
  if (!skipResidual) {
    const rv = residualViolations(geoms, T, rules);
    if (rv.bad.length) {
      const b = rv.bad[0];
      if (demoted.includes(b.rule)) return fail('residual', CONFLICT(b.rule, rules), { bad: rv.bad.slice(0, 4), demoted });
      return fail('residual', `${rowTxt(b.rule)} (it ${nameOfRule(rules[b.rule])}) is not met by the solved sketch, so nothing was built; the rules probably conflict.`, { bad: rv.bad.slice(0, 4), demoted });
    }
  }
  if (!skipBranch) {
    const bv = branchViolations(geoms, T, rules);
    const im = bv.length ? { ok: true } : nearestImageCheck(geoms, T, rules);
    if (!im.ok) bv.push({ kind: 'other-side', text: im.text });
    const crossing = bv.find((v) => v.kind === 'self-cross' || v.to === 'cross');
    if (crossing) return fail('branch', CROSSING(crossing.text), { violations: bv, crossing: true });
    if (bv.length) return fail('branch', BRANCH(bv[0].text), { violations: bv });
  }
  let body = bodiesOf(r.measure);
  const profiles = dump.profile_list ?? [];
  let chosen = null;
  if (profileMode === 'evenodd' && profiles.length > 1) {
    chosen = evenOddProfiles(profiles, T, rules);
    if (chosen.length === 0) return fail('profiles', 'The outline has no solid area to extrude.', { profiles: profiles.length });
    if (chosen.length !== profiles.length) {
      const cmds2 = mapper.extrudeCommands(m, { height }).filter((c) => c.command !== '@sketch');
      const e = cmds2.find((c) => c.command === 'solid.extrude'); e.params.profiles = chosen.map((i) => ({ point: profiles[i].interior }));
      const r2 = scRaw(cmds2);
      const bad2 = (r2.results ?? []).find((x) => !x.ok);
      if (bad2) return fail('extrude', plainSc(bad2.error, -1, rules), { raw: bad2.error });
      body = bodiesOf(r2.measure);
    }
  }
  if (!body) return fail('extrude', 'The sketch produced no solid.', {});
  if (!noPlacement) {
    const pv = placementViolation(pl.frame, T, body, height);
    if (pv) return fail('placement', `The solid did not land where the sketch plane is, so nothing was built (${pv}).`, { pv });
  }
  const references = [...refIdx].sort((a, b) => a - b).map((i) => { const mv = measureRef(rules[i], T); return { rule: i, stored: rules[i].value, measured: mv, stale: typeof rules[i].value === 'number' && mv !== null ? Math.abs(rules[i].value - mv) > 1e-6 * Math.max(1, Math.abs(mv)) : null }; });
  return { ok: true, body, solved: T, report: rep, profiles: profiles.length, chosen, map: m, notes: m.notes, perm: orig, demoted, references, frame: pl.frame };
}

export function guardedSketch(sk, opts = {}) {
  try { return guardedSketchInner(sk, opts); } catch (e) {
    // a check that throws must never let a solid through: it is a refusal in one plain sentence (the raw message stays in `detail` for the referee, not for the student)
    return { ok: false, stage: 'internal', sentence: 'The sketch could not be checked against its rules, so nothing was built; remove the last rule you added or simplify the sketch.', detail: { raw: String(e?.message ?? e).slice(0, 200) } };
  }
}

// ---- the ladder -----------------------------------------------------------------------------------------------------
// SolidCraft solves after every command, so the SAME valid rows land on different branches (or are refused as over-constrained) depending on their order.
// The rows are therefore tried in a short list of fixed orders and the FIRST attempt that passes every check above is used. A rung that fails a check is
// discarded, never "fixed". LADDER_DEFAULT is chosen from exp-ladder.mjs data (greedy cover); the last rung is the order the rows were written in.
export const LADDER_DEFAULT = [
  ['JGTD*', (rules) => canonicalOrder(rules, 'JGTD', true)],
  ['GJTD*', (rules) => canonicalOrder(rules, 'GJTD', true)],
  ['GTDJ*', (rules) => canonicalOrder(rules, 'GTDJ', true)],
  ['as-written', (rules) => rules.map((r, i) => [r, i])],
];
const RANK = { branch: 0, placement: 0, collapsed: 0, internal: 7.5, residual: 1, profiles: 2, extrude: 3, solve: 4, report: 5, map: 6, preflight: 7 };
const SEEN = new Set();
/** every sentence a student could be shown is appended (once per process) to $SENTENCE_LOG for the audit (audit.mjs) */
export function logSentence(sentence, stage = '') {
  const f = process.env.SENTENCE_LOG;
  if (!f || !sentence || SEEN.has(sentence)) return;
  SEEN.add(sentence);
  try { appendFileSync(f, JSON.stringify({ s: sentence, stage }) + '\n'); } catch { /* */ }
}
export function ladderSketch(sk, opts = {}) {
  const r = ladderInner(sk, opts);
  if (!r.ok) logSentence(r.sentence, r.stage);
  return r;
}
function ladderInner(sk, opts = {}) {
  const ladder = opts.ladder ?? LADDER_DEFAULT;
  const tried = []; let best = null;
  for (const [name, permute] of ladder) {
    const g = guardedSketch(sk, { ...opts, permute });
    tried.push({ rung: name, stage: g.ok ? 'ok' : g.stage });
    if (g.ok) return { ...g, rung: name, tried };
    if (g.stage === 'preflight' || g.stage === 'map') return { ...g, tried };      // independent of the order
    if (!best || RANK[g.stage] < RANK[best.stage]) best = g;                      // keep the most informative refusal (a branch / rule sentence beats "over-constrained")
  }
  return { ...best, tried };
}
