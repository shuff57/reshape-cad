const out = [];
for (const s of [2, 200]) for (const e of [1e3, 3e3, 1e4]) {
  const a = `[${e}, ${-e}, ${e}]`;
  out.push({ id: `e7b-sph-s${s}-e${e}`, script: `sphere(${s}, { at: ${a} });` });
  out.push({ id: `e7b-ring-s${s}-e${e}`, script: `ring(${s * 2}, ${s / 2}, { at: ${a} });` });
}
export default out;
