// E26 (round 4): (a) the turned-cone slenderness edge between tall/across 10 (right) and 18 (3 faces for 2), (b) the flat turned cone WITH a centre offset (volume 2x to 100x off),
// (c) rounded discs with a bevel and rounded plates (box corner) at a large aspect.
const D = (f) => ({ version: 1, features: [{ ...f, id: f.kind + '1' }] });
const out = []; const f = (v) => +v.toPrecision(10);
// (a) slender turned cones at the origin
for (const r of [1, 10, 72.95]) for (const t of [10, 11, 12, 13, 14, 15, 16, 17]) {
  for (const [rn, rot] of [['x90', [90, 0, 0]], ['xyz', [20, 35, 50]]]) out.push({ id: `e26-a-r${r}-t${t}-${rn}`, doc: D({ kind: 'cone', radius: r, height: f(t * 2 * r), center: [0, 0, 0], rotate: rot }), occt: true });
}
// (a2) very flat turned cones at the origin (e22: r5 h0.01, t = 0.001, built 4 faces for 2)
for (const r of [5, 10, 50, 200]) for (const t of [0.0002, 0.0005, 0.001, 0.002, 0.003, 0.005]) {
  const h = f(t * 2 * r); if (h < 0.01) continue;
  out.push({ id: `e26-a2-r${r}-t${t}-xyz`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0], rotate: [20, 35, 50] }), occt: true });
  out.push({ id: `e26-a2-r${r}-t${t}-none`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0] }), occt: true });
}
// (b) turned + offset cones: tall/across t, centre [5,-3,2] and a far one
for (const r of [1, 10, 50]) for (const t of [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.5, 3, 8]) {
  for (const [cn, c] of [['near', [5, -3, 2]], ['far', [r * 40, -r * 25, r * 10]]]) {
    out.push({ id: `e26-b-r${r}-t${t}-${cn}`, doc: D({ kind: 'cone', radius: r, height: f(t * 2 * r), center: c, rotate: [20, 35, 50] }), occt: true });
  }
}
// turned + offset: other curved kinds, same recipe (is it only the cone?)
for (const [k, g] of [['cylinder', { radius: 5, height: 3 }], ['cylinder', { radius: 0.9, height: 0.5 }], ['sphere', { radius: 3 }], ['torus', { ringRadius: 6, tubeRadius: 2 }], ['box', { size: [4, 5, 6], round: 1 }], ['cylinder', { radius: 5, height: 3, round: 1 }]]) {
  out.push({ id: `e26-b2-${k}-${JSON.stringify(g).length}`, doc: D({ kind: k, ...g, center: [5, -3, 2], rotate: [20, 35, 50] }), occt: true });
}
// (c) rounded discs with a bevel, rounded plates
for (const [R, H] of [[1000, 20], [5000, 20], [5000, 87.62], [20000, 87.62], [20000, 300]]) for (const q of [0.1, 0.5, 0.9]) {
  out.push({ id: `e26-c-bevel-R${R}-H${H}-q${q}`, doc: D({ kind: 'cylinder', radius: R, height: H, round: f(H / 2 * q), roundStyle: 'chamfer', center: [0, 0, 0] }), occt: true });
}
for (const [L, t] of [[100, 4], [1000, 20], [1000, 4], [10000, 40], [10000, 10], [30000, 20], [30000, 100]]) for (const q of [0.1, 0.5, 0.9]) {
  out.push({ id: `e26-c-plate-L${L}-t${t}-q${q}`, script: `box(${L}, ${f(L * 0.7)}, ${t}, { corner: ${f(t / 2 * q)} });`, occt: true });
}
export default out;
