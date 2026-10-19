// Independent closed form (numeric integral) of two blends on the two TOP edges that meet at one corner of a W x D x H box (edge A along x, length W, size a; edge B along y, length D, size b),
// taken LITERALLY: the box minus the union of the two removal prisms (the mitre), no propagation along a tangent chain, nothing added at the corner.
//   V = W D H - Ar(a) W - Ar(b) D + overlap,   overlap = integral over the depth t below the top of  extA(t) * extB(t)  (the two removal sections are rectangles at depth t)
//   fillet : extX(t) = s - sqrt(s^2 - (s - t)^2),  Ar(s) = (1 - pi/4) s^2        chamfer: extX(t) = s - t,  Ar(s) = s^2 / 2
// The integral is done with 200000 midpoint steps; it is a geometric identity, not a kernel result.
export function mitreVolume({ W = 40, D = 30, H = 10, a, b, style = 'fillet', styleB = style }) {
  const ext = (st, s, t) => (t >= s ? 0 : st === 'fillet' ? s - Math.sqrt(Math.max(0, s * s - (s - t) * (s - t))) : s - t);
  const Ar = (st, s) => (st === 'fillet' ? (1 - Math.PI / 4) * s * s : s * s / 2);
  const m = Math.min(a, b); const N = 200000; let ov = 0;
  for (let i = 0; i < N; i++) { const t = (i + 0.5) * m / N; ov += ext(style, a, t) * ext(styleB, b, t); }
  ov *= m / N;
  return W * D * H - Ar(style, a) * W - Ar(styleB, b) * D + ov;
}

/** the same closed form for ANY two edges of a box that share a corner (and therefore a face): V0 = volume, LA / LB = their lengths, a / b = their sizes */
export function mitrePair({ V0, LA, LB, a, b, styleA = 'fillet', styleB = styleA }) {
  const ext = (st, s, t) => (t >= s ? 0 : st === 'fillet' ? s - Math.sqrt(Math.max(0, s * s - (s - t) * (s - t))) : s - t);
  const Ar = (st, s) => (st === 'fillet' ? (1 - Math.PI / 4) * s * s : s * s / 2);
  const m = Math.min(a, b); const N = 200000; let ov = 0;
  for (let i = 0; i < N; i++) { const t = (i + 0.5) * m / N; ov += ext(styleA, a, t) * ext(styleB, b, t); }
  ov *= m / N;
  return V0 - Ar(styleA, a) * LA - Ar(styleB, b) * LB + ov;
}
