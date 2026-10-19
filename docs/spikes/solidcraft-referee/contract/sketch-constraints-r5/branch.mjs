// POST-SOLVE BRANCH CHECK (round 2, group 'sketch-constraints'). Proposed translator code; lives only in the contract dir.
//
// Why: SolidCraft's sketch solver is local. Given a rule set that has several valid solutions (a slot's four common tangents, a hexagon vs a star
// hexagon, a mirrored symmetric profile ...) it lands on the one its incremental Newton path reaches, reports status "solved", dof 0, residual
// ~1e-10, and the extrude builds it. Round 1 only compared the REQUESTED branch with the START geometry (before the solve). This module compares
// the SOLVED geometry with the START geometry after the solve, on what a branch change looks like, and returns violations. It asks SolidCraft
// nothing and shares no code with brep-rs.
//
// Compared S (start, as drawn) against T (solved):
//   per closed loop (joined by the doc's coincident rows): winding sign, self-crossing, the bend direction at every corner, a cusp at a smooth joint,
//     small/large class of every arc
//   per pair of loops: which one contains which (by area centroid), a NEW crossing
//   per line: the direction does not reverse; per arc: the end points stay within 90 degrees of where they were drawn
//   per rule: line/circle tangent side, circle/circle external vs internal (and the requested mode), endpoint tangent is a smooth continuation (no cusp),
//     symmetric-about-line side, angle quadrant (cross and dot sign), a point drawn inside a segment / arc span stays inside it
// Signed distanceX / distanceY are NOT here: they are checked as signed residuals by phase2/rule-check.mjs in guard.mjs.
import { sub, dot, cross, len, dist, unit, sgn, sizeOf, arcSweep, arcPoints, circlePoints, tangentAt, polyArea, polyCentroid, winding, selfCrosses, segCross, polysCross, TAU } from './geom.mjs';

const live = (r) => r.active !== false && r.driving !== false;

/** loops joined by coincident rows: {ents:[{id,fwd}], closed} per chain, circles as their own loop */
export function loopsOf(geoms, rules) {
  const byId = new Map(geoms.map((g) => [g.id, g]));
  const chainable = (id) => { const g = byId.get(id); return g && !g.construction && (g.k === 'line' || g.k === 'arc'); };
  const link = new Map(), amb = new Set();
  for (const r of rules) {
    if (r.k !== 'coincident' || !live(r)) continue;
    if (!chainable(r.a) || !chainable(r.b) || !['a', 'b'].includes(r.aEnd) || !['a', 'b'].includes(r.bEnd)) continue;
    const x = `${r.a}:${r.aEnd}`, y = `${r.b}:${r.bEnd}`;
    for (const [p, q] of [[x, y], [y, x]]) { if (link.has(p) && link.get(p) !== q) amb.add(p); link.set(p, q); }
  }
  const seen = new Set(), loops = [];
  for (const g of geoms) {
    if (!chainable(g.id) || seen.has(g.id)) continue;
    // rewind to the start of the chain so a closed chain is walked once from its lowest-id member
    const ents = []; let cur = { id: g.id, fwd: true }, closed = false;
    for (let guard = 0; guard < 1000; guard++) {
      if (seen.has(cur.id)) { closed = ents.length > 0 && ents[0].id === cur.id && ents[0].fwd === cur.fwd; break; }
      seen.add(cur.id); ents.push(cur);
      const exit = `${cur.id}:${cur.fwd ? 'b' : 'a'}`;
      if (amb.has(exit) || !link.has(exit)) break;
      const [id2, end2] = link.get(exit).split(':');
      cur = { id: +id2, fwd: end2 === 'a' };
    }
    loops.push({ ents, closed });
  }
  for (const g of geoms) if (g.k === 'circle' && !g.construction) loops.push({ ents: [{ id: g.id, fwd: true }], closed: true, circle: true });
  return loops;
}

/** does a closed chain of entities cross itself? Only NON-ADJACENT entities are compared: two neighbours may overshoot each other at their joint (a hand-drawn corner), which is not a self-crossing outline. */
function entitiesCross(parts, eps) {
  const n = parts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const A = parts[i], B = parts[j];
    for (let a = 0; a + 1 < A.length; a++) for (let b = 0; b + 1 < B.length; b++) if (segCross(A[a], A[a + 1], B[b], B[b + 1], eps)) return true;
  }
  return false;
}
function entityPoints(g, fwd) {
  const pts = g.k === 'line' ? [g.a, g.b] : arcPoints(g, 32);
  return fwd ? pts : [...pts].reverse();
}
/** unit direction of travel along entity at its entry / exit end */
function travel(g, fwd, which) { // which: 'entry' | 'exit'
  const end = (which === 'entry') === fwd ? 'a' : 'b';
  const t = tangentAt(g, end);
  return fwd ? t : [-t[0], -t[1]];
}

export function loopSignature(geoms, loops) {
  const byId = new Map(geoms.map((g) => [g.id, g]));
  const diag = sizeOf(geoms);
  return loops.map((lp) => {
    if (lp.circle) { const g = byId.get(lp.ents[0].id); const poly = circlePoints(g, 64); return { ...lp, poly, areaSign: 1, simple: true, centroid: g.c, joints: [], arcs: [], area: Math.PI * g.r * g.r }; }
    let poly = []; const parts = [];
    for (const e of lp.ents) { const pts = entityPoints(byId.get(e.id), e.fwd); poly.push(...pts.slice(0, -1)); parts.push(pts); }
    const joints = [], arcs = [];
    lp.ents.forEach((e, i) => {
      const g = byId.get(e.id);
      if (g.k === 'arc') { const { sw } = arcSweep(g); arcs.push({ id: g.id, sw: Math.abs(sw) }); }
      if (!lp.closed && i === lp.ents.length - 1) return;
      const nxt = byId.get(lp.ents[(i + 1) % lp.ents.length].id);
      const nf = lp.ents[(i + 1) % lp.ents.length].fwd;
      const tin = travel(g, e.fwd, 'exit'), tout = travel(nxt, nf, 'entry');
      joints.push({ between: [g.id, nxt.id], turn: Math.atan2(cross(tin, tout), dot(tin, tout)) });
    });
    const area = polyArea(poly);
    return { ...lp, poly, area, areaSign: sgn(area, 1e-9 * diag * diag), simple: !lp.closed || !entitiesCross(parts, 1e-4 * diag), centroid: polyCentroid(poly), joints, arcs };
  });
}

const SMOOTH = 0.1; // rad (5.7 deg): below this a joint reads as smooth
const HALF_BAND = 0.35; // rad (20 deg) around a half turn, where small/large is not decided
const cls = (turn) => (Math.abs(turn) < SMOOTH ? 0 : Math.abs(turn) > Math.PI - SMOOTH ? 2 : Math.sign(turn));
const swClass = (sw) => (sw < Math.PI - HALF_BAND ? -1 : sw > Math.PI + HALF_BAND ? 1 : 0);
const REL = { a_in_b: 'one inside the other', b_in_a: 'one inside the other', disjoint: 'separate', cross: 'overlapping' };
/** the relation of loop 1 to loop 2 in words that say WHICH one is inside (a_in_b: 1 inside 2; b_in_a: 2 inside 1) */
const relWords = (r, n1, n2) => ({ a_in_b: `being inside ${n2}`, b_in_a: `being around ${n2}`, disjoint: `being apart from ${n2}`, cross: `cutting across ${n2}` }[r] ?? REL[r]);
function relation(A, B, eps) {
  if (polysCross(A.poly, B.poly, eps)) return 'cross';
  const frac = (P, Q) => P.poly.filter((p) => winding(p, Q.poly) !== 0).length / P.poly.length;
  const fa = frac(A, B), fb = frac(B, A);
  if (fa >= 0.9) return 'a_in_b';
  if (fb >= 0.9) return 'b_in_a';
  if (fa <= 0.1 && fb <= 0.1) return 'disjoint';
  return 'cross';
}
const name = (loop) => `the outline through geometry ${loop.ents.map((e) => e.id).join(', ')}`;

/** violations of loop-level branch features; S and T are the signatures of the same loops (same order) */
export function compareLoops(SS, TT, diag) {
  const v = [];
  SS.forEach((s, i) => {
    const t = TT[i];
    if (s.circle) return;
    if (s.closed) {
      // a start that crosses itself carries no branch (which way round is it?), and a solution that crosses itself is never an extrudable outline
      if (!s.simple) { v.push({ kind: 'start-crosses', text: `${name(s)} crosses itself as drawn, so the shape it means is not clear` }); return; }
      if (!t.simple) v.push({ kind: 'self-cross', text: `${name(s)} would cross itself` });
      if (s.areaSign !== 0 && t.areaSign !== 0 && s.areaSign !== t.areaSign) v.push({ kind: 'winding', text: `${name(s)} would be turned inside out (mirrored)` });
    }
    s.joints.forEach((j, k) => {
      const a = cls(j.turn), b = cls(t.joints[k].turn);
      if (b === 2 && a !== 2) v.push({ kind: 'cusp', text: `geometry ${j.between[0]} would fold straight back on geometry ${j.between[1]}` });
      else if (a !== 0 && b !== 0 && a !== 2 && b !== 2 && a !== b) v.push({ kind: 'corner', text: `the corner between geometry ${j.between[0]} and geometry ${j.between[1]} would bend the other way` });
    });
    s.arcs.forEach((a, k) => {
      const ca = swClass(a.sw), cb = swClass(t.arcs[k].sw);
      if (ca !== 0 && cb !== 0 && ca !== cb) v.push({ kind: 'arc-sweep', text: `arc ${a.id} would swing the other way round (${ca < 0 ? 'short' : 'long'} way to the ${cb < 0 ? 'short' : 'long'} way)` });
    });
  });
  // pairs: nested / disjoint / crossing. A start that already crosses (neither tangent branch decided) says nothing, so only nested and disjoint starts are compared.
  for (let i = 0; i < SS.length; i++) for (let j = i + 1; j < SS.length; j++) {
    const s1 = SS[i], s2 = SS[j], t1 = TT[i], t2 = TT[j];
    if (!s1.closed || !s2.closed) continue;
    const rs = relation(s1, s2, 1e-3 * diag), rt = relation(t1, t2, 1e-3 * diag);
    if (rs !== 'cross' && rs !== rt) v.push({ kind: rs === 'disjoint' || rt === 'cross' ? 'overlap' : 'nesting', to: rt, text: `${name(s1)} would go from ${relWords(rs, name(s1), name(s2))} to ${relWords(rt, name(s1), name(s2))}` });
  }
  return v;
}

/** per-geometry and per-rule branch features */
export function compareGeoms(S, T, rules) {
  const v = [];
  const sBy = new Map(S.map((g) => [g.id, g])), tBy = new Map(T.map((g) => [g.id, g]));
  S.forEach((s) => {
    const t = tBy.get(s.id);
    if (s.k === 'line') {
      const us = unit(sub(s.b, s.a)), ut = unit(sub(t.b, t.a));
      if (dot(us, ut) <= 0) v.push({ kind: 'line-direction', text: `line ${s.id} would end up pointing the opposite way (or turned more than a quarter turn)` });
    } else if (s.k === 'arc') {
      for (const e of ['a', 'b']) {
        const ps = unit(sub(s[e], s.c)), pt = unit(sub(t[e], t.c));
        if (dot(ps, pt) <= 0) v.push({ kind: 'arc-end', text: `an end of arc ${s.id} would move more than a quarter turn round its circle` });
      }
    }
  });
  const P = (g, end) => (!g ? null : g.k === 'point' ? g.p : g.k === 'line' ? (end === 'b' ? g.b : g.a) : g.k === 'circle' ? g.c : end === 'b' ? g.b : end === 'c' ? g.c : g.a);
  rules.forEach((r, i) => {
    if (!live(r)) return;
    const sa = sBy.get(r.a), sb = sBy.get(r.b), ta = tBy.get(r.a), tb = tBy.get(r.b);
    const where = `the ${r.k} rule on geometry ${r.a}${typeof r.b === 'number' && r.b >= 0 ? ` and geometry ${r.b}` : ''}`;
    if (r.k === 'tangent' && sa && sb) {
      const round = (g) => g.k === 'circle' || g.k === 'arc';
      const endForm = r.aEnd !== undefined || r.bEnd !== undefined;
      if (endForm) {
        // smooth continuation: at the shared end the two curves leave in opposite directions
        const away = (g, end) => { const t = tangentAt(g, end); return end === 'b' ? [-t[0], -t[1]] : t; };
        const ea = r.aEnd ?? 'a', eb = r.bEnd ?? 'a';
        const d = dot(away(ta, ea), away(tb, eb));
        if (d > -0.5) v.push({ kind: 'cusp-tangent', text: `${where} would join geometry ${r.a} and geometry ${r.b} in a sharp fold-back instead of a smooth tangent` });
      } else if (round(sa) && round(sb)) {
        const m = (a, b) => { const d = dist(a.c, b.c); return Math.abs(d - (a.r + b.r)) <= Math.abs(d - Math.abs(a.r - b.r)) ? 'external' : 'internal'; };
        const ms = m(sa, sb), mt = m(ta, tb);
        if (ms !== mt) v.push({ kind: 'tangent-mode', text: `${where} would turn ${ms} tangency into ${mt} tangency` });
        if (r.mode && r.mode !== mt) v.push({ kind: 'tangent-mode', text: `${where} asks for ${r.mode} tangency but the solved circles are tangent ${mt}ly` });
      } else {
        const side = (L, C) => sgn(cross(sub(L.b, L.a), sub(C.c, L.a)), 1e-9);
        const [sL, sC, tL, tC] = sa.k === 'line' ? [sa, sb, ta, tb] : [sb, sa, tb, ta];
        const a = side(sL, sC), b = side(tL, tC);
        if (a !== 0 && b !== 0 && a !== b) v.push({ kind: 'tangent-side', text: `${where} would move the circle to the other side of the line` });
      }
    }
    if (r.k === 'symmetric' && r.cEnd === undefined) {
      const L = (m) => (r.c === -2 ? { a: [0, 0], b: [1, 0] } : r.c === -3 ? { a: [0, 0], b: [0, 1] } : m.get(r.c));
      const ls = L(sBy), lt = L(tBy);
      if (ls && lt) {
        const pa = P(sa, r.aEnd), pb = P(ta, r.aEnd);
        const a = sgn(cross(sub(ls.b, ls.a), sub(pa, ls.a)), 1e-9), b = sgn(cross(sub(lt.b, lt.a), sub(pb, lt.a)), 1e-9);
        if (a !== 0 && b !== 0 && a !== b) v.push({ kind: 'symmetric-side', text: `${where} would swap the two mirrored points to opposite sides of the mirror line` });
      }
    }
    if (r.k === 'angle' && sa && sb) {
      // round 5: the rule fixes the angle between two lines only modulo 180 degrees (its two solutions are v and v - 180 as DIRECTED angles). The branch is the one nearest the drawing;
      // a dimension that crosses 90 degrees (the triangle's 120 -> 60) is a plain slider move, not a branch change, and is not flagged.
      const dirAng = (p, q) => { const da = sub(p.b, p.a), db = sub(q.b, q.a); return (Math.atan2(cross(da, db), dot(da, db)) * 180) / Math.PI; };
      const circ = (x, y) => Math.abs((((x - y) % 360) + 540) % 360 - 180);
      const cands = [((r.value % 360) + 360) % 360, (((r.value + 180) % 360) + 360) % 360];
      const nearestTo = (ang) => (circ(ang, cands[0]) <= circ(ang, cands[1]) ? 0 : 1);
      const as = dirAng(sa, sb), at = dirAng(ta, tb);
      const ns = nearestTo(as), nt = nearestTo(at);
      if (ns !== nt) v.push({ kind: 'angle-quadrant', text: `${where} would put the angle in a different quadrant (the lines would turn the other way round)` });
      else if (Math.abs(circ(as, cands[0]) - circ(as, cands[1])) < 10) v.push({ kind: 'angle-ambiguous', text: `${where} could be met by turning the line either way, and the drawing does not say which` });
    }
    if (r.k === 'pointOnObject' && sb && r.b > 0 && sa) {
      const ps = P(sa, r.aEnd), pt = P(ta, r.aEnd);
      if (sb.k === 'line') {
        const tparam = (L, p) => dot(sub(p, L.a), sub(L.b, L.a)) / dot(sub(L.b, L.a), sub(L.b, L.a));
        const a = tparam(sb, ps), b = tparam(tb, pt);
        if (a >= -1e-9 && a <= 1 + 1e-9 && (b < -1e-6 || b > 1 + 1e-6)) v.push({ kind: 'point-off-segment', text: `${where} would move the point off the end of the line it was drawn on` });
      } else if (sb.k === 'arc') {
        const within = (g, p) => { const { a0, sw } = arcSweep(g); let d = Math.atan2(p[1] - g.c[1], p[0] - g.c[0]) - a0; d = (((d % TAU) + TAU) % TAU); if (sw < 0) d = d === 0 ? 0 : TAU - d; return d <= Math.abs(sw) + 1e-6; };
        if (within(sb, ps) && !within(tb, pt)) v.push({ kind: 'point-off-arc', text: `${where} would move the point off the arc it was drawn on` });
      }
    }
  });
  return v;
}

export function branchViolations(S, T, rules) {
  const diag = sizeOf(S);
  const loops = loopsOf(S, rules);
  const SS = loopSignature(S, loops), TT = loopSignature(T, loops);
  return [...compareLoops(SS, TT, diag), ...compareGeoms(S, T, rules)];
}
