// E2: cylinder corner (fillet) and chamfer near the radius and near half the height.
const out = []; const f = (v) => +v.toPrecision(12);
const docOf = (feat) => ({ version: 1, features: [{ id: 'cyl1', kind: 'cylinder', center: [0, 0, 0], ...feat }] });
for (const base of [1, 10]) {
  // radius limit: R = 5*base, h = 30*base (half height 15 base, so the radius is the limit)
  for (const k of [0.9, 0.95, 0.98, 0.99, 0.995, 0.998, 0.9999, 1, 1.01]) {
    out.push({ id: `e2-fillet-R-s${base}-k${k}`, script: `cylinder(${10 * base}, ${30 * base}, { corner: ${f(5 * base * k)} });` });
    out.push({ id: `e2-chamfer-R-s${base}-k${k}`, doc: docOf({ radius: 5 * base, height: 30 * base, round: f(5 * base * k), roundStyle: 'chamfer' }) });
  }
  // height limit: R = 24*base, h = 10*base (half height 5 base)
  for (const k of [0.9, 0.98, 0.99, 0.999, 0.9999, 0.99999, 1, 1.01]) {
    out.push({ id: `e2-fillet-H-s${base}-k${k}`, script: `cylinder(${48 * base}, ${10 * base}, { corner: ${f(5 * base * k)} });` });
    out.push({ id: `e2-chamfer-H-s${base}-k${k}`, doc: docOf({ radius: 24 * base, height: 10 * base, round: f(5 * base * k), roundStyle: 'chamfer' }) });
  }
}
export default out;
