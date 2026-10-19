// E22 (round 4): flat cones (tall small against across), turned or not, at the origin: the vol 20 (2000%) cases of fuzz seed 1.
const D = (f) => ({ version: 1, features: [{ ...f, id: 'cone1' }] });
const out = [];
for (const [r, h] of [[2.449, 0.2], [2.449, 0.5], [2.449, 1], [2.449, 2], [2.449, 5], [5, 0.01], [5, 0.05], [5, 0.1], [5, 0.2], [5, 0.5], [50, 0.2], [50, 2], [0.5, 0.01], [0.5, 0.2], [0.5, 1]]) {
  out.push({ id: `e22-cone-plain-r${r}-h${h}`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0] }), occt: true });
  out.push({ id: `e22-cone-turn-r${r}-h${h}`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0], rotate: [180, 90, 90] }), occt: true });
  out.push({ id: `e22-cone-turn2-r${r}-h${h}`, doc: D({ kind: 'cone', radius: r, height: h, center: [0, 0, 0], rotate: [20, 35, 50] }), occt: true });
}
export default out;
