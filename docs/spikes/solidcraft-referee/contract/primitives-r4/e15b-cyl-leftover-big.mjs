// E15b (round 4): the cylinder leftover (R - corner) at larger radii and other heights. The E15 R=50 rows were invalid (corner above half the height); redone with H = 3R.
const out = []; const f = (v) => +v.toPrecision(12);
const docOf = (feat) => ({ version: 1, features: [{ id: 'cyl1', kind: 'cylinder', center: [0, 0, 0], ...feat }] });
for (const R of [50, 200, 1000, 10000]) for (const l of [0.05, 0.1, 0.2, 0.5, 1, 2, 5]) {
  const c = f(R - l); const H = 3 * R;
  out.push({ id: `e15b-R-fil-R${R}-l${l}`, script: `cylinder(${2 * R}, ${H}, { corner: ${c} });`, occt: true });
  if (R <= 1000) out.push({ id: `e15b-R-cha-R${R}-l${l}`, doc: docOf({ radius: R, height: H, round: c, roundStyle: 'chamfer' }), occt: true });
}
for (const H of [26, 30, 100, 300]) for (const l of [0.03, 0.06, 0.08, 0.1, 0.15]) {
  const c = f(12 - l);
  out.push({ id: `e15b-H${H}-fil-l${l}`, script: `cylinder(24, ${H}, { corner: ${c} });`, occt: true });
  out.push({ id: `e15b-H${H}-cha-l${l}`, doc: docOf({ radius: 12, height: H, round: c, roundStyle: 'chamfer' }), occt: true });
}
export default out;
