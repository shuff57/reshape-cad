// TypeScript port of docs/spikes/solidcraft-referee/contract/holes4-volume.mjs (ROUND 4 of the holes group). Pure: no engine, no kernel.
//
// Exact-enough removed volume of a STACK of coaxial hole tools on a box host. Round 3's closed form compared one hole's removed volume with the
// formula for ONE ring on an intact box, which is false as soon as an earlier hole's tool already removed part of this one's volume. Here the
// removed volume is integrated:
//     removed = integral over the axis z of  area( (U new tools) intersect box  minus  (U earlier tools) )  dz
// Each tool is the solid of revolution of a piecewise-linear radius profile (plain bore, bore + counterbore, bore + countersink cone), so at one z
// it is a set of circles. Behaviour-preserving: same sweep, same step counts, same numbers.

type Interval = [number, number];
export type Profile2 = Array<[number, number]>;
export interface VolTool { cx: number; cy: number; prof: Profile2 }

const mergeIntervals = (a: Interval[]): Interval[] => {
  const s = a.filter(([l, h]) => h > l).sort((p, q) => p[0] - q[0]);
  const out: Interval[] = [];
  for (const iv of s) {
    if (out.length && iv[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
};
/** A, B merged interval lists; length of A minus B */
const subtract = (A: Interval[], B: Interval[]): number => {
  let len = 0;
  for (const [l, h] of A) {
    let cur = l;
    for (const [bl, bh] of B) {
      if (bh <= cur) continue;
      if (bl >= h) break;
      if (bl > cur) len += bl - cur;
      cur = Math.max(cur, bh);
      if (cur >= h) break;
    }
    if (cur < h) len += h - cur;
  }
  return len;
};

/** radius of a piecewise-linear profile [[z, r], ...] (z ascending) at z, or 0 outside */
const radiusAt = (prof: Profile2, z: number): number => {
  for (let i = 0; i + 1 < prof.length; i++) {
    const [z0, r0] = prof[i];
    const [z1, r1] = prof[i + 1];
    if (z >= z0 && z <= z1) return z1 === z0 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
  }
  return 0;
};

/** area at z of (union of `news` clipped to box [x0,x1]x[y0,y1]) minus (union of `olds`) */
export function sectionArea(news: VolTool[], olds: VolTool[], box: [number, number, number, number], z: number, N = 4000): number {
  const circ = (T: VolTool[]) => T.map((t) => ({ cx: t.cx, cy: t.cy, r: radiusAt(t.prof, z) })).filter((c) => c.r > 0);
  const nc = circ(news);
  const oc = circ(olds);
  if (!nc.length) return 0;
  const [x0, x1, y0, y1] = box;
  const lo = Math.max(x0, Math.min(...nc.map((c) => c.cx - c.r)));
  const hi = Math.min(x1, Math.max(...nc.map((c) => c.cx + c.r)));
  if (!(hi > lo)) return 0;
  const h = (hi - lo) / N;
  let area = 0;
  for (let i = 0; i < N; i++) {
    const x = lo + (i + 0.5) * h;
    const chord = (c: { cx: number; cy: number; r: number }): Interval | null => {
      const d = c.r * c.r - (x - c.cx) ** 2;
      if (d <= 0) return null;
      const s = Math.sqrt(d);
      return [c.cy - s, c.cy + s];
    };
    const A = mergeIntervals(nc.map(chord).filter((v): v is Interval => !!v).map(([l, u]): Interval => [Math.max(l, y0), Math.min(u, y1)]));
    if (!A.length) continue;
    const B = mergeIntervals(oc.map(chord).filter((v): v is Interval => !!v));
    area += subtract(A, B) * h;
  }
  return area;
}

/** tools: [{cx, cy, prof:[[z,r]...]}] ; breakpoints = all profile z's inside [zlo, zhi]; Simpson (M panels) between them */
export function removedVolume(news: VolTool[], olds: VolTool[], box3: [number, number, number, number, number, number], M = 24): number {
  const [x0, x1, y0, y1, zlo, zhi] = box3;
  const zs = new Set<number>([zlo, zhi]);
  for (const t of [...news, ...olds]) for (const [z] of t.prof) if (z > zlo && z < zhi) zs.add(z);
  const zb = [...zs].sort((a, b) => a - b);
  let vol = 0;
  for (let k = 0; k + 1 < zb.length; k++) {
    const a = zb[k];
    const b = zb[k + 1];
    if (b - a < 1e-12) continue;
    const m = M;
    const dz = (b - a) / m;
    // Simpson on the section area; evaluate strictly inside the end points (the area function jumps at a profile step)
    const f = (z: number) => sectionArea(news, olds, [x0, x1, y0, y1], z);
    const eps = (b - a) * 1e-9;
    let s = f(a + eps) + f(b - eps);
    for (let j = 1; j < m; j++) s += (j % 2 ? 4 : 2) * f(a + j * dz);
    vol += (s * dz) / 3;
  }
  return vol;
}

/** the tool-relevant fields of a hole feature */
export interface ProfileHole {
  diameter: number;
  depth: number;
  counterbore?: { diameter: number; depth: number } | null;
  countersink?: { diameter: number; angleDeg: number } | null;
}
/** the tool profile [[z, r]] of a HoleFeature along its own axis, in absolute axial coordinates; `top`/`lo` = extent of the host along the axis, c0z = tool centre along it */
export function holeProfile(f: ProfileHole, top: number, lo: number, c0z: number): Profile2 {
  const r = f.diameter / 2;
  const zb0 = c0z - f.depth / 2;
  const zb1 = c0z + f.depth / 2;
  const through = zb0 <= lo + 1e-9 && zb1 >= top - 1e-9;
  const big = 1e6; // stand-in for "past the host": nothing exists outside the host anyway (box clipped in z)
  if (!f.counterbore && !f.countersink) return [[zb0, r], [zb1, r]];
  const bot = through ? lo - 1 : zb0;
  if (f.counterbore) {
    const R = f.counterbore.diameter / 2;
    const zc = top - f.counterbore.depth;
    return [[bot, r], [zc, r], [zc, R], [top + big, R]];
  }
  const R = f.countersink!.diameter / 2;
  const tn = Math.tan((f.countersink!.angleDeg * Math.PI) / 360);
  const dc = (R - r) / tn;
  const zc = top - dc;
  const pts: Profile2 = [];
  if (zc >= bot) pts.push([bot, r], [zc, r]);
  else pts.push([bot, R - (top - bot) * tn]);
  pts.push([top, R], [top + 1, R + tn]);
  return pts;
}
