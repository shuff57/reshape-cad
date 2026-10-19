// Round 3 cases for the fillet-chamfer group (the critic's unrecorded SILENT WRONG SOLIDS and the boundary/size items). Same conventions as cases-r2.mjs.
// Every closed form is independent of every kernel (numeric Simpson integrals of the removed prisms, Pappus, Minkowski).
// `ref` = the same part built in the FILLET-FIRST order (the order the three engines agree on); `expect: 'refuse'` = a correct system must refuse.
const PI = Math.PI;
const integ = (f, a, b, n = 40000) => { const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2); return s * h / 3; };
const Af = (r) => (1 - PI / 4) * r * r;
const Ac = (d) => d * d / 2;
// depth of the removal prism of a fillet (kind f) / chamfer (kind c) of size s at distance w from the shared face
const dep = (k, s, w) => (w >= s || w < 0 ? 0 : k === 'f' ? s - Math.sqrt(Math.max(0, s * s - (s - w) * (s - w))) : s - w);
const area = (k, s) => (k === 'f' ? Af(s) : Ac(s));
const B3 = 'const b = cuboid(40,30,20)\n';           // 40 x 30 x 20 centred on the origin: front face y = -15, top z = 10
const V3 = 40 * 30 * 20;
const PLATE = "const sk = sketch('top')\nsk.rect(40, 30, { at: [20, 15] })\nconst pad = extrude(sk, 10)\n"; // 40 x 30 x 10, x 0..40, y 0..30
const VP = 12000;
export const CASES = [];
const add = (c) => CASES.push(c);

// ---------------------------------------------------------------------------------------------------------------------
// H: a blend whose footprint reaches an EARLIER hole (hole first, then the edge). box minus the removal prism minus the hole plus their overlap.
// hole across D at [hx, hy] through all of z; blended edge top/front (y = -15, along x, length 40).
const holeCase = (D, hx, hy, k, s) => () => {
  const R = D / 2;
  const overlap = integ((y) => { const c2 = R * R - (y - hy) * (y - hy); return c2 <= 0 ? 0 : 2 * Math.sqrt(c2) * dep(k, s, y + 15); }, Math.max(hy - R, -15), Math.min(hy + R, -15 + s));
  return V3 - area(k, s) * 40 - PI * R * R * 20 + overlap;
};
for (const r of [2, 3, 3.5, 4, 5, 6, 7]) {
  add({ id: `r3-h-fillet-r${r}`, row: 'holeFirst', script: `${B3}hole(b, { across: 6, at: [0, -9] })\nround(b.edge('top','front'), ${r})`, size: r, closed: holeCase(6, 0, -9, 'f', r) });
  add({ id: `r3-h-ref-r${r}`, row: 'holeFirstRef', script: `${B3}round(b.edge('top','front'), ${r})\nhole(b, { across: 6, at: [0, -9] })`, size: r, closed: holeCase(6, 0, -9, 'f', r) });
}
for (const d of [3, 4, 5, 6, 7]) {
  add({ id: `r3-h-bevel-d${d}`, row: 'holeFirst', script: `${B3}hole(b, { across: 6, at: [0, -9] })\nbevel(b.edge('top','front'), ${d})`, size: d, closed: holeCase(6, 0, -9, 'c', d) });
  add({ id: `r3-h-bevelref-d${d}`, row: 'holeFirstRef', script: `${B3}bevel(b.edge('top','front'), ${d})\nhole(b, { across: 6, at: [0, -9] })`, size: d, closed: holeCase(6, 0, -9, 'c', d) });
}
// positions: hole nearer / farther, off-centre in x, blind from the top, a hole under the OTHER face of the edge (front-face side is a z hole, so only top matters), hole well clear (control)
for (const [tag, hy, hx, r] of [['y6', -6, 0, 4], ['y12', -12, 0, 4], ['y12b', -12, 0, 8], ['x10', -9, 10, 5], ['x17', -9, 17, 5], ['far', 0, 0, 5], ['far-r12', 0, 0, 12], ['clear-edge', -9, 0, 2.99], ['touch', -9, 0, 3]]) {
  add({ id: `r3-hp-${tag}`, row: 'holeFirstPos', script: `${B3}hole(b, { across: 6, at: [${hx}, ${hy}] })\nround(b.edge('top','front'), ${r})`, size: r, closed: holeCase(6, hx, hy, 'f', r) });
  add({ id: `r3-hpref-${tag}`, row: 'holeFirstPosRef', script: `${B3}round(b.edge('top','front'), ${r})\nhole(b, { across: 6, at: [${hx}, ${hy}] })`, size: r, closed: holeCase(6, hx, hy, 'f', r) });
}
// blind hole from the top (deep 8) at [0,-9]; blind hole deeper than the blend (deep 3 vs r 5)
for (const [dp, r] of [[8, 5], [3, 5], [1, 5], [12, 6]]) {
  add({ id: `r3-hb-deep${dp}-r${r}`, row: 'holeFirstBlind', script: `${B3}hole(b, { across: 6, at: [0, -9], deep: ${dp} })\nround(b.edge('top','front'), ${r})`, size: r });
  add({ id: `r3-hbref-deep${dp}-r${r}`, row: 'holeFirstBlindRef', script: `${B3}round(b.edge('top','front'), ${r})\nhole(b, { across: 6, at: [0, -9], deep: ${dp} })`, size: r });
}

// P: plate edge fillet when a POCKET sits closer to the edge than the radius (pocket rect 10x6 at y 2..8, 4 deep)
const PK = (y0) => `${PLATE}const sk2 = sketch('top', 10)\nsk2.rect(10, 6, { at: [20, ${y0 + 3}] })\n`;
const pocketCase = (y0, k, s) => () => VP - 240 - area(k, s) * 40 + 10 * integ((w) => dep(k, s, w), Math.max(y0, 0), Math.min(y0 + 6, s));
for (const r of [1.5, 2, 2.5, 3, 4, 5]) {
  add({ id: `r3-pk-fillet-r${r}`, row: 'pocketFirst', script: `${PK(2)}const part = pocket(sk2, pad, 4)\nround(part.edge('top','front'), ${r})`, size: r, closed: pocketCase(2, 'f', r) });
  add({ id: `r3-pkref-fillet-r${r}`, row: 'pocketFirstRef', script: `${PLATE}round(pad.edge('top','front'), ${r})\nconst sk2 = sketch('top', 10)\nsk2.rect(10, 6, { at: [20, 5] })\npocket(sk2, pad, 4)`, size: r, closed: pocketCase(2, 'f', r) });
}
for (const d of [1.5, 2, 3, 4]) {
  add({ id: `r3-pk-bevel-d${d}`, row: 'pocketFirst', script: `${PK(2)}const part = pocket(sk2, pad, 4)\nbevel(part.edge('top','front'), ${d})`, size: d, closed: pocketCase(2, 'c', d) });
  add({ id: `r3-pkref-bevel-d${d}`, row: 'pocketFirstRef', script: `${PLATE}bevel(pad.edge('top','front'), ${d})\nconst sk2 = sketch('top', 10)\nsk2.rect(10, 6, { at: [20, 5] })\npocket(sk2, pad, 4)`, size: d, closed: pocketCase(2, 'c', d) });
}
for (const [tag, y0, r] of [['y0', 0, 3], ['y1', 1, 3], ['y3', 3, 3], ['y6', 6, 3], ['y20', 20, 5]]) {
  add({ id: `r3-pkpos-${tag}`, row: 'pocketFirstPos', script: `${PK(y0)}const part = pocket(sk2, pad, 4)\nround(part.edge('top','front'), ${r})`, size: r, closed: y0 + 6 <= 30 ? pocketCase(y0, 'f', r) : undefined });
}

// B: bevel of a concave pocket vertical edge larger than the adjacent wall (10 x 6 pocket in the 40 x 30 x 10 plate, 4 deep, plate 12000 - 240 = 11760)
const PB = `${PLATE}const sk2 = sketch('top', 10)\nsk2.rect(10, 6, { at: [20, 15] })\nconst part = pocket(sk2, plate, 4)\n`.replace('plate', 'pad');
for (const [a, b] of [[1, 2], [2, 3]]) for (const d of [1, 3, 5, 5.99, 6, 6.01, 7, 9, 10, 10.01, 12]) {
  add({ id: `r3-pw-bevel-w${a}${b}-d${d}`, row: 'pocketWallBevel', script: `${PB}bevel(part.edge(part.wall(sk2, ${a}), part.wall(sk2, ${b})), ${d})`, size: d, wall: [a, b], closed: d <= 6 ? () => 11760 + Ac(d) * 4 : undefined, expect: d >= 6 ? 'refuse' : null });
}
for (const [a, b] of [[1, 2]]) for (const r of [1, 3, 5, 5.99, 6, 6.01, 7]) {
  add({ id: `r3-pw-fillet-w${a}${b}-r${r}`, row: 'pocketWallFillet', script: `${PB}round(part.edge(part.wall(sk2, ${a}), part.wall(sk2, ${b})), ${r})`, size: r, wall: [a, b], closed: r <= 6 ? () => 11760 + Af(r) * 4 : undefined, expect: r > 6 ? 'refuse' : null });
}
// W: wall-top boundary: size == the depth (4) of the wall the edge runs along
for (const d of [3.99, 4, 4.01, 5]) add({ id: `r3-wt-bevel-d${d}`, row: 'wallTop', script: `${PB}bevel(part.edge('top', part.wall(sk2, 1)), ${d})`, size: d, closed: d <= 4 ? () => 11760 - Ac(d) * 10 : undefined, expect: d >= 4 ? 'refuse' : null });
for (const r of [3.99, 4, 4.01, 5]) add({ id: `r3-wt-fillet-r${r}`, row: 'wallTop', script: `${PB}round(part.edge('top', part.wall(sk2, 1)), ${r})`, size: r, closed: r <= 4 ? () => 11760 - Af(r) * 10 : undefined, expect: r > 4 ? 'refuse' : null });

// R: rim bevel on a LARGE pocket (30 x 20 x 6 deep in 40x30x10), one edge at a time (rig only: the pane refuses the second edge)
const PR = `${PLATE}const sk2 = sketch('top', 10)\nsk2.rect(30, 20, { at: [20, 15] })\nconst part = pocket(sk2, pad, 6)\n`;
for (const d of [1, 2, 3]) add({ id: `r3-rim-bevel-d${d}`, row: 'rimBig', script: `${PR}bevel(part.rim(sk2), ${d})`, size: d });
for (const r of [1, 2, 3]) add({ id: `r3-rim-fillet-r${r}`, row: 'rimBig', script: `${PR}round(part.rim(sk2), ${r})`, size: r });

// Z: sizes of zero / negative / tiny / exactly half
add({ id: 'r3-z-whole-0', row: 'size', script: `${B3}round(b, 0)` });
add({ id: 'r3-z-whole-0.001', row: 'size', script: `${B3}round(b, 0.001)` });
add({ id: 'r3-z-whole-neg2', row: 'size', script: `${B3}round(b, -2)` });
add({ id: 'r3-z-edge-0', row: 'size', script: `${B3}round(b.edge('top','front'), 0)` });
add({ id: 'r3-z-edge-neg2', row: 'size', script: `${B3}round(b.edge('top','front'), -2)` });
add({ id: 'r3-z-bevel-0', row: 'size', script: `${B3}bevel(b.edge('top','front'), 0)` });
add({ id: 'r3-z-bevel-neg2', row: 'size', script: `${B3}bevel(b.edge('top','front'), -2)` });
add({ id: 'r3-z-edge-0.001', row: 'size', script: `${B3}round(b.edge('top','front'), 0.001)` });
add({ id: 'r3-z-cyl-whole-0', row: 'size', script: `const c = cylinder(30,20)\nround(c, 0)` });
add({ id: 'r3-z-cyl-whole-neg2', row: 'size', script: `const c = cylinder(30,20)\nround(c, -2)` });
const rbox = (L, W, H, r) => (L - 2 * r) * (W - 2 * r) * (H - 2 * r) + 2 * r * ((L - 2 * r) * (W - 2 * r) + (L - 2 * r) * (H - 2 * r) + (W - 2 * r) * (H - 2 * r)) + PI * r * r * ((L - 2 * r) + (W - 2 * r) + (H - 2 * r)) + 4 / 3 * PI * r ** 3;
const rimFillet = (R, r) => 2 * PI * (r * r * (R - r / 2) - (PI * r * r / 4) * (R - r + 4 * r / (3 * PI)));
for (const r of [9.99, 10, 10.01, 11]) add({ id: `r3-half-box-r${r}`, row: 'half', script: `${B3}round(b, ${r})`, size: r, closed: r <= 10 ? () => rbox(40, 30, 20, r) : undefined, expect: r > 10 ? 'refuse' : null });
for (const r of [9.99, 10, 10.01, 11]) add({ id: `r3-half-cyl-r${r}`, row: 'half', script: `const c = cylinder(30,20)\nround(c, ${r})`, size: r, closed: r <= 10 ? () => PI * 225 * 20 - 2 * rimFillet(15, r) : undefined, expect: r > 10 ? 'refuse' : null });
// near-degenerate cylinder rim chamfer bbox (truck bbox of a chamfer cone)
for (const d of [14, 14.9, 14.99]) add({ id: `r3-bbox-cyl-bevel-${d}`, row: 'bbox', script: `const c = cylinder(30,20)\nbevel(c.edge('top','side'), ${d})`, size: d });
for (const r of [14, 14.9, 14.99]) add({ id: `r3-bbox-cyl-fillet-${r}`, row: 'bbox', script: `const c = cylinder(30,20)\nround(c.edge('top','side'), ${r})`, size: r });

// K: round then hollow with the round equal to / bigger than the wall
for (const [r, w] of [[1, 2], [1.99, 2], [2, 2], [2.01, 2], [3, 2]]) add({ id: `r3-k-round${r}-wall${w}`, row: 'roundHollow', script: `const b = cuboid(40,30,12)\nround(b.edge('top','right'), ${r})\nhollow(b,{wall:${w},open:'top'})`, size: r });
