// cross-hole-family.mjs <out.json>: plan item 4, the family: holes ACROSS a curved wall, as documents, each with the volume worked out here with no kernel.
// Run with the guard off:  GUARDS_OFF=G-CURVED sh ../../sweep/score-built.sh <out> file=<out.json>
// The volume is a midpoint integral over the part's footprint: at each (x, y) the height of material left, the bore taken out where it passes.
// A bore along x at (y0, z0), radius r, through a part of height h about z = 0, removes at (x, y) the height of the z-interval |z - z0| <= sqrt(r^2 - (y - y0)^2)
// that lies inside the part. Everything is in the part's own frame: the part's middle is the origin (a hole's `at` is measured from there).
import fs from 'node:fs';
const PI = Math.PI;
const rnd = (() => { let s = 20261114; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const pick = (a) => a[Math.floor(rnd() * a.length)]; const q = (v) => Math.round(v * 4) / 4;
/** material volume: footprint(x, y) -> half height H(x, y) of the part there (0 outside), bores: [{ r, y0, z0 }] along x, by a grid of n x n */
function volume(R, half, bores, n = 1600) {
  const hx = 2 * R / n; let s = 0;
  for (let i = 0; i < n; i++) { const x = -R + (i + 0.5) * hx; for (let j = 0; j < n; j++) { const y = -R + (j + 0.5) * hx; const H = half(x, y); if (!(H > 0)) continue;
    // the union of the z-intervals the bores remove, clipped to [-H, H]
    const iv = []; for (const b of bores) { const d = y - b.y0; if (Math.abs(d) >= b.r) continue; const c = Math.sqrt(b.r * b.r - d * d); const lo = Math.max(-H, b.z0 - c), hi = Math.min(H, b.z0 + c); if (hi > lo) iv.push([lo, hi]); }
    iv.sort((a, b) => a[0] - b[0]); let cut = 0, end = -Infinity; for (const [lo, hi] of iv) { if (hi <= end) continue; cut += hi - Math.max(lo, end); end = hi; }
    s += 2 * H - cut; } }
  return s * hx * hx;
}
const cases = [];
const add = (id, features, analytic, tags) => cases.push({ id, doc: { version: 1, features }, analytic, curved: true, tags });
// ---- a cylinder, the hole along x through it: radius, bore ratio, offset from the axis (y) and height (z)
for (const R of [4, 6, 10, 16, 30]) for (const ratio of [0.05, 0.15, 0.3, 0.5, 0.7, 0.9]) for (const off of ['axis', 'off', 'graze', 'break']) {
  const h = pick([12, 20, 30]); const r = Math.max(0.5, q(R * ratio)); if (r >= h / 2 - 0.5) continue;
  // off: the bore still wholly inside the wall's width; graze: its edge 0.25 inside the wall; break: its edge 0.25 outside (it breaks out of the side)
  const y0 = off === 'axis' ? 0 : off === 'off' ? q((R - r) * 0.5) : off === 'graze' ? R - r - 0.25 : R - r + 0.25;
  if (off !== 'axis' && y0 <= 0) continue;
  const z0 = pick([0, 0, q((h / 2 - r) * 0.5)]);
  const half = (x, y) => (x * x + y * y <= R * R ? h / 2 : 0);
  add(`cyl R${R} h${h} bore ${2 * r} ${off} y${y0} z${z0}`, [{ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'c1', diameter: 2 * r, depth: 4 * R + 20, center: [0, y0, z0], axis: 'x' }],
    volume(R, half, [{ r, y0, z0 }]), { shape: 'cylinder', R, r, ratio: r / R, off, y0, z0 });
}
// ---- the same along y (the other "across"), a few
for (const R of [6, 10, 16]) for (const ratio of [0.15, 0.5]) { const h = 20, r = q(R * ratio); const half = (x, y) => (x * x + y * y <= R * R ? h / 2 : 0);
  add(`cyl R${R} h${h} bore ${2 * r} along y`, [{ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'c1', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, 0], axis: 'y' }], volume(R, half, [{ r, y0: 0, z0: 0 }]), { shape: 'cylinder', R, r, ratio: r / R, off: 'axis-y' }); }
// ---- a cylinder that is not at the origin (a hole's place is measured from the part's middle, so the volume is the same)
for (const R of [8, 12]) { const h = 24, r = q(R * 0.3); const half = (x, y) => (x * x + y * y <= R * R ? h / 2 : 0);
  add(`cyl R${R} at 13,-7,5 bore ${2 * r}`, [{ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [13, -7, 5] }, { id: 'h2', kind: 'hole', target: 'c1', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, 0], axis: 'x' }], volume(R, half, [{ r, y0: 0, z0: 0 }]), { shape: 'cylinder', R, r, ratio: 0.3, off: 'moved' }); }
// ---- two holes across, one above the other (they do not meet), and two that cross (the guard G-CROSS has to say so)
for (const R of [10, 16]) { const h = 30, r = q(R * 0.2); const half = (x, y) => (x * x + y * y <= R * R ? h / 2 : 0);
  add(`cyl R${R} two bores apart`, [{ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'c1', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, 8], axis: 'x' }, { id: 'h3', kind: 'hole', target: 'h2', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, -8], axis: 'x' }],
    volume(R, half, [{ r, y0: 0, z0: 8 }, { r, y0: 0, z0: -8 }]), { shape: 'cylinder', R, r, ratio: 0.2, off: 'two' }); }
// ---- a cone (apex up): the half height at (x, y) is not symmetric about z = 0, so it has its own integral; left without a form here and judged by OCCT
for (const R of [8, 12]) for (const ratio of [0.15, 0.3]) { const h = 20, r = q(R * ratio);
  add(`cone R${R} h${h} bore ${2 * r}`, [{ id: 'k1', kind: 'cone', radius: R, height: h, center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'k1', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, -h / 4], axis: 'x' }], null, { shape: 'cone', R, r, ratio }); }
// ---- a round pad (a pulled circle), and a pad with one rounded corner: across the pull
for (const R of [8, 12]) for (const ratio of [0.15, 0.4]) { const h = 20, r = q(R * ratio); const half = (x, y) => (x * x + y * y <= R * R ? h / 2 : 0);
  add(`pad R${R} h${h} bore ${2 * r}`, [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, shape: 'circle', points: [[-R, 0], [R, 0]] }, { id: 'e2', kind: 'extrude', target: 'sk1', height: h }, { id: 'h3', kind: 'hole', target: 'e2', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, 0], axis: 'x' }], volume(R, half, [{ r, y0: 0, z0: 0 }]), { shape: 'round pad', R, r, ratio }); }
// ---- with a counterbore and a countersink at the mouth (on the curved wall: the layer has its own guards for a recess there; judged by OCCT)
for (const R of [10, 16]) for (const rec of ['counterbore', 'countersink']) { const h = 24, r = q(R * 0.15);
  add(`cyl R${R} bore ${2 * r} ${rec}`, [{ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'c1', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, 0], axis: 'x', ...(rec === 'counterbore' ? { counterbore: { diameter: 4 * r, depth: 2 } } : { countersink: { diameter: 4 * r, angleDeg: 90 } }) }], null, { shape: 'cylinder', R, r, ratio: 0.15, off: rec }); }
// ---- blind, from the +x side to the axis
for (const R of [10, 16]) { const h = 24, r = q(R * 0.2);
  add(`cyl R${R} bore ${2 * r} blind to the axis`, [{ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'c1', diameter: 2 * r, depth: R, center: [R / 2, 0, 0], axis: 'x' }], null, { shape: 'cylinder', R, r, ratio: 0.2, off: 'blind' }); }
// ---- controls: the same bores ALONG the axis (the guard never refused these) and across a box
for (const R of [6, 10, 16]) { const h = 20, r = q(R * 0.3);
  add(`control cyl R${R} bore ${2 * r} along the axis`, [{ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'c1', diameter: 2 * r, depth: h + 20, center: [0, 0, 0], axis: 'z' }], PI * (R * R - r * r) * h, { shape: 'control', R, r, ratio: 0.3 });
  add(`control box ${2 * R} bore ${2 * r} across`, [{ id: 'b1', kind: 'box', size: [2 * R, 2 * R, h], center: [0, 0, 0] }, { id: 'h2', kind: 'hole', target: 'b1', diameter: 2 * r, depth: 4 * R + 20, center: [0, 0, 0], axis: 'x' }], 4 * R * R * h - PI * r * r * 2 * R, { shape: 'control', R, r, ratio: 0.3 }); }
fs.writeFileSync(process.argv[2], JSON.stringify(cases));
const by = {}; for (const c of cases) by[c.tags.shape] = (by[c.tags.shape] ?? 0) + 1; console.log(cases.length, 'cases', JSON.stringify(by), 'with a volume worked out here:', cases.filter((c) => c.analytic != null).length);
