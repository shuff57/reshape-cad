// E4: ring envelope. across A, ratio k = across / tubeAcross. Time + accuracy.
const out = []; const f = (v) => +v.toPrecision(10);
for (const A of [4, 40, 400]) {
  for (const k of [2.05, 2.2, 2.5, 3, 4, 6, 10, 20, 30, 40, 50, 60, 80, 100]) {
    out.push({ id: `e4-ring-A${A}-k${k}`, script: `ring(${A}, ${f(A / k)});` });
  }
}
export default out;
