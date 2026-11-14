// cross-hole-family-2.mjs <out.json>: plan item 4, the rest of the family (the first file has 127 cases; the plan asked for about 400).
// What the first file does not have: sizes and places drawn at random rather than from a grid, bores that reach a cap, the cylinder TURNED so that
// "across" is another axis, two bores that CROSS, more pads, cones and recesses. Run like the first:
//   GUARDS_OFF=G-CURVED node ../../sweep/host-route-sweep.mjs --corpus=file --cases=<out.json> --name=cross2 --out=<dir>
// The volume is the same midpoint integral, with bores along x and along y: at each (x, y) of the footprint, the height of material left.
import fs from 'node:fs';
const rnd = (() => { let s = 20261115; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const pick = (a) => a[Math.floor(rnd() * a.length)]; const q = (v) => Math.round(v * 4) / 4; const uni = (a, b) => a + rnd() * (b - a);
/** bores: [{ r, along: 'x' | 'y', off, z0 }]: a bore along x sits at y = off, one along y at x = off; both at height z0. A part of radius R, height h about z = 0. */
function volume(R, h, bores, n = 1400) {
  const hx = 2 * R / n, H = h / 2; let s = 0;
  for (let i = 0; i < n; i++) { const x = -R + (i + 0.5) * hx; for (let j = 0; j < n; j++) { const y = -R + (j + 0.5) * hx; if (x * x + y * y > R * R) continue;
    const iv = []; for (const b of bores) { const d = (b.along === 'x' ? y : x) - b.off; if (Math.abs(d) >= b.r) continue; const c = Math.sqrt(b.r * b.r - d * d); const lo = Math.max(-H, b.z0 - c), hi = Math.min(H, b.z0 + c); if (hi > lo) iv.push([lo, hi]); }
    iv.sort((a, b) => a[0] - b[0]); let cut = 0, end = -Infinity; for (const [lo, hi] of iv) { if (hi <= end) continue; cut += hi - Math.max(lo, end); end = hi; }
    s += h - cut; } }
  return s * hx * hx;
}
const cases = [];
const add = (id, features, analytic, tags) => cases.push({ id, doc: { version: 1, features }, analytic, curved: true, tags });
const cyl = (R, h, extra = {}) => ({ id: 'c1', kind: 'cylinder', radius: R, height: h, center: [0, 0, 0], ...extra });
const bore = (id, target, r, center, axis, depth) => ({ id, kind: 'hole', target, diameter: 2 * r, depth, center, axis });

// ---- A. 150 cylinders at random: radius 4 to 30, the bore 5% to 95% of it, anywhere from the axis to half out of the side, at any height up to and through a cap
for (let k = 0; k < 150; k++) {
  const R = q(uni(4, 30)), h = pick([10, 16, 24, 36]); const r = Math.max(0.5, q(R * uni(0.05, 0.95)));
  const y0 = q(uni(0, 1) < 0.25 ? 0 : uni(0, R)); const z0 = q(uni(0, 1) < 0.3 ? 0 : uni(-(h / 2), h / 2));
  const where = y0 === 0 ? 'axis' : y0 + r < R - 0.01 ? 'off' : y0 + r <= R + 0.01 ? 'graze' : 'break';
  const cap = Math.abs(z0) + r < h / 2 - 0.01 ? 'clear' : 'cap';
  add(`r${k} cyl R${R} h${h} bore ${2 * r} y${y0} z${z0}`, [cyl(R, h), bore('h2', 'c1', r, [0, y0, z0], 'x', 4 * R + 20)], volume(R, h, [{ r, along: 'x', off: y0, z0 }]),
    { shape: 'cylinder', R, h, r, ratio: r / R, off: where, cap, y0, z0 });
}
// ---- B. the cylinder turned: its axis along y (turned 90 about x) or along x (turned 90 about y), the bore along each axis that is across it.
// In the part's own frame this is the unturned case with the two offsets swapped; the volume does not depend on the sign of either.
for (let k = 0; k < 40; k++) {
  const R = q(uni(5, 20)), h = pick([16, 24, 36]); const r = Math.max(0.5, q(R * uni(0.08, 0.6)));
  const axisOf = pick(['y', 'x']); const along = pick(axisOf === 'y' ? ['x', 'z'] : ['y', 'z']);
  const dAxis = q(uni(0, 1) < 0.4 ? 0 : uni(0, R - r - 0.5)); const dLen = q(uni(0, 1) < 0.4 ? 0 : uni(0, h / 2 - r - 0.5)); // from the axis, and along it
  // the cylinder's axis is `axisOf`; the bore runs along `along`; the third axis is where "from the axis" is measured
  const third = ['x', 'y', 'z'].find((a) => a !== axisOf && a !== along); const c = { x: 0, y: 0, z: 0 }; c[third] = dAxis; c[axisOf] = dLen;
  add(`t${k} cyl R${R} h${h} axis ${axisOf} bore ${2 * r} along ${along} off ${dAxis} at ${dLen}`,
    [cyl(R, h, { rotate: axisOf === 'y' ? [90, 0, 0] : [0, 90, 0] }), bore('h2', 'c1', r, [c.x, c.y, c.z], along, 4 * R + 2 * h + 20)],
    volume(R, h, [{ r, along: 'x', off: dAxis, z0: dLen }]), { shape: 'turned cylinder', R, h, r, ratio: r / R, off: dAxis === 0 ? 'axis' : 'off', axisOf, along });
}
// ---- C. two bores across, one along x and one along y: crossing at the same height, overlapping at different heights, and apart
for (let k = 0; k < 40; k++) {
  const R = q(uni(8, 24)), h = pick([24, 36]); const r1 = Math.max(0.5, q(R * uni(0.08, 0.35))), r2 = Math.max(0.5, q(R * uni(0.08, 0.35)));
  const kind = pick(['cross', 'cross', 'overlap', 'apart']); const z1 = q(uni(-(h / 2 - r1 - 1), h / 2 - r1 - 1) * 0.5);
  const z2 = kind === 'cross' ? z1 : kind === 'overlap' ? q(z1 + (r1 + r2) * uni(0.3, 0.8)) : q(z1 + r1 + r2 + uni(1, 3));
  if (Math.abs(z2) + r2 >= h / 2 - 0.25) continue;
  add(`x${k} cyl R${R} h${h} bores ${2 * r1} along x z${z1} and ${2 * r2} along y z${z2} (${kind})`,
    [cyl(R, h), bore('h2', 'c1', r1, [0, 0, z1], 'x', 4 * R + 20), bore('h3', 'h2', r2, [0, 0, z2], 'y', 4 * R + 20)],
    volume(R, h, [{ r: r1, along: 'x', off: 0, z0: z1 }, { r: r2, along: 'y', off: 0, z0: z2 }]), { shape: 'two bores', R, h, r: Math.max(r1, r2), ratio: Math.max(r1, r2) / R, off: kind });
}
// ---- D. round pads (a pulled circle, z 0 to h: the hole's place is from the part's middle), off the axis too
for (let k = 0; k < 16; k++) {
  const R = q(uni(5, 20)), h = pick([12, 20, 30]); const r = Math.max(0.5, q(R * uni(0.08, 0.7))); const y0 = q(uni(0, 1) < 0.4 ? 0 : uni(0, R - r - 0.5)); const z0 = q(uni(0, 1) < 0.5 ? 0 : uni(0, h / 2 - r - 0.5));
  add(`p${k} pad R${R} h${h} bore ${2 * r} y${y0} z${z0}`, [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, shape: 'circle', points: [[-R, 0], [R, 0]] }, { id: 'e2', kind: 'extrude', target: 'sk1', height: h }, bore('h3', 'e2', r, [0, y0, z0], 'x', 4 * R + 20)],
    volume(R, h, [{ r, along: 'x', off: y0, z0 }]), { shape: 'round pad', R, h, r, ratio: r / R, off: y0 === 0 ? 'axis' : 'off' });
}
// ---- E. cones (no form here; OCCT judges), at three heights, on and off the axis
for (const R of [6, 10, 16]) for (const zf of [-0.3, 0, 0.2]) for (const off of [0, 0.3]) { const h = 24, r = q(R * 0.2);
  add(`cone R${R} h${h} bore ${2 * r} z${q(zf * h)} y${q(off * R)}`, [{ id: 'k1', kind: 'cone', radius: R, height: h, center: [0, 0, 0] }, bore('h2', 'k1', r, [0, q(off * R), q(zf * h)], 'x', 4 * R + 20)], null, { shape: 'cone', R, h, r, ratio: 0.2, off: off ? 'off' : 'axis' }); }
// ---- F. blind bores to several depths, and recesses of several sizes (no form here; OCCT judges)
for (const R of [8, 12, 20]) for (const frac of [0.5, 1, 1.5]) { const h = 24, r = q(R * 0.2); const depth = q(R * frac);
  add(`cyl R${R} bore ${2 * r} blind ${depth} deep`, [cyl(R, h), bore('h2', 'c1', r, [R - depth / 2, 0, 0], 'x', depth)], null, { shape: 'cylinder', R, h, r, ratio: 0.2, off: 'blind' }); }
for (const R of [8, 12, 20]) for (const rec of ['counterbore', 'countersink']) { const h = 24, r = q(R * 0.12);
  add(`cyl R${R} bore ${2 * r} ${rec} wide`, [cyl(R, h), { ...bore('h2', 'c1', r, [0, 0, 0], 'x', 4 * R + 20), ...(rec === 'counterbore' ? { counterbore: { diameter: 5 * r, depth: 1.5 } } : { countersink: { diameter: 5 * r, angleDeg: 82 } }) }], null, { shape: 'cylinder', R, h, r, ratio: 0.12, off: rec }); }
fs.writeFileSync(process.argv[2], JSON.stringify(cases));
const by = {}; for (const c of cases) by[c.tags.shape] = (by[c.tags.shape] ?? 0) + 1; console.log(cases.length, 'cases', JSON.stringify(by), 'with a volume worked out here:', cases.filter((c) => c.analytic != null).length);
