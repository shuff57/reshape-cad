// CONTRACT PIECE (round 4, proposed translator code, lives only in the contract dir). The guard for the SOUP (rows-and-rules) route that needs ONLY the stock
// referee pkg: `run` answers with the first refused command or the final measure, never the solved sketch, so the round-3 post-solve guard (soup-guard.mjs, which read
// SolveReport and solved points from the wrapper2 build) cannot run on this rig.
//
// Measured failures this stands in front of (r4c.mjs): two right angles on a triangle build a 0.0229 mm3 sliver with no error; a signed distanceY asked as +2.1 builds as -2.1
// (SolidCraft dimensions are |d|); the arc-first-order slot from a start 1% to 3.5% off builds a solid whose volume is 26% to 76% wrong with the bbox and face types exactly right.
//
// The design is "solve with a solver we can check, let SolidCraft verify and build":
//   1. WITNESS. indep.mjs (its own residuals, signed, its own LM and numeric Jacobian rank; shares no code with brep-rs or solidcraft) solves the rules from the drawn start, then from deterministic
//      jitters. A witness is accepted only if (a) indep's residual is < 1e-9, (b) phase2/rule-check.mjs (a second evaluator, plain geometry) agrees, (c) nothing was squeezed to a sliver unless a size rule asked for it
//      (soup-guard.mjs guardSolved). Several accepted witnesses: the one nearest to the drawn sketch. None: REFUSE before any kernel call, naming the rule that is still off.
//   2. BUILD ON THE WITNESS. The mapper draws the WITNESS (not the drawn start), emits the student's rules, then fixes every point and keeps every radius at the witness value.
//      SolidCraft therefore cannot land in another basin, cannot flip a signed distance and cannot collapse: if it disagrees with the witness about any rule it answers with a refusal
//      ("conflicts", "over-constrain"), which is turned into one plain sentence. A refusal is never retried elsewhere.
//   3. DIAGNOSTIC (not a gate): the unguarded SolidCraft answer from the drawn start is built too and compared with the witness build (rawAgrees), so a report can say where SolidCraft's own solver was wrong.
import * as L from './lib.mjs';
import { analyse, unpack, build, rankOf } from './indep.mjs';
import { guardSolved } from './soup-guard.mjs';
import { labelSoup, plainProblems, plainRefusal } from './refusal-sentence.mjs';
import { evenOddPicks, soupLoops } from '../soup-regions.mjs';

const clone = L.clone;
/** reference (driving:false) rules are measurements, not constraints: the independent solver must not enforce them */
const live = (rules) => rules.map((r) => (r.driving === false ? { ...r, active: false } : r));
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const HEIGHT = 10;

const ent = (geoms, id) => { if (id === -1) return 'the origin'; if (id === -2) return 'the x axis'; if (id === -3) return 'the y axis'; const g = geoms.find((x) => x.id === id); return g?.k === 'circle' ? `circle ${id}` : g?.k === 'arc' ? `arc ${id}` : g?.k === 'point' ? `point ${id}` : `line ${id}`; };
/** a noun phrase for one rule: labelSoup() plus the kinds it words badly (a distance between two different shapes, point-on-shape, symmetric) */
export function labelRule(r0, geoms) {
  const r = typeof r0.value === 'number' ? { ...r0, value: Math.round(r0.value * 1000) / 1000 } : r0;
  const e = (id) => ent(geoms, id);
  if (r.k === 'distance' && r.a !== r.b) return `the ${r.value} distance between ${e(r.a)} and ${e(r.b)}`;
  if (r.k === 'pointOnObject') return `a point of ${e(r.a)} sitting on ${e(r.b)}`;
  if (r.k === 'symmetric') return `${e(r.a)} and ${e(r.b)} being mirror images about ${e(r.c)}`;
  return labelSoup(r, geoms);
}


const coordsOf = (g) => (g.k === 'point' ? [g.p] : g.k === 'line' ? [g.a, g.b] : g.k === 'circle' ? [g.c] : [g.c, g.a, g.b]);
const diagOf = (geoms) => { const pts = geoms.flatMap((g) => (g.k === 'circle' ? [[g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]] : coordsOf(g))); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1; };
const moved = (A, B) => A.reduce((s, g, i) => s + coordsOf(g).reduce((t, p, j) => t + (p[0] - coordsOf(B[i])[j][0]) ** 2 + (p[1] - coordsOf(B[i])[j][1]) ** 2, 0) + ((g.r ?? 0) - (B[i].r ?? 0)) ** 2, 0);

/** the points the rules pin (lock) must not be jittered: indep's lock reads its anchor from the start geoms */
function jitterGeoms(geoms, rules, amp, rnd) {
  const locked = new Set(rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const isLocked = (g, end) => locked.has(`${g.id}:${end}`) || (locked.has(`${g.id}:`) && ((g.k === 'circle' && end === 'c') || (g.k !== 'circle' && end === 'a')));
  const mv = (p) => [p[0] + (rnd() * 2 - 1) * amp, p[1] + (rnd() * 2 - 1) * amp];
  return geoms.map((g) => {
    const o = clone(g);
    if (g.k === 'point' && !isLocked(g, 'a')) o.p = mv(g.p);
    if (g.k === 'line') { if (!isLocked(g, 'a')) o.a = mv(g.a); if (!isLocked(g, 'b')) o.b = mv(g.b); }
    if (g.k === 'circle') { if (!isLocked(g, 'c')) o.c = mv(g.c); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    if (g.k === 'arc') { if (!isLocked(g, 'c')) o.c = mv(g.c); if (!isLocked(g, 'a')) o.a = mv(g.a); if (!isLocked(g, 'b')) o.b = mv(g.b); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    return o;
  });
}


const polyArea = (poly) => Math.abs(poly.reduce((a, q, i) => a + q[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * q[1], 0)) / 2;
/** a closed outline squeezed flat (no single edge is short, but the area is gone): loop ids, or null. Compared with the drawn loop of the same rows. */
export function flatLoop(drawn, solved) {
  const a = soupLoops({ id: 'g', geoms: drawn }), b = soupLoops({ id: 'g', geoms: solved });
  if (!a.loops || !b.loops) return null;
  for (const lb of b.loops) {
    const la = a.loops.find((l) => l.ids.length === lb.ids.length && l.ids.every((i) => lb.ids.includes(i)));
    if (!la) continue;
    const A0 = polyArea(la.poly); if (A0 < 1e-9) continue;
    if (polyArea(lb.poly) < 1e-4 * A0) return lb.ids;
  }
  return null;
}

/** Step 1. Returns {witness, dof, tried, accepted} or {fail:{kind, ruleIndex, sentence}} */
export function findWitness(geoms, rules, { starts = 60, label = (i) => labelRule(rules[i], geoms) } = {}) {
  const diag = diagOf(geoms); const rnd = mulberry(0xC0FFEE);
  const driving = (rules.map((r, i) => i)).filter((i) => rules[i].active !== false);
  const accepted = []; let best = null; let tried = 0; let unsupported = null;
  for (let t = 0; t < starts; t++) {
    const start = t === 0 ? clone(geoms) : jitterGeoms(geoms, rules, (t < 20 ? 0.05 : t < 40 ? 0.15 : 0.3) * diag, rnd);
    let a; try { a = analyse(start, live(rules)); } catch { continue; }
    tried++;
    if (a.unsupported) { unsupported = a.unsupported; break; }
    if (!best || a.maxRes < best.maxRes) best = a;
    if (!(a.maxRes < 1e-9)) continue;
    const solved = a.solved.map((g) => ({ ...g }));
    const sg = guardSolved(geoms, solved, rules, (i) => label(i));
    if (!sg.ok) { if (!best.degenerate) best = { ...a, degenerate: sg }; continue; }
    const flat = flatLoop(geoms, solved);
    if (flat) { if (!best.degenerate) best = { ...a, degenerate: { ok: false, kind: 'collapsed', sentence: `These rules flatten the outline made of ${flat.length === 1 ? (geoms.find((g) => g.id === flat[0]).k === 'circle' ? 'circle' : 'line') + ' ' + flat[0] : 'lines ' + flat.join(', ')} until it has no area, so the part cannot be built; remove or change one of them.` } }; continue; }
    accepted.push({ solved, dof: a.dof, moved: moved(solved, geoms) });
    if (t === 0) break;                           // the fewest-movers answer from the drawn start is the one a student expects
    if (accepted.length >= 3) break;
  }
  if (unsupported) return { fail: { kind: 'unsupported', sentence: `The rule kind ${unsupported[0]} cannot be checked yet, so the part is not built; remove that rule.` } };
  if (accepted.length) { accepted.sort((p, q) => p.moved - q.moved); return { witness: accepted[0].solved, dof: accepted[0].dof, tried, accepted: accepted.length }; }
  if (best?.degenerate) return { fail: { kind: 'collapsed', ruleIndex: best.degenerate.ruleIndex ?? null, sentence: best.degenerate.sentence } };
  // none: name the newest driving rule that is still off in the best effort (indep's rows carry their rule index), and the older rules whose removal lets the rest hold
  const res = best ? best.b.res(best.x) : []; const rowRule = best?.b.rowRule ?? [];
  const mx = Math.max(0, ...res.map(Math.abs)); let idx = -1;
  res.forEach((v, i) => { if (Math.abs(v) >= 0.5 * mx && rowRule[i] >= 0) idx = Math.max(idx, rowRule[i]); });
  if (idx < 0) idx = driving.at(-1) ?? 0;
  const others = blameRules(geoms, rules, idx, label);
  const named = others.slice(0, 3).map(label);
  const list = others.length > 3 ? `${named.join(', ')} and ${others.length - 3} more` : named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
  const cap260 = (t, fallback) => (t.length > 250 ? fallback : t);
  const sentence0 = others.length === 0 ? `${cap(label(idx))} cannot hold together with the other rules on this sketch, so the part is not built; remove or change one of the rules.`
    : `${cap(label(idx))} cannot hold together with ${list}, so the part is not built; remove or change one of them.`;
  const sentence = cap260(sentence0, `${cap(label(idx))} cannot hold together with the other rules on this sketch, so the part is not built; remove or change one of the rules.`);
  return { fail: { kind: 'infeasible', ruleIndex: idx, residual: mx, blamed: others, sentence } };
}

/** older, non-structural rules whose removal (one at a time) leaves a feasible set */
export function blameRules(geoms, rules, idx, label) {
  const out = [];
  for (let j = 0; j < rules.length; j++) {
    if (j === idx || rules[j].k === 'coincident' || rules[j].active === false) continue;
    const rest = rules.filter((_, k) => k !== j);
    const rnd = mulberry(j + 1); const diag = diagOf(geoms);
    for (let t = 0; t < 6; t++) {
      const start = t === 0 ? clone(geoms) : jitterGeoms(geoms, rest, 0.15 * diag, rnd);
      let a; try { a = analyse(start, live(rest)); } catch { continue; }
      if (a.unsupported) break;
      if (a.maxRes < 1e-9 && guardSolved(geoms, a.solved, rest, label).ok) { out.push(j); break; }
    }
  }
  return out;
}

/**
 * Redundant rules by rank (the guard's own counterpart of SolveReport.redundant, which the stock pkg cannot show): rule i is redundant when its rows add nothing
 * to the rows of the rules before it at the witness. Returns indices (in rule order); structural coincident joins count only when the SAME join is written twice.
 */
export function redundantRules(witness, rules) {
  const b = build(witness, live(rules)); if (b.unsupported) return { unsupported: b.unsupported };
  const jacOf = (resf, x) => { const f0 = resf(x); const J = f0.map(() => new Array(x.length).fill(0)); for (let j = 0; j < x.length; j++) { const h = 1e-6 * Math.max(1, Math.abs(x[j])); const xp = x.slice(), xm = x.slice(); xp[j] += h; xm[j] -= h; const fp = resf(xp), fm = resf(xm); for (let i = 0; i < f0.length; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h); } return J; };
  const J = jacOf(b.res, b.x0); const red = []; let rows = []; let rank = 0;
  // implicit rows first (rule -1: arc end on its circle)
  J.forEach((r, i) => { if (b.rowRule[i] === -1) rows.push(r); });
  rank = rankOf(rows);
  rules.forEach((_, ri) => {
    if (rules[ri].active === false) return;
    const mine = J.filter((_, i) => b.rowRule[i] === ri); if (!mine.length) return;
    const r2 = rankOf([...rows, ...mine]);
    if (r2 === rank) red.push(ri); else { rows = [...rows, ...mine]; rank = r2; }
  });
  return { redundant: red, rank, rows: J.length, unknowns: b.n, dof: b.n - rank };
}


/**
 * The status the sketch panel needs (packages/studio sketch-canvas-core.ts reads {bucket, dof, blame} from brep-rs's diagnose; the retired kernel's diagnose has no SolidCraft counterpart on the stock pkg):
 *   bucket: 'conflicting' (no witness) | 'collapsed' (rules satisfiable only by squeezing a shape away) | 'redundant' (a witness, some rule adds nothing) | 'consistent'
 *   dof: unknowns minus the rank of the rule Jacobian at the witness; redundant: rule indices; blamed: rules whose removal resolves a conflict.
 * No kernel call: independent solver + rank only.
 */
export function diagnose(geoms, rules) {
  const label = (i) => labelRule(rules[i], geoms);
  const w = findWitness(geoms, rules, { label });
  if (w.fail) return { bucket: w.fail.kind === 'infeasible' ? 'conflicting' : w.fail.kind === 'collapsed' ? 'collapsed' : 'unsupported', dof: null, redundant: [], blamed: w.fail.blamed ?? [], ruleIndex: w.fail.ruleIndex ?? null, sentence: w.fail.sentence };
  const red = redundantRules(w.witness, rules);
  return { bucket: red.unsupported ? 'unsupported' : red.redundant.length ? 'redundant' : 'consistent', dof: w.dof, redundant: red.redundant ?? [], blamed: [] };
}

const measureOf = (r) => { const bs = r.measure.bodies; return { volume: bs.reduce((s, b) => s + b.volume_mm3, 0), bodies: bs.length, faces: bs.reduce((s, b) => s + b.faces, 0), bbox: bs.map((b) => [...b.bbox.min, ...b.bbox.max]), com: bs.map((b) => b.center_of_mass), faceTypes: bs.map((b) => b.face_types) }; };
const sameMeasure = (a, b) => a.bodies === b.bodies && Math.abs(a.volume - b.volume) <= 1e-6 * Math.max(1, Math.abs(b.volume)) && a.bbox.flat().every((v, i) => Math.abs(v - b.bbox.flat()[i]) <= 1e-6 * Math.max(1, diagOf3(b)));
const diagOf3 = (m) => Math.max(...m.bbox.flat().map(Math.abs), 1);

/** the extrude command: material regions by the even-odd rule (a loop inside a loop is a hole), as the language defines them; the same rule for the raw and the guarded build */
export function extrudeCmd(geoms, m, height) {
  const eo = evenOddPicks({ id: 'g', geoms });
  const params = { distance: height, sketch: m.sketchName, operation: 'new', body_name: 'Body1' };
  // only a sketch with a loop INSIDE a loop needs picks (the hole rule); picks are points in the drawn/witness geometry, so a start-state pick can miss once a solver moves the shapes
  if (eo.picks && eo.picks.length && eo.depths && eo.depths.some((d) => d > 0)) params.profiles = eo.picks.map((pt) => ({ point: pt }));
  return { command: 'solid.extrude', params, regionsSentence: eo.sentence ?? null };
}

/** unguarded: what the repo's mapper + SolidCraft do today from the drawn start */
export function rawBuild(geoms, rules, { height = HEIGHT, plane = 'xy', patch } = {}) {
  const m = L.mapper.mapSketch({ id: 'g', plane, geoms: clone(geoms), rules: clone(rules) });
  if (!m.ok) return { status: 'mapper-refused', sentence: m.refusals.map((r) => r.sentence).join(' | '), rule: m.refusals[0].rule, kind: m.refusals[0].kind };
  const ex = extrudeCmd(geoms, m, height);
  let cmds = [...m.commands, { command: 'sketch.finish', params: {} }, { command: ex.command, params: ex.params }];
  if (patch) cmds = patch(cmds, m);
  const r = L.scRun(cmds);
  if (!r.ok) return { status: 'refused', index: r.index, command: r.command, error: r.error, rule: m.ruleMap.findIndex((ix) => ix && ix.includes(r.index)), map: m };
  return { status: 'built', ...measureOf({ measure: r.measure }), map: m };
}

/** Step 2: the build on the witness */
export function witnessBuild(witness, rules0, { height = HEIGHT, plane = 'xy' } = {}) {
  // reference rules (driving:false) measure and never constrain: they are not sent (the witness already ignores them), so a reference value the sketch cannot have cannot refuse the build
  const keep = rules0.map((_, i) => i).filter((i) => rules0[i].driving !== false); const rules = keep.map((i) => rules0[i]);
  const m = L.mapper.mapSketch({ id: 'g', plane, geoms: clone(witness), rules: clone(rules) });
  if (!m.ok) return { status: 'mapper-refused', sentence: m.refusals.map((r) => r.sentence).join(' | '), rule: m.refusals[0].rule >= 0 ? keep[m.refusals[0].rule] : -1, map: m };
  const pins = [];
  for (const n of m.names) {
    if (n.geom == null) continue;
    for (const ref of Object.values(n.points)) pins.push({ command: 'sketch.constraint.fix', params: { entity: ref, fixed: true } });
    const g = witness.find((x) => x.id === n.geom);
    if (g.k === 'circle' || g.k === 'arc') pins.push({ command: 'sketch.dimension', params: { entities: [n.curve], type: 'radius', value: g.r, if_redundant: 'driven' } });
  }
  // a dimension the witness already fixes (a duplicate, or one implied through a chain) is accepted as a reference dimension; a dimension that DISAGREES with the witness still refuses
  const body = m.commands.map((c) => (c.command === 'sketch.dimension' && c.params.if_redundant === undefined ? { ...c, params: { ...c.params, if_redundant: 'driven' } } : c));
  const ex = extrudeCmd(witness, m, height);
  if (ex.regionsSentence) { const t = ex.regionsSentence.replace(/sketch g\b/g, 'this sketch'); return { status: 'regions-refused', sentence: `${t[0].toUpperCase()}${t.slice(1)}.`, map: m }; }
  const cmds = [...body, ...pins, { command: 'sketch.finish', params: {} }, { command: ex.command, params: ex.params }];
  const r = L.scRun(cmds);
  if (!r.ok) {
    const fr0 = m.ruleMap.findIndex((ix) => ix && ix.includes(r.index));
    return { status: 'refused', index: r.index, command: r.command, error: r.error, failedRule: fr0 >= 0 ? keep[fr0] : -1, inPins: r.index >= m.commands.length, map: m };
  }
  return { status: 'built', ...measureOf({ measure: r.measure }), map: m };
}

/**
 * geoms, rules -> {outcome:'built'|'refused', stage, sentence?, measure?, dof, witness?, rawAgrees?, raw?}
 * Every `refused` carries exactly one plain sentence.
 */
export function guardedSoup(geoms, rules, opts = {}) {
  const label = (i) => labelRule(rules[i], geoms);
  const w = findWitness(geoms, rules, { label, ...opts });
  if (w.fail) return { outcome: 'refused', stage: 'preflight:' + w.fail.kind, sentence: w.fail.sentence, ruleIndex: w.fail.ruleIndex };
  const raw = opts.skipRaw ? null : rawBuild(geoms, rules, opts);
  const mapperSentence = (rule) => (rule >= 0 && rules[rule] ? `${cap(label(rule))} cannot be built from this sketch as drawn, so the part is not built; change that rule or redraw the sketch.` : 'A rule on this sketch cannot be built as written, so the part is not built; remove or change one of the rules.');
  if (raw?.status === 'mapper-refused' && rules[raw.rule]?.driving !== false) return { outcome: 'refused', stage: 'mapper', sentence: mapperSentence(raw.rule), mapperText: raw.sentence, dof: w.dof };
  const b = witnessBuild(w.witness, rules, opts);
  if (b.status === 'mapper-refused') return { outcome: 'refused', stage: 'mapper', sentence: mapperSentence(b.rule), mapperText: b.sentence, dof: w.dof };
  if (b.status === 'regions-refused') return { outcome: 'refused', stage: 'outline', sentence: b.sentence, dof: w.dof };
  if (b.status === 'refused') {
    const fr = b.failedRule >= 0 && rules[b.failedRule] ? b.failedRule : -1;
    if (/no closed profile/.test(b.error)) return { outcome: 'refused', stage: 'kernel', sentence: 'These rules leave the sketch without a closed outline to pull, so the part is not built; remove or change one of the rules.', rawError: b.error, failedCommand: b.command, failedInPins: b.inPins, dof: w.dof };
    const sentence = fr >= 0 ? plainRefusal({ raw: b.error, failedRule: fr, labelOf: label, isStructural: (i) => rules[i]?.k === 'coincident', kToRule: [] })
      : 'The solver could not keep every rule on this sketch where the checker puts them, so the part is not built; remove or change one of the rules.';
    return { outcome: 'refused', stage: 'kernel', sentence, rawError: b.error, failedCommand: b.command, failedInPins: b.inPins, dof: w.dof };
  }
  const out = { outcome: 'built', stage: 'built', measure: { volume: b.volume, bodies: b.bodies, faces: b.faces, bbox: b.bbox, com: b.com, faceTypes: b.faceTypes }, dof: w.dof, witness: w.witness, accepted: w.accepted };
  if (raw) out.raw = raw.status === 'built' ? { status: 'built', volume: raw.volume, bodies: raw.bodies } : { status: raw.status, error: raw.error ?? raw.sentence };
  if (raw) out.rawAgrees = raw.status === 'built' && sameMeasure(raw, b);
  return out;
}
export { plainProblems };
