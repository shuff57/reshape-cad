// E23 (round 4): turned cones. (a) aspect x rotation at the origin (faces 3/2 and 4/2 were seen on slender and flat cones), (b) turned cone with a centre offset (volume 20x off in fuzz seed 1).
const D = (f) => ({ version: 1, features: [{ ...f, id: 'cone1' }] });
const out = []; const f = (v) => +v.toPrecision(10);
const rots = { x90: [90, 0, 0], y90: [0, 90, 0], z90: [0, 0, 90], xyz: [20, 35, 50], mix: [180, 90, 90] };
for (const r of [1, 10, 72.95]) for (const asp of [0.005, 0.02, 0.1, 0.5, 1, 3, 10, 18, 25, 40]) { // asp = tall / across
  const h = f(asp * 2 * r); if (h < 0.01) continue;
  for (const [rn, rot] of Object.entries(rots)) out.push({ id: `e23-a-r${r}-t${asp}-${rn}`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0], rotate: rot }), occt: true });
  out.push({ id: `e23-a-r${r}-t${asp}-none`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0] }), occt: true });
}
// (b) centre offsets
for (const [r, h] of [[0.921, 0.7261], [2.449, 0.2], [10, 15]]) for (const c of [[0, 0, 5], [5, 0, 0], [0, 0, 50], [0, 0, 500], [30, -20, 10]]) for (const [rn, rot] of [['xyz', rots.xyz], ['mix', rots.mix]]) {
  out.push({ id: `e23-b-r${r}-h${h}-c${c.join('_')}-${rn}`, doc: D({ kind: 'cone', radius: r, height: h, center: c, rotate: rot }), occt: true });
}
export default out;
