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
import { expectedSolid } from './expect.mjs';

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
      const bb = boxOf(R); const key = bb.map((v) => v.toFixed(3)).join(',') + '|' + R.map((x) => JSON.stringify([x.id, x.p, x.a, x.b, x.c, x.r].map((v) => (typeof v === 'number' ? +v.toFixed(3) : Array.isArray(v) ? v.map((w) => +w.toFixed(3)) : v)))).join(';'); // round 6: images with the same bbox but different loops are kept apart (a mirror image of a symmetric shape is the SAME solid but a different distance from the drawing)
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
// ROUND 6 (critic: the sweep oracle was volume + bbox only): a build is MATCH only if, besides volume and bbox, its CENTRE OF MASS (a first moment: a different outline with the same
// area and bbox moves it) and, for straight-line outlines, its FACE COUNT agree with the exact solid of the image (expect.mjs: exact loop areas and centroids, arithmetic, no kernel).
// Every image was already filtered by the independent rule checker (phase2/rule-check.mjs) so it is a valid solution of the rules whoever solved it. Tolerances fixed BEFORE the
// run: centre of mass 1e-6 of the sketch size (planar) / 1e-3 (curved: tessellated volumes), no tolerance was changed after seeing data.
export const COM_TOL = { planar: 1e-6, curved: 1e-3 };
const comOf = (im) => { if (im.exp === undefined) { try { const e = im.geoms ? expectedSolid(im.geoms, H) : null; im.exp = e && e.ok ? e : null; } catch { im.exp = null; } } return im.exp; };
export function classifyImg(cs, body, start = null) {
  // round 6 (critic): a circle with NO rules has nothing to solve; building it as drawn is correct, so it is scored against the DRAWN circle (pi r^2 H, bbox c +- r, the curved bar 3e-4 / 2e-3 mm fixed beforehand), not against the stored circle of another radius.
  if (start && start.length === 1 && start[0].k === 'circle' && plainRules(cs.rules ?? []).length === 0) {
    const c = start[0], dv = rel(body.volume, Math.PI * c.r * c.r * H), e = [c.c[0] - c.r, c.c[1] - c.r, c.c[0] + c.r, c.c[1] + c.r], bb = [body.bbox[0], body.bbox[1], body.bbox[3], body.bbox[4]];
    const db = Math.max(...e.map((v, i) => Math.abs(bb[i] - v)));
    return dv <= 3e-4 && db <= 2e-3 ? { cls: 'MATCH', dv, db, image: 'free circle as drawn' } : { cls: 'VOLUME', dv, db };
  }
  const t = cs.curved ? 3e-4 : 1e-9;
  const { nearest, all, dmin } = expectedImage(cs, start);
  const score = (im) => {
    const want = [im.bbox[0], im.bbox[1], 0, im.bbox[2], im.bbox[3], H];
    const e = comOf(im);
    let dc = null, faces = null;
    if (e && body.com) { const size = Math.max(1, ...im.bbox.map(Math.abs)); dc = Math.max(...[0, 1, 2].map((i) => Math.abs(body.com[i] - e.com[i]))) / size; }
    if (e && e.faces != null && body.faces != null) faces = [body.faces, e.faces];
    return { dv: rel(body.volume, cs.area * H), db: Math.max(...want.map((w, i) => rel(body.bbox[i], w))), dc, faces };
  };
  const shapeOk = (s) => (s.dc === null || s.dc <= (cs.curved ? COM_TOL.curved : COM_TOL.planar)) && (!s.faces || s.faces[0] === s.faces[1]);
  const bodiesOk = !cs.bodies || body.bodies === cs.bodies;
  const scored = all.map((im) => ({ im, s: score(im) }));
  // which valid image is it?
  const hit = scored.filter((x) => x.s.dv <= t && x.s.db <= t && bodiesOk && shapeOk(x.s)).sort((p, q) => (p.im.d ?? 0) - (q.im.d ?? 0) || p.s.db - q.s.db)[0]; // round 6: the passing image NEAREST the drawing wins, so a build equal to the drawn side (also when a mirror image of a symmetric shape is the same solid) is MATCH, not MATCH-OTHER-SIDE
  if (hit) {
    // a tie band of 10% in key-point distance (the guard's own tolerance): inside it the two sides cannot be told apart by the drawing
    const tied = !start || hit.im.d <= dmin / 0.9 + 1e-9;
    return { cls: tied ? 'MATCH' : 'MATCH-OTHER-SIDE', dv: hit.s.dv, db: hit.s.db, dc: hit.s.dc, image: hit.im.how, d: hit.im.d, dmin };
  }
  const sN = score(nearest);
  if (sN.dv <= 1e-6 && sN.db <= 1e-6 && bodiesOk && !cs.curved && shapeOk(sN)) return { cls: 'TOL-MISS', dv: sN.dv, db: sN.db };
  // same volume and bbox as an image but a different centre of mass or face count: the outline is a different shape
  if (scored.some((x) => x.s.dv <= t && x.s.db <= t && bodiesOk)) return { cls: 'SHAPE', dv: sN.dv, db: sN.db, dc: sN.dc };
  return { cls: sN.dv <= t && bodiesOk ? 'POSE' : 'VOLUME', dv: sN.dv, db: sN.db };
}
