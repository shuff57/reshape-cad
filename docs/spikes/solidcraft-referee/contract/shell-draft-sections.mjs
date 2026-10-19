// SPIKE, referee only. Independent closed form for DRAFTS of prismatic solids that are not convex (L, T, joined L, slotted box, pocket, boss,
// notch), where shell-draft-polytope.mjs (one convex half-space intersection) cannot be used. No kernel is involved.
//
// The solid is a stack of z-sections; each section is a z interval and a list of signed polygons (+1 outer, -1 hole). A draft is a flat face of
// that solid (axis 0|1 = x|y, side +1|-1 = which way the outward normal points, c0 = the plane coordinate, lat = the face's extent along the
// other horizontal axis, zr = its z extent). It tilts about the line {plane, pull coordinate = neutral}: the plane moves OUT by
//   out(z) = sigma tan(deg) (z - neutral)           (sigma = the kernels' sign convention, fixed from brep-rs by the runner)
// Negative out = the face moves INTO the solid. What a draft means when the tilted face runs into the rest of the part is not defined (OCCT
// says "would not fit"), so the closed form reports it as `vanish` instead of a number:
//   - an INWARD sweep (largest -out over the face) that reaches any vertex of the section that lies inward of the face within the face's
//     lateral extent: an arm, a notch wall, a pocket wall, the opposite face (that vertex's face would be consumed);
//   - two drafted faces on opposite sides, with overlapping lateral extent, whose sweeps meet.
// Otherwise the volume is  sum over sections of the integral of  [ area(polygons clipped inward by every inward plane) + sum of out x lat for
// outward planes ]  dz, integrated with 6-point Gauss-Legendre per section (the integrand is a polynomial of degree <= number of drafts).
// Outward tilts are only used on faces that are extreme in their direction (nothing lies outward of them), and never two adjacent ones at once.
const GLX = [-0.932469514203152, -0.6612093864662645, -0.2386191860831969, 0.2386191860831969, 0.6612093864662645, 0.932469514203152];
const GLW = [0.17132449237917, 0.3607615730481386, 0.46791393457269104, 0.46791393457269104, 0.3607615730481386, 0.17132449237917];

export const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 2; };
/** keep side*coord(axis) <= T (Sutherland-Hodgman; exact area also for non-convex input) */
export function clipHalf(poly, axis, side, T) {
  const f = (p) => side * p[axis] - T;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) { const t = fa / (fa - fb); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
  }
  return out;
}
const tanD = (d) => Math.tan(d.deg * Math.PI / 180);
const outAt = (d, z, neutral, sigma) => (z >= d.zr[0] - 1e-12 && z <= d.zr[1] + 1e-12 ? sigma * tanD(d) * (z - neutral) : 0);

/** @returns {{volume:number, vanish:boolean, why?:string}} */
export function draftedVolume({ sections, drafts, neutral, sigma }) {
  const ds = drafts.map((d) => ({ ...d, zr: d.zr ?? [sections[0].z0, sections.at(-1).z1] }));
  // vanish tests ---------------------------------------------------------------------------------------------------
  const inMax = (d, z0, z1) => { const a = Math.max(z0, d.zr[0]), b = Math.min(z1, d.zr[1]); if (b < a) return 0; return Math.max(0, -outAt(d, a, neutral, sigma), -outAt(d, b, neutral, sigma)); };
  for (const sec of sections) {
    const verts = sec.polys.flatMap((p) => p.pts);
    for (const d of ds) {
      const dmax = inMax(d, sec.z0, sec.z1);
      if (dmax <= 0) continue;
      for (const v of verts) {
        const dist = d.side * (d.c0 - v[d.axis]);
        const lateral = v[1 - d.axis];
        if (dist > 1e-9 && lateral >= d.lat[0] - 1e-9 && lateral <= d.lat[1] + 1e-9 && dist <= dmax + 1e-9) return { volume: NaN, vanish: true, why: `${d.word ?? d.axis}: sweep ${dmax.toFixed(4)} reaches a vertex ${dist.toFixed(4)} inward (section z ${sec.z0}..${sec.z1})` };
      }
    }
  }
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
    const a = ds[i], b = ds[j];
    if (a.axis !== b.axis || a.side === b.side) continue;
    if (Math.min(a.lat[1], b.lat[1]) - Math.max(a.lat[0], b.lat[0]) <= 1e-9) continue;
    const W = a.side * (a.c0 - b.c0);
    const z0 = Math.max(a.zr[0], b.zr[0]), z1 = Math.min(a.zr[1], b.zr[1]);
    if (z1 < z0) continue;
    const worst = Math.max(...[z0, z1].map((z) => -outAt(a, z, neutral, sigma) - outAt(b, z, neutral, sigma)));
    if (worst >= W - 1e-9) return { volume: NaN, vanish: true, why: `${a.word}/${b.word} meet (${worst.toFixed(4)} >= ${W})` };
  }
  // volume ---------------------------------------------------------------------------------------------------------
  let V = 0;
  for (const sec of sections) {
    const h = (sec.z1 - sec.z0) / 2, m = (sec.z1 + sec.z0) / 2;
    for (let k = 0; k < GLX.length; k++) {
      const z = m + h * GLX[k];
      let A = 0;
      for (const pl of sec.polys) {
        let P = pl.pts;
        for (const d of ds) { const o = outAt(d, z, neutral, sigma); if (o < 0) P = clipHalf(P, d.axis, d.side, d.side * d.c0 + o); }
        A += pl.sign * polyArea(P);
      }
      for (const d of ds) { const o = outAt(d, z, neutral, sigma); if (o > 0 && sec.polys.some((p) => p.sign > 0)) A += o * (d.lat[1] - d.lat[0]); }
      V += GLW[k] * h * A;
    }
  }
  return { volume: V, vanish: false };
}
export const rectPoly = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const single = (pts, z0, z1) => [{ z0, z1, polys: [{ pts, sign: 1 }] }];
