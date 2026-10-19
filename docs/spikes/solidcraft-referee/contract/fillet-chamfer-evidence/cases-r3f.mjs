// Round 3 FUZZ of the two critic classes the round-2 guards could not see: a blend whose footprint reaches an EARLIER hole (hole first, then round/bevel the top/front edge of
// a 40x30x20 box) and an EARLIER pocket (pocket first, then round/bevel the top/front edge of a 40x30x10 plate). Deterministic (seed 11). Every case has an independent closed form
// (numeric Simpson integral of the removal prism, minus the hole/pocket, plus their overlap); the truth label is "truck within 1e-4 of the closed form" (the same kernel's fillet-first build
// of the same part is within 2.4e-6 of it, so 1e-4 is not tessellation noise here).
const PI = Math.PI;
const integ = (f, a, b, n = 20000) => { const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2); return s * h / 3; };
const dep = (k, s, w) => (w >= s || w < 0 ? 0 : k === 'f' ? s - Math.sqrt(Math.max(0, s * s - (s - w) * (s - w))) : s - w);
const area = (k, s) => (k === 'f' ? (1 - PI / 4) * s * s : s * s / 2);
let seed = 11;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r1 = (x) => Math.round(x * 10) / 10;
export const CASES = [];
const B3 = 'const b = cuboid(40,30,20)\n';
const PLATE = "const sk = sketch('top')\nsk.rect(40, 30, { at: [20, 15] })\nconst pad = extrude(sk, 10)\n";
for (let i = 0; i < 36; i++) {
  const D = r1(3 + rnd() * 7);                    // hole diameter 3..10
  const R = D / 2;
  const hx = r1((rnd() - 0.5) * 24);              // inside the 40 wide top
  const hy = r1(-15 + R + 0.2 + rnd() * (22 - R)); // hole fully inside the 30 deep top: y from -15+R+0.2
  const k = rnd() < 0.5 ? 'f' : 'c';
  const s = r1(1 + rnd() * 9);                    // size 1..10 (< 20 the front height, < 30)
  const overlap = () => integ((y) => { const c2 = R * R - (y - hy) * (y - hy); return c2 <= 0 ? 0 : 2 * Math.sqrt(c2) * dep(k, s, y + 15); }, Math.max(hy - R, -15), Math.min(hy + R, -15 + s));
  const gap = (hy - R) - (-15); // clear distance from the hole to the front face
  CASES.push({ id: `r3f-h-${i}`, row: 'holeFirstFuzz', script: `${B3}hole(b, { across: ${D}, at: [${hx}, ${hy}] })\n${k === 'f' ? 'round' : 'bevel'}(b.edge('top','front'), ${s})`, size: s, gap, closed: () => 24000 - area(k, s) * 40 - PI * R * R * 20 + overlap() });
}
for (let i = 0; i < 36; i++) {
  const w = r1(4 + rnd() * 14); const h = r1(3 + rnd() * 8); // pocket w (x) by h (y)
  const y0 = r1(0.5 + rnd() * 14);                          // pocket from y0 to y0+h
  const x0 = 20;
  const dp = r1(2 + rnd() * 6);                             // pocket depth 2..8 (plate is 10)
  const k = rnd() < 0.5 ? 'f' : 'c';
  const s = r1(0.8 + rnd() * 6);                            // size 0.8..6.8
  // overlap of the removal prism with the pocket: only the part of the removal prism that is above the pocket floor: the removal depth at distance w is dep(w) <= s; the pocket is dp deep (>= dep when dp >= s)
  const ov = () => w * integ((y) => Math.min(dep(k, s, y), dp), Math.max(y0, 0), Math.min(y0 + h, s));
  CASES.push({ id: `r3f-p-${i}`, row: 'pocketFirstFuzz', script: `${PLATE}const sk2 = sketch('top', 10)\nsk2.rect(${w}, ${h}, { at: [${x0}, ${r1(y0 + h / 2)}] })\nconst part = pocket(sk2, pad, ${dp})\n${k === 'f' ? 'round' : 'bevel'}(part.edge('top','front'), ${s})`, size: s, gap: y0, closed: () => 12000 - w * h * dp - area(k, s) * 40 + ov() });
}
