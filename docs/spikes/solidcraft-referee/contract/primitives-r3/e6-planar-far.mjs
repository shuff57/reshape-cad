// E6: planar primitives far from the origin. offset = q * (largest dimension of the part). Shapes with an irrational vertex or a turn.
const out = []; const f = (v) => +v.toPrecision(12);
const shapes = {
  prism3: (s, a) => `prism(3, ${s}, ${f(s * 1.5)}, { at: ${a} });`,
  prism6: (s, a) => `prism(6, ${s}, ${f(s * 1.5)}, { at: ${a} });`,
  prism5: (s, a) => `prism(5, ${s}, ${f(s * 1.5)}, { at: ${a} });`,
  prism12: (s, a) => `prism(12, ${s}, ${f(s * 1.5)}, { at: ${a} });`,
  box: (s, a) => `box(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} });`,
  wedge: (s, a) => `wedge(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} });`,
  tbox: (s, a) => `turn(box(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} }), [20, 35, 50]);`,
  tprism6: (s, a) => `turn(prism(6, ${s}, ${f(s * 1.5)}, { at: ${a} }), [20, 35, 50]);`,
  twedge: (s, a) => `turn(wedge(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} }), [20, 35, 50]);`,
};
for (const [name, mk] of Object.entries(shapes)) {
  for (const s of [0.5, 2, 20, 200]) {
    const big = s * 2; // largest dimension
    for (const q of [10, 30, 50, 100, 150, 200, 300, 500, 1000, 3000]) {
      const e = f(q * big);
      if (e > 2e6) continue;
      out.push({ id: `e6-${name}-s${s}-q${q}`, script: mk(s, `[${e}, ${-e}, ${e}]`), occt: true });
    }
  }
}
export default out;
