// E24 (round 4): rounded discs and plates: volume error against R, H and the corner (fuzz seed 1 found cylinder(21340, 87.62, {corner: 23.96}) at 3.4e-4 while corner 10 and 40 were 6e-5 and 9e-5).
const D = (f) => ({ version: 1, features: [{ ...f, id: 'cylinder1' }] });
const out = []; const f = (v) => +v.toPrecision(6);
for (const R of [1000, 5000, 10670, 20000]) for (const H of [20, 87.62, 300]) for (const q of [0.05, 0.1, 0.27, 0.4, 0.55, 0.8, 0.95]) {
  const c = f(H / 2 * q);
  out.push({ id: `e24-R${R}-H${H}-q${q}`, doc: D({ kind: 'cylinder', radius: R, height: H, round: c, center: [0, 0, 0] }), occt: true });
}
for (const c of [22, 23, 23.5, 23.96, 24.5, 25, 26, 28]) out.push({ id: `e24-fine-c${c}`, doc: D({ kind: 'cylinder', radius: 10670, height: 87.62, round: c, center: [0, 0, 0] }), occt: true });
export default out;
