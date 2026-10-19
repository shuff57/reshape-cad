// helpers copied from ../sketch-constraints-run.mjs (oddPoint: an interior point of the even-odd region of circle / polygon geoms, as round 1's unguarded baseline used)
import { geomBox } from './cases.mjs';
export const geomBoxOf = geomBox;
export function oddPoint(geoms) {
  const bb = geomBox(geoms);
  const loops = geoms.filter((g) => !g.construction && g.k === 'circle');
  const polys = geoms.filter((g) => !g.construction && g.k === 'line');
  const inPoly = (pt) => { let c = false; for (const g of polys) { const [p, q] = [g.a, g.b]; if ((p[1] > pt[1]) !== (q[1] > pt[1]) && pt[0] < ((q[0] - p[0]) * (pt[1] - p[1])) / (q[1] - p[1]) + p[0]) c = !c; } return c; };
  let best = null;
  for (let i = 1; i < 200; i++) for (let j = 1; j < 200; j++) {
    const pt = [bb[0] + ((bb[2] - bb[0]) * i) / 200, bb[1] + ((bb[3] - bb[1]) * j) / 200];
    const depth = loops.filter((g) => Math.hypot(pt[0] - g.c[0], pt[1] - g.c[1]) < g.r).length + (polys.length ? (inPoly(pt) ? 1 : 0) : 0);
    if (depth % 2 !== 1) continue;
    const clear = Math.min(...loops.map((g) => Math.abs(Math.hypot(pt[0] - g.c[0], pt[1] - g.c[1]) - g.r)), 1e9);
    if (!best || clear > best.clear) best = { pt, clear };
  }
  return best?.pt ?? null;
}
