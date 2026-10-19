// E19 (round 4): the ring ratio boundaries, inclusive ends. across / tubeAcross from 2.05 to 50 is the supported range.
const out = [];
for (const [a, t] of [[2.05, 1], [4.1, 2], [8.2, 4], [20.5, 10], [41, 20], [82, 40], [205, 100], [2.0501, 1], [2.06, 1], [2.1, 1], [2.04, 1], [2.0499, 1], [2.0, 1],
  [25, 0.5], [50, 1], [100, 2], [250, 5], [500, 10], [50.5, 1], [26, 0.5], [60, 1]]) {
  out.push({ id: `e19-ring-${a}-${t}`, script: `ring(${a}, ${t});`, occt: true });
}
export default out;
