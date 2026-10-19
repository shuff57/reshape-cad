// "Which mirror image?" check (round 2). Many rule sets are met by several mirror images of one shape (a rectangle hanging from the origin fits any of four quadrants, a circle
// tangent to a line sits above or below). SolidCraft keeps whichever side its incremental solve reaches, which is not always the side the shape was DRAWN on. This check asks, with the
// independent rule checker only: of T and its mirror images that ALSO meet every rule, which is nearest to the drawing S? If an image is clearly nearer, T is on the wrong side.
import { ruleCheck } from './lib.mjs';
import { dist, sizeOf } from './geom.mjs';

const reflP = (q, sx, sy, cx, cy) => [sx === 1 ? q[0] : 2 * cx - q[0], sy === 1 ? q[1] : 2 * cy - q[1]];
function reflect(g, sx, sy, cx, cy) {
  if (g.construction) return g; // pinned reference geometry stays
  const o = { ...g }; const p = (q) => reflP(q, sx, sy, cx, cy);
  if (g.k === 'point') o.p = p(g.p);
  else if (g.k === 'line') { o.a = p(g.a); o.b = p(g.b); }
  else if (g.k === 'circle') o.c = p(g.c);
  else { o.a = p(g.a); o.b = p(g.b); o.c = p(g.c); if (sx * sy === -1) o.sense = g.sense === 'cw' ? 'ccw' : 'cw'; }
  return o;
}
function keyPoints(g) { return g.construction ? [] : g.k === 'point' ? [g.p] : g.k === 'line' ? [g.a, g.b] : g.k === 'circle' ? [g.c] : [g.a, g.b, g.c]; }
export function distanceToDrawing(S, X) {
  let d = 0;
  S.forEach((s, i) => { const a = keyPoints(s), b = keyPoints(X[i]); a.forEach((p, k) => { d += dist(p, b[k]) ** 2; }); });
  return Math.sqrt(d);
}
/** returns {ok:true} or {ok:false, text, nearer:{how, d, dT}} */
export function nearestImageCheck(S, T, rules) {
  const diag = sizeOf(S);
  const locks = rules.filter((r) => r.k === 'lock' && r.active !== false).map((r) => { const s = S.find((x) => x.id === r.a); return s ? (s.k === 'circle' || s.k === 'arc' ? s.c : r.aEnd === 'b' ? s.b : s.a) : null; }).filter(Boolean);
  const CX = [...new Set([0, ...locks.map((p) => p[0])])], CY = [...new Set([0, ...locks.map((p) => p[1])])];
  const dT = distanceToDrawing(S, T);
  let best = null;
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const cx of CX) for (const cy of CY) {
    if (sx === 1 && sy === 1) continue;
    const R = T.map((g) => reflect(g, sx, sy, cx, cy));
    const d = distanceToDrawing(S, R);
    if (d >= dT * 0.9 - 1e-9 * diag) continue;       // not clearly nearer: ties (symmetric shapes) and near-ties are not flagged
    const res = ruleCheck.checkRules(R, rules, S).filter((x) => x.driving && x.residual !== null);
    if (res.some((x) => x.residual > (x.unit === 'mm' ? 2e-3 : 1e-5))) continue; // not a valid image
    if (!best || d < best.d) best = { how: `${sx === -1 ? 'the vertical line x = ' + +cx.toFixed(3) : ''}${sx === -1 && sy === -1 ? ' and ' : ''}${sy === -1 ? 'the horizontal line y = ' + +cy.toFixed(3) : ''}`, d, dT };
  }
  return best ? { ok: false, text: `the shape would be placed on the other side of ${best.how} from where it was drawn (its mirror image fits the drawing better)`, nearer: best } : { ok: true };
}
