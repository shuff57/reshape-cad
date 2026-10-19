// E15 (round 4): cylinder corner / bevel against an ABSOLUTE leftover. radius side: leftover = R - corner; height side: leftover = H/2 - corner.
// Closes "cylinder(4,20,{corner:1.9799}) is accepted by a 99%-of-radius rule and builds a bbox 1e-2 of the diagonal wrong".
const out = []; const f = (v) => +v.toPrecision(12);
const docOf = (feat) => ({ version: 1, features: [{ id: 'cyl1', kind: 'cylinder', center: [0, 0, 0], ...feat }] });
for (const R of [0.5, 1, 2, 5, 12, 50]) {
  const H = Math.min(f(R * 10), 60);
  for (const l of [0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.5]) {
    if (l >= R) continue;
    const c = f(R - l);
    out.push({ id: `e15-R-fil-R${R}-l${l}`, script: `cylinder(${2 * R}, ${H}, { corner: ${c} });`, occt: true });
    out.push({ id: `e15-R-cha-R${R}-l${l}`, doc: docOf({ radius: R, height: H, round: c, roundStyle: 'chamfer' }), occt: true });
  }
}
// height side: wide disc R = 24, H = 1 / 5 / 20
for (const H of [1, 5, 20]) for (const l of [0.001, 0.003, 0.01, 0.03, 0.1, 0.3]) {
  if (l >= H / 2) continue;
  const c = f(H / 2 - l);
  out.push({ id: `e15-H-fil-H${H}-l${l}`, script: `cylinder(48, ${H}, { corner: ${c} });`, occt: true });
  out.push({ id: `e15-H-cha-H${H}-l${l}`, doc: docOf({ radius: 24, height: H, round: c, roundStyle: 'chamfer' }), occt: true });
}
export default out;
