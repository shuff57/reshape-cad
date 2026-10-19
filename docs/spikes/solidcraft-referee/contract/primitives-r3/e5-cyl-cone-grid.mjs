// E5: cylinder and cone, across a x aspect (tall = aspect * across). Fast shapes, dense grid.
const out = []; const f = (v) => +v.toPrecision(10);
for (const a of [0.1, 0.25, 0.5, 1, 2, 5, 20, 200, 2000]) {
  for (const asp of [0.02, 0.1, 1, 5, 10, 20, 30, 40, 50, 60, 80, 100]) {
    const t = f(a * asp);
    if (t > 1e5 || t < 1e-3) continue;
    out.push({ id: `e5-cyl-a${a}-asp${asp}`, script: `cylinder(${a}, ${t});` });
    out.push({ id: `e5-cone-a${a}-asp${asp}`, script: `cone(${a}, ${t});` });
  }
}
export default out;
