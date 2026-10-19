// E7: curved primitives far from the origin, by part size and offset (cylinder = fast, dense; sphere/ring/cone/boxr = spot checks).
const out = []; const f = (v) => +v.toPrecision(10);
for (const s of [2, 20, 200, 2000]) for (const e of [1e2, 3e2, 1e3, 2e3, 3e3, 5e3, 1e4, 3e4, 1e5]) {
  const a = `[${e}, ${-e}, ${e}]`;
  out.push({ id: `e7-cyl-s${s}-e${e}`, script: `cylinder(${s}, ${f(s * 1.5)}, { at: ${a} });` });
  out.push({ id: `e7-cone-s${s}-e${e}`, script: `cone(${s}, ${f(s * 1.5)}, { at: ${a} });` });
  out.push({ id: `e7-boxr-s${s}-e${e}`, script: `box(${s}, ${s}, ${s}, { corner: ${f(s * 0.15)}, at: ${a} });` });
}
export default out;
