// Round-3 seeded spin fuzz with an EXACT oracle: every profile is a polygon, so the volume of the turn is Pappus (V = |a|/360 * 2 pi * |u_centroid| * area), no kernel in the oracle.
//   RG3_SEED=<n> RG3_N=<count> (defaults 5 and 100). Ids: sf<seed>-<i>-<plane>-<angle>. Deterministic.
let seed = Number(process.env.RG3_SEED ?? 5) >>> 0;
const N = Number(process.env.RG3_N ?? 100);
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rf = (a, b, d = 2) => +(a + rnd() * (b - a)).toFixed(d);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const tag = Number(process.env.RG3_SEED ?? 5);
const polyProps = (P) => { let A = 0; let cu = 0; for (let i = 0; i < P.length; i++) { const [x0, y0] = P[i]; const [x1, y1] = P[(i + 1) % P.length]; const c = x0 * y1 - x1 * y0; A += c; cu += (x0 + x1) * c; } A /= 2; return { A: Math.abs(A), cu: Math.abs(cu / (6 * A)) }; };
export const cases = [];
for (let i = 0; i < N; i++) {
  const plane = pick(['top', 'front', 'side']);
  const off = pick([0, 0, rf(-6, 6)]);
  const side = rnd() < 0.2 ? -1 : 1;
  const kind = pick(['rect', 'rect', 'rect', 'tri', 'pent']);
  const thin = rnd() < 0.35;                                   // thin ring walls: the amplification case
  const u0 = rf(thin ? 8 : 0.5, 30); const w = thin ? rf(0.5, 3) : rf(1, 12); const v0 = rf(-5, 20); const h = rf(1.5, 22);
  let P;
  if (kind === 'rect') P = [[u0, v0], [u0 + w, v0], [u0 + w, v0 + h], [u0, v0 + h]];
  else if (kind === 'tri') P = [[u0, v0], [u0 + w, v0], [u0, v0 + h]];
  else P = [[u0, v0], [u0 + w, v0], [u0 + w, v0 + h], [u0 + w * 0.4, v0 + h], [u0, v0 + h * 0.6]];
  P = P.map(([x, y]) => [+(side * x).toFixed(2), +y.toFixed(2)]);
  const ang = pick([360, 360, 360, 90, 180, 270, -90, -180, 45, rf(5, 355, 1), rf(-355, -5, 1)]);
  const pr = polyProps(P);
  const expectVol = (Math.min(360, Math.abs(ang)) / 360) * 2 * Math.PI * pr.cu * pr.A;
  const outer = Math.max(...P.map((p) => Math.abs(p[0]))); const inner = Math.min(...P.map((p) => Math.abs(p[0])));
  cases.push({ id: `sf${tag}-${i}-${plane}-${ang}`, src: `const s = sketch('${plane}'${off ? ', ' + off : ''}); s.polygon(${JSON.stringify(P)}); spin(s, ${ang});`, expectVol, tag: { kind, thin, outer, inner, amp: ((Math.min(360, Math.abs(ang)) / 360) * Math.PI * outer * outer * (Math.max(...P.map((p) => p[1])) - Math.min(...P.map((p) => p[1])))) / expectVol } });
}
