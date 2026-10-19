// E6b: planar primitives that are long and thin, far from the origin. offset = q * L, L = largest typed dimension.
const out = []; const f = (v) => +v.toPrecision(12);
const shapes = {
  'prism6-needle': { L: 200, mk: (a) => `prism(6, 2, 200, { at: ${a} });` },
  'prism6-plate': { L: 200, mk: (a) => `prism(6, 200, 2, { at: ${a} });` },
  'prism7-needle': { L: 300, mk: (a) => `prism(7, 1, 300, { at: ${a} });` },
  'tbox-needle': { L: 300, mk: (a) => `turn(box(2, 3, 300, { at: ${a} }), [20, 35, 50]);` },
  'tbox-plate': { L: 300, mk: (a) => `turn(box(300, 200, 1, { at: ${a} }), [20, 35, 50]);` },
  'tprism6-plate': { L: 300, mk: (a) => `turn(prism(6, 300, 1, { at: ${a} }), [20, 35, 50]);` },
  'twedge-needle': { L: 300, mk: (a) => `turn(wedge(2, 3, 300, { at: ${a} }), [20, 35, 50]);` },
  'twedge-plate': { L: 300, mk: (a) => `turn(wedge(300, 200, 1, { at: ${a} }), [20, 35, 50]);` },
};
for (const [name, s] of Object.entries(shapes)) {
  for (const q of [5, 10, 20, 40, 80, 160, 320]) {
    const e = f(q * s.L);
    out.push({ id: `e6b-${name}-q${q}`, script: s.mk(`[${e}, ${-e}, ${e}]`) });
  }
}
export default out;
