// E1: box corner near half the shortest side. scales x shortest-axis x gap. gap g: corner = half*(1-g).
const out = [];
const f = (v) => +v.toPrecision(12);
for (const [sc, base] of [['s0.1', 0.1], ['s1', 1], ['s10', 10]]) {
  const half = 6 * base; // shortest side 12*base
  [[12, 20, 30], [20, 12, 30], [20, 30, 12]].forEach((sz, ai) => {
    const ax = 'XYZ'[ai];
    for (const g of [1e-1, 1e-2, 1e-3, 3e-4, 1e-4, 3e-5, 1e-5, 1e-6, 1e-8, 0, -1e-6, -1e-3, -1e-1]) {
      const c = f(half * (1 - g));
      out.push({ id: `e1-${sc}-${ax}-g${g}`, script: `box(${sz.map((v) => f(v * base)).join(', ')}, { corner: ${c} });` });
    }
  });
}
export default out;
