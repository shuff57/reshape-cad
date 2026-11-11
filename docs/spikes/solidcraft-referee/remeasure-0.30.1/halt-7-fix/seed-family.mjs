// seed-family.mjs <seed> <out.json>: a seeded family of student-plausible "hollow after a counterbore / countersink" scripts, each with
//   - model: the fuzz plane-offset oracle's model (oracle-com.mjs, box z 0..H; the script's box is centred, so frame 'centred');
//   - closed: an independent closed form of the same hollow, by exact cross-sections: P = S - C, S exact (box - bore - recess),
//     C = integral over the cavity's z range of area(cavity rectangle minus the disk of the hole's offset radius at z), the disk/rectangle overlap
//     computed exactly (theta-substituted Gauss-Legendre per smooth segment), the z integral by Gauss-Legendre between the breakpoints of R(z).
//     Offset radius at z (the plane offset, as the oracle defines it): bore r + t over the whole height; counterbore Rm + t over [H - depth - t, H + t];
//     countersink cone rb + s (z - zb) + t sqrt(1 + s^2) over [zb - 2t, H + t]; R(z) = the largest that covers z.
// Axes swept: recess kind (counterbore / countersink), the gap g from the mouth's edge to the nearest side face in walls (0 to 3), open top / bottom,
// placement (toward +x, toward -y, toward a corner), wall, bore, mouth, depth / angle, plate height. Family 3 sub-set: a countersink from the open
// face, mouth far from every side, straight length H - cone depth from 0.5t to 3t.
import { writeFileSync } from 'node:fs';
const seed = Number(process.argv[2] ?? 7); const OUT = process.argv[3];
let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
// SNAP=0.05: every plane of the part on the voxel oracle's grid (h 0.05): box sides, counterbore floor, plate height (a plane off the grid moves by up to h/2 in
// the oracle, about 1e-3 of the volume on these sizes). Hole centres and radii need not be on it.
const SNAP = Number(process.env.SNAP || 0.01);
const r2 = (v) => Math.round(Math.round(v / SNAP) * SNAP * 100) / 100;

// ---- exact pieces ----
const GL = (() => { // 16-point Gauss-Legendre on [-1, 1]
  const x = [0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
  const w = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];
  return { x: [...x.map((v) => -v), ...x], w: [...w, ...w] };
})();
const quad = (f, a, b, n = 8) => { if (b <= a) return 0; let S = 0; const hgt = (b - a) / n; for (let k = 0; k < n; k++) { const lo = a + k * hgt, m = lo + hgt / 2; for (let i = 0; i < 16; i++) S += GL.w[i] * f(m + GL.x[i] * hgt / 2) * hgt / 2; } return S; };
// area of the disk (cx, cy, R) inside the rectangle [x0, x1] x [y0, y1]: integrate over x = cx + R sin(th) the clipped chord, piecewise smooth
function diskRect(cx, cy, R, x0, x1, y0, y1) {
  if (R <= 0) return 0;
  const a = Math.max(x0, cx - R), b = Math.min(x1, cx + R); if (b <= a) return 0;
  const th = (x) => Math.asin(Math.max(-1, Math.min(1, (x - cx) / R)));
  const chord = (t) => { const hh = R * Math.cos(t); const lo = Math.max(y0, cy - hh), hi = Math.min(y1, cy + hh); return Math.max(0, hi - lo) * R * Math.cos(t); };
  // breakpoints: where the chord's end meets y0 or y1
  const bp = [th(a), th(b)];
  for (const y of [y0, y1]) { const d = Math.abs(y - cy); if (d < R) { const t = Math.acos(d / R); for (const v of [t, -t]) if (v > bp[0] && v < bp[1]) bp.push(v); } }
  bp.sort((p, q) => p - q);
  let S = 0; for (let i = 0; i + 1 < bp.length; i++) S += quad(chord, bp[i], bp[i + 1], 4);
  return S;
}
export function closedForm(c) {
  const { W, D, H, t, kind, r, Rm, depth, angle, cx, cy, open } = c;
  // S: exact solid
  let S = W * D * H - Math.PI * r * r * H;
  let cone = null;
  if (kind === 'cbore') S -= Math.PI * (Rm * Rm - r * r) * depth;
  else { const dep = (Rm - r) / Math.tan(angle / 2 * Math.PI / 180); S -= Math.PI * dep / 3 * (r * r + r * Rm + Rm * Rm) - Math.PI * r * r * dep; const sl = (Rm - r) / dep; cone = { zb: H - dep, s: sl, q: Math.sqrt(1 + sl * sl) }; }
  const R = (z) => { let v = r + t; if (kind === 'cbore' && z >= H - depth - t && z <= H + t) v = Math.max(v, Rm + t); if (cone && z >= cone.zb - 2 * t && z <= H + t) v = Math.max(v, r + cone.s * (z - cone.zb) + t * cone.q); return v; };
  const [z0, z1] = open === 'top' ? [t, H] : [0, H - t];
  const X0 = -W / 2 + t, X1 = W / 2 - t, Y0 = -D / 2 + t, Y1 = D / 2 - t; const Arect = (X1 - X0) * (Y1 - Y0);
  const bz = [z0, z1];
  if (kind === 'cbore') bz.push(H - depth - t); else { bz.push(cone.zb - 2 * t); const zc = cone.zb + (r + t - r - t * cone.q) / cone.s; bz.push(zc); }
  const zs = [...new Set(bz.filter((z) => z >= z0 && z <= z1))].sort((p, q) => p - q);
  let C = 0; for (let i = 0; i + 1 < zs.length; i++) C += quad((z) => Arect - diskRect(cx, cy, R(z), X0, X1, Y0, Y1), zs[i], zs[i + 1], 24);
  return { S, C, P: S - C };
}
function modelOf(c) {
  const { W, D, H, t, kind, r, Rm, depth, angle, cx, cy, open } = c;
  const holes = kind === 'cbore'
    ? [{ type: 'cyl', axis: 'z', c: [cx, cy], r, range: [-1, H + 1] }, { type: 'cyl', axis: 'z', c: [cx, cy], r: Rm, range: [H - depth, H + 1] }]
    : [(() => { const dep = (Rm - r) / Math.tan(angle / 2 * Math.PI / 180); return { type: 'cone', c: [cx, cy], rb: r, zb: H - dep, rt: Rm, zt: H, r, range: [-1, H + 1] }; })()];
  const opens = [open === 'top' ? { axis: 'z', dir: 1, coord: H, rect: [-W / 2, W / 2, -D / 2, D / 2], minus: [] } : { axis: 'z', dir: -1, coord: 0, rect: [-W / 2, W / 2, -D / 2, D / 2], minus: [] }];
  return { t, mode: 'rect', boxes: [[-W / 2, W / 2, -D / 2, D / 2, 0, H]], cuts: [], opens, holes, rbosses: [] };
}
function scriptOf(c) {
  const rec = c.kind === 'cbore' ? `counterbore: { across: ${2 * c.Rm}, deep: ${c.depth} }` : `countersink: { across: ${2 * c.Rm}, angle: ${c.angle} }`;
  return `const b = box(${c.W}, ${c.D}, ${c.H});\nhole(b, { across: ${2 * c.r}, at: [${c.cx}, ${c.cy}], ${rec} });\nhollow(b, { wall: ${c.t}, open: '${c.open}' });`;
}
const cases = [];
const add = (c) => { c.script = scriptOf(c); c.model = modelOf(c); c.frame = 'centred'; c.closed = closedForm(c); cases.push(c); };
const KS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
let n = 0;
for (const kind of ['cbore', 'csink']) for (const open of ['top', 'bottom']) for (const k of KS) for (let rep = 0; rep < 2; rep++) {
  const t = pick([1, 1.5, 2]); const r = pick([1, 1.5, 2]); const ring = r2(1 + rnd() * 2.5); const Rm = r2(r + ring);
  const H = pick([6, 8, 10, 12]);
  const depth = kind === 'cbore' ? r2(Math.min(H - 2 * t - 0.5, 1 + rnd() * 2.5)) : null;
  const angle = kind === 'csink' ? pick([90, 90, 82, 100, 120]) : null;
  if (kind === 'csink') { const dep = (Rm - r) / Math.tan(angle / 2 * Math.PI / 180); if (dep > H - 0.5) continue; }
  if (kind === 'cbore' && !(depth > 0.3)) continue;
  const g = r2(k * t); const place = pick(['x', 'y', 'corner']);
  const far = Rm + 3 * t + 3 + r2(rnd() * 6); // the other sides: well clear
  let W, D, cx, cy;
  if (place === 'x') { W = r2(2 * (Rm + g) + 4 + rnd() * 10); D = r2(2 * far); cx = r2(W / 2 - g - Rm); cy = 0; }
  else if (place === 'y') { D = r2(2 * (Rm + g) + 4 + rnd() * 10); W = r2(2 * far); cy = r2(-(D / 2 - g - Rm)); cx = 0; }
  else { W = r2(2 * (Rm + g) + 4 + rnd() * 10); D = r2(2 * (Rm + g) + 4 + rnd() * 10); cx = r2(W / 2 - g - Rm); cy = r2(D / 2 - g - Rm); }
  add({ id: `sf${seed}-${String(++n).padStart(3, '0')}-${kind}-${open}-k${k}-${place}`, kind, open, k, place, t, r, Rm, depth, angle, H, W, D, cx, cy });
}
// family 3: countersink from the open face (open top), mouth far from every side, straight length L = H - cone depth in walls
for (const kl of [0.5, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 1.9, 2, 2.1, 2.5, 3]) for (let rep = 0; rep < 2; rep++) {
  const t = pick([1, 1.5, 2]); const r = pick([1, 1.5, 2]); const Rm = r2(r + 1.5 + rnd() * 2); const angle = pick([90, 82, 100]);
  const dep = (Rm - r) / Math.tan(angle / 2 * Math.PI / 180);
  const H = r2(dep + kl * t); if (H < 2 * t + 0.5) continue;
  const W = r2(2 * (Rm + 3 * t) + 8 + rnd() * 10), D = r2(2 * (Rm + 3 * t) + 8 + rnd() * 10);
  add({ id: `sf${seed}-f3-${String(++n).padStart(3, '0')}-L${kl}t`, kind: 'csink', open: 'top', k: null, f3: kl, place: 'centre', t, r, Rm, depth: null, angle, H, W, D, cx: 0, cy: 0 });
}
writeFileSync(OUT, JSON.stringify(cases, null, 1));
console.log(cases.length, 'cases');
