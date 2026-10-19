// E12 (round 4): small planar parts at an offset. Closes the gap the critic found: E6 only tried sizes of 0.5 and up.
// size s = smallest typed dimension (box s x 1.5s x 2s, wedge the same, prism(6, across s, tall 1.5s)); offset e on all three axes (e, -e, e).
const out = []; const f = (v) => +v.toPrecision(12);
const shapes = {
  box: (s, a) => `box(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} });`,
  wedge: (s, a) => `wedge(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} });`,
  prism6: (s, a) => `prism(6, ${s}, ${f(s * 1.5)}, { at: ${a} });`,
  tbox: (s, a) => `turn(box(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} }), [20, 35, 50]);`,
  twedge: (s, a) => `turn(wedge(${s}, ${f(s * 1.5)}, ${f(s * 2)}, { at: ${a} }), [20, 35, 50]);`,
};
for (const [name, mk] of Object.entries(shapes)) {
  for (const s of [0.001, 0.002, 0.01, 0.05, 0.1, 0.5, 1, 5]) {
    for (const e of [0, 10, 100, 1e3, 1e4, 1e5, 1e6]) {
      out.push({ id: `e12-${name}-s${s}-e${e}`, script: mk(s, e === 0 ? '[0, 0, 0]' : `[${e}, ${-e}, ${e}]`), occt: true });
    }
  }
}
export default out;
