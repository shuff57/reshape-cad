// GUARDED SOUP ROUTE (round 2, group 'sketch-constraints'). Proposed translator code; lives only in the contract dir.
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
import { mapper, ruleCheck, scRaw, bodiesOf, solvedGeoms, clone } from './lib.mjs';
import { sizeOf, dist, sub, dot, cross, len, winding, circlePoints } from './geom.mjs';
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
const CONFLICT = (i, rules) => `${rowTxt(i)} (it ${nameOfRule(rules[i])}) cannot be met together with the other rules from this drawing: they conflict, or the drawing is too far from the shape they describe. Nothing was built; resolve the conflict first, or redraw closer.`;
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
export function preflight(geoms, rules) {
  for (const g of geoms) {
    if (g.k !== 'arc') continue;
    const tol = 1e-6 * Math.max(1, g.r);
    const ea = Math.abs(dist(g.a, g.c) - g.r), eb = Math.abs(dist(g.b, g.c) - g.r);
    if (ea > tol || eb > tol) return `Arc ${g.id} has an end that is not on its circle (off by ${Math.max(ea, eb).toPrecision(2)}); an arc's centre, radius and two ends have to agree, so redraw it.`;
  }
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
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

// ---- the guarded route -----------------------------------------------------------------------------------------------
export function guardedSketch(sk, { height = 10, order = 'GTJD', plane = 'xy', skipBranch = false, skipResidual = false, noCanon = false, permute = null, profileMode = 'evenodd' } = {}) {
  const geoms = clone(sk.geoms), rules = clone(sk.rules);
  const fail = (stage, sentence, detail = {}) => ({ ok: false, stage, sentence, detail });
  const pre = preflight(geoms, rules);
  if (pre) return fail('preflight', pre);
  // canonical row order; keep the map from sent index to original index for sentences
  const perm = permute ? permute(rules) : noCanon ? rules.map((r, i) => [r, i]) : canonicalOrder(rules, order);
  const sent = perm.map((x) => x[0]);
  const orig = perm.map((x) => x[1]);
  const m = mapper.mapSketch({ id: 'p', plane, geoms: clone(geoms), rules: clone(sent) }, { name: 'sk' });
  if (!m.ok) return fail('map', m.refusals.map((rf) => plainMapper({ ...rf, rule: rf.rule >= 0 ? orig[rf.rule] : -1 }, rules, geoms)).join(' '), { raw: m.refusals.map((x) => x.sentence) });
  const cmds = mapper.extrudeCommands(m, { height });
  const r = scRaw(cmds);
  const res = r.results ?? [];
  const bad = res.find((x) => !x.ok && x.command !== '@sketch');
  const dump = res.find((x) => x.command === '@sketch')?.out;
  if (bad) {
    const ri = m.ruleMap.findIndex((ix) => ix && ix.includes(bad.i));
    const oi = ri >= 0 ? orig[ri] : -1;
    return fail(bad.command === 'solid.extrude' ? 'extrude' : 'solve', plainSc(bad.error, oi, rules), { raw: bad.error, command: bad.command });
  }
  if (!dump?.report) return fail('report', 'The sketch could not be solved.', { raw: 'no @sketch dump' });
  const rep = dump.report;
  if (rep.status !== 'solved' || (rep.failing ?? []).length) return fail('report', `The solver could not satisfy all the rules (${rep.status}), so nothing was built; check for rules that fight each other.`, { report: rep });
  const T = solvedGeoms(geoms, m.names, dump);
  if (!skipResidual) {
    const rv = residualViolations(geoms, T, rules);
    if (rv.bad.length) { const b = rv.bad[0]; return fail('residual', `${rowTxt(b.rule)} (it ${nameOfRule(rules[b.rule])}) is not met by the solved sketch, so nothing was built; the rules probably conflict.`, { bad: rv.bad.slice(0, 4) }); }
  }
  if (!skipBranch) {
    const bv = branchViolations(geoms, T, rules);
    const im = bv.length ? { ok: true } : nearestImageCheck(geoms, T, rules);
    if (!im.ok) bv.push({ kind: 'other-side', text: im.text });
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
  return { ok: true, body, solved: T, report: rep, profiles: profiles.length, chosen, map: m, notes: m.notes, perm: orig };
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
const RANK = { branch: 0, residual: 1, profiles: 2, extrude: 3, solve: 4, report: 5, map: 6, preflight: 7 };
export function ladderSketch(sk, opts = {}) {
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
