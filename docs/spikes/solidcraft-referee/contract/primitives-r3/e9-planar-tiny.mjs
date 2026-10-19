// E9: planar primitives at the small end (and a mid-size control).
const out = [];
for (const s of [1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
  out.push({ id: `e9-box-${s}`, script: `box(${s}, ${s * 1.5}, ${s * 2});` });
  out.push({ id: `e9-prism6-${s}`, script: `prism(6, ${s}, ${s * 1.5});` });
  out.push({ id: `e9-prism7-${s}`, script: `prism(7, ${s}, ${s * 1.5});` });
  out.push({ id: `e9-wedge-${s}`, script: `wedge(${s}, ${s * 1.5}, ${s * 2});` });
  out.push({ id: `e9-tbox-${s}`, script: `turn(box(${s}, ${s * 1.5}, ${s * 2}), [20, 35, 50]);` });
}
// one dimension tiny, others normal (thin plates and slivers)
for (const t of [1e-2, 1e-3, 1e-4, 1e-5]) {
  out.push({ id: `e9-plate-box-${t}`, script: `box(100, 100, ${t});` });
  out.push({ id: `e9-plate-prism-${t}`, script: `prism(7, 100, ${t});` });
  out.push({ id: `e9-plate-wedge-${t}`, script: `wedge(100, 100, ${t});` });
  out.push({ id: `e9-sliver-prism-${t}`, script: `prism(7, ${t}, 100);` });
  out.push({ id: `e9-sliver-box-${t}`, script: `box(${t}, 100, 100);` });
}
export default out;
