// Start-aware oracle for the sweeps. Many rule sets have mirror-image solutions (a rectangle that hangs from the origin can hang into any quadrant, a circle tangent to a line
// sits above OR below it, a slot can run left or right of its pinned arc). A closed form that names one of them scores a correct build of another as "different solid".
// Round 2 therefore derives, per fixture, EVERY mirror image of the closed-form solution that still satisfies every rule (checked by the independent phase2/rule-check.mjs,
// signed, with locks measured against the ORIGINAL start), and scores a build as right if it equals one of them. The image nearest the drawn start is "the drawn side":
//   MATCH            equals the image nearest the drawing
//   MATCH-OTHER-SIDE equals another valid image (rules met, volume and shape right, but the other side from the drawing)
//   POSE / VOLUME    equals no valid image   <- the dangerous ones
import * as lib from './lib.mjs';
import { ladderSketch } from './guard.mjs';
import { plainRules, geomBox, H } from './cases.mjs';
import { arcPoints } from './geom.mjs';

const cache = new Map();
const refl = (g, sx, sy, cx, cy) => {
  const p = (q) => [sx === 1 ? q[0] : 2 * cx - q[0], sy === 1 ? q[1] : 2 * cy - q[1]];
  const flip = sx * sy === -1;
  const o = { ...g };
  if (g.k === 'point') o.p = p(g.p);
  else if (g.k === 'line') { o.a = p(g.a); o.b = p(g.b); }
  else if (g.k === 'circle') o.c = p(g.c);
  else { o.a = p(g.a); o.b = p(g.b); o.c = p(g.c); if (flip) o.sense = g.sense === 'cw' ? 'ccw' : 'cw'; }
  return o;
};
function boxOf(geoms) {
  const pts = [];
  for (const g of geoms) {
    if (g.construction) continue;
    if (g.k === 'line') pts.push(g.a, g.b); else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]);
    else if (g.k === 'arc') pts.push(...arcPoints(g, 64));
  }
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
export function imagesOf(cs) {
  if (cache.has(cs.id)) return cache.get(cs.id);
  const rules = plainRules(cs.rules);
  const g = ladderSketch({ geoms: cs.geoms, rules });
  let out = [{ bbox: cs.bbox, how: 'closed form' }];
  if (g.ok) {
    const T0 = g.solved;
    const lockPts = rules.filter((r) => r.k === 'lock').map((r) => { const s = cs.geoms.find((x) => x.id === r.a); return s ? (s.k === 'circle' || s.k === 'arc' ? s.c : r.aEnd === 'b' ? s.b : s.a) : null; }).filter(Boolean);
    const CX = [0, ...lockPts.map((p) => p[0])], CY = [0, ...lockPts.map((p) => p[1])];
    const seen = new Set(); out = [];
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const cx of CX) for (const cy of CY) {
      if (sx === 1 && sy === 1 && !(cx === 0 && cy === 0)) continue;
      const R = T0.map((x) => (x.construction ? x : refl(x, sx, sy, cx, cy))); // construction geometry is the pinned reference: it stays
      const res = lib.ruleCheck.checkRules(R, rules, cs.geoms).filter((x) => x.driving && x.residual !== null);
      const tol = (x) => (x.unit === 'mm' ? 2e-3 : 1e-5);
      if (res.some((x) => x.residual > tol(x))) continue;
      const bb = boxOf(R); const key = bb.map((v) => v.toFixed(3)).join(',');
      if (seen.has(key)) continue; seen.add(key);
      out.push({ bbox: bb, geoms: R, how: `${sx === -1 ? 'x about ' + cx : ''}${sx === -1 && sy === -1 ? ' and ' : ''}${sy === -1 ? 'y about ' + cy : ''}` || 'as solved' });
    }
    if (!out.length) out = [{ bbox: cs.bbox, how: 'closed form' }];
  }
  cache.set(cs.id, out);
  return out;
}
import { distanceToDrawing } from './images.mjs';
/** images with their distance to the drawing (key-point distance, the same metric the guard uses in images.mjs); nearest first */
export function expectedImage(cs, start) {
  const imgs = imagesOf(cs).map((im) => ({ ...im, d: start && im.geoms ? distanceToDrawing(start, im.geoms) : 0 }));
  const sorted = [...imgs].sort((a, b) => a.d - b.d);
  return { nearest: sorted[0], all: imgs, dmin: sorted[0].d };
}
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
export function classifyImg(cs, body, start = null) {
  const t = cs.curved ? 3e-4 : 1e-9;
  const { nearest, all, dmin } = expectedImage(cs, start);
  const score = (im) => {
    const want = [im.bbox[0], im.bbox[1], 0, im.bbox[2], im.bbox[3], H];
    return { dv: rel(body.volume, cs.area * H), db: Math.max(...want.map((w, i) => rel(body.bbox[i], w))) };
  };
  const bodiesOk = !cs.bodies || body.bodies === cs.bodies;
  // which valid image is it?
  const hit = all.map((im) => ({ im, s: score(im) })).filter((x) => x.s.dv <= t && x.s.db <= t && bodiesOk).sort((p, q) => p.s.db - q.s.db)[0];
  if (hit) {
    // a tie band of 10% in key-point distance (the guard's own tolerance): inside it the two sides cannot be told apart by the drawing
    const tied = !start || hit.im.d <= dmin / 0.9 + 1e-9;
    return { cls: tied ? 'MATCH' : 'MATCH-OTHER-SIDE', dv: hit.s.dv, db: hit.s.db, image: hit.im.how, d: hit.im.d, dmin };
  }
  const sN = score(nearest);
  if (sN.dv <= 1e-6 && sN.db <= 1e-6 && bodiesOk && !cs.curved) return { cls: 'TOL-MISS', dv: sN.dv, db: sN.db };
  return { cls: sN.dv <= t && bodiesOk ? 'POSE' : 'VOLUME', dv: sN.dv, db: sN.db };
}
