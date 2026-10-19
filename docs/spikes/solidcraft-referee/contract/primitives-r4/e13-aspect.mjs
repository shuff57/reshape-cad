// E13 (round 4): long-and-thin planar parts (needles and plates) at the origin. L = longest typed dimension, t = L / aspect (floor 0.001).
// Closes the gap "box(1000, 0.001, 0.001) builds 4 faces against 6". Non-dyadic L so that the sizes are not exact in binary.
const out = []; const f = (v) => +v.toPrecision(12);
const shapes = {
  boxX: (L, t) => `box(${L}, ${t}, ${f(t * 1.3)});`, boxY: (L, t) => `box(${t}, ${L}, ${f(t * 1.3)});`, boxZ: (L, t) => `box(${t}, ${f(t * 1.3)}, ${L});`,
  plate: (L, t) => `box(${L}, ${f(L * 0.7)}, ${t});`,
  wedgeX: (L, t) => `wedge(${L}, ${t}, ${f(t * 1.3)});`, wedgeZ: (L, t) => `wedge(${t}, ${f(t * 1.3)}, ${L});`, wedgePlate: (L, t) => `wedge(${L}, ${f(L * 0.7)}, ${t});`,
  prismNeedle: (L, t) => `prism(7, ${t}, ${L});`, prismPlate: (L, t) => `prism(7, ${L}, ${t});`,
  tboxX: (L, t) => `turn(box(${L}, ${t}, ${f(t * 1.3)}), [20, 35, 50]);`, tplate: (L, t) => `turn(box(${L}, ${f(L * 0.7)}, ${t}), [20, 35, 50]);`,
};
for (const [name, mk] of Object.entries(shapes)) {
  for (const L of [1.37, 13.7, 137, 1370, 13700, 137000, 913000]) {
    for (const asp of [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]) {
      const t = f(L / asp); if (t < 1e-3) continue;
      out.push({ id: `e13-${name}-L${L}-a${asp}`, script: mk(L, t), occt: true });
    }
  }
}
export default out;
