// E27 (round 4, after fuzz seeds 1..3): pins the four rules the held-out fuzz seeds showed were missing, with the boundary cells that decide each constant.
//  (a) rounded plates (box corner) at a large length / thickness: tessellation volume error 3.7e-4 .. 5.6e-4 from L/t 250 (E26c)
//  (b) rounded discs (cylinder corner / bevel) at a large across / tall: a band is dropped (4 faces for 5) from across/tall 456 (E24, E26c)
//  (c) cone turned AND moved off the origin, flat: volume 2x .. 100x off for tall/across <= 0.6, exact from 0.75 (E26b); pin the edge, tiny offsets, one-axis turns
//  (d) very flat cones: 4 faces for 2 from tall/across 0.001 turned and 0.0005 plain (E26a2)
//  (e) sphere placed far: COM / bbox wrong when max|at| x across is above ~1e9 (E21, E25); pin P = max|at| x across between 1e7 and 4e9
const D = (f) => ({ version: 1, features: [{ ...f, id: f.kind + '1' }] });
const f = (v) => +v.toPrecision(10);
const out = [];
// (a) plates
for (const t of [4, 40]) for (const asp of [60, 100, 150, 200, 300, 500]) for (const q of [0.1, 0.5, 0.9]) {
  const L = f(t * asp);
  out.push({ id: `e27-a-plate-t${t}-asp${asp}-q${q}`, script: `box(${L}, ${f(L * 0.7)}, ${t}, { corner: ${f(t / 2 * q)} });`, occt: true });
}
// (b) discs: fillet and bevel, across / tall from 40 to 500
for (const R of [50, 500, 5000]) for (const asp of [40, 60, 80, 100, 150, 200, 300, 450, 500]) {
  const H = f(2 * R / asp); const c = f(H / 2 * 0.5);
  if (c >= R * 0.98) continue;
  out.push({ id: `e27-b-fil-R${R}-asp${asp}`, doc: D({ kind: 'cylinder', radius: R, height: H, round: c, center: [0, 0, 0] }), occt: true });
  out.push({ id: `e27-b-bev-R${R}-asp${asp}`, doc: D({ kind: 'cylinder', radius: R, height: H, round: c, roundStyle: 'chamfer', center: [0, 0, 0] }), occt: true });
}
// (c) turned + moved flat cones
const rot = [20, 35, 50];
for (const t of [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1, 1.2, 2]) for (const [cn, c] of [['o001', [0.001, 0, 0]], ['o05', [0.5, 0, 0]], ['z3', [0, 0, 3]], ['n', [5, -3, 2]]]) {
  out.push({ id: `e27-c-t${t}-${cn}-xyz`, doc: D({ kind: 'cone', radius: 10, height: f(t * 20), center: c, rotate: rot }), occt: true });
}
for (const [rn, r] of [['x90', [90, 0, 0]], ['z90', [0, 0, 90]], ['y45', [0, 45, 0]]]) for (const t of [0.1, 0.4]) {
  out.push({ id: `e27-c-axis-${rn}-t${t}`, doc: D({ kind: 'cone', radius: 10, height: f(t * 20), center: [5, -3, 2], rotate: r }), occt: true });
}
for (const t of [0.02, 0.1, 0.3, 0.6]) out.push({ id: `e27-c-plainmoved-t${t}`, doc: D({ kind: 'cone', radius: 10, height: f(t * 20), center: [5, -3, 2] }), occt: true });
// (d) very flat cones, plain and turned, three sizes
for (const r of [5, 50, 1000]) for (const t of [0.0005, 0.001, 0.002, 0.004, 0.006, 0.01]) {
  const h = f(t * 2 * r); if (h < 0.01) continue;
  out.push({ id: `e27-d-r${r}-t${t}-none`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0] }), occt: true });
  out.push({ id: `e27-d-r${r}-t${t}-xyz`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0], rotate: rot }), occt: true });
}
// (e) sphere far: P = max|at| x across
for (const s of [2000, 5000, 10000, 20000, 40000]) for (const P of [1e7, 3e7, 1e8, 2e8, 5e8, 1e9, 2e9, 4e9]) {
  const e = f(P / s); if (e > 1e6 || e > 400 * s) continue;
  out.push({ id: `e27-e-sph-s${s}-P${P}`, script: `sphere(${s}, { at: [${e}, ${f(-e / 2)}, ${f(e / 4)}] });`, occt: true });
}
export default out;
