// E14b (round 4): is the 1e-6 corner floor of cylinder fillet/bevel absolute? Large radii.
const out = []; const f = (v) => +v.toPrecision(12);
const docOf = (feat) => ({ version: 1, features: [{ id: 'cyl1', kind: 'cylinder', center: [0, 0, 0], ...feat }] });
for (const R of [600, 6000, 25000]) for (const c of [1e-3, 1e-4, 1e-5, 3e-6, 1e-6]) {
  out.push({ id: `e14b-cylF-R${R}-c${c}`, script: `cylinder(${2 * R}, ${f(R * 3)}, { corner: ${c} });`, occt: true });
  out.push({ id: `e14b-cylC-R${R}-c${c}`, doc: docOf({ radius: R, height: f(R * 3), round: c, roundStyle: 'chamfer' }), occt: true });
}
export default out;
