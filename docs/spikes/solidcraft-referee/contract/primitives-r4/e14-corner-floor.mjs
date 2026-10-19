// E14 (round 4): how small can a corner / bevel be? Closes "box corner 1e-5 builds 18 faces against 26; 1e-6 and 1e-7 reach truck and come back in kernel text".
const out = []; const f = (v) => +v.toPrecision(12);
const docOf = (feat) => ({ version: 1, features: [{ id: 'cyl1', kind: 'cylinder', center: [0, 0, 0], ...feat }] });
const cs = [1e-2, 1e-3, 1e-4, 3e-5, 1e-5, 3e-6, 1e-6, 1e-7];
for (const s of [1.2, 12, 120, 1200]) for (const c of cs) {
  out.push({ id: `e14-box-s${s}-c${c}`, script: `box(${f(s * 1.5)}, ${f(s * 2)}, ${s}, { corner: ${c} });`, occt: true });
}
for (const R of [0.6, 6, 60]) for (const c of cs) {
  out.push({ id: `e14-cylF-R${R}-c${c}`, script: `cylinder(${2 * R}, ${f(R * 3)}, { corner: ${c} });`, occt: true });
  out.push({ id: `e14-cylC-R${R}-c${c}`, doc: docOf({ radius: R, height: f(R * 3), round: c, roundStyle: 'chamfer' }), occt: true });
}
export default out;
