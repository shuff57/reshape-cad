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
// draft after a hole along z. Frame: box x -W/2..W/2, y -D/2..D/2, z 0..H; the mouth is at z = H. A draft of the right face by a degrees about the neutral height n
// moves it to x = W/2 - (z - n) tan a (narrower upward); the front face to y = -D/2 + (z - n) tan a. Exact volume by cross-sections: at each z the part is the
// rectangle up to the tilted planes minus the hole's disk of radius R(z) (bore r; counterbore Rm over its depth; countersink cone), the disk/rectangle overlap exact.
// So a tilted face that cuts INTO the hole or the recess is still exact here.
export function closedFormDraft(c) {
  const { W, D, H, kind, r, Rm, depth, angle, cx, cy, drafts } = c;
  const dep = kind === 'csink' ? (Rm - r) / Math.tan(angle / 2 * Math.PI / 180) : 0;
  const Rz = (z) => (kind === 'cbore' && z >= H - depth ? Rm : kind === 'csink' && z >= H - dep ? r + (Rm - r) * (z - (H - dep)) / dep : r);
  const plane = (face, z) => { const d = drafts.find((q) => q.face === face); return d ? (z - d.n) * Math.tan(d.deg * Math.PI / 180) : 0; };
  const bz = [0, H]; if (kind === 'cbore') bz.push(H - depth); if (kind === 'csink') bz.push(H - dep); for (const d of drafts) if (d.n > 0 && d.n < H) bz.push(d.n);
  const zs = [...new Set(bz)].sort((p, q) => p - q);
  let V = 0;
  for (let i = 0; i + 1 < zs.length; i++) V += quad((z) => { const X1 = W / 2 - plane('right', z), Y0 = -D / 2 + plane('front', z); return (X1 + W / 2) * (D / 2 - Y0) - diskRect(cx, cy, Rz(z), -W / 2, X1, Y0, D / 2); }, zs[i], zs[i + 1], 48);
  // does a tilted face reach the hole anywhere (the recess breaks out through the drafted face)? clearance = the least distance from the hole's edge to a tilted face
  let clear = Infinity; for (let k = 0; k <= 400; k++) { const z = H * k / 400; clear = Math.min(clear, W / 2 - plane('right', z) - cx - Rz(z), cy - Rz(z) - (-D / 2 + plane('front', z))); }
  return { P: V, clear, breaks: clear < 0 };
}
const recOf = (h) => (h.kind === 'cbore' ? `, counterbore: { across: ${2 * h.Rm}, deep: ${h.depth} }` : h.kind === 'csink' ? `, countersink: { across: ${2 * h.Rm}, angle: ${h.angle} }` : '');
const optOf = (d) => (d.from === 'default' ? '' : `, { from: '${d.from}' }`);
const scriptOf = (c) => `const b = box(${c.W}, ${c.D}, ${c.H});\nhole(b, { across: ${2 * c.r}, at: [${c.cx}, ${c.cy}]${recOf(c)} });\n${c.drafts.map((d) => `draft(b.face('${d.face}'), ${d.deg}${optOf(d)});`).join('\n')}`;
const cases = []; let n = 0;
for (const kind of ['plain', 'cbore', 'csink']) for (const which of ['right', 'front', 'both']) for (const from of ['default', 'bottom', 'top']) for (const g of [0.2, 0.5, 1, 1.5, 2, 3, 5]) {
  const r = pick([1, 1.5, 2]); const Rm = kind === 'plain' ? r : r2(r + 1 + rnd() * 2.5); const H = pick([8, 10, 12, 14]);
  const depth = kind === 'cbore' ? r2(Math.min(H - 1.5, 0.5 + rnd() * 4)) : null; const angle = kind === 'csink' ? pick([90, 90, 82, 100, 120]) : null;
  if (kind === 'csink' && (Rm - r) / Math.tan(angle / 2 * Math.PI / 180) > H - 0.5) continue; if (kind === 'cbore' && !(depth > 0.3)) continue;
  const deg = pick([3, 5, 8, 10, 15]); const nH = from === 'default' ? H / 2 : from === 'bottom' ? 0 : H;
  const sx = which !== 'front', sy = which !== 'right';
  const W = r2(sx ? 2 * (Rm + g) + 14 + rnd() * 10 : 2 * (Rm + 12 + rnd() * 6)), D = r2(sy ? 2 * (Rm + g) + 14 + rnd() * 10 : 2 * (Rm + 12 + rnd() * 6));
  const cx = sx ? r2(W / 2 - g - Rm) : 0, cy = sy ? r2(-(D / 2 - g - Rm)) : 0;
  const drafts = []; if (sx) drafts.push({ face: 'right', deg, from, n: nH }); if (sy) drafts.push({ face: 'front', deg, from, n: nH });
  const c = { id: `sd${seed}-${String(++n).padStart(3, '0')}-${kind}-${which}-${from}-g${g}-a${deg}`, kind, which, from, g, deg, r, Rm, depth, angle, H, W, D, cx, cy, drafts };
  c.script = scriptOf(c); c.model = null; c.closed = closedFormDraft(c); cases.push(c);
}
writeFileSync(OUT, JSON.stringify(cases, null, 1));
console.log(cases.length, 'cases');
